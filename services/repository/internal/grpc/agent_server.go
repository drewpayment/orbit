// Package grpc — agent_server.go
//
// AgentService implementation. Bridges the Infrastructure Agent's Temporal
// workflow to Connect/gRPC clients (the chat UI). For each agent run:
//   - StartInfrastructureAgent kicks off InfrastructureAgentWorkflow
//   - SendMessage / Approve* / Abort flow as Temporal signals
//   - StreamAgentEvents server-streams the workflow event log via polling
//     of the AgentEventsSince query (Spike 1; SSE proxy in orbit-www
//     consumes this stream and re-emits as text/event-stream)
//
// Lifetime, history, and all source-of-truth state live in the workflow.
// This server is intentionally thin.

package grpc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"go.temporal.io/sdk/client"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	agentv1 "github.com/drewpayment/orbit/proto/gen/go/idp/agent/v1"
	"github.com/drewpayment/orbit/proto/gen/go/idp/agent/v1/agentv1connect"
	"github.com/drewpayment/orbit/temporal-workflows/pkg/agentcontract"
)

// AgentTaskQueue is the task queue the infrastructure agent worker polls. The
// worker registers on "orbit-workflows" today; we keep that here for clarity.
const AgentTaskQueue = "orbit-workflows"

// AgentServer implements agentv1connect.AgentServiceHandler.
type AgentServer struct {
	agentv1connect.UnimplementedAgentServiceHandler
	temporal client.Client
	pollEvery time.Duration
}

// NewAgentServer constructs an AgentServer. pollEvery controls how often
// StreamAgentEvents queries the workflow for new events; 50ms is a good
// default for a responsive chat UI.
func NewAgentServer(temporal client.Client, pollEvery time.Duration) *AgentServer {
	if pollEvery <= 0 {
		pollEvery = 50 * time.Millisecond
	}
	return &AgentServer{temporal: temporal, pollEvery: pollEvery}
}

// StartInfrastructureAgent begins a new agent run.
func (s *AgentServer) StartInfrastructureAgent(
	ctx context.Context,
	req *connect.Request[agentv1.StartInfrastructureAgentRequest],
) (*connect.Response[agentv1.StartInfrastructureAgentResponse], error) {
	msg := req.Msg

	if msg.WorkspaceId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("workspace_id is required"))
	}
	if msg.LlmProviderId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("llm_provider_id is required"))
	}
	if msg.InitialPrompt == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("initial_prompt is required"))
	}

	agentRunID := uuid.New().String()
	workflowID := fmt.Sprintf("agent-%s", agentRunID)

	input := agentcontract.InfrastructureAgentInput{
		AgentRunID:    agentRunID,
		WorkspaceID:   msg.WorkspaceId,
		RepositoryID:  msg.RepositoryId,
		UserID:        msg.UserId,
		LLMProviderID: msg.LlmProviderId,
		InitialPrompt: msg.InitialPrompt,
	}

	run, err := s.temporal.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:                       workflowID,
		TaskQueue:                AgentTaskQueue,
		WorkflowExecutionTimeout: 24 * time.Hour,
	}, agentcontract.WorkflowInfrastructureAgent, input)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("start workflow: %w", err))
	}

	return connect.NewResponse(&agentv1.StartInfrastructureAgentResponse{
		WorkflowId: run.GetID(),
		RunId:      run.GetRunID(),
		AgentRunId: agentRunID,
		StartedAt:  timestamppb.Now(),
	}), nil
}

// SendMessage forwards a user chat message into the workflow.
func (s *AgentServer) SendMessage(
	ctx context.Context,
	req *connect.Request[agentv1.SendMessageRequest],
) (*connect.Response[agentv1.SendMessageResponse], error) {
	msg := req.Msg
	if msg.WorkflowId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("workflow_id is required"))
	}

	turnID := uuid.New().String()
	if err := s.temporal.SignalWorkflow(ctx, msg.WorkflowId, "", agentcontract.SignalUserMessage, agentcontract.UserMessageSignalPayload{
		TurnID:  turnID,
		UserID:  msg.UserId,
		Message: msg.Message,
	}); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("signal user message: %w", err))
	}

	return connect.NewResponse(&agentv1.SendMessageResponse{TurnId: turnID}), nil
}

