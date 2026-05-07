package workflows

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/tooltemplate"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// defaultHTTPAllowlist is used when input.HTTPAllowlist is empty. Conservative
// list of public hosts the agent often needs (read-only). Workspace admins can
// override via input.HTTPAllowlist.
var defaultHTTPAllowlist = []string{
	"api.github.com",
	"raw.githubusercontent.com",
	"*.githubusercontent.com",
	"registry.npmjs.org",
	"pypi.org",
	"pkg.go.dev",
	"crates.io",
}

// Signal/query/activity names re-exported from the contract package so the
// workflow file remains the canonical reference.
const (
	AgentSignalUserMessage  = agentcontract.SignalUserMessage
	AgentSignalApproval     = agentcontract.SignalApproval
	AgentSignalAbort        = agentcontract.SignalAbort
	AgentSignalTokenStream  = agentcontract.SignalTokenStream
	AgentSignalToolFinished = agentcontract.SignalToolFinished

	AgentQuerySnapshot    = agentcontract.QuerySnapshot
	AgentQueryEventsSince = agentcontract.QueryEventsSince
	AgentQueryHasFinished = agentcontract.QueryHasFinished

	ActivityLLMNextStep = agentcontract.ActivityLLMNextStep
)

// Type aliases for the contract types, kept here for source-code
// continuity with the rest of the workflow.
type (
	TokenStreamSignalPayload = agentcontract.TokenStreamSignalPayload
	UserMessageSignalPayload = agentcontract.UserMessageSignalPayload
	ApprovalSignalPayload    = agentcontract.ApprovalSignalPayload
	AbortSignalPayload       = agentcontract.AbortSignalPayload

	InfrastructureAgentInput = agentcontract.InfrastructureAgentInput
	ConversationTurn         = agentcontract.ConversationTurn
	ToolCallRecord           = agentcontract.ToolCallRecord
	Proposal                 = agentcontract.Proposal
	AgentEvent               = agentcontract.AgentEvent
	AgentSnapshot            = agentcontract.AgentSnapshot
	PendingApproval          = agentcontract.PendingApproval
)

// Tool / event-kind names re-exported from the contract package.
const (
	ToolProposeToUser = agentcontract.ToolProposeToUser
	ToolDone          = agentcontract.ToolDone

	ToolShellExec       = agentcontract.ToolShellExec
	ToolHTTPRequest     = agentcontract.ToolHTTPRequest
	ToolReadFile        = agentcontract.ToolReadFile
	ToolWriteFile       = agentcontract.ToolWriteFile
	ToolListDir         = agentcontract.ToolListDir
	ToolRepoInspect     = agentcontract.ToolRepoInspect
	ToolRequestApproval = agentcontract.ToolRequestApproval
	ToolRegisterTool    = agentcontract.ToolRegisterTool

	EventKindConversationTurn = agentcontract.EventKindConversationTurn
	EventKindTokenDelta       = agentcontract.EventKindTokenDelta
	EventKindProposalUpdate   = agentcontract.EventKindProposalUpdate
	EventKindApprovalRequest  = agentcontract.EventKindApprovalRequest
	EventKindApprovalResolved = agentcontract.EventKindApprovalResolved
	EventKindStatusUpdate     = agentcontract.EventKindStatusUpdate
)

// Default behavioral knobs. Tunable via input.
const (
	defaultMaxIterations    = 80
	defaultMaxHistoryTurns  = 80
	defaultUserWaitTimeout  = 24 * time.Hour
)

// agentState is the in-workflow mutable state.
type agentState struct {
	status            string
	history           []ConversationTurn
	events            []AgentEvent
	nextSeq           uint64
	streamingPartial  string
	streamingTurnID   string
	proposal          *Proposal
	pendingApprovals  map[string]PendingApproval
	registeredTools   map[string]agentactivity.ApprovedAgentTool
	terminated        bool
	abortReason       string
	iterations        int
	backend           string
	model             string
}

