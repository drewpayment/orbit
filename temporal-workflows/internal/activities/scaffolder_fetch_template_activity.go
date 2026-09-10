package activities

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// ActivityScaffolderResolveTemplateVersion is the activity name for the
// `fetch:template` special case (Phase 4 Task D).
const ActivityScaffolderResolveTemplateVersion = "ScaffolderResolveTemplateVersion"

// TemplateVersionResolver is the subset of
// services.PayloadTemplateDefinitionsClient the activity needs. Satisfied
// by *services.PayloadTemplateDefinitionsClient.
type TemplateVersionResolver interface {
	GetDefinition(ctx context.Context, id string) (services.TemplateDefinitionSummary, error)
	GetDefinitionVersion(ctx context.Context, id string) (services.TemplateDefinitionVersion, error)
}

// ScaffolderFetchTemplateActivities backs the `fetch:template` step's
// definition/version lookup — the "workflow code makes no Payload calls"
// rule Phase 1 established for the top-level run input applies equally to a
// nested one.
type ScaffolderFetchTemplateActivities struct {
	client TemplateVersionResolver
	logger *slog.Logger
}

// NewScaffolderFetchTemplateActivities wires the activity. client may be
// nil in tests that never call ResolveTemplateVersion.
func NewScaffolderFetchTemplateActivities(client TemplateVersionResolver, logger *slog.Logger) *ScaffolderFetchTemplateActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &ScaffolderFetchTemplateActivities{client: client, logger: logger}
}

// ScaffolderResolveTemplateVersionInput is the activity input for
// ResolveTemplateVersion.
type ScaffolderResolveTemplateVersionInput struct {
	WorkspaceID string `json:"workspaceId"`
	// TemplateDefinitionID is the template-definitions doc id to compose in.
	TemplateDefinitionID string `json:"templateDefinitionId"`
	// Version optionally pins a specific template-definition-versions doc
	// id. Empty resolves the definition's current published version.
	Version string `json:"version,omitempty"`
}

// ScaffolderResolveTemplateVersionResult carries the resolved version id
// (for cycle detection against TemplateStack) and the full definition
// document to run as a child ScaffolderWorkflow.
type ScaffolderResolveTemplateVersionResult struct {
	DefinitionVersionID string                `json:"definitionVersionId"`
	DefinitionID        string                `json:"definitionId"`
	Definition          scaffolder.Definition `json:"definition"`
}

// ResolveTemplateVersion resolves `templateDefinitionId` (+ optional pinned
// `version`) to a definition document, enforcing that the resolved
// definition and version both belong to the calling run's own workspace —
// the same tenant-isolation check StartScaffolderRun applies to a top-level
// run.
func (a *ScaffolderFetchTemplateActivities) ResolveTemplateVersion(ctx context.Context, in ScaffolderResolveTemplateVersionInput) (*ScaffolderResolveTemplateVersionResult, error) {
	if a.client == nil {
		return nil, nonRetryable(errors.New("fetch:template: template definitions client not configured"))
	}
	if strings.TrimSpace(in.WorkspaceID) == "" || strings.TrimSpace(in.TemplateDefinitionID) == "" {
		return nil, nonRetryable(errors.New("fetch:template: workspaceId and templateDefinitionId required"))
	}

	versionID := strings.TrimSpace(in.Version)
	if versionID == "" {
		def, err := a.client.GetDefinition(ctx, in.TemplateDefinitionID)
		if err != nil {
			if errors.Is(err, services.ErrTemplateDefinitionNotFound) {
				return nil, nonRetryable(fmt.Errorf("fetch:template: %w", err))
			}
			return nil, fmt.Errorf("fetch:template: resolve definition: %w", err)
		}
		if def.WorkspaceID != "" && def.WorkspaceID != in.WorkspaceID {
			return nil, nonRetryable(fmt.Errorf("fetch:template: template %s belongs to a different workspace", in.TemplateDefinitionID))
		}
		if def.Status != "published" {
			return nil, nonRetryable(fmt.Errorf("fetch:template: template %s is not published", in.TemplateDefinitionID))
		}
		if strings.TrimSpace(def.CurrentVersionID) == "" {
			return nil, nonRetryable(fmt.Errorf("fetch:template: template %s has no published version", in.TemplateDefinitionID))
		}
		versionID = def.CurrentVersionID
	}

	version, err := a.client.GetDefinitionVersion(ctx, versionID)
	if err != nil {
		if errors.Is(err, services.ErrTemplateDefinitionVersionNotFound) {
			return nil, nonRetryable(fmt.Errorf("fetch:template: %w", err))
		}
		return nil, fmt.Errorf("fetch:template: resolve version: %w", err)
	}
	if version.DefinitionID != "" && version.DefinitionID != in.TemplateDefinitionID {
		return nil, nonRetryable(fmt.Errorf("fetch:template: version %s does not belong to template %s", versionID, in.TemplateDefinitionID))
	}
	if version.WorkspaceID != "" && version.WorkspaceID != in.WorkspaceID {
		return nil, nonRetryable(fmt.Errorf("fetch:template: version %s belongs to a different workspace", versionID))
	}

	var def scaffolder.Definition
	if err := json.Unmarshal(version.DefinitionJSON, &def); err != nil {
		return nil, nonRetryable(fmt.Errorf("fetch:template: decode definition: %w", err))
	}

	return &ScaffolderResolveTemplateVersionResult{
		DefinitionVersionID: versionID,
		DefinitionID:        in.TemplateDefinitionID,
		Definition:          def,
	}, nil
}