// SendReviewerMessage signals AgentReviewerMessage so the workflow's
// reviewer-message goroutine appends the reviewer's text as a regular
// conversation turn under the open gate, runs an LLM step with no
// tools, and surfaces the agent's text response. The gate stays open;
// resolution still requires a real Approval / Reject signal.
func (s *AgentServer) SendReviewerMessage(
	ctx context.Context,
	req *connect.Request[agentv1.SendReviewerMessageRequest],
) (*connect.Response[agentv1.SendReviewerMessageResponse], error) {
	msg := req.Msg
	if msg.WorkflowId == "" || msg.ApprovalId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("workflow_id and approval_id are required"))
	}
	if msg.Message == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("message is required"))
	}
	turnID := uuid.New().String()
	if err := s.temporal.SignalWorkflow(ctx, msg.WorkflowId, "", agentcontract.SignalReviewerMessage, agentcontract.ReviewerMessageSignalPayload{
		ApprovalID: msg.ApprovalId,
		UserID:     msg.UserId,
		Message:    msg.Message,
	}); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("signal reviewer message: %w", err))
	}
	return connect.NewResponse(&agentv1.SendReviewerMessageResponse{TurnId: turnID}), nil
}

// ApproveAction sends an approval signal. When the request carries an
// optional Edits sub-message (commit α — approve-with-edits for tool
// registrations), those fields ride along on the signal so the workflow
// can validate and apply the reviewer's modifications before resolving.
// Empty edit fields with edits.present=true mean "the reviewer touched
// the form but didn't change anything" — the workflow treats that as an
// unedited approval downstream.
func (s *AgentServer) ApproveAction(
	ctx context.Context,
	req *connect.Request[agentv1.ApproveActionRequest],
) (*connect.Response[agentv1.ApproveActionResponse], error) {
	msg := req.Msg
	if msg.WorkflowId == "" || msg.ApprovalId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("workflow_id and approval_id are required"))
	}
	payload := agentcontract.ApprovalSignalPayload{
		ApprovalID: msg.ApprovalId,
		Approved:   true,
		ResolvedBy: msg.ApprovedBy,
		Notes:      msg.Notes,
	}
	if edits := msg.GetEdits(); edits != nil {
		payload.Edited = true
		payload.EditedName = edits.GetName()
		payload.EditedDescription = edits.GetDescription()
		payload.EditedTemplateKind = edits.GetTemplateKind()
		payload.EditedTemplateJSON = edits.GetTemplateJson()
		payload.EditedSchemaJSON = edits.GetInputSchemaJson()
	}
	if err := s.temporal.SignalWorkflow(ctx, msg.WorkflowId, "", agentcontract.SignalApproval, payload); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("signal approval: %w", err))
	}
	return connect.NewResponse(&agentv1.ApproveActionResponse{Success: true}), nil
}

// RejectAction sends an approval signal with approved=false.
func (s *AgentServer) RejectAction(
	ctx context.Context,
	req *connect.Request[agentv1.RejectActionRequest],
) (*connect.Response[agentv1.RejectActionResponse], error) {
	msg := req.Msg
	if msg.WorkflowId == "" || msg.ApprovalId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("workflow_id and approval_id are required"))
	}
	if err := s.temporal.SignalWorkflow(ctx, msg.WorkflowId, "", agentcontract.SignalApproval, agentcontract.ApprovalSignalPayload{
		ApprovalID: msg.ApprovalId,
		Approved:   false,
		ResolvedBy: msg.RejectedBy,
		Notes:      msg.Reason,
	}); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("signal rejection: %w", err))
	}
	return connect.NewResponse(&agentv1.RejectActionResponse{Success: true}), nil
}

// AbortAgent terminates a running agent.
func (s *AgentServer) AbortAgent(
	ctx context.Context,
	req *connect.Request[agentv1.AbortAgentRequest],
) (*connect.Response[agentv1.AbortAgentResponse], error) {
	msg := req.Msg
	if msg.WorkflowId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("workflow_id is required"))
	}
	if err := s.temporal.SignalWorkflow(ctx, msg.WorkflowId, "", agentcontract.SignalAbort, agentcontract.AbortSignalPayload{
		RequestedBy: msg.RequestedBy,
		Reason:      msg.Reason,
	}); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("signal abort: %w", err))
	}
	return connect.NewResponse(&agentv1.AbortAgentResponse{Success: true}), nil
}

