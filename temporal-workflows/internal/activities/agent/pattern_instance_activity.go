package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// PatternInstanceClient is the contract the instance-side activities
// depend on. Implemented by services.PayloadPatternInstanceClient in
// production; tests substitute a fake. Mirrors the AgentToolsClient
// shape one abstraction level up.
type PatternInstanceClient interface {
	GetPatternByID(ctx context.Context, id string) (services.PatternFull, error)
	CreateInstance(ctx context.Context, in services.PatternInstanceCreateInput) (string, error)
	UpdateStatus(ctx context.Context, id string, in services.PatternInstanceStatusInput) error
}

// PatternInstanceActivities backs the agent's instantiate_pattern
// dispatch: pattern lookup, instance row creation, and status
// writebacks as the dispatch walks the lifecycle.
// See plans/merry-strolling-bumblebee.md (Phase 3).
type PatternInstanceActivities struct {
	client PatternInstanceClient
	logger *slog.Logger
}

func NewPatternInstanceActivities(client PatternInstanceClient, logger *slog.Logger) *PatternInstanceActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &PatternInstanceActivities{client: client, logger: logger}
}

// --- inputs / outputs ---

// PatternFullForWorkflow mirrors services.PatternFull with
// workflow-friendly JSON tags so the value survives Temporal's
// serialization.
type PatternFullForWorkflow struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	DisplayName     string `json:"display_name"`
	Description     string `json:"description"`
	Category        string `json:"category"`
	TemplateKind    string `json:"template_kind"`
	TemplateJSON    string `json:"template_json"`
	InputSchemaJSON string `json:"input_schema_json"`
	Status          string `json:"status"`
	CurrentVersion  int    `json:"current_version"`
}

type GetPatternByIDInput struct {
	ID string
}

type GetPatternByIDResult struct {
	Pattern PatternFullForWorkflow
}

type CreatePatternInstanceInput struct {
	WorkspaceID    string
	PatternID      string
	PatternVersion int
	Name           string
	AppID          string
	Parameters     map[string]interface{}
	CreatedByUser  string
	CreatedByRunID string
	WorkflowID     string
}

type CreatePatternInstanceResult struct {
	ID string
}

type UpdatePatternInstanceStatusInput struct {
	ID           string
	Status       string
	Outputs      map[string]interface{}
	ErrorMessage string
}

// --- activities ---

// GetPatternByID returns full pattern content (templateJson +
// inputSchemaJson) for the agent's dispatch to validate parameters
// against and render the template. ErrPatternNotFound is mapped to a
// non-retryable application error so a bad pattern_id surfaces cleanly.
func (a *PatternInstanceActivities) GetPatternByID(ctx context.Context, in GetPatternByIDInput) (GetPatternByIDResult, error) {
	if in.ID == "" {
		return GetPatternByIDResult{}, temporal.NewNonRetryableApplicationError("id required", "InvalidInput", nil)
	}
	p, err := a.client.GetPatternByID(ctx, in.ID)
	if err != nil {
		if errors.Is(err, services.ErrPatternNotFound) {
			return GetPatternByIDResult{}, temporal.NewNonRetryableApplicationError(err.Error(), "PatternNotFound", err)
		}
		return GetPatternByIDResult{}, fmt.Errorf("get pattern: %w", err)
	}
	return GetPatternByIDResult{
		Pattern: PatternFullForWorkflow{
			ID:              p.ID,
			Name:            p.Name,
			DisplayName:     p.DisplayName,
			Description:     p.Description,
			Category:        p.Category,
			TemplateKind:    p.TemplateKind,
			TemplateJSON:    p.TemplateJSON,
			InputSchemaJSON: p.InputSchemaJSON,
			Status:          p.Status,
			CurrentVersion:  p.CurrentVersion,
		},
	}, nil
}

// CreatePatternInstance creates the row at status=pending and returns
// its id. Subsequent UpdatePatternInstanceStatus calls walk the
// lifecycle. ErrInstanceNameTaken is mapped to a non-retryable error so
// the agent can pick a different name without a retry loop.
func (a *PatternInstanceActivities) CreatePatternInstance(ctx context.Context, in CreatePatternInstanceInput) (CreatePatternInstanceResult, error) {
	if in.WorkspaceID == "" || in.PatternID == "" || in.Name == "" {
		return CreatePatternInstanceResult{}, temporal.NewNonRetryableApplicationError(
			"workspace_id, pattern_id, name required", "InvalidInput", nil)
	}
	if in.Parameters == nil {
		in.Parameters = map[string]interface{}{}
	}
	id, err := a.client.CreateInstance(ctx, services.PatternInstanceCreateInput{
		WorkspaceID:    in.WorkspaceID,
		PatternID:      in.PatternID,
		PatternVersion: in.PatternVersion,
		Name:           in.Name,
		AppID:          in.AppID,
		Parameters:     in.Parameters,
		CreatedByUser:  in.CreatedByUser,
		CreatedByRunID: in.CreatedByRunID,
		WorkflowID:     in.WorkflowID,
	})
	if err != nil {
		if errors.Is(err, services.ErrInstanceNameTaken) {
			return CreatePatternInstanceResult{}, temporal.NewNonRetryableApplicationError(err.Error(), "InstanceNameTaken", err)
		}
		return CreatePatternInstanceResult{}, fmt.Errorf("create pattern instance: %w", err)
	}
	return CreatePatternInstanceResult{ID: id}, nil
}

// UpdatePatternInstanceStatus patches an instance row as the dispatch
// walks the lifecycle. Best-effort: failures log a warning but don't
// fail the dispatch (mirrors markRun's behavior — a flaky internal API
// shouldn't roll back the provisioning side effects).
func (a *PatternInstanceActivities) UpdatePatternInstanceStatus(ctx context.Context, in UpdatePatternInstanceStatusInput) error {
	if in.ID == "" {
		return temporal.NewNonRetryableApplicationError("id required", "InvalidInput", nil)
	}
	if in.Status == "" {
		return temporal.NewNonRetryableApplicationError("status required", "InvalidInput", nil)
	}
	return a.client.UpdateStatus(ctx, in.ID, services.PatternInstanceStatusInput{
		Status:       in.Status,
		Outputs:      in.Outputs,
		ErrorMessage: in.ErrorMessage,
	})
}
