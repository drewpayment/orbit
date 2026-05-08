package agent

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/sandbox"
)

// ToolOutputSigniller pushes shell command output back to the parent
// workflow as a Temporal signal so the chat UI can render lines as they
// arrive. Implementations typically wrap a Temporal client.SignalWorkflow
// call (see services.TemporalToolOutputSigniller). nil falls back to a
// no-op which keeps the activity testable without a real Temporal client.
type ToolOutputSigniller interface {
	SignalToolOutput(ctx context.Context, workflowID, runID, callID, stream, chunk string) error
}

type noopToolOutputSigniller struct{}

func (noopToolOutputSigniller) SignalToolOutput(context.Context, string, string, string, string, string) error {
	return nil
}

// SandboxActivities groups sandbox-backed activities (shell exec, file IO,
// http, repo inspect). They share one SandboxExecutor whose Backend()
// determines whether commands run locally (dev) or in K8s (prod).
type SandboxActivities struct {
	executor      sandbox.SandboxExecutor
	outputSignal  ToolOutputSigniller
	logger        *slog.Logger

	// MaxOutputBytes caps stdout/stderr returned to the model. Defaults to
	// 16384. Output above this size is truncated with a notice appended.
	MaxOutputBytes int
}

// NewSandboxActivities constructs the activity group. exec is required;
// outputSignal may be nil in which case no streaming output flows back to
// the workflow (the final stdout / stderr are still returned in the
// SandboxedShellResult).
func NewSandboxActivities(exec sandbox.SandboxExecutor, outputSignal ToolOutputSigniller, logger *slog.Logger) *SandboxActivities {
	if logger == nil {
		logger = slog.Default()
	}
	if outputSignal == nil {
		outputSignal = noopToolOutputSigniller{}
	}
	return &SandboxActivities{
		executor:       exec,
		outputSignal:   outputSignal,
		logger:         logger,
		MaxOutputBytes: 16384,
	}
}

// --- inputs / outputs ---

// EnsureSandboxInput configures a fresh-or-existing sandbox.
type EnsureSandboxInput struct {
	WorkflowID  string
	WorkspaceID string

	// Image (k8s only). Empty falls back to executor default.
	Image string
	// Env to project (cloud creds, etc). Sensitive — never logged.
	Env map[string]string
	// Egress allowlist for outbound network policy.
	EgressAllowlist []string
}

type EnsureSandboxResult struct {
	SandboxID string
	Backend   string
	Ref       string
}

type TeardownSandboxInput struct {
	WorkflowID string
}

// SandboxedShellInput runs one shell command inside the sandbox.
type SandboxedShellInput struct {
	WorkflowID string
	RunID      string // populated by the workflow; needed to address signal-back when streaming output
	CallID     string // tool call id; ties streaming output back to the right chat bubble
	Command    string
	WorkingDir string
	EnvOverrides map[string]string
	TimeoutSeconds int
}

type SandboxedShellResult struct {
	ExitCode    int
	Stdout      string
	Stderr      string
	DurationMs  int64
	Truncated   bool
}

// --- activities ---

// EnsureSandbox provisions (or re-attaches to) the per-run sandbox. Idempotent.
func (a *SandboxActivities) EnsureSandbox(ctx context.Context, in EnsureSandboxInput) (EnsureSandboxResult, error) {
	if in.WorkflowID == "" {
		return EnsureSandboxResult{}, temporal.NewNonRetryableApplicationError("workflow_id required", "InvalidInput", nil)
	}
	box, err := a.executor.Ensure(ctx, sandbox.SandboxID(in.WorkflowID), sandbox.EnsureOptions{
		Image:           in.Image,
		Env:             in.Env,
		EgressAllowlist: in.EgressAllowlist,
	})
	if err != nil {
		return EnsureSandboxResult{}, fmt.Errorf("ensure sandbox: %w", err)
	}
	return EnsureSandboxResult{
		SandboxID: string(box.ID),
		Backend:   box.Backend,
		Ref:       box.Ref,
	}, nil
}