// StreamAgentEvents server-streams new workflow events as they appear. The
// implementation polls the workflow's AgentEventsSince query on a tick, then
// emits each event over the Connect stream. The client side's resume-cursor
// (`since_sequence`) lets reconnects pick up where they left off.
func (s *AgentServer) StreamAgentEvents(
	ctx context.Context,
	req *connect.Request[agentv1.StreamAgentEventsRequest],
	stream *connect.ServerStream[agentv1.AgentEvent],
) error {
	msg := req.Msg
	if msg.WorkflowId == "" {
		return connect.NewError(connect.CodeInvalidArgument, errors.New("workflow_id is required"))
	}
	since := msg.SinceSequence

	ticker := time.NewTicker(s.pollEvery)
	defer ticker.Stop()

	for {
		newEvents, finished, err := s.fetchNewEvents(ctx, msg.WorkflowId, since)
		if err != nil {
			return connect.NewError(connect.CodeInternal, err)
		}
		for _, e := range newEvents {
			pb, err := toProtoEvent(e)
			if err != nil {
				return connect.NewError(connect.CodeInternal, err)
			}
			if err := stream.Send(pb); err != nil {
				return err
			}
			if e.Sequence > since {
				since = e.Sequence
			}
		}
		if finished {
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

// fetchNewEvents queries the workflow for events with Sequence > since and
// also reports whether the workflow has terminated.
func (s *AgentServer) fetchNewEvents(ctx context.Context, workflowID string, since uint64) ([]agentcontract.AgentEvent, bool, error) {
	resp, err := s.temporal.QueryWorkflow(ctx, workflowID, "", agentcontract.QueryEventsSince, since)
	if err != nil {
		return nil, false, fmt.Errorf("query events: %w", err)
	}
	var events []agentcontract.AgentEvent
	if err := resp.Get(&events); err != nil {
		return nil, false, fmt.Errorf("decode events: %w", err)
	}

	finishedResp, err := s.temporal.QueryWorkflow(ctx, workflowID, "", agentcontract.QueryHasFinished)
	if err != nil {
		return events, false, nil // non-fatal; keep streaming
	}
	var finished bool
	_ = finishedResp.Get(&finished)
	return events, finished, nil
}

// ListAgentRuns is a Spike-1 stub. Real impl will hit Payload's
// /api/agent-runs collection or query Temporal's visibility API.
func (s *AgentServer) ListAgentRuns(
	_ context.Context,
	_ *connect.Request[agentv1.ListAgentRunsRequest],
) (*connect.Response[agentv1.ListAgentRunsResponse], error) {
	return connect.NewResponse(&agentv1.ListAgentRunsResponse{}), nil
}

// GetAgentRun returns the workflow snapshot (conversation, proposal, pending
// approvals).
func (s *AgentServer) GetAgentRun(
	ctx context.Context,
	req *connect.Request[agentv1.GetAgentRunRequest],
) (*connect.Response[agentv1.GetAgentRunResponse], error) {
	msg := req.Msg
	if msg.WorkflowId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("workflow_id is required"))
	}

	snapResp, err := s.temporal.QueryWorkflow(ctx, msg.WorkflowId, "", agentcontract.QuerySnapshot)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("query snapshot: %w", err))
	}
	var snapshot agentcontract.AgentSnapshot
	if err := snapResp.Get(&snapshot); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("decode snapshot: %w", err))
	}

	out := &agentv1.GetAgentRunResponse{
		LatestSequence: snapshot.LatestSequence,
	}
	for _, t := range snapshot.Conversation {
		out.Conversation = append(out.Conversation, &agentv1.ConversationTurn{
			TurnId:  t.TurnID,
			Role:    t.Role,
			Content: t.Content,
		})
	}
	if snapshot.Proposal != nil {
		out.LatestProposal = &agentv1.ProposalUpdate{
			ProposalId:   snapshot.Proposal.ProposalID,
			Title:        snapshot.Proposal.Title,
			Summary:      snapshot.Proposal.Summary,
			BodyMarkdown: snapshot.Proposal.BodyMarkdown,
		}
	}
	for _, pa := range snapshot.PendingApprovals {
		args, _ := structpb.NewStruct(pa.Payload)
		out.PendingApprovals = append(out.PendingApprovals, &agentv1.ApprovalRequest{
			ApprovalId:   pa.ApprovalID,
			Kind:         pa.Kind,
			Title:        pa.Title,
			BodyMarkdown: pa.BodyMarkdown,
			Payload:      args,
		})
	}
	return connect.NewResponse(out), nil
}

