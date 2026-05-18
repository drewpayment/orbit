// Package sandbox defines the SandboxExecutor abstraction the Infrastructure
// Agent uses to execute shell commands, read/write files, and inspect
// repositories inside an isolated, per-run environment.
//
// Two implementations live alongside this package:
//   - sandbox/local — a subprocess executor over a workflow-scoped temp
//     directory. Used for `make dev` and tests.
//   - sandbox/k8s — a Kubernetes Job-backed executor. Each agent run gets a
//     fresh pod with workspace cloud creds projected via ExternalSecret and
//     an egress NetworkPolicy.
//
// The interface is small and deliberate: one Ensure call to provision (or
// re-attach to) a per-run environment, one Exec call to run a shell command
// (with streaming output), file read/write/list helpers, and a Teardown.
// All higher-level concerns — destructive-command approval gates, registered
// tool templates, etc. — live in the workflow above this layer.
package sandbox

import (
	"context"
	"errors"
	"time"
)

// SandboxID is a stable per-agent-run identifier. Implementations use it to
// derive the pod name (k8s) or working directory (local).
type SandboxID string

// EnsureOptions configures a fresh sandbox. Re-Ensure on an existing sandbox
// is a no-op aside from updating live env vars.
type EnsureOptions struct {
	// Image is the container image to launch (k8s only). Ignored by local.
	Image string

	// Env is the environment variables to project into the sandbox. Should
	// already include workspace cloud creds. Implementations MUST NOT log
	// these values.
	Env map[string]string

	// EgressAllowlist is the host allowlist for outbound traffic (k8s
	// NetworkPolicy). Empty means "no policy enforced" — only safe in trusted
	// environments such as `make dev` against the local executor.
	EgressAllowlist []string

	// IdleTimeout tears down an idle sandbox after this duration. Defaults
	// to 1 hour.
	IdleTimeout time.Duration
}

// Sandbox is the per-run environment handle. The opaque Ref is whatever the
// implementation needs (pod name + namespace, temp-dir path, etc.) and
// shouldn't be inspected by callers.
type Sandbox struct {
	ID        SandboxID
	Ref       string
	CreatedAt time.Time
	Backend   string // "local" | "k8s"
}

// ExecOptions describes one shell invocation. The command is invoked through
// `bash -lc` so callers can use shell syntax (pipes, redirects, &&). The
// activity layer is responsible for any pre-execution approval gating.
type ExecOptions struct {
	Command string

	// WorkingDir defaults to the sandbox's working dir.
	WorkingDir string

	// EnvOverrides is merged on top of the sandbox's base env for this
	// invocation only. Useful for one-off variables.
	EnvOverrides map[string]string

	// Timeout caps the run; the implementation kills the process on expiry.
	// Defaults to 30 minutes.
	Timeout time.Duration

	// OnStdout and OnStderr are line-oriented callbacks. They fire as output
	// arrives so the activity can signal partial output back to the workflow.
	OnStdout func(line string)
	OnStderr func(line string)
}

// ExecResult is the terminal status of a command.
type ExecResult struct {
	ExitCode int
	Stdout   string
	Stderr   string
	Duration time.Duration
}

// DirEntry is one element of a ListDir result.
type DirEntry struct {
	Name  string
	IsDir bool
	Size  int64
}

// SandboxExecutor is the interface implemented by local and k8s.
type SandboxExecutor interface {
	Ensure(ctx context.Context, id SandboxID, opts EnsureOptions) (Sandbox, error)
	Exec(ctx context.Context, id SandboxID, opts ExecOptions) (ExecResult, error)
	ReadFile(ctx context.Context, id SandboxID, path string) ([]byte, error)
	WriteFile(ctx context.Context, id SandboxID, path string, content []byte) error
	ListDir(ctx context.Context, id SandboxID, path string) ([]DirEntry, error)
	Teardown(ctx context.Context, id SandboxID) error
	Backend() string
}

// ErrNotFound is returned when an operation references a SandboxID that has
// never been Ensured (or has already been torn down).
var ErrNotFound = errors.New("sandbox: not found")

// ErrPathEscape is returned when a caller tries to read/write/list outside the
// sandbox's working directory. Callers MUST consume args from the LLM as
// untrusted input.
var ErrPathEscape = errors.New("sandbox: path escapes working directory")