// TeardownSandbox is called once when the workflow exits.
func (a *SandboxActivities) TeardownSandbox(ctx context.Context, in TeardownSandboxInput) error {
	if in.WorkflowID == "" {
		return temporal.NewNonRetryableApplicationError("workflow_id required", "InvalidInput", nil)
	}
	if err := a.executor.Teardown(ctx, sandbox.SandboxID(in.WorkflowID)); err != nil {
		if errors.Is(err, sandbox.ErrNotFound) {
			return nil
		}
		return fmt.Errorf("teardown sandbox: %w", err)
	}
	return nil
}

// SandboxedShell runs one shell command in the sandbox with a heartbeat
// loop so long-running terraform / pulumi operations don't trip the
// heartbeat timeout. stdout / stderr lines stream back to the workflow as
// AgentToolOutput signals via the activity's ToolOutputSigniller — without
// this, interactive CLIs like `az login --use-device-code` would hide
// their device code until after the user had already entered it.
//
// Activity input must include CallID; signals without it are dropped by
// the signiller, so the workflow can correlate output to the right tool
// call bubble in the chat UI.
func (a *SandboxActivities) SandboxedShell(ctx context.Context, in SandboxedShellInput) (SandboxedShellResult, error) {
	if in.WorkflowID == "" || in.Command == "" {
		return SandboxedShellResult{}, temporal.NewNonRetryableApplicationError("workflow_id and command required", "InvalidInput", nil)
	}

	hbStop := make(chan struct{})
	defer close(hbStop)
	go heartbeatLoop(ctx, hbStop)

	// Best-effort streaming. SignalWorkflow can fail (network, rate
	// limit) — we log and keep going rather than aborting the whole
	// command, since the buffered stdout/stderr are still returned in
	// the SandboxedShellResult. Empty CallID disables streaming (the
	// signaller would have nowhere to attach the chunk in the UI).
	emit := func(stream, line string) {
		if in.CallID == "" {
			return
		}
		if err := a.outputSignal.SignalToolOutput(ctx, in.WorkflowID, in.RunID, in.CallID, stream, line); err != nil {
			a.logger.Warn("tool output signal failed (non-fatal)",
				"err", err, "workflowId", in.WorkflowID, "callId", in.CallID, "stream", stream)
		}
	}
	onStdout := func(line string) { emit("stdout", line) }
	onStderr := func(line string) { emit("stderr", line) }

	timeout := time.Duration(in.TimeoutSeconds) * time.Second
	res, err := a.executor.Exec(ctx, sandbox.SandboxID(in.WorkflowID), sandbox.ExecOptions{
		Command:      in.Command,
		WorkingDir:   in.WorkingDir,
		EnvOverrides: in.EnvOverrides,
		Timeout:      timeout,
		OnStdout:     onStdout,
		OnStderr:     onStderr,
	})
	if err != nil {
		return SandboxedShellResult{}, fmt.Errorf("sandbox exec: %w", err)
	}

	stdout, stdoutTrunc := truncate(res.Stdout, a.MaxOutputBytes)
	stderr, stderrTrunc := truncate(res.Stderr, a.MaxOutputBytes)

	return SandboxedShellResult{
		ExitCode:   res.ExitCode,
		Stdout:     stdout,
		Stderr:     stderr,
		DurationMs: res.Duration.Milliseconds(),
		Truncated:  stdoutTrunc || stderrTrunc,
	}, nil
}

// --- file IO ---

type SandboxReadFileInput struct {
	WorkflowID string
	Path       string
}
type SandboxReadFileResult struct {
	Content   string
	SizeBytes int
	Truncated bool
}

