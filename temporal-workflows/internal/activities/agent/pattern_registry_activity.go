package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// PatternsClient is the contract the pattern-registry activities depend
// on. Implemented by services.PayloadPatternClient in production; tests
// substitute a fake. Mirrors AgentToolsClient one abstraction level up.
type PatternsClient interface {
	ListApproved(ctx context.Context, category string) ([]services.PatternDoc, error)
	RegisterPending(ctx context.Context, in services.RegisterPendingPatternInput) (string, error)
	Resolve(ctx context.Context, id string, approved bool, resolvedBy, reason string, edits *services.PatternEdits) (services.ResolvePatternResult, error)
}

// PatternRegistryActivities owns the activities backing the Patterns
// platform-wide catalog: list-approved (catalog merge), register-pending
// (propose_pattern first half), resolve (propose_pattern second half).
type PatternRegistryActivities struct {
	client PatternsClient
	logger *slog.Logger
}

func NewPatternRegistryActivities(client PatternsClient, logger *slog.Logger) *PatternRegistryActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &PatternRegistryActivities{client: client, logger: logger}
}

// --- inputs / outputs ---

// ApprovedPattern mirrors services.PatternDoc with workflow-friendly JSON
// tags so the value can survive Temporal's serialization.
type ApprovedPattern struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	DisplayName     string `json:"display_name"`
	Description     string `json:"description"`
	Category        string `json:"category"`
	TemplateKind    string `json:"template_kind"`
	TemplateJSON    string `json:"template_json"`
	InputSchemaJSON string `json:"input_schema_json"`
	CurrentVersion  int    `json:"current_version"`
}

type ListApprovedPatternsInput struct {
	// Optional category filter (e.g. "compute", "data"). Empty returns all.
	Category string
}

type ListApprovedPatternsResult struct {
	Patterns []ApprovedPattern
}

type RegisterPendingPatternInput struct {
	Name            string
	DisplayName     string
	Description     string
	Category        string
	TemplateKind    string
	TemplateJSON    string
	InputSchemaJSON string
	Reasoning       string
	CreatedByRunID  string
	CreatedByUser   string
}

type RegisterPendingPatternResult struct {
	ID string
}

type ResolvePatternInput struct {
	ID         string
	Approved   bool
	ResolvedBy string
	Reason     string

	// Edited* fields are populated when the admin approved with edits.
	// Empty values mean "leave the agent's proposal unchanged for this
	// field." The downstream route writes a reviewer_edited
	// PatternVersions row only when at least one field actually changed.
	Edited              bool
	EditedName          string
	EditedDisplayName   string
	EditedDescription   string
	EditedCategory      string
	EditedTemplateKind  string
	EditedTemplateJSON  string
	EditedSchemaJSON    string
}

// ResolvePatternResult mirrors services.ResolvePatternResult so the
// workflow can include the version id + diff in the agent's tool result.
type ResolvePatternResult struct {
	ID               string
	Status           string
	PatternVersionID string
	EditedFields     []string
}

// --- activities ---

// ListApprovedPatterns returns the approved patterns in the platform-wide
// catalog. The workflow calls this at the top of each iteration so the
// LLM's catalog stays current as new patterns are approved mid-run.
func (a *PatternRegistryActivities) ListApprovedPatterns(ctx context.Context, in ListApprovedPatternsInput) (ListApprovedPatternsResult, error) {
	docs, err := a.client.ListApproved(ctx, in.Category)
	if err != nil {
		return ListApprovedPatternsResult{}, fmt.Errorf("list approved patterns: %w", err)
	}
	out := make([]ApprovedPattern, 0, len(docs))
	for _, d := range docs {
		out = append(out, ApprovedPattern{
			ID:              d.ID,
			Name:            d.Name,
			DisplayName:     d.DisplayName,
			Description:     d.Description,
			Category:        d.Category,
			TemplateKind:    d.TemplateKind,
			TemplateJSON:    d.TemplateJSON,
			InputSchemaJSON: d.InputSchemaJSON,
			CurrentVersion:  d.CurrentVersion,
		})
	}
	return ListApprovedPatternsResult{Patterns: out}, nil
}

// RegisterPendingPattern creates a pending row.
func (a *PatternRegistryActivities) RegisterPendingPattern(ctx context.Context, in RegisterPendingPatternInput) (RegisterPendingPatternResult, error) {
	if in.Name == "" || in.DisplayName == "" || in.Category == "" || in.TemplateKind == "" || in.TemplateJSON == "" || in.InputSchemaJSON == "" {
		return RegisterPendingPatternResult{}, temporal.NewNonRetryableApplicationError(
			"name, display_name, category, template_kind, template_json, input_schema_json required",
			"InvalidInput", nil)
	}
	id, err := a.client.RegisterPending(ctx, services.RegisterPendingPatternInput{
		Name:            in.Name,
		DisplayName:     in.DisplayName,
		Description:     in.Description,
		Category:        in.Category,
		TemplateKind:    in.TemplateKind,
		TemplateJSON:    in.TemplateJSON,
		InputSchemaJSON: in.InputSchemaJSON,
		Reasoning:       in.Reasoning,
		CreatedByRunID:  in.CreatedByRunID,
		CreatedByUser:   in.CreatedByUser,
	})
	if err != nil {
		if errors.Is(err, services.ErrPatternNameTaken) {
			return RegisterPendingPatternResult{}, temporal.NewNonRetryableApplicationError(err.Error(), "PatternNameTaken", err)
		}
		return RegisterPendingPatternResult{}, fmt.Errorf("register pending pattern: %w", err)
	}
	return RegisterPendingPatternResult{ID: id}, nil
}

// ResolvePattern flips a pending row to approved or rejected. When
// in.Edited is set, the activity passes a non-nil edits payload through
// to the route which writes the version history and patches the
// Patterns row to the admin's curated values.
func (a *PatternRegistryActivities) ResolvePattern(ctx context.Context, in ResolvePatternInput) (ResolvePatternResult, error) {
	if in.ID == "" {
		return ResolvePatternResult{}, temporal.NewNonRetryableApplicationError("id required", "InvalidInput", nil)
	}
	var edits *services.PatternEdits
	if in.Edited {
		edits = &services.PatternEdits{
			Name:            in.EditedName,
			DisplayName:     in.EditedDisplayName,
			Description:     in.EditedDescription,
			Category:        in.EditedCategory,
			TemplateKind:    in.EditedTemplateKind,
			TemplateJSON:    in.EditedTemplateJSON,
			InputSchemaJSON: in.EditedSchemaJSON,
		}
	}
	res, err := a.client.Resolve(ctx, in.ID, in.Approved, in.ResolvedBy, in.Reason, edits)
	if err != nil {
		return ResolvePatternResult{}, err
	}
	return ResolvePatternResult{
		ID:               res.ID,
		Status:           res.Status,
		PatternVersionID: res.PatternVersionID,
		EditedFields:     res.EditedFields,
	}, nil
}
