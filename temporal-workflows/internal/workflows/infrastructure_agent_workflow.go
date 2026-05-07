package workflows

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"

	agentactivity "github.com/drewpayment/orbit/temporal-workflows/internal/activities/agent"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/providers"
)

// Signal names for the InfrastructureAgentWorkflow.
const (
	AgentSignalUserMessage  = "AgentUserMessage"
	AgentSignalApproval     = "AgentApproval"
	AgentSignalAbort        = "AgentAbort"
	AgentSignalTokenStream  = "AgentTokenStream"
	AgentSignalToolFinished = "AgentToolFinished"
)

// Query names.
const (
	AgentQuerySnapshot     = "AgentSnapshot"
	AgentQueryEventsSince  = "AgentEventsSince"
	AgentQueryHasFinished  = "AgentHasFinished"
)

// Activity names.
const (
	ActivityLLMNextStep = "LLMNextStep"
)

// Built-in tools available in the Spike 1 skeleton. Subsequent spikes add
// shell_exec, http_request, request_approval, register_tool, etc.
const (
	ToolProposeToUser = "propose_to_user"
	ToolDone          = "done"
)

// Default behavioral knobs. Tunable via input.
const (
	defaultMaxIterations    = 80
	defaultMaxHistoryTurns  = 80
	defaultUserWaitTimeout  = 24 * time.Hour
)

// InfrastructureAgentInput is the workflow input.
type InfrastructureAgentInput struct {
	AgentRunID     string
	WorkspaceID    string
	RepositoryID   string
	UserID         string
	LLMProviderID  string
	InitialPrompt  string

	// Optional: override the system prompt. Empty uses the default.
	SystemPrompt string

	// Optional: continue-as-new carry-over.
	History         []ConversationTurn
	Events          []AgentEvent
	NextSequence    uint64
	IterationsSoFar int
}

// ConversationTurn captures one message in the agent transcript.
type ConversationTurn struct {
	TurnID    string                 `json:"turn_id"`
	Role      string                 `json:"role"` // user | assistant | tool | system
	Content   string                 `json:"content"`
	ToolCalls []ToolCallRecord       `json:"tool_calls,omitempty"`
	ToolCallID string                `json:"tool_call_id,omitempty"`
	ToolName   string                `json:"tool_name,omitempty"`
	Timestamp  time.Time             `json:"timestamp"`
}

// ToolCallRecord is the serializable form of a tool call.
type ToolCallRecord struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

// Proposal is the latest agent proposal (rendered in the chat).
type Proposal struct {
	ProposalID   string `json:"proposal_id"`
	Title        string `json:"title"`
	Summary      string `json:"summary"`
	BodyMarkdown string `json:"body_markdown"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// AgentEvent is one item in the workflow's event log, surfaced via query to the
// gRPC streaming proxy. The Kind discriminates the payload.
type AgentEvent struct {
	Sequence  uint64    `json:"sequence"`
	EmittedAt time.Time `json:"emitted_at"`
	Kind      string    `json:"kind"` // see EventKind* constants
	Payload   map[string]any `json:"payload"`
}

const (
	EventKindConversationTurn = "conversation_turn"
	EventKindTokenDelta       = "token_delta"
	EventKindProposalUpdate   = "proposal_update"
	EventKindApprovalRequest  = "approval_request"
	EventKindApprovalResolved = "approval_resolution"
	EventKindStatusUpdate     = "status_update"
)

// AgentSnapshot is what the chat UI reads on initial mount.
type AgentSnapshot struct {
	Status            string             `json:"status"`
	Conversation      []ConversationTurn `json:"conversation"`
	StreamingPartial  string             `json:"streaming_partial"`
	StreamingTurnID   string             `json:"streaming_turn_id"`
	Proposal          *Proposal          `json:"proposal,omitempty"`
	PendingApprovals  []PendingApproval  `json:"pending_approvals"`
	LatestSequence    uint64             `json:"latest_sequence"`
	Backend           string             `json:"backend"`
	Model             string             `json:"model"`
}

// PendingApproval is exposed for HITL UI rendering.
type PendingApproval struct {
	ApprovalID   string         `json:"approval_id"`
	Kind         string         `json:"kind"` // proposal | tool_registration | destructive_command | custom
	Title        string         `json:"title"`
	BodyMarkdown string         `json:"body_markdown"`
	Payload      map[string]any `json:"payload,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
}

// ApprovalSignalPayload is the body of AgentSignalApproval.
type ApprovalSignalPayload struct {
	ApprovalID string `json:"approval_id"`
	Approved   bool   `json:"approved"`
	ResolvedBy string `json:"resolved_by"`
	Notes      string `json:"notes"`
}

// UserMessageSignalPayload is the body of AgentSignalUserMessage.
type UserMessageSignalPayload struct {
	TurnID  string `json:"turn_id"`
	UserID  string `json:"user_id"`
	Message string `json:"message"`
}

// AbortSignalPayload is the body of AgentSignalAbort.
type AbortSignalPayload struct {
	RequestedBy string `json:"requested_by"`
	Reason      string `json:"reason"`
}

// TokenStreamSignalPayload is the body of AgentSignalTokenStream. The LLM
// activity emits these to push partial assistant text back into the workflow,
// from which the gRPC streaming proxy fans it out via SSE to chat UIs.
type TokenStreamSignalPayload struct {
	TurnID string `json:"turn_id"`
	Delta  string `json:"delta"`
}

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

		llmInput := agentactivity.LLMNextStepInput{
			WorkflowID:  workflow.GetInfo(ctx).WorkflowExecution.ID,
			RunID:       workflow.GetInfo(ctx).WorkflowExecution.RunID,
			TurnID:      state.streamingTurnID,
			WorkspaceID: input.WorkspaceID,
			ProviderID:  input.LLMProviderID,
			System:      effectiveSystemPrompt(input),
			Messages:    historyToProviderMessages(state.history),
			Tools:       builtInToolSchemas(),
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
			toolResult, terminated := dispatchTool(ctx, &state, tc, approvalCh)
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
func dispatchTool(ctx workflow.Context, state *agentState, tc providers.ToolCall, approvalCh workflow.ReceiveChannel) (string, bool) {
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

	default:
		return fmt.Sprintf("ERROR: unknown tool %q (Spike 1 supports propose_to_user and done; more arrive in later spikes).", tc.Name), false
	}
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

Tools available right now:
- propose_to_user: post a structured plan to the user and wait for their reply
- done: end the run when the goal is achieved (or unrecoverably blocked)

Style: be concise. Prefer structured proposals over wall-of-text. When the user's goal is unclear, ask. When you have enough information, post a propose_to_user with a concrete plan.`

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
