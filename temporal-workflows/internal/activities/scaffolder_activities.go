package activities

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// Activity names for the v2 scaffolder. These are the names the worker
// registers under and the names ScaffolderWorkflow schedules by, so they are
// deliberately prefixed: the generic method names would collide with other
// activity structs in the same worker.
const (
	ActivityScaffolderExecuteStep        = "ScaffolderExecuteStep"
	ActivityScaffolderPlanStep           = "ScaffolderPlanStep"
	ActivityScaffolderWriteRunProgress   = "ScaffolderWriteRunProgress"
	ActivityScaffolderCleanupRun         = "ScaffolderCleanupRun"
	ActivityScaffolderValidateDefinition = "ScaffolderValidateDefinition"
)

// ErrTypeScaffolderInvalid is the temporal.ApplicationError type used for
// failures that a retry can never fix: an unknown action, a malformed step, a
// run id that does not resolve, or storage being unconfigured. Everything else
// (an action's own I/O failure) stays retryable under the workflow's bounded
// retry policy.
const ErrTypeScaffolderInvalid = "ScaffolderInvalidStep"

// redactedPlaceholder replaces secret-looking values before step output is
// persisted to the run record. It never touches the value the workflow keeps
// in its expression context, so a later step can still consume the real value.
const redactedPlaceholder = "[redacted]"

// previewMaxFileBytes and previewMaxTotalBytes bound the dry-run preview
// upload. A template can render an arbitrarily large tree; without these a
// single dry run could push hundreds of megabytes into object storage.
const (
	previewMaxFileBytes  = 512 << 10
	previewMaxTotalBytes = 8 << 20
)

// ScaffolderStorage is the subset of clients.StorageClient the dry-run
// preview needs. An interface keeps the activity testable without MinIO.
type ScaffolderStorage interface {
	UploadJSON(ctx context.Context, path string, data any) (int64, error)
}

// ActionRunStatusWriter writes run progress back to orbit-www. Satisfied by
// *services.PayloadActionRunClient.
type ActionRunStatusWriter interface {
	WriteStatus(ctx context.Context, runID string, in services.ActionRunStatusInput) error
}

// ScaffolderStepInput is the activity input for both ExecuteStep and PlanStep.
// Input arrives already expression-resolved: the workflow owns resolution so
// the resolved values are recorded in history and replay-stable.
type ScaffolderStepInput struct {
	RunID             string          `json:"runId"`
	WorkspaceID       string          `json:"workspaceId"`
	TemplateVersionID string          `json:"templateVersionId"`
	UserID            string          `json:"userId"`
	DryRun            bool            `json:"dryRun"`
	StepID            string          `json:"stepId"`
	StepName          string          `json:"stepName"`
	Action            string          `json:"action"`
	Input             json.RawMessage `json:"input"`
}

// ScaffolderStepResult is one executed step's output object.
type ScaffolderStepResult struct {
	Output map[string]any `json:"output"`
}

// ScaffolderPlanResult is one planned step. Unsupported is set when the action
// returned scaffolder.ErrNoPlan, which is a plan entry, not a failure.
type ScaffolderPlanResult struct {
	Changes     []scaffolder.PlannedChange `json:"changes"`
	Unsupported bool                       `json:"unsupported"`
	// PreviewPath is the object-storage key of the rendered tree, when the
	// action produced one.
	PreviewPath string `json:"previewPath,omitempty"`
}

// ScaffolderStepProgress is the workflow's per-step view, persisted to
// `action-runs.steps` and returned by the "progress" query.
type ScaffolderStepProgress struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Status     string         `json:"status"` // pending|running|succeeded|failed|skipped
	StartedAt  string         `json:"startedAt,omitempty"`
	FinishedAt string         `json:"finishedAt,omitempty"`
	Output     map[string]any `json:"output,omitempty"`
	Error      string         `json:"error,omitempty"`
}

// ScaffolderLogEntry is one line appended to the run's log.
type ScaffolderLogEntry struct {
	TS      string `json:"ts,omitempty"`
	Level   string `json:"level,omitempty"`
	Message string `json:"message"`
}