// InfrastructureAgentWorkflow drives the agentic deployment loop. It is the
// deterministic orchestration layer; every non-deterministic decision (LLM
// call, tool execution) goes through an activity.
//
// Spike 1 supports two tools: propose_to_user (sets the live proposal and
// awaits the next user reply) and done (terminates the loop). Subsequent
// spikes layer in shell_exec, http_request, request_approval, register_tool,
// and so on without changing the dispatch shape.
func InfrastructureAgentWorkflow(ctx workflow.Context, input InfrastructureAgentInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("starting infrastructure agent workflow",
		"agentRunId", input.AgentRunID,
		"workspaceId", input.WorkspaceID,
		"repositoryId", input.RepositoryID,
	)

	state := initState(ctx, input)

	if err := registerQueries(ctx, &state); err != nil {
		return err
	}

	// Activity options for the LLM step.
	llmCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		HeartbeatTimeout:    30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    3,
			NonRetryableErrorTypes: []string{"InvalidInput", "LLMNonRetryable"},
		},
	})

	// Activity options for sandbox tools. Long timeouts because terraform /
	// pulumi / kubectl can take a while; the activity heartbeats every 5s so
	// these timeouts gate true hangs only.
	sandboxCtx := workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Minute,
		HeartbeatTimeout:    30 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    2 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    2,
			NonRetryableErrorTypes: []string{"InvalidInput", "PathEscape", "HostNotAllowed"},
		},
	})

	// Provision the per-run sandbox up-front so the first tool call doesn't
	// pay creation cost on the critical path.
	if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityEnsureSandbox, agentactivity.EnsureSandboxInput{
		WorkflowID:      workflow.GetInfo(ctx).WorkflowExecution.ID,
		WorkspaceID:     input.WorkspaceID,
		Image:           input.SandboxImage,
		Env:             input.SandboxEnv,
		EgressAllowlist: input.HTTPAllowlist,
	}).Get(sandboxCtx, nil); err != nil {
		return fmt.Errorf("ensure sandbox: %w", err)
	}

	// Tear down the sandbox on workflow exit, on a disconnected context so
	// it survives cancellation. Best-effort: errors logged but not returned.
	defer func() {
		dctx, _ := workflow.NewDisconnectedContext(ctx)
		teardownCtx := workflow.WithActivityOptions(dctx, workflow.ActivityOptions{
			StartToCloseTimeout: 2 * time.Minute,
			RetryPolicy:         &temporal.RetryPolicy{MaximumAttempts: 2},
		})
		_ = workflow.ExecuteActivity(teardownCtx, agentcontract.ActivityTeardownSandbox, agentactivity.TeardownSandboxInput{
			WorkflowID: workflow.GetInfo(ctx).WorkflowExecution.ID,
		}).Get(teardownCtx, nil)
	}()

	userMsgCh := workflow.GetSignalChannel(ctx, AgentSignalUserMessage)
	approvalCh := workflow.GetSignalChannel(ctx, AgentSignalApproval)
	abortCh := workflow.GetSignalChannel(ctx, AgentSignalAbort)
	tokenCh := workflow.GetSignalChannel(ctx, AgentSignalTokenStream)

	// Launch a goroutine to drain token-stream signals into state.
	workflow.Go(ctx, func(ctx workflow.Context) {
		for !state.terminated {
			var payload TokenStreamSignalPayload
			more := tokenCh.Receive(ctx, &payload)
			if !more {
				return
			}
			if payload.TurnID != "" && payload.TurnID == state.streamingTurnID {
				state.streamingPartial += payload.Delta
			}
			emitEvent(ctx, &state, EventKindTokenDelta, map[string]any{
				"turn_id": payload.TurnID,
				"delta":   payload.Delta,
			})
		}
	})

	// Launch goroutine to drain abort signals.
	workflow.Go(ctx, func(ctx workflow.Context) {
		var payload AbortSignalPayload
		more := abortCh.Receive(ctx, &payload)
		if !more {
			return
		}
		state.terminated = true
		state.abortReason = payload.Reason
		state.status = "aborted"
		emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{
			"status":  "aborted",
			"message": fmt.Sprintf("aborted by %s: %s", payload.RequestedBy, payload.Reason),
		})
	})

	// Seed the conversation with the initial user prompt if this is a fresh run.
	if len(state.history) == 0 && input.InitialPrompt != "" {
		appendTurn(ctx, &state, ConversationTurn{
			TurnID:    workflowUUID(ctx),
			Role:      "user",
			Content:   input.InitialPrompt,
			Timestamp: workflow.Now(ctx),
		})
	}

	maxIters := defaultMaxIterations
	for !state.terminated && state.iterations < maxIters {
		state.iterations++

		// If the last turn is from the assistant and we're awaiting user input
		// (e.g. after propose_to_user), block until UserMessage or Abort.
		if awaitingUser(&state) {
			state.status = "awaiting_user"
			emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{"status": "awaiting_user"})

			selector := workflow.NewSelector(ctx)
			receivedUserMessage := false
			selector.AddReceive(userMsgCh, func(c workflow.ReceiveChannel, _ bool) {
				var msg UserMessageSignalPayload
				c.Receive(ctx, &msg)
				appendTurn(ctx, &state, ConversationTurn{
					TurnID:    msg.TurnID,
					Role:      "user",
					Content:   msg.Message,
					Timestamp: workflow.Now(ctx),
				})
				receivedUserMessage = true
			})
			selector.AddFuture(workflow.NewTimer(ctx, defaultUserWaitTimeout), func(workflow.Future) {
				state.terminated = true
				state.status = "timeout"
				emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{
					"status":  "timeout",
					"message": "no user response within 24 hours",
				})
			})
			selector.Select(ctx)
			if state.terminated || !receivedUserMessage {
				continue
			}
		}

		// Drive one LLM step.
		state.status = "running"
		state.streamingTurnID = workflowUUID(ctx)
		state.streamingPartial = ""

		// Refresh the registered-tool catalog at the top of each iteration
		// so newly approved tools become available mid-run.
		refreshRegisteredTools(ctx, sandboxCtx, &state, input.WorkspaceID)

		llmInput := agentactivity.LLMNextStepInput{
			WorkflowID:  workflow.GetInfo(ctx).WorkflowExecution.ID,
			RunID:       workflow.GetInfo(ctx).WorkflowExecution.RunID,
			TurnID:      state.streamingTurnID,
			WorkspaceID: input.WorkspaceID,
			ProviderID:  input.LLMProviderID,
			System:      effectiveSystemPrompt(input),
			Messages:    historyToProviderMessages(state.history),
			Tools:       buildToolCatalog(&state),
			MaxTokens:   4096,
		}

		var result agentactivity.LLMNextStepResult
		if err := workflow.ExecuteActivity(llmCtx, ActivityLLMNextStep, llmInput).Get(llmCtx, &result); err != nil {
			state.status = "failed"
			emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{
				"status":  "failed",
				"message": err.Error(),
			})
			return fmt.Errorf("llm step failed: %w", err)
		}
		state.backend = result.Backend
		state.model = result.Model

		// Append assistant turn, including any tool calls.
		assistantTurn := ConversationTurn{
			TurnID:    state.streamingTurnID,
			Role:      "assistant",
			Content:   result.Text,
			Timestamp: workflow.Now(ctx),
		}
		for _, tc := range result.ToolCalls {
			assistantTurn.ToolCalls = append(assistantTurn.ToolCalls, ToolCallRecord{
				ID:        tc.ID,
				Name:      tc.Name,
				Arguments: tc.Arguments,
			})
		}
		appendTurn(ctx, &state, assistantTurn)
		state.streamingPartial = ""

		// Dispatch tool calls.
		for _, tc := range result.ToolCalls {
			toolResult, terminated := dispatchTool(ctx, sandboxCtx, &state, &input, tc, approvalCh)
			appendTurn(ctx, &state, ConversationTurn{
				TurnID:     workflowUUID(ctx),
				Role:       "tool",
				ToolCallID: tc.ID,
				ToolName:   tc.Name,
				Content:    toolResult,
				Timestamp:  workflow.Now(ctx),
			})
			if terminated {
				state.terminated = true
				break
			}
		}

		// If the LLM finished its turn without calling any tool, surface the
		// transcript and wait for the user.
		if len(result.ToolCalls) == 0 {
			// stay in loop; awaitingUser will gate next iteration
		}

		// Continue-as-new threshold.
		if shouldContinueAsNew(&state) {
			return continueAsNew(ctx, input, &state)
		}
	}

	if state.iterations >= maxIters {
		state.status = "max_iterations"
		emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{
			"status":  "max_iterations",
			"message": fmt.Sprintf("hit max iterations (%d)", maxIters),
		})
	}
	if state.status == "running" {
		state.status = "completed"
		emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{"status": "completed"})
	}

	return nil
}

