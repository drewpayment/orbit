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

// SandboxActivities groups sandbox-backed activities (shell exec, file IO,
// http, repo inspect). They share one SandboxExecutor whose Backend()
// determines whether commands run locally (dev) or in K8s (prod).
type SandboxActivities struct {
	executor sandbox.SandboxExecutor
	logger   *slog.Logger

	// MaxOutputBytes caps stdout/stderr returned to the model. Defaults to
	// 16384. Output above this size is truncated with a notice appended.
	MaxOutputBytes int
}

// NewSandboxActivities constructs the activity group. exec is required.
func NewSandboxActivities(exec sandbox.SandboxExecutor, logger *slog.Logger) *SandboxActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &SandboxActivities{
		executor:       exec,
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
	CallID     string // tool call id, for audit / future streaming
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
// loop so long-running terraform / pulumi operations don't trip the heartbeat
// timeout.
func (a *SandboxActivities) SandboxedShell(ctx context.Context, in SandboxedShellInput) (SandboxedShellResult, error) {
	if in.WorkflowID == "" || in.Command == "" {
		return SandboxedShellResult{}, temporal.NewNonRetryableApplicationError("workflow_id and command required", "InvalidInput", nil)
	}

	hbStop := make(chan struct{})
	defer close(hbStop)
	go heartbeatLoop(ctx, hbStop)

	timeout := time.Duration(in.TimeoutSeconds) * time.Second
	res, err := a.executor.Exec(ctx, sandbox.SandboxID(in.WorkflowID), sandbox.ExecOptions{
		Command:      in.Command,
		WorkingDir:   in.WorkingDir,
		EnvOverrides: in.EnvOverrides,
		Timeout:      timeout,
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