// WriteRunProgressInput is the activity input for the run-status writeback.
//
// HasPlan distinguishes "this dry run produced no changes" (send an empty
// array) from "this is not a dry-run write" (leave the stored plan alone) —
// the status route replaces `plan` whenever the key is present.
type WriteRunProgressInput struct {
	RunID      string                     `json:"runId"`
	Status     string                     `json:"status,omitempty"`
	WorkflowID string                     `json:"workflowId,omitempty"`
	Steps      []ScaffolderStepProgress   `json:"steps,omitempty"`
	HasPlan    bool                       `json:"hasPlan,omitempty"`
	Plan       []scaffolder.PlannedChange `json:"plan,omitempty"`
	Outputs    map[string]any             `json:"outputs,omitempty"`
	Error      string                     `json:"error,omitempty"`
	AppendLogs []ScaffolderLogEntry       `json:"appendLogs,omitempty"`
}

// ValidateDefinitionInput carries the v2 document to statically validate.
type ValidateDefinitionInput struct {
	Definition scaffolder.Definition `json:"definition"`
}

// ValidateDefinitionResult is the validator's findings, already formatted and
// sorted. An empty Errors slice means the definition is executable.
type ValidateDefinitionResult struct {
	Errors []string `json:"errors"`
}

// CleanupScaffolderRunInput identifies the run whose work dir to remove.
type CleanupScaffolderRunInput struct {
	RunID string `json:"runId"`
}

// ScaffolderActivities dispatches v2 template steps through the action
// registry and writes progress back to orbit-www.
type ScaffolderActivities struct {
	registry *scaffolder.Registry
	runs     ActionRunStatusWriter
	storage  ScaffolderStorage
	baseDir  string
	logger   *slog.Logger
}

// NewScaffolderActivities wires the dispatch activities. runs and storage may
// be nil: without runs, progress writes are dropped with a warning (the run
// still executes); without storage, dry runs of previewing actions fail loudly
// rather than silently skipping the preview.
func NewScaffolderActivities(registry *scaffolder.Registry, runs ActionRunStatusWriter, storage ScaffolderStorage, baseDir string, logger *slog.Logger) *ScaffolderActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &ScaffolderActivities{
		registry: registry,
		runs:     runs,
		storage:  storage,
		baseDir:  baseDir,
		logger:   logger,
	}
}

// ExecuteStep runs one step's action and returns its output object.
func (a *ScaffolderActivities) ExecuteStep(ctx context.Context, in ScaffolderStepInput) (*ScaffolderStepResult, error) {
	action, rc, err := a.prepare(ctx, in, false)
	if err != nil {
		return nil, err
	}

	raw, err := action.Execute(ctx, rc, in.Input)
	if err != nil {
		// The action's own failure may well be transient (a 503 from GitHub,
		// a flaky clone), so it stays retryable under the caller's bounded
		// retry policy rather than being classified here.
		return nil, fmt.Errorf("step %q (%s): %w", in.StepID, in.Action, err)
	}

	out, err := decodeOutputObject(raw)
	if err != nil {
		return nil, nonRetryable(fmt.Errorf("step %q (%s): %w", in.StepID, in.Action, err))
	}
	return &ScaffolderStepResult{Output: out}, nil
}