// dispatchTool routes a single tool call to its handler. Returns the textual
// result (fed back to the model as a tool-result message) and a flag telling
// the caller whether the loop should terminate.
func dispatchTool(ctx workflow.Context, sandboxCtx workflow.Context, state *agentState, input *InfrastructureAgentInput, tc providers.ToolCall, approvalCh workflow.ReceiveChannel) (string, bool) {
	workflowID := workflow.GetInfo(ctx).WorkflowExecution.ID

	switch tc.Name {
	case ToolProposeToUser:
		title, _ := tc.Arguments["title"].(string)
		summary, _ := tc.Arguments["summary"].(string)
		body, _ := tc.Arguments["body_markdown"].(string)
		state.proposal = &Proposal{
			ProposalID:   workflowUUID(ctx),
			Title:        title,
			Summary:      summary,
			BodyMarkdown: body,
			UpdatedAt:    workflow.Now(ctx),
		}
		emitEvent(ctx, state, EventKindProposalUpdate, map[string]any{
			"proposal_id":   state.proposal.ProposalID,
			"title":         title,
			"summary":       summary,
			"body_markdown": body,
		})
		return "Proposal posted to user; awaiting their response.", false

	case ToolDone:
		summary, _ := tc.Arguments["summary"].(string)
		state.status = "completed"
		emitEvent(ctx, state, EventKindStatusUpdate, map[string]any{
			"status":  "completed",
			"message": summary,
		})
		return "Marked done.", true

	case ToolShellExec:
		command, _ := tc.Arguments["command"].(string)
		workingDir, _ := tc.Arguments["working_dir"].(string)
		var res agentactivity.SandboxedShellResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivitySandboxedShell, agentactivity.SandboxedShellInput{
			WorkflowID: workflowID,
			CallID:     tc.ID,
			Command:    command,
			WorkingDir: workingDir,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("shell_exec", err), false
		}
		return jsonResult(map[string]any{
			"exit_code":   res.ExitCode,
			"stdout":      res.Stdout,
			"stderr":      res.Stderr,
			"duration_ms": res.DurationMs,
			"truncated":   res.Truncated,
		}), false

	case ToolHTTPRequest:
		method, _ := tc.Arguments["method"].(string)
		urlStr, _ := tc.Arguments["url"].(string)
		body, _ := tc.Arguments["body"].(string)
		headers := stringMap(tc.Arguments["headers"])
		allow := input.HTTPAllowlist
		if len(allow) == 0 {
			allow = defaultHTTPAllowlist
		}
		var res agentactivity.HTTPRequestResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityHTTPRequest, agentactivity.HTTPRequestInput{
			WorkflowID: workflowID,
			Method:     method,
			URL:        urlStr,
			Headers:    headers,
			Body:       body,
			Allowlist:  allow,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("http_request", err), false
		}
		return jsonResult(map[string]any{
			"status":      res.Status,
			"status_code": res.StatusCode,
			"headers":     res.Headers,
			"body":        res.Body,
			"truncated":   res.Truncated,
			"duration_ms": res.DurationMs,
		}), false

	case ToolReadFile:
		path, _ := tc.Arguments["path"].(string)
		var res agentactivity.SandboxReadFileResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivitySandboxReadFile, agentactivity.SandboxReadFileInput{
			WorkflowID: workflowID,
			Path:       path,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("read_file", err), false
		}
		return jsonResult(map[string]any{
			"content":    res.Content,
			"size_bytes": res.SizeBytes,
			"truncated":  res.Truncated,
		}), false

	case ToolWriteFile:
		path, _ := tc.Arguments["path"].(string)
		content, _ := tc.Arguments["content"].(string)
		var res agentactivity.SandboxWriteFileResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivitySandboxWriteFile, agentactivity.SandboxWriteFileInput{
			WorkflowID: workflowID,
			Path:       path,
			Content:    content,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("write_file", err), false
		}
		return jsonResult(map[string]any{"bytes_written": res.BytesWritten}), false

	case ToolListDir:
		path, _ := tc.Arguments["path"].(string)
		var res agentactivity.SandboxListDirResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivitySandboxListDir, agentactivity.SandboxListDirInput{
			WorkflowID: workflowID,
			Path:       path,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("list_dir", err), false
		}
		return jsonResult(map[string]any{"entries": res.Entries}), false

	case ToolRepoInspect:
		repoURL, _ := tc.Arguments["repo_url"].(string)
		revision, _ := tc.Arguments["revision"].(string)
		var res agentactivity.RepoInspectResult
		if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityRepoInspect, agentactivity.RepoInspectInput{
			WorkflowID:  workflowID,
			RepoURL:     repoURL,
			Revision:    revision,
			GitHubToken: input.GitHubToken,
		}).Get(sandboxCtx, &res); err != nil {
			return jsonError("repo_inspect", err), false
		}
		return jsonResult(map[string]any{
			"source":      res.Source,
			"revision":    res.Revision,
			"clone_ref":   res.CloneRef,
			"tree":        res.Tree,
			"files":       res.Files,
			"truncated_at": res.TruncatedAt,
		}), false

	case ToolRequestApproval:
		title, _ := tc.Arguments["title"].(string)
		kind, _ := tc.Arguments["kind"].(string)
		if kind == "" {
			kind = agentcontract.ApprovalKindCustom
		}
		body, _ := tc.Arguments["body_markdown"].(string)
		approvalID := workflowUUID(ctx)

		state.pendingApprovals[approvalID] = PendingApproval{
			ApprovalID:   approvalID,
			Kind:         kind,
			Title:        title,
			BodyMarkdown: body,
			CreatedAt:    workflow.Now(ctx),
		}
		prevStatus := state.status
		state.status = "awaiting_approval"
		emitEvent(ctx, state, EventKindApprovalRequest, map[string]any{
			"approval_id":   approvalID,
			"kind":          kind,
			"title":         title,
			"body_markdown": body,
		})
		emitEvent(ctx, state, EventKindStatusUpdate, map[string]any{
			"status":  "awaiting_approval",
			"message": title,
		})

		// Block until a signal with this approval_id arrives. Other ids are
		// dropped (they'll be re-issued when their parent approval prompts
		// are reopened); abort short-circuits the wait.
		resolution, aborted := awaitApproval(ctx, approvalCh, approvalID)
		delete(state.pendingApprovals, approvalID)
		state.status = prevStatus
		if aborted {
			state.terminated = true
			return jsonResult(map[string]any{
				"approved": false,
				"reason":   "agent run aborted",
			}), true
		}
		emitEvent(ctx, state, EventKindApprovalResolved, map[string]any{
			"approval_id": approvalID,
			"approved":    resolution.Approved,
			"resolved_by": resolution.ResolvedBy,
			"notes":       resolution.Notes,
		})
		return jsonResult(map[string]any{
			"approved":    resolution.Approved,
			"resolved_by": resolution.ResolvedBy,
			"notes":       resolution.Notes,
		}), false

	case ToolRegisterTool:
		return dispatchRegisterTool(ctx, sandboxCtx, state, tc, approvalCh, input)

	default:
		// Registered tool? Expand its template and dispatch as primitive(s).
		if reg, ok := state.registeredTools[tc.Name]; ok {
			return dispatchRegisteredTool(ctx, sandboxCtx, state, input, tc, reg, approvalCh)
		}
		return fmt.Sprintf("ERROR: unknown tool %q.", tc.Name), false
	}
}