// toProtoEvent translates a workflow AgentEvent to its proto sibling. The
// payload map is rendered into the appropriate oneof case based on Kind.
func toProtoEvent(e agentcontract.AgentEvent) (*agentv1.AgentEvent, error) {
	out := &agentv1.AgentEvent{
		Sequence:  e.Sequence,
		EmittedAt: timestamppb.New(e.EmittedAt),
	}
	switch e.Kind {
	case agentcontract.EventKindConversationTurn:
		out.Event = &agentv1.AgentEvent_ConversationTurn{
			ConversationTurn: &agentv1.ConversationTurn{
				TurnId:  asString(e.Payload, "turn_id"),
				Role:    asString(e.Payload, "role"),
				Content: asString(e.Payload, "content"),
			},
		}
	case agentcontract.EventKindTokenDelta:
		out.Event = &agentv1.AgentEvent_TokenDelta{
			TokenDelta: &agentv1.TokenDelta{
				TurnId: asString(e.Payload, "turn_id"),
				Delta:  asString(e.Payload, "delta"),
			},
		}
	case agentcontract.EventKindProposalUpdate:
		out.Event = &agentv1.AgentEvent_ProposalUpdate{
			ProposalUpdate: &agentv1.ProposalUpdate{
				ProposalId:   asString(e.Payload, "proposal_id"),
				Title:        asString(e.Payload, "title"),
				Summary:      asString(e.Payload, "summary"),
				BodyMarkdown: asString(e.Payload, "body_markdown"),
			},
		}
	case agentcontract.EventKindApprovalRequest:
		// Tool-registration approvals carry the structured template +
		// schema in the payload so the chat UI can render an editable
		// form. structpb best-effort: fields it can't represent (e.g.
		// nested map[string]any) are dropped gracefully.
		var payloadStruct *structpb.Struct
		if extras := approvalPayloadFields(e.Payload); len(extras) > 0 {
			if s, err := structpb.NewStruct(extras); err == nil {
				payloadStruct = s
			}
		}
		out.Event = &agentv1.AgentEvent_ApprovalRequest{
			ApprovalRequest: &agentv1.ApprovalRequest{
				ApprovalId:   asString(e.Payload, "approval_id"),
				Kind:         asString(e.Payload, "kind"),
				Title:        asString(e.Payload, "title"),
				BodyMarkdown: asString(e.Payload, "body_markdown"),
				Payload:      payloadStruct,
			},
		}
	case agentcontract.EventKindApprovalResolved:
		out.Event = &agentv1.AgentEvent_ApprovalResolution{
			ApprovalResolution: &agentv1.ApprovalResolution{
				ApprovalId: asString(e.Payload, "approval_id"),
				Approved:   asBool(e.Payload, "approved"),
				ResolvedBy: asString(e.Payload, "resolved_by"),
				Notes:      asString(e.Payload, "notes"),
			},
		}
	case agentcontract.EventKindStatusUpdate:
		out.Event = &agentv1.AgentEvent_StatusUpdate{
			StatusUpdate: &agentv1.AgentStatusUpdate{
				Status:  asString(e.Payload, "status"),
				Message: asString(e.Payload, "message"),
			},
		}
	case agentcontract.EventKindToolCallOutputChunk:
		out.Event = &agentv1.AgentEvent_ToolCallOutputChunk{
			ToolCallOutputChunk: &agentv1.ToolCallOutputChunk{
				CallId: asString(e.Payload, "call_id"),
				Stream: asString(e.Payload, "stream"),
				Chunk:  asString(e.Payload, "chunk"),
			},
		}
	default:
		// Fallback: encode as a status update so the UI doesn't choke.
		blob, _ := json.Marshal(e.Payload)
		out.Event = &agentv1.AgentEvent_StatusUpdate{
			StatusUpdate: &agentv1.AgentStatusUpdate{
				Status:  e.Kind,
				Message: string(blob),
			},
		}
	}
	return out, nil
}

func asString(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func asBool(m map[string]any, key string) bool {
	if v, ok := m[key].(bool); ok {
		return v
	}
	return false
}

// approvalPayloadFields extracts the structured fields a chat UI needs to
// render an editable approval form (e.g. tool_registration kind: name,
// template, schema). The basic event fields (approval_id / kind / title /
// body_markdown) are already on the proto's top-level so they're filtered
// out here to keep the payload Struct small.
func approvalPayloadFields(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	skip := map[string]struct{}{
		"approval_id":   {},
		"kind":          {},
		"title":         {},
		"body_markdown": {},
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		if _, drop := skip[k]; drop {
			continue
		}
		out[k] = v
	}
	return out
}
