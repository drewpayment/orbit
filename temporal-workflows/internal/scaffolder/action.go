package scaffolder

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
)

// ErrNoPlan is returned by Action.Plan when the action cannot be dry-run.
// The workflow records a PlannedChange of kind "unsupported" rather than
// failing the dry run (plan §6.1).
var ErrNoPlan = errors.New("action does not support dry-run planning")

// PlannedChange is one side effect an action would cause, surfaced in the
// dry-run plan.
type PlannedChange struct {
	Kind        string `json:"kind"` // repo | entity | topic | file | pr | log | unsupported
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// ActionRunContext carries per-run context into an action. It is constructed by
// the dispatch activity, not by the workflow, so it may hold live clients.
//
// Dependencies that only some actions need (token service, storage client,
// Payload clients) are held by the concrete action structs, which are wired at
// worker startup; this struct stays free of them so the interface is stable.
type ActionRunContext struct {
	RunID             string
	WorkspaceID       string
	TemplateVersionID string
	UserID            string
	// WorkDir is the run's scratch directory on the worker, shared between
	// fetch/render/push steps. Empty when the run needs no filesystem.
	WorkDir string
	// DryRun is true for Plan dispatches. Actions must treat it as advisory
	// only: Execute is never called during a dry run.
	DryRun bool
	// Logger is run-scoped. Never nil when constructed via NewActionRunContext.
	Logger *slog.Logger
	// Heartbeat is called by long-running actions to keep the Temporal activity
	// alive. Never nil when constructed via NewActionRunContext.
	Heartbeat func(details ...any)
}

// NewActionRunContext fills in the optional collaborators so actions never have
// to nil-check them.
func NewActionRunContext(rc ActionRunContext) ActionRunContext {
	if rc.Logger == nil {
		rc.Logger = slog.Default()
	}
	if rc.Heartbeat == nil {
		rc.Heartbeat = func(...any) {}
	}
	return rc
}

// Action is one step type. Implementations live in the actions subpackage and
// are registered once at worker startup.
//
// Execute and Plan run inside a Temporal activity, so they may do I/O, but they
// must not depend on wall-clock ordering between steps beyond their declared
// inputs. Plan must have no side effects.
type Action interface {
	// Name is the registry key, e.g. "github:repo:create".
	Name() string
	// InputSchema is a JSON Schema for the step's `input` — used by static
	// validation and by the Phase 2 authoring UI for autocomplete.
	InputSchema() json.RawMessage
	// OutputSchema's `properties` keys are exactly what
	// `${{ steps.<id>.output.<key> }}` may reference.
	OutputSchema() json.RawMessage
	// Execute performs the action and returns its output object.
	Execute(ctx context.Context, rc ActionRunContext, input json.RawMessage) (json.RawMessage, error)
	// Plan describes what Execute would do, without doing it. Return ErrNoPlan
	// if dry-run planning is not supported.
	Plan(ctx context.Context, rc ActionRunContext, input json.RawMessage) ([]PlannedChange, error)
}

// PlanDeclarer lets an action state up front that it cannot be dry-run, so the
// authoring UI can warn without invoking Plan. Actions that omit it are assumed
// to support planning.
type PlanDeclarer interface {
	SupportsPlan() bool
}

// FamilyDeclarer overrides the family derived from the action name prefix.
type FamilyDeclarer interface {
	Family() string
}

// PlanPreviewer is implemented by actions whose dry run produces a file tree
// worth keeping for the Phase 2 diff viewer. The dispatch activity supplies an
// empty destination directory, and the action renders into it instead of into
// a throwaway temp dir, so the caller can persist the result.
//
// An action that implements this is declaring that its dry run is only useful
// when the preview can actually be stored: the activity fails the step rather
// than silently planning without a preview.
type PlanPreviewer interface {
	// PlanPreview renders into destDir, which the caller creates and owns
	// (including deleting it). It returns the same changes Plan would.
	PlanPreview(ctx context.Context, rc ActionRunContext, input json.RawMessage, destDir string) ([]PlannedChange, error)
}

// ErrInvalidInput marks an action failure caused by the step's input rather
// than by the world: a missing required field, a malformed value, a path
// outside the run's work dir. The dispatch activity raises these as
// non-retryable, so a broken definition fails once instead of burning the
// whole retry budget.
//
// Wrap it with %w:
//
//	return fmt.Errorf("fs:render: %w: `path` is required", scaffolder.ErrInvalidInput)
var ErrInvalidInput = errors.New("invalid action input")