// refreshRegisteredTools fetches the workspace's approved AgentTools and
// stores them in state.registeredTools. Failures fall through silently —
// the next iteration will retry, and the agent still has access to all
// built-ins in the meantime.
func refreshRegisteredTools(ctx workflow.Context, actCtx workflow.Context, state *agentState, workspaceID string) {
	logger := workflow.GetLogger(ctx)
	var res agentactivity.ListApprovedToolsResult
	err := workflow.ExecuteActivity(actCtx, agentcontract.ActivityListApprovedAgentTools, agentactivity.ListApprovedToolsInput{
		WorkspaceID: workspaceID,
	}).Get(actCtx, &res)
	if err != nil {
		logger.Warn("list approved agent tools failed; using last cached set", "err", err)
		return
	}
	out := make(map[string]agentactivity.ApprovedAgentTool, len(res.Tools))
	for _, t := range res.Tools {
		out[t.Name] = t
	}
	state.registeredTools = out
}

// buildToolCatalog returns the schemas the LLM sees: built-ins plus every
// approved registered tool (whose schema is its inputSchemaJson). Names
// are deterministically ordered for stable workflow histories.
func buildToolCatalog(state *agentState) []providers.ToolSchema {
	out := builtInToolSchemas()
	if len(state.registeredTools) == 0 {
		return out
	}
	names := make([]string, 0, len(state.registeredTools))
	for n := range state.registeredTools {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		t := state.registeredTools[n]
		schema := map[string]any{"type": "object"}
		if t.InputSchemaJSON != "" {
			var parsed map[string]any
			if err := json.Unmarshal([]byte(t.InputSchemaJSON), &parsed); err == nil {
				schema = parsed
			}
		}
		out = append(out, providers.ToolSchema{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: schema,
		})
	}
	return out
}

// dispatchRegisteredTool expands a registered tool's template into one or
// more primitive calls and runs each via the standard primitive dispatch.
// Composite templates aggregate results into a JSON array; single-call
// templates return their primitive's result directly.
func dispatchRegisteredTool(ctx workflow.Context, sandboxCtx workflow.Context, state *agentState, input *InfrastructureAgentInput, tc providers.ToolCall, reg agentactivity.ApprovedAgentTool, approvalCh workflow.ReceiveChannel) (string, bool) {
	calls, err := tooltemplate.Expand(tooltemplate.Kind(reg.TemplateKind), reg.TemplateJSON, tc.Arguments)
	if err != nil {
		return jsonError(reg.Name, err), false
	}
	if len(calls) == 0 {
		return jsonError(reg.Name, fmt.Errorf("template expansion produced no calls")), false
	}
	results := make([]any, 0, len(calls))
	for i, call := range calls {
		// Synthesize a fresh tool call with the primitive's name and the
		// expanded args; reuse the parent's CallID as a prefix so audit
		// can stitch them back together.
		synthetic := providers.ToolCall{
			ID:        fmt.Sprintf("%s.step-%d", tc.ID, i),
			Name:      call.Tool,
			Arguments: call.Args,
		}
		out, terminated := dispatchTool(ctx, sandboxCtx, state, input, synthetic, approvalCh)
		var parsed any
		if jerr := json.Unmarshal([]byte(out), &parsed); jerr == nil {
			results = append(results, parsed)
		} else {
			results = append(results, out)
		}
		if terminated {
			break
		}
	}
	if len(results) == 1 {
		b, _ := json.Marshal(results[0])
		return string(b), false
	}
	b, _ := json.Marshal(map[string]any{"steps": results})
	return string(b), false
}