// PlanStep describes what ExecuteStep would do, without doing it. Actions that
// implement scaffolder.PlanPreviewer render into a scratch directory whose
// contents are uploaded to object storage for the dry-run diff viewer.
func (a *ScaffolderActivities) PlanStep(ctx context.Context, in ScaffolderStepInput) (*ScaffolderPlanResult, error) {
	action, rc, err := a.prepare(ctx, in, true)
	if err != nil {
		return nil, err
	}

	previewer, wantsPreview := action.(scaffolder.PlanPreviewer)
	if !wantsPreview {
		changes, err := action.Plan(ctx, rc, in.Input)
		if errors.Is(err, scaffolder.ErrNoPlan) {
			return &ScaffolderPlanResult{Unsupported: true}, nil
		}
		if err != nil {
			return nil, fmt.Errorf("plan step %q (%s): %w", in.StepID, in.Action, err)
		}
		return &ScaffolderPlanResult{Changes: changes}, nil
	}

	if a.storage == nil {
		// Fail before running the action: a preview we cannot store is worse
		// than no dry run at all, because the plan would look complete.
		return nil, nonRetryable(fmt.Errorf("plan step %q (%s): dry-run preview unavailable: storage offline", in.StepID, in.Action))
	}

	destDir := filepath.Join(a.runWorkDir(in.RunID), "preview", sanitizePathSegment(in.StepID))
	if err := os.RemoveAll(destDir); err != nil {
		return nil, fmt.Errorf("plan step %q: clear preview dir: %w", in.StepID, err)
	}
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return nil, fmt.Errorf("plan step %q: create preview dir: %w", in.StepID, err)
	}
	defer func() { _ = os.RemoveAll(destDir) }()

	changes, err := previewer.PlanPreview(ctx, rc, in.Input, destDir)
	if err != nil {
		return nil, fmt.Errorf("plan step %q (%s): %w", in.StepID, in.Action, err)
	}

	preview, err := collectPreview(in.RunID, in.StepID, destDir)
	if err != nil {
		return nil, fmt.Errorf("plan step %q: collect preview: %w", in.StepID, err)
	}
	key := previewObjectKey(in.RunID, in.StepID)
	if _, err := a.storage.UploadJSON(ctx, key, *preview); err != nil {
		return nil, fmt.Errorf("plan step %q: upload preview: %w", in.StepID, err)
	}

	return &ScaffolderPlanResult{Changes: changes, PreviewPath: key}, nil
}

// WriteRunProgress pushes the current run snapshot to orbit-www.
func (a *ScaffolderActivities) WriteRunProgress(ctx context.Context, in WriteRunProgressInput) error {
	if strings.TrimSpace(in.RunID) == "" {
		return nonRetryable(errors.New("write run progress: run id required"))
	}
	if a.runs == nil {
		a.logger.Warn("scaffolder run progress dropped: no action-run client configured",
			slog.String("runId", in.RunID), slog.String("status", in.Status))
		return nil
	}

	body := services.ActionRunStatusInput{}
	if in.Status != "" {
		body.Status = &in.Status
	}
	if in.WorkflowID != "" {
		body.WorkflowID = &in.WorkflowID
	}
	if in.Error != "" {
		body.Error = &in.Error
	}
	if in.Outputs != nil {
		body.Outputs = in.Outputs
	}
	if in.Steps != nil {
		body.Steps = toActionRunSteps(in.Steps)
	}
	if in.HasPlan {
		plan := toPlanMaps(in.Plan)
		body.Plan = &plan
	}
	for _, l := range in.AppendLogs {
		if strings.TrimSpace(l.Message) == "" {
			continue
		}
		ts := l.TS
		if ts == "" {
			ts = time.Now().UTC().Format(time.RFC3339)
		}
		level := l.Level
		if level == "" {
			level = "info"
		}
		body.AppendLogs = append(body.AppendLogs, services.ActionRunLogEntry{TS: ts, Level: level, Message: l.Message})
	}

	if body.IsEmpty() {
		return nil
	}

	if err := a.runs.WriteStatus(ctx, in.RunID, body); err != nil {
		if errors.Is(err, services.ErrActionRunNotFound) {
			return nonRetryable(fmt.Errorf("write run progress: %w", err))
		}
		return fmt.Errorf("write run progress: %w", err)
	}
	return nil
}

// CleanupRun removes a run's work directory. It is idempotent and refuses to
// act on an empty run id, which would otherwise resolve to the shared base dir.
func (a *ScaffolderActivities) CleanupRun(_ context.Context, in CleanupScaffolderRunInput) error {
	if strings.TrimSpace(in.RunID) == "" {
		return nonRetryable(errors.New("cleanup scaffolder run: run id required"))
	}
	dir := a.runWorkDir(in.RunID)
	if err := os.RemoveAll(dir); err != nil {
		return fmt.Errorf("cleanup scaffolder run %s: %w", in.RunID, err)
	}
	a.logger.Debug("scaffolder run work dir removed", slog.String("runId", in.RunID), slog.String("workDir", dir))
	return nil
}

