package activities

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// ActivityScaffolderCreateAgentRun is the activity name for the `agent:run`
// special case (Phase 4 Task D).
const ActivityScaffolderCreateAgentRun = "ScaffolderCreateAgentRun"

// AgentRunCreator is the subset of services.PayloadAgentRunsClient the
// activity needs. Satisfied by *services.PayloadAgentRunsClient.
type AgentRunCreator interface {
	Create(ctx context.Context, in services.CreateAgentRunInput) (services.CreateAgentRunResult, error)
}

// ScaffolderAgentRunActivities backs the `agent:run` step's AgentRuns row.
// The actual child-workflow start/await happens in workflow code
// (internal/workflows/scaffolder_agent_run.go); this activity only creates
// the row and resolves which LLM provider to use, both of which require a
// Payload call a workflow may not make directly.
type ScaffolderAgentRunActivities struct {
	client AgentRunCreator
	logger *slog.Logger
}

// NewScaffolderAgentRunActivities wires the activity. client may be nil in
// tests that never call CreateAgentRun; a nil client fails loudly rather
// than silently dropping the row, since an agent:run step with no backing
// AgentRuns row cannot start the child workflow at all (it has no
// LLMProviderID).
func NewScaffolderAgentRunActivities(client AgentRunCreator, logger *slog.Logger) *ScaffolderAgentRunActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &ScaffolderAgentRunActivities{client: client, logger: logger}
}

// ScaffolderCreateAgentRunInput is the activity input for CreateAgentRun.
type ScaffolderCreateAgentRunInput struct {
	WorkspaceID string `json:"workspaceId"`
	UserID      string `json:"userId"`
	WorkflowID  string `json:"workflowId"`
	Title       string `json:"title"`
	Prompt      string `json:"prompt"`
}

// ScaffolderCreateAgentRunResult carries what the workflow needs to start
// InfrastructureAgentWorkflow as a child: the row id and the workspace's
// resolved default LLM provider.
type ScaffolderCreateAgentRunResult struct {
	AgentRunID    string `json:"agentRunId"`
	LLMProviderID string `json:"llmProviderId"`
}

// CreateAgentRun inserts the AgentRuns row for one agent:run step.
func (a *ScaffolderAgentRunActivities) CreateAgentRun(ctx context.Context, in ScaffolderCreateAgentRunInput) (*ScaffolderCreateAgentRunResult, error) {
	if a.client == nil {
		return nil, nonRetryable(errors.New("scaffolder create agent run: agent-runs client not configured"))
	}
	if strings.TrimSpace(in.WorkspaceID) == "" || strings.TrimSpace(in.WorkflowID) == "" || strings.TrimSpace(in.Prompt) == "" {
		return nil, nonRetryable(errors.New("scaffolder create agent run: workspaceId, workflowId, prompt required"))
	}

	res, err := a.client.Create(ctx, services.CreateAgentRunInput{
		WorkspaceID:   in.WorkspaceID,
		UserID:        in.UserID,
		WorkflowID:    in.WorkflowID,
		Title:         in.Title,
		InitialPrompt: in.Prompt,
	})
	if err != nil {
		if errors.Is(err, services.ErrNoDefaultLLMProvider) {
			// A missing LLM provider is a workspace configuration problem no
			// retry can fix.
			return nil, nonRetryable(fmt.Errorf("scaffolder create agent run: %w", err))
		}
		return nil, fmt.Errorf("scaffolder create agent run: %w", err)
	}
	return &ScaffolderCreateAgentRunResult{AgentRunID: res.AgentRunID, LLMProviderID: res.LLMProviderID}, nil
}