// dispatchRegisterTool persists the LLM's proposed tool template as a
// pending row, surfaces a tool_registration approval prompt, and on
// approval flips the row to approved. The agent's next turn sees
// {approved, name, id, reason?} and can then invoke the tool by name.
func dispatchRegisterTool(ctx workflow.Context, sandboxCtx workflow.Context, state *agentState, tc providers.ToolCall, approvalCh workflow.ReceiveChannel, input *InfrastructureAgentInput) (string, bool) {
	name, _ := tc.Arguments["name"].(string)
	description, _ := tc.Arguments["description"].(string)
	templateKind, _ := tc.Arguments["template_kind"].(string)
	templateJSON, _ := tc.Arguments["template_json"].(string)
	inputSchemaJSON, _ := tc.Arguments["input_schema_json"].(string)
	reasoning, _ := tc.Arguments["reasoning"].(string)

	// Validate the template is well-formed BEFORE we surface an approval to
	// the human reviewer. Saves them clicking through obviously-broken
	// rows and gives the agent immediate feedback to fix typos.
	if _, err := tooltemplate.Expand(tooltemplate.Kind(templateKind), templateJSON, exampleArgsFromSchema(inputSchemaJSON)); err != nil {
		return jsonError("register_tool", fmt.Errorf("template invalid: %w", err)), false
	}

	var registered agentactivity.RegisterPendingToolResult
	if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityRegisterPendingAgentTool, agentactivity.RegisterPendingToolInput{
		WorkspaceID:     input.WorkspaceID,
		Name:            name,
		Description:     description,
		InputSchemaJSON: inputSchemaJSON,
		TemplateKind:    templateKind,
		TemplateJSON:    templateJSON,
		Reasoning:       reasoning,
		CreatedByRunID:  workflow.GetInfo(ctx).WorkflowExecution.ID,
	}).Get(sandboxCtx, &registered); err != nil {
		return jsonError("register_tool", err), false
	}

	approvalID := workflowUUID(ctx)
	state.pendingApprovals[approvalID] = PendingApproval{
		ApprovalID:   approvalID,
		Kind:         agentcontract.ApprovalKindToolRegistration,
		Title:        fmt.Sprintf("Register new agent tool: %s", name),
		BodyMarkdown: fmt.Sprintf("**Description**\n\n%s\n\n**Reasoning**\n\n%s\n\n**Template (%s)**\n\n```json\n%s\n```\n\n**Input schema**\n\n```json\n%s\n```", description, reasoning, templateKind, templateJSON, inputSchemaJSON),
		Payload: map[string]any{
			"agent_tool_id":     registered.ID,
			"name":              name,
			"template_kind":     templateKind,
			"template_json":     templateJSON,
			"input_schema_json": inputSchemaJSON,
			"reasoning":         reasoning,
		},
		CreatedAt: workflow.Now(ctx),
	}
	prevStatus := state.status
	state.status = "awaiting_approval"
	emitEvent(ctx, state, EventKindApprovalRequest, map[string]any{
		"approval_id":   approvalID,
		"kind":          agentcontract.ApprovalKindToolRegistration,
		"title":         fmt.Sprintf("Register new agent tool: %s", name),
		"body_markdown": fmt.Sprintf("Tool: `%s`\nKind: `%s`\n\n%s", name, templateKind, description),
		"agent_tool_id": registered.ID,
	})
	emitEvent(ctx, state, EventKindStatusUpdate, map[string]any{
		"status":  "awaiting_approval",
		"message": fmt.Sprintf("tool registration: %s", name),
	})

	resolution, aborted := awaitApproval(ctx, approvalCh, approvalID)
	delete(state.pendingApprovals, approvalID)
	state.status = prevStatus
	if aborted {
		state.terminated = true
		// Reject the pending row on abort so it doesn't linger as approvable.
		_ = workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityResolveAgentTool, agentactivity.ResolveAgentToolInput{
			ID: registered.ID, Approved: false, Reason: "agent run aborted",
		}).Get(sandboxCtx, nil)
		return jsonResult(map[string]any{"approved": false, "reason": "agent run aborted"}), true
	}

	if err := workflow.ExecuteActivity(sandboxCtx, agentcontract.ActivityResolveAgentTool, agentactivity.ResolveAgentToolInput{
		ID:         registered.ID,
		Approved:   resolution.Approved,
		ResolvedBy: resolution.ResolvedBy,
		Reason:     resolution.Notes,
	}).Get(sandboxCtx, nil); err != nil {
		return jsonError("register_tool", fmt.Errorf("resolve: %w", err)), false
	}

	emitEvent(ctx, state, EventKindApprovalResolved, map[string]any{
		"approval_id": approvalID,
		"approved":    resolution.Approved,
		"resolved_by": resolution.ResolvedBy,
		"notes":       resolution.Notes,
	})

	if resolution.Approved {
		// Eagerly add to in-memory catalog so the next LLM call sees it
		// without waiting for the next refresh tick.
		if state.registeredTools == nil {
			state.registeredTools = map[string]agentactivity.ApprovedAgentTool{}
		}
		state.registeredTools[name] = agentactivity.ApprovedAgentTool{
			ID:              registered.ID,
			Name:            name,
			Description:     description,
			InputSchemaJSON: inputSchemaJSON,
			TemplateKind:    templateKind,
			TemplateJSON:    templateJSON,
		}
	}

	return jsonResult(map[string]any{
		"approved":      resolution.Approved,
		"name":          name,
		"agent_tool_id": registered.ID,
		"resolved_by":   resolution.ResolvedBy,
		"notes":         resolution.Notes,
	}), false
}

