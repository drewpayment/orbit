package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// AgentToolsClient is the contract the registry activities depend on.
// Implemented by services.PayloadAgentToolsClient in production; tests
// substitute a fake.
type AgentToolsClient interface {
	ListApproved(ctx context.Context, workspaceID string) ([]services.AgentToolDoc, error)
	RegisterPending(ctx context.Context, in services.RegisterPendingInput) (string, error)
	Resolve(ctx context.Context, id string, approved bool, resolvedBy, reason string, edits *services.AgentToolEdits) (services.ResolveResult, error)
}

// ToolRegistryActivities owns the activities backing the AgentTools
// collection: list-approved (catalog merge), register-pending
// (register_tool first half), resolve (register_tool second half).
type ToolRegistryActivities struct {
	client AgentToolsClient
	logger *slog.Logger
}

// NewToolRegistryActivities constructs the activity group.
func NewToolRegistryActivities(client AgentToolsClient, logger *slog.Logger) *ToolRegistryActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &ToolRegistryActivities{client: client, logger: logger}
}

// --- inputs / outputs ---

// ApprovedAgentTool mirrors services.AgentToolDoc with workflow-friendly
// JSON tags so the value can survive Temporal's serialization.
type ApprovedAgentTool struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Description     string `json:"description"`
	InputSchemaJSON string `json:"input_schema_json"`
	TemplateKind    string `json:"template_kind"`
	TemplateJSON    string `json:"template_json"`
}

type ListApprovedToolsInput struct {
	WorkspaceID string
}

type ListApprovedToolsResult struct {
	Tools []ApprovedAgentTool
}

type RegisterPendingToolInput struct {
	WorkspaceID     string
	Name            string
	Description     string
	InputSchemaJSON string
	TemplateKind    string
	TemplateJSON    string
	Reasoning       string
	CreatedByRunID  string
}

type RegisterPendingToolResult struct {
	ID string
}

type ResolveAgentToolInput struct {
	ID         string
	Approved   bool
	ResolvedBy string
	Reason     string

	// Edited* fields are populated when the reviewer approved with edits
	// (commit α). Empty values mean "leave the agent's proposal
	// unchanged for this field." The downstream route writes a
	// reviewer_edited AgentToolVersions row only when at least one field
	// actually changed from the original.
	Edited             bool
	EditedName         string
	EditedDescription  string
	EditedTemplateKind string
	EditedTemplateJSON string
	EditedSchemaJSON   string
}

// ResolveAgentToolResult mirrors services.ResolveResult so the workflow
// can include the version id + diff in the agent's tool result.
type ResolveAgentToolResult struct {
	ID                 string
	Status             string
	AgentToolVersionID string
	EditedFields       []string
}

// --- activities ---

// ListApprovedTools returns the approved AgentTools for a workspace. The
// workflow calls this at the top of each iteration so the LLM's catalog
// stays current as new tools are approved mid-run.
func (a *ToolRegistryActivities) ListApprovedTools(ctx context.Context, in ListApprovedToolsInput) (ListApprovedToolsResult, error) {
	if in.WorkspaceID == "" {
		return ListApprovedToolsResult{}, temporal.NewNonRetryableApplicationError("workspace_id required", "InvalidInput", nil)
	}
	docs, err := a.client.ListApproved(ctx, in.WorkspaceID)
	if err != nil {
		return ListApprovedToolsResult{}, fmt.Errorf("list approved tools: %w", err)
	}
	out := make([]ApprovedAgentTool, 0, len(docs))
	for _, d := range docs {
		out = append(out, ApprovedAgentTool{
			ID:              d.ID,
			Name:            d.Name,
			Description:     d.Description,
			InputSchemaJSON: d.InputSchemaJSON,
			TemplateKind:    d.TemplateKind,
			TemplateJSON:    d.TemplateJSON,
		})
	}
	return ListApprovedToolsResult{Tools: out}, nil
}

// RegisterPendingTool creates a pending row.
func (a *ToolRegistryActivities) RegisterPendingTool(ctx context.Context, in RegisterPendingToolInput) (RegisterPendingToolResult, error) {
	if in.WorkspaceID == "" || in.Name == "" || in.TemplateKind == "" || in.TemplateJSON == "" {
		return RegisterPendingToolResult{}, temporal.NewNonRetryableApplicationError("workspace_id, name, template_kind, template_json required", "InvalidInput", nil)
	}
	id, err := a.client.RegisterPending(ctx, services.RegisterPendingInput{
		WorkspaceID:     in.WorkspaceID,
		Name:            in.Name,
		Description:     in.Description,
		InputSchemaJSON: in.InputSchemaJSON,
		TemplateKind:    in.TemplateKind,
		TemplateJSON:    in.TemplateJSON,
		Reasoning:       in.Reasoning,
		CreatedByRunID:  in.CreatedByRunID,
	})
	if err != nil {
		if errors.Is(err, services.ErrToolNameTaken) {
			return RegisterPendingToolResult{}, temporal.NewNonRetryableApplicationError(err.Error(), "ToolNameTaken", err)
		}
		return RegisterPendingToolResult{}, fmt.Errorf("register pending tool: %w", err)
	}
	return RegisterPendingToolResult{ID: id}, nil
}

// ResolveAgentTool flips a pending row to approved or rejected. When
// in.Edited is set, the activity passes a non-nil edits payload through
// to the route which writes the version history and patches the
// AgentTools row to the reviewer's curated values.
func (a *ToolRegistryActivities) ResolveAgentTool(ctx context.Context, in ResolveAgentToolInput) (ResolveAgentToolResult, error) {
	if in.ID == "" {
		return ResolveAgentToolResult{}, temporal.NewNonRetryableApplicationError("id required", "InvalidInput", nil)
	}
	var edits *services.AgentToolEdits
	if in.Edited {
		edits = &services.AgentToolEdits{
			Name:            in.EditedName,
			Description:     in.EditedDescription,
			TemplateKind:    in.EditedTemplateKind,
			TemplateJSON:    in.EditedTemplateJSON,
			InputSchemaJSON: in.EditedSchemaJSON,
		}
	}
	res, err := a.client.Resolve(ctx, in.ID, in.Approved, in.ResolvedBy, in.Reason, edits)
	if err != nil {
		return ResolveAgentToolResult{}, err
	}
	return ResolveAgentToolResult{
		ID:                 res.ID,
		Status:             res.Status,
		AgentToolVersionID: res.AgentToolVersionID,
		EditedFields:       res.EditedFields,
	}, nil
}