// ValidateDefinition statically validates a definition against the live action
// registry.
//
// This runs in an activity rather than in workflow code on purpose: JSON Schema
// compilation and schema-error flattening walk Go maps, whose iteration order
// is randomised, so the set and order of findings is not replay-stable. Running
// it here records one settled answer in workflow history.
//
// Findings are returned in the result, not as an error: an invalid definition
// is a user error that must fail the run immediately, never retry.
func (a *ScaffolderActivities) ValidateDefinition(_ context.Context, in ValidateDefinitionInput) (*ValidateDefinitionResult, error) {
	def := in.Definition
	findings := scaffolder.Validate(&def, scaffolder.DescriptorCatalog(a.registry.Descriptors()))

	out := make([]string, 0, len(findings))
	for _, f := range findings {
		out = append(out, f.Error())
	}
	sort.Strings(out)
	return &ValidateDefinitionResult{Errors: out}, nil
}

// --- internals --------------------------------------------------------------

// prepare resolves the action and builds its run context, creating the run's
// shared work dir so fetch/render/push steps see the same tree.
func (a *ScaffolderActivities) prepare(ctx context.Context, in ScaffolderStepInput, dryRun bool) (scaffolder.Action, scaffolder.ActionRunContext, error) {
	if strings.TrimSpace(in.RunID) == "" {
		return nil, scaffolder.ActionRunContext{}, nonRetryable(errors.New("scaffolder step: run id required"))
	}
	action, ok := a.registry.Get(in.Action)
	if !ok {
		return nil, scaffolder.ActionRunContext{}, nonRetryable(fmt.Errorf("scaffolder step %q: unknown action %q", in.StepID, in.Action))
	}

	workDir := a.runWorkDir(in.RunID)
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return nil, scaffolder.ActionRunContext{}, fmt.Errorf("scaffolder step %q: create work dir: %w", in.StepID, err)
	}

	rc := scaffolder.NewActionRunContext(scaffolder.ActionRunContext{
		RunID:             in.RunID,
		WorkspaceID:       in.WorkspaceID,
		TemplateVersionID: in.TemplateVersionID,
		UserID:            in.UserID,
		WorkDir:           workDir,
		DryRun:            dryRun,
		Logger: a.logger.With(
			slog.String("runId", in.RunID),
			slog.String("stepId", in.StepID),
			slog.String("action", in.Action),
		),
		Heartbeat: func(details ...any) {
			if activity.IsActivity(ctx) {
				activity.RecordHeartbeat(ctx, details...)
			}
		},
	})
	return action, rc, nil
}

// runWorkDir is the per-run scratch directory. The run id is sanitised so a
// hostile id cannot escape the configured base directory.
func (a *ScaffolderActivities) runWorkDir(runID string) string {
	return filepath.Join(a.baseDir, "scaffolder-run-"+sanitizePathSegment(runID))
}

// sanitizePathSegment reduces s to a single safe path segment.
func sanitizePathSegment(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	out := b.String()
	if out == "" {
		out = "unnamed"
	}
	if len(out) > 128 {
		out = out[:128]
	}
	return out
}

// decodeOutputObject turns an action's raw output into a map. Actions declare
// object output schemas, so anything else is a platform bug in that action.
func decodeOutputObject(raw json.RawMessage) (map[string]any, error) {
	if len(strings.TrimSpace(string(raw))) == 0 || string(raw) == "null" {
		return map[string]any{}, nil
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("action output is not a JSON object: %w", err)
	}
	if out == nil {
		out = map[string]any{}
	}
	return out, nil
}