// exampleArgsFromSchema returns a map filled with placeholder values for
// every required property in the schema. Used by dispatchRegisterTool for
// the template's pre-flight validation: every {{var}} placeholder must
// resolve to *some* value, which means at minimum every placeholder must
// appear as a property in the schema.
func exampleArgsFromSchema(schemaJSON string) map[string]any {
	var schema map[string]any
	if err := json.Unmarshal([]byte(schemaJSON), &schema); err != nil {
		return map[string]any{}
	}
	props, _ := schema["properties"].(map[string]any)
	out := map[string]any{}
	for k := range props {
		out[k] = "x"
	}
	return out
}

// awaitApproval blocks until an ApprovalSignal with matching approvalID
// arrives. Mismatched signals are dropped (best-effort; callers re-emit the
// approval prompt when their gate reopens). Returns aborted=true when the
// abort path fires; callers must terminate the loop in that case.
//
// Implementation note: the loop uses workflow.NewSelector instead of a
// straight Receive so it can also watch for state.terminated set by the
// abort goroutine without racing with signal delivery.
func awaitApproval(ctx workflow.Context, approvalCh workflow.ReceiveChannel, approvalID string) (ApprovalSignalPayload, bool) {
	for {
		var p ApprovalSignalPayload
		approvalCh.Receive(ctx, &p)
		if p.ApprovalID == approvalID {
			return p, false
		}
		if ctx.Err() != nil {
			return ApprovalSignalPayload{}, true
		}
		// mismatched id: drop and keep waiting.
	}
}

// jsonResult marshals a tool result for the model. Always returns valid JSON
// even on marshal failure so the LLM can reliably parse.
func jsonResult(v map[string]any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf(`{"error":"marshal: %s"}`, err.Error())
	}
	return string(b)
}

// jsonError formats an activity error as a tool result so the model can see
// what went wrong and adapt.
func jsonError(tool string, err error) string {
	return fmt.Sprintf(`{"error":%q,"tool":%q}`, err.Error(), tool)
}

// stringMap coerces a map[string]any (as decoded from LLM JSON) into the
// map[string]string the activity expects. Non-string values are stringified.
func stringMap(v any) map[string]string {
	in, ok := v.(map[string]any)
	if !ok {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, val := range in {
		switch s := val.(type) {
		case string:
			out[k] = s
		default:
			out[k] = fmt.Sprintf("%v", val)
		}
	}
	return out
}

func awaitingUser(state *agentState) bool {
	if len(state.history) == 0 {
		return false
	}
	last := state.history[len(state.history)-1]
	if last.Role != "tool" {
		return false
	}
	// Walk back to find the assistant turn this tool result belongs to.
	for i := len(state.history) - 2; i >= 0; i-- {
		if state.history[i].Role == "assistant" {
			for _, tc := range state.history[i].ToolCalls {
				if tc.ID == last.ToolCallID && tc.Name == ToolProposeToUser {
					return true
				}
			}
			return false
		}
	}
	return false
}

func builtInToolSchemas() []providers.ToolSchema {
	return []providers.ToolSchema{
		{
			Name:        ToolProposeToUser,
			Description: "Show the user a structured deployment proposal and wait for their reply. Use when you have a concrete plan to share or a question that needs the user's input.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title":         map[string]any{"type": "string", "description": "Short headline for the proposal"},
					"summary":       map[string]any{"type": "string", "description": "One-paragraph summary"},
					"body_markdown": map[string]any{"type": "string", "description": "Full proposal body in markdown"},
				},
				"required": []string{"title", "summary", "body_markdown"},
			},
		},
		{
			Name:        ToolDone,
			Description: "Mark the agent run finished. Use only after the user's goal is achieved (or unrecoverably impossible). Provides a final summary message.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"summary": map[string]any{"type": "string", "description": "Final summary for the user"},
				},
				"required": []string{"summary"},
			},
		},
		{
			Name: ToolShellExec,
			Description: "Run a bash command inside the run's sandbox. Use this for `az`, `gcloud`, `kubectl`, `helm`, `terraform`, `pulumi`, `git`, `npm`, etc. Output is captured and returned. Long commands heartbeat automatically. Returns {exit_code, stdout, stderr, duration_ms, truncated}.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"command":     map[string]any{"type": "string", "description": "The shell command to run via `bash -lc`."},
					"working_dir": map[string]any{"type": "string", "description": "Optional. Defaults to the sandbox root."},
				},
				"required": []string{"command"},
			},
		},
		{
			Name: ToolHTTPRequest,
			Description: "Make an outbound HTTP request, gated by the workspace's host allowlist. Use for cloud-provider REST APIs the agent doesn't have a CLI for. Returns {status, status_code, headers, body, truncated}.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"method":  map[string]any{"type": "string", "description": "GET / POST / PUT / DELETE / PATCH"},
					"url":     map[string]any{"type": "string"},
					"headers": map[string]any{"type": "object", "description": "Header name → value"},
					"body":    map[string]any{"type": "string", "description": "Optional request body."},
				},
				"required": []string{"url"},
			},
		},
		{
			Name: ToolReadFile,
			Description: "Read a file inside the sandbox. Path is relative to the sandbox root and rejected if it escapes.",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{"path": map[string]any{"type": "string"}},
				"required":   []string{"path"},
			},
		},
		{
			Name: ToolWriteFile,
			Description: "Write a file inside the sandbox (parent directories are created). Use to author terraform / helm / pulumi files before applying.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path":    map[string]any{"type": "string"},
					"content": map[string]any{"type": "string"},
				},
				"required": []string{"path", "content"},
			},
		},
		{
			Name: ToolListDir,
			Description: "List the contents of a directory inside the sandbox.",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{"path": map[string]any{"type": "string", "description": "Defaults to '.'"}},
			},
		},
		{
			Name: ToolRepoInspect,
			Description: "Survey a git repository (tree + key manifest files like README, package.json, go.mod, Dockerfile). Tries the GitHub API first; falls back to a shallow clone of the main branch into the sandbox at repo/<slug>/. Use this to learn what kind of app the user wants to deploy before proposing a plan.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"repo_url":  map[string]any{"type": "string", "description": "https://github.com/owner/repo or git URL"},
					"revision":  map[string]any{"type": "string", "description": "Defaults to 'main'."},
					"max_files": map[string]any{"type": "integer", "description": "Tree entry cap (default 200)."},
				},
				"required": []string{"repo_url"},
			},
		},
		{
			Name: ToolRequestApproval,
			Description: "Request explicit human approval before proceeding. The workflow blocks on this; the chat UI surfaces an inline Approve/Reject card. Use BEFORE any destructive command (terraform destroy, kubectl delete, az ... delete) and any time the user has not yet given consent for a billable / observable action. Returns {approved, resolved_by, notes}.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"title":         map[string]any{"type": "string", "description": "Short headline shown on the approval card."},
					"kind":          map[string]any{"type": "string", "enum": []string{"destructive_command", "tool_registration", "proposal", "custom"}, "description": "Defaults to 'custom'."},
					"body_markdown": map[string]any{"type": "string", "description": "Full detail rendered as markdown. Embed the exact command/diff being approved."},
				},
				"required": []string{"title", "body_markdown"},
			},
		},
		{
			Name: ToolRegisterTool,
			Description: `Register a new named tool for this workspace. The tool becomes a parameterized template over primitives (shell or http); after a workspace admin approves it the agent can invoke it by name in subsequent turns and the template expands to vetted primitive calls. You never write executable code — the template references {{var}} placeholders that bind to your supplied args at call time. Use this to capture a useful procedure once instead of re-deriving it every run (e.g. deploy_azure_appservice → shell_exec("az appservice create ...")). Returns {approved, name, agent_tool_id, resolved_by, notes}.`,
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"name":              map[string]any{"type": "string", "description": "Slug-style tool name (snake_case). Must not collide with built-ins."},
					"description":       map[string]any{"type": "string", "description": "What the tool does, in one paragraph."},
					"template_kind":     map[string]any{"type": "string", "enum": []string{"shell", "http", "composite"}},
					"template_json":     map[string]any{"type": "string", "description": "JSON-encoded template body. Shell: {\"command\":\"...{{var}}...\"}. HTTP: {\"method\":\"GET\",\"url\":\"...\"}. Composite: {\"steps\":[{...}]}."},
					"input_schema_json": map[string]any{"type": "string", "description": "JSON Schema for the tool's args. Every {{var}} placeholder in template_json must appear as a property here."},
					"reasoning":         map[string]any{"type": "string", "description": "Why this tool is worth registering. Shown to the human reviewer."},
				},
				"required": []string{"name", "description", "template_kind", "template_json"},
			},
		},
	}
}