func (a *SandboxActivities) SandboxReadFile(ctx context.Context, in SandboxReadFileInput) (SandboxReadFileResult, error) {
	if in.WorkflowID == "" || in.Path == "" {
		return SandboxReadFileResult{}, temporal.NewNonRetryableApplicationError("workflow_id and path required", "InvalidInput", nil)
	}
	data, err := a.executor.ReadFile(ctx, sandbox.SandboxID(in.WorkflowID), in.Path)
	if err != nil {
		if errors.Is(err, sandbox.ErrPathEscape) {
			return SandboxReadFileResult{}, temporal.NewNonRetryableApplicationError("path escapes sandbox", "PathEscape", err)
		}
		return SandboxReadFileResult{}, fmt.Errorf("read file: %w", err)
	}
	out, trunc := truncate(string(data), a.MaxOutputBytes)
	return SandboxReadFileResult{Content: out, SizeBytes: len(data), Truncated: trunc}, nil
}

type SandboxWriteFileInput struct {
	WorkflowID string
	Path       string
	Content    string
}
type SandboxWriteFileResult struct {
	BytesWritten int
}

func (a *SandboxActivities) SandboxWriteFile(ctx context.Context, in SandboxWriteFileInput) (SandboxWriteFileResult, error) {
	if in.WorkflowID == "" || in.Path == "" {
		return SandboxWriteFileResult{}, temporal.NewNonRetryableApplicationError("workflow_id and path required", "InvalidInput", nil)
	}
	if err := a.executor.WriteFile(ctx, sandbox.SandboxID(in.WorkflowID), in.Path, []byte(in.Content)); err != nil {
		if errors.Is(err, sandbox.ErrPathEscape) {
			return SandboxWriteFileResult{}, temporal.NewNonRetryableApplicationError("path escapes sandbox", "PathEscape", err)
		}
		return SandboxWriteFileResult{}, fmt.Errorf("write file: %w", err)
	}
	return SandboxWriteFileResult{BytesWritten: len(in.Content)}, nil
}

type SandboxListDirInput struct {
	WorkflowID string
	Path       string
}
type SandboxListDirEntry struct {
	Name  string
	IsDir bool
	Size  int64
}
type SandboxListDirResult struct {
	Entries []SandboxListDirEntry
}

func (a *SandboxActivities) SandboxListDir(ctx context.Context, in SandboxListDirInput) (SandboxListDirResult, error) {
	if in.WorkflowID == "" {
		return SandboxListDirResult{}, temporal.NewNonRetryableApplicationError("workflow_id required", "InvalidInput", nil)
	}
	path := in.Path
	if path == "" {
		path = "."
	}
	entries, err := a.executor.ListDir(ctx, sandbox.SandboxID(in.WorkflowID), path)
	if err != nil {
		if errors.Is(err, sandbox.ErrPathEscape) {
			return SandboxListDirResult{}, temporal.NewNonRetryableApplicationError("path escapes sandbox", "PathEscape", err)
		}
		return SandboxListDirResult{}, fmt.Errorf("list dir: %w", err)
	}
	out := make([]SandboxListDirEntry, 0, len(entries))
	for _, e := range entries {
		out = append(out, SandboxListDirEntry{Name: e.Name, IsDir: e.IsDir, Size: e.Size})
	}
	return SandboxListDirResult{Entries: out}, nil
}

// --- helpers ---

func truncate(s string, max int) (string, bool) {
	if max <= 0 || len(s) <= max {
		return s, false
	}
	notice := fmt.Sprintf("\n\n[orbit-sandbox] output truncated from %d to %d bytes", len(s), max)
	return s[:max] + notice, true
}

// heartbeatLoop ticks an activity heartbeat every 5s so long sandbox
// commands (terraform apply, helm install, etc.) survive the heartbeat
// timeout. Shared by all activities in this package.
func heartbeatLoop(ctx context.Context, stop <-chan struct{}) {
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ctx.Done():
			return
		case <-t.C:
			activity.RecordHeartbeat(ctx)
		}
	}
}
