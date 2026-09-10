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
	"regexp"
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
	// previewMaxFiles bounds the manifest independently of its byte size:
	// hundreds of thousands of empty files would each pass the byte checks and
	// still build one enormous in-memory JSON document.
	previewMaxFiles = 5000
)

// previewsDirName and previewDirPrefix name the dry-run preview scratch area,
// a sibling of the run work dirs under the worker's base directory.
const (
	previewsDirName  = "previews"
	previewDirPrefix = "orbit-scaffolder-preview-"
)

// previewSweepGrace is how long an orphaned preview directory is left alone
// before CleanupRun removes it. It must comfortably exceed the longest plausible
// PlanStep, or the sweep could delete a preview another run is still filling.
const previewSweepGrace = 6 * time.Hour

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
// HasPlan and HasOutputs distinguish "this run produced none" (send an empty
// value, clearing whatever is stored) from "this is not a write of that field"
// (leave it alone) — the status route replaces a field whenever its key is
// present.
type WriteRunProgressInput struct {
	RunID      string                     `json:"runId"`
	Status     string                     `json:"status,omitempty"`
	WorkflowID string                     `json:"workflowId,omitempty"`
	Steps      []ScaffolderStepProgress   `json:"steps,omitempty"`
	HasPlan    bool                       `json:"hasPlan,omitempty"`
	Plan       []scaffolder.PlannedChange `json:"plan,omitempty"`
	// HasOutputs distinguishes "this run produced no outputs, clear any
	// stored ones" from "this is not an outputs write". Outputs alone cannot
	// carry that: an empty map is dropped by omitempty on the way in, so it
	// would arrive indistinguishable from unset.
	HasOutputs bool                 `json:"hasOutputs,omitempty"`
	Outputs    map[string]any       `json:"outputs,omitempty"`
	Error      string               `json:"error,omitempty"`
	AppendLogs []ScaffolderLogEntry `json:"appendLogs,omitempty"`
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
//
// KNOWN LIMITATION — single-worker work dir. Steps of one run share a local
// directory under baseDir (fetch:git clones into it, fs:render renders it,
// git:push pushes it). Nothing pins a run's activities to one worker, so with
// more than one worker replica on the "orbit-workflows" task queue a later
// step can land on a host where that directory does not exist, and
// CleanupRun can delete a directory on the wrong host while leaving the real
// one behind. This is safe on today's single-replica deployment. Fixing it
// properly means a Temporal session (workflow.NewSessionContext) pinning a
// run's steps to one worker, or shared storage for the work dir; either is a
// deliberate change to worker configuration and is tracked as follow-up work.
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
		// An action that declares its failure as an input error will never
		// succeed on retry; anything else may be transient (a 503 from GitHub,
		// a flaky clone) and stays retryable under the bounded policy.
		if errors.Is(err, scaffolder.ErrInvalidInput) {
			return nil, nonRetryable(fmt.Errorf("step %q (%s): %w", in.StepID, in.Action, err))
		}
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
			return nil, planStepError(in, err)
		}
		return &ScaffolderPlanResult{Changes: changes}, nil
	}

	if a.storage == nil {
		// Fail before running the action: a preview we cannot store is worse
		// than no dry run at all, because the plan would look complete.
		return nil, nonRetryable(fmt.Errorf("plan step %q (%s): dry-run preview unavailable: storage offline", in.StepID, in.Action))
	}

	// The preview directory MUST live outside the run work dir. A previewing
	// action copies its source tree into destDir, and fs:render's source is
	// routinely the work dir root — a destination inside it would make the
	// copy walk into its own output and recurse until the path length blows
	// up, rewriting the whole tree at every level.
	//
	// It lives under baseDir/previews rather than the system temp dir so it
	// shares the worker's configured scratch volume, and so CleanupRun can
	// sweep anything a crashed attempt left behind.
	previewRoot := a.previewRoot()
	if err := os.MkdirAll(previewRoot, 0o755); err != nil {
		return nil, fmt.Errorf("plan step %q: create preview root: %w", in.StepID, err)
	}
	destDir, err := os.MkdirTemp(previewRoot, previewDirPrefix+"*")
	if err != nil {
		return nil, fmt.Errorf("plan step %q: create preview dir: %w", in.StepID, err)
	}
	defer func() { _ = os.RemoveAll(destDir) }()

	changes, err := previewer.PlanPreview(ctx, rc, in.Input, destDir)
	if err != nil {
		return nil, planStepError(in, err)
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
	if in.HasOutputs || in.Outputs != nil {
		// spec.output is author-written and can name a step output that holds
		// a credential, so the persisted copy goes through the same redaction
		// as step output.
		outputs := in.Outputs
		if outputs == nil {
			outputs = map[string]any{}
		}
		redacted, _ := redactSecrets(outputs).(map[string]any)
		body.Outputs = redacted
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

	a.sweepStalePreviews()
	return nil
}

// sweepStalePreviews removes preview directories a crashed or killed attempt
// left behind. PlanStep removes its own on every path, so anything still here
// past the grace period is orphaned. Best effort: a run must never fail
// because someone else's leftovers could not be removed.
func (a *ScaffolderActivities) sweepStalePreviews() {
	root := a.previewRoot()
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-previewSweepGrace)
	for _, e := range entries {
		if !e.IsDir() || !strings.HasPrefix(e.Name(), previewDirPrefix) {
			continue
		}
		info, err := e.Info()
		// Skip anything still young: a preview for another run may be in
		// flight right now on this worker.
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		stale := filepath.Join(root, e.Name())
		if err := os.RemoveAll(stale); err != nil {
			a.logger.Warn("failed to remove a stale scaffolder preview dir",
				slog.String("dir", stale), slog.String("error", err.Error()))
			continue
		}
		a.logger.Debug("removed a stale scaffolder preview dir", slog.String("dir", stale))
	}
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

// previewRoot holds every dry-run preview directory. It is a sibling of the
// run work dirs, never inside one.
func (a *ScaffolderActivities) previewRoot() string {
	return filepath.Join(a.baseDir, previewsDirName)
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
			// An action error can quote the input it choked on (a URL with a
			// token in the query string, say), so the persisted tail is
			// scrubbed of anything that looks like a secret.
			LogTail: redactSecretsInText(s.Error),
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
		if len(preview.Files) >= previewMaxFiles {
			preview.Truncated = true
			return fs.SkipAll
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

// planStepError wraps a planning failure, marking it non-retryable when the
// action blamed its input.
func planStepError(in ScaffolderStepInput, err error) error {
	wrapped := fmt.Errorf("plan step %q (%s): %w", in.StepID, in.Action, err)
	if errors.Is(err, scaffolder.ErrInvalidInput) {
		return nonRetryable(wrapped)
	}
	return wrapped
}

// Credential shapes recognised in free text.
//
// This is a BACKSTOP for text this code did not compose (an action's error
// string). The real control is not putting secrets in messages; the run log
// only ever carries step lifecycle lines, never a resolved input.
//
// It is tuned for precision over recall, because over-redaction actively
// misleads: "Secret: [redacted] not found" tells an operator less than the
// unredacted message did. So:
//
//   - Only field names that mean "the value IS a credential" are matched.
//     Deliberately absent: bare `secret`, `token`, `credential`, `auth` and
//     `private_key`. Those routinely name a resource, not a secret — a
//     Kubernetes Secret, a git ref (`token: refs/heads/x`), a key file path —
//     and matching them destroyed the identifying half of real messages.
//     Values that are genuinely secret under those names are still caught by
//     secretTokenPattern whenever they have a recognisable shape.
//   - URL userinfo is handled by its own rule, so a credentialed clone URL
//     keeps its scheme, username and host and loses only the password.
var (
	// secretValueChars: no whitespace or quoting, and no brackets, so
	// re-running cannot chew an earlier "[redacted]".
	secretValueChars = `[^\s"'&,;)\[\]{}]`

	// urlUserinfoPattern matches the password half of scheme://user:pass@host.
	// Group 1 keeps everything up to and including the ":", group 2 is the
	// password, and the trailing "@host" is left in place by the replacement.
	urlUserinfoPattern = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.\-]*://[^/\s:@]+:)([^/\s@]+)@`)

	// secretAssignmentPattern matches `<credential name> = <value>` and
	// `<credential name>: <value>`, including a leading auth scheme
	// ("Bearer", "Basic", "token") which must be KEPT — eating the scheme
	// while publishing the token after it is worse than not redacting.
	secretAssignmentPattern = regexp.MustCompile(
		`(?i)\b((?:access[_-]?token|refresh[_-]?token|id[_-]?token|bearer[_-]?token|api[_-]?key|apikey|api[_-]?secret|client[_-]?secret|password|passwd|pwd|authorization)` +
			`["']?\s*[=:]\s*["']?(?:(?:bearer|basic|token)\s+)?)` +
			// The value must look like a credential rather than a word:
			// either it carries a digit or symbol, or it is long enough that
			// no ordinary word reaches it. Without this the optional scheme
			// above can backtrack and be redacted AS the value, publishing
			// the token that follows it.
			`(` + secretValueChars + `{5,}[0-9_\-+/=.@]` + secretValueChars + `*` +
			`|` + secretValueChars + `{12,})`)

	// secretTokenPattern matches tokens that identify themselves, so they are
	// redacted wherever they appear regardless of any surrounding field name:
	// GitHub (classic ghp_/gho_/ghu_/ghs_/ghr_ and fine-grained github_pat_),
	// GitLab (glpat-), Slack (xoxb-/xoxp-/xoxa-/xoxs-), AWS access key ids,
	// and long opaque alphanumeric strings in the shape of an Azure DevOps PAT.
	//
	// The opaque rule starts at 44 characters specifically so a 40-character
	// git SHA-1 is NOT redacted; a longer single-case hex digest still can be,
	// which is an accepted cost for catching unprefixed PATs.
	secretTokenPattern = regexp.MustCompile(
		`\b(gh[pousr]_[A-Za-z0-9]{16,}` +
			`|github_pat_[A-Za-z0-9_]{20,}` +
			`|glpat-[A-Za-z0-9\-_]{16,}` +
			`|xox[baps]-[A-Za-z0-9\-]{10,}` +
			`|AKIA[0-9A-Z]{16}` +
			`|[A-Za-z0-9]{44,})\b`)
)

// redactSecretsInText scrubs credential-shaped substrings from free text.
//
// Only the value is replaced, so the reader still sees which field leaked and
// what the surrounding error said. Running it twice is a no-op.
func redactSecretsInText(s string) string {
	if s == "" {
		return s
	}
	// URL userinfo first: it is the most specific rule, and running it before
	// the assignment rule means a credentialed URL keeps its host.
	out := urlUserinfoPattern.ReplaceAllString(s, "${1}"+redactedPlaceholder+"@")
	out = secretAssignmentPattern.ReplaceAllString(out, "${1}"+redactedPlaceholder)
	return secretTokenPattern.ReplaceAllString(out, redactedPlaceholder)
}

// nonRetryable marks err as a failure no retry can fix.
func nonRetryable(err error) error {
	return temporal.NewNonRetryableApplicationError(err.Error(), ErrTypeScaffolderInvalid, err)
}