func toActionRunSteps(steps []ScaffolderStepProgress) []services.ActionRunStep {
	out := make([]services.ActionRunStep, 0, len(steps))
	for _, s := range steps {
		step := services.ActionRunStep{
			ID:         s.ID,
			Name:       s.Name,
			Status:     s.Status,
			StartedAt:  s.StartedAt,
			FinishedAt: s.FinishedAt,
			LogTail:    s.Error,
		}
		if s.Output != nil {
			redacted, _ := redactSecrets(s.Output).(map[string]any)
			step.Output = redacted
		}
		out = append(out, step)
	}
	return out
}

func toPlanMaps(changes []scaffolder.PlannedChange) []map[string]any {
	out := make([]map[string]any, 0, len(changes))
	for _, c := range changes {
		out = append(out, map[string]any{
			"kind":        c.Kind,
			"name":        c.Name,
			"description": c.Description,
		})
	}
	return out
}

// secretKeyFragments are matched case-insensitively against output keys.
var secretKeyFragments = []string{"token", "secret", "password", "passwd", "apikey", "api_key", "credential", "privatekey", "private_key", "authorization"}

// redactSecrets returns a copy of v with secret-looking scalar values replaced.
// Only the persisted view is redacted; the workflow's expression context keeps
// the real values so later steps still work.
func redactSecrets(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			if looksSecret(k) {
				out[k] = redactedPlaceholder
				continue
			}
			out[k] = redactSecrets(val)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, item := range t {
			out[i] = redactSecrets(item)
		}
		return out
	default:
		return v
	}
}

func looksSecret(key string) bool {
	lower := strings.ToLower(key)
	for _, frag := range secretKeyFragments {
		if strings.Contains(lower, frag) {
			return true
		}
	}
	return false
}

// --- dry-run preview --------------------------------------------------------

// scaffolderPreviewFile is one file in a dry-run preview.
type scaffolderPreviewFile struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Encoding string `json:"encoding"` // utf8 | base64
	Size     int64  `json:"size"`
	Omitted  bool   `json:"omitted,omitempty"`
}

// scaffolderPreview is the object uploaded under scaffolder-runs/{runId}/.
type scaffolderPreview struct {
	RunID     string                  `json:"runId"`
	StepID    string                  `json:"stepId"`
	Files     []scaffolderPreviewFile `json:"files"`
	Truncated bool                    `json:"truncated"`
}

func previewObjectKey(runID, stepID string) string {
	return "scaffolder-runs/" + sanitizePathSegment(runID) + "/" + sanitizePathSegment(stepID) + "/preview.json"
}

// collectPreview walks destDir into a size-bounded manifest, sorted by path so
// the uploaded object is stable for a given tree.
func collectPreview(runID, stepID, destDir string) (*scaffolderPreview, error) {
	preview := &scaffolderPreview{RunID: runID, StepID: stepID, Files: []scaffolderPreviewFile{}}
	var total int64

	err := filepath.WalkDir(destDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		// Symlinks are recorded by name only: following them could read
		// outside the preview dir, and their targets are already covered.
		if d.IsDir() || !d.Type().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(destDir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)

		info, err := d.Info()
		if err != nil {
			return err
		}
		entry := scaffolderPreviewFile{Path: rel, Size: info.Size(), Encoding: "utf8"}

		switch {
		case info.Size() > previewMaxFileBytes, total+info.Size() > previewMaxTotalBytes:
			entry.Omitted = true
			preview.Truncated = true
		default:
			data, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			total += int64(len(data))
			if utf8.Valid(data) {
				entry.Content = string(data)
			} else {
				entry.Encoding = "base64"
				entry.Content = base64.StdEncoding.EncodeToString(data)
			}
		}
		preview.Files = append(preview.Files, entry)
		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Slice(preview.Files, func(i, j int) bool { return preview.Files[i].Path < preview.Files[j].Path })
	return preview, nil
}

// nonRetryable marks err as a failure no retry can fix.
func nonRetryable(err error) error {
	return temporal.NewNonRetryableApplicationError(err.Error(), ErrTypeScaffolderInvalid, err)
}