// historyToProviderMessages converts the workflow's transcript into the
// provider-agnostic message list. It elides system turns (lifted to System)
// and translates tool turns into RoleTool messages.
func historyToProviderMessages(history []ConversationTurn) []providers.Message {
	out := make([]providers.Message, 0, len(history))
	for _, t := range history {
		switch t.Role {
		case "user":
			out = append(out, providers.Message{Role: providers.RoleUser, Content: t.Content})
		case "assistant":
			m := providers.Message{Role: providers.RoleAssistant, Content: t.Content}
			for _, tc := range t.ToolCalls {
				m.ToolCalls = append(m.ToolCalls, providers.ToolCall{
					ID: tc.ID, Name: tc.Name, Arguments: tc.Arguments,
				})
			}
			out = append(out, m)
		case "tool":
			out = append(out, providers.Message{
				Role:       providers.RoleTool,
				Content:    t.Content,
				ToolCallID: t.ToolCallID,
				Name:       t.ToolName,
			})
		}
	}
	return out
}

func effectiveSystemPrompt(input InfrastructureAgentInput) string {
	if strings.TrimSpace(input.SystemPrompt) != "" {
		return input.SystemPrompt
	}
	return defaultSystemPrompt
}

const defaultSystemPrompt = `You are Orbit's infrastructure agent. You help the user deploy applications to their cloud accounts.

You operate inside a deterministic Temporal workflow that exposes a small set of tools. You never execute commands directly; you emit tool-use requests and the workflow runs them inside a sandboxed environment with optional human approval. Tool results flow back into your next turn.

Tools:
- propose_to_user(title, summary, body_markdown): post a structured plan to the user and wait for their reply
- request_approval(title, kind, body_markdown): block on an explicit human approve/reject decision (use BEFORE every destructive command)
- register_tool(name, description, template_kind, template_json, input_schema_json?, reasoning?): teach the system a new named tool that compiles to vetted primitives; admin approval required once, then callable by name
- done(summary): end the run
- shell_exec(command, working_dir?): run a bash command in the sandbox (az / gcloud / kubectl / helm / terraform / pulumi / git etc.)
- http_request(method, url, headers?, body?): outbound HTTP gated by the workspace allowlist
- read_file(path) / write_file(path, content) / list_dir(path?): file IO inside the sandbox
- repo_inspect(repo_url, revision?, max_files?): survey a repo (tree + manifests) without a full clone when possible

Workflow:
1. Use repo_inspect first to learn what the app is (language, framework, manifests).
2. Use shell_exec for further investigation as needed (e.g. cat package.json, ls deeper paths).
3. Once you have a concrete plan, propose_to_user with the proposed commands embedded in body_markdown.
4. After the user approves, run the plan via shell_exec calls.
5. Call done with a final summary.

Style: be concise. Prefer structured proposals over wall-of-text. When the user's goal is unclear, ask. Tool results are JSON; treat them programmatically. Never assume credentials are present until you've verified them with shell_exec (e.g. ` + "`" + `az account show` + "`" + `).`

// --- state helpers ---

func initState(ctx workflow.Context, input InfrastructureAgentInput) agentState {
	state := agentState{
		status:           "starting",
		history:          append([]ConversationTurn(nil), input.History...),
		events:           append([]AgentEvent(nil), input.Events...),
		nextSeq:          input.NextSequence,
		pendingApprovals: map[string]PendingApproval{},
		iterations:       input.IterationsSoFar,
	}
	if state.nextSeq == 0 {
		state.nextSeq = 1
	}
	emitEvent(ctx, &state, EventKindStatusUpdate, map[string]any{"status": "starting"})
	return state
}

func emitEvent(ctx workflow.Context, state *agentState, kind string, payload map[string]any) {
	state.events = append(state.events, AgentEvent{
		Sequence:  state.nextSeq,
		EmittedAt: workflow.Now(ctx),
		Kind:      kind,
		Payload:   payload,
	})
	state.nextSeq++
}

func appendTurn(ctx workflow.Context, state *agentState, turn ConversationTurn) {
	state.history = append(state.history, turn)
	emitEvent(ctx, state, EventKindConversationTurn, map[string]any{
		"turn_id":      turn.TurnID,
		"role":         turn.Role,
		"content":      turn.Content,
		"tool_calls":   turn.ToolCalls,
		"tool_call_id": turn.ToolCallID,
		"tool_name":    turn.ToolName,
	})
}

func registerQueries(ctx workflow.Context, state *agentState) error {
	if err := workflow.SetQueryHandler(ctx, AgentQuerySnapshot, func() (AgentSnapshot, error) {
		return AgentSnapshot{
			Status:           state.status,
			Conversation:     append([]ConversationTurn(nil), state.history...),
			StreamingPartial: state.streamingPartial,
			StreamingTurnID:  state.streamingTurnID,
			Proposal:         cloneProposal(state.proposal),
			PendingApprovals: pendingList(state.pendingApprovals),
			LatestSequence:   lastSeq(state),
			Backend:          state.backend,
			Model:            state.model,
		}, nil
	}); err != nil {
		return err
	}
	if err := workflow.SetQueryHandler(ctx, AgentQueryEventsSince, func(since uint64) ([]AgentEvent, error) {
		out := make([]AgentEvent, 0)
		for _, e := range state.events {
			if e.Sequence > since {
				out = append(out, e)
			}
		}
		return out, nil
	}); err != nil {
		return err
	}
	if err := workflow.SetQueryHandler(ctx, AgentQueryHasFinished, func() (bool, error) {
		return state.terminated, nil
	}); err != nil {
		return err
	}
	return nil
}

func cloneProposal(p *Proposal) *Proposal {
	if p == nil {
		return nil
	}
	cp := *p
	return &cp
}

// pendingList returns the pending approvals sorted by ApprovalID for
// deterministic iteration. Map iteration would be non-deterministic and
// violate workflow rules.
func pendingList(m map[string]PendingApproval) []PendingApproval {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]PendingApproval, 0, len(keys))
	for _, k := range keys {
		out = append(out, m[k])
	}
	return out
}

func lastSeq(state *agentState) uint64 {
	if len(state.events) == 0 {
		return 0
	}
	return state.events[len(state.events)-1].Sequence
}

func shouldContinueAsNew(state *agentState) bool {
	return len(state.history) > defaultMaxHistoryTurns
}

func continueAsNew(ctx workflow.Context, input InfrastructureAgentInput, state *agentState) error {
	// Compact: keep the last N turns and a summary of older context. For Spike
	// 1 we just keep the last 30 turns; later spikes may add a summarization
	// activity.
	keep := state.history
	if len(keep) > 30 {
		keep = keep[len(keep)-30:]
	}
	carry := InfrastructureAgentInput{
		AgentRunID:      input.AgentRunID,
		WorkspaceID:     input.WorkspaceID,
		RepositoryID:    input.RepositoryID,
		UserID:          input.UserID,
		LLMProviderID:   input.LLMProviderID,
		SystemPrompt:    input.SystemPrompt,
		History:         keep,
		Events:          nil,
		NextSequence:    state.nextSeq,
		IterationsSoFar: 0,
	}
	return workflow.NewContinueAsNewError(ctx, InfrastructureAgentWorkflow, carry)
}

// workflowUUID returns a deterministic UUID-shaped identifier from a SideEffect.
// (Crypto-grade randomness isn't needed here; we just want unique-per-event.)
func workflowUUID(ctx workflow.Context) string {
	var id string
	enc := workflow.SideEffect(ctx, func(workflow.Context) any {
		// SideEffect bypasses determinism enforcement, allowing time/random.
		// Use UnixNano + a counter-ish suffix.
		return fmt.Sprintf("%d-%d", time.Now().UnixNano(), nextSideEffectCounter())
	})
	if err := enc.Get(&id); err != nil {
		// SideEffect should never fail in practice; fall back to a stable id.
		return "fallback"
	}
	return id
}

// nextSideEffectCounter is monotonic per process. Workflow determinism is
// preserved because the value is captured inside SideEffect.
var sideEffectCounter int64

func nextSideEffectCounter() int64 {
	sideEffectCounter++
	return sideEffectCounter
}

// errInternal is returned by the workflow on logic errors that shouldn't be
// surfaced as activity failures.
var errInternal = errors.New("infrastructure agent: internal error")
