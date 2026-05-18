// Package local is a SandboxExecutor that runs commands directly on the host
// inside a per-run temp directory. It exists for `make dev` and tests; in
// production the k8s executor takes its place.
//
// The local executor offers no network or filesystem isolation. It MUST NOT
// be used to execute LLM-generated commands against credentials a user
// hasn't explicitly authorized for local use.
package local

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/sandbox"
)

// Executor implements sandbox.SandboxExecutor over local subprocesses.
type Executor struct {
	root string

	mu       sync.Mutex
	sandboxes map[sandbox.SandboxID]*entry
}

type entry struct {
	box       sandbox.Sandbox
	env       map[string]string
	createdAt time.Time
}

// NewExecutor returns a local executor rooted at root. If root is empty,
// ${TMPDIR}/orbit-agent-sandbox is used.
func NewExecutor(root string) (*Executor, error) {
	if root == "" {
		root = filepath.Join(os.TempDir(), "orbit-agent-sandbox")
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("local sandbox: mkdir root: %w", err)
	}
	return &Executor{
		root:      root,
		sandboxes: map[sandbox.SandboxID]*entry{},
	}, nil
}

// Backend identifies the implementation in audit logs.
func (e *Executor) Backend() string { return "local" }

// Ensure creates (or returns) the per-id working directory.
func (e *Executor) Ensure(_ context.Context, id sandbox.SandboxID, opts sandbox.EnsureOptions) (sandbox.Sandbox, error) {
	if id == "" {
		return sandbox.Sandbox{}, errors.New("local sandbox: empty id")
	}
	e.mu.Lock()
	defer e.mu.Unlock()

	if existing, ok := e.sandboxes[id]; ok {
		// Refresh env on re-Ensure.
		existing.env = mergeEnv(existing.env, opts.Env)
		return existing.box, nil
	}

	dir := filepath.Join(e.root, string(id))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return sandbox.Sandbox{}, fmt.Errorf("local sandbox: mkdir %s: %w", dir, err)
	}

	box := sandbox.Sandbox{
		ID:        id,
		Ref:       dir,
		CreatedAt: time.Now(),
		Backend:   "local",
	}
	e.sandboxes[id] = &entry{
		box:       box,
		env:       mergeEnv(nil, opts.Env),
		createdAt: time.Now(),
	}
	return box, nil
}

// Exec runs a shell command inside the sandbox.
func (e *Executor) Exec(ctx context.Context, id sandbox.SandboxID, opts sandbox.ExecOptions) (sandbox.ExecResult, error) {
	ent, err := e.lookup(id)
	if err != nil {
		return sandbox.ExecResult{}, err
	}

	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Minute
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	workDir := opts.WorkingDir
	if workDir == "" {
		workDir = ent.box.Ref
	} else if !strings.HasPrefix(filepath.Clean(workDir), ent.box.Ref) {
		return sandbox.ExecResult{}, sandbox.ErrPathEscape
	}

	cmd := exec.CommandContext(cctx, "bash", "-lc", opts.Command)
	cmd.Dir = workDir
	cmd.Env = envSlice(mergeEnv(ent.env, opts.EnvOverrides))

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return sandbox.ExecResult{}, fmt.Errorf("stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return sandbox.ExecResult{}, fmt.Errorf("stderr pipe: %w", err)
	}

	start := time.Now()
	if err := cmd.Start(); err != nil {
		return sandbox.ExecResult{}, fmt.Errorf("start: %w", err)
	}

	stdoutBuf, stderrBuf := &strings.Builder{}, &strings.Builder{}
	wg := &sync.WaitGroup{}
	wg.Add(2)
	go drain(stdoutPipe, stdoutBuf, opts.OnStdout, wg)
	go drain(stderrPipe, stderrBuf, opts.OnStderr, wg)

	waitErr := cmd.Wait()
	wg.Wait()

	exitCode := 0
	if waitErr != nil {
		var ee *exec.ExitError
		if errors.As(waitErr, &ee) {
			exitCode = ee.ExitCode()
		} else {
			// non-exit error (timeout, IO) — surface as -1 with stderr addendum.
			exitCode = -1
			stderrBuf.WriteString("\n[orbit-sandbox] " + waitErr.Error())
		}
	}

	return sandbox.ExecResult{
		ExitCode: exitCode,
		Stdout:   stdoutBuf.String(),
		Stderr:   stderrBuf.String(),
		Duration: time.Since(start),
	}, nil
}

// ReadFile reads a file inside the sandbox.
func (e *Executor) ReadFile(_ context.Context, id sandbox.SandboxID, path string) ([]byte, error) {
	ent, err := e.lookup(id)
	if err != nil {
		return nil, err
	}
	resolved, err := safeJoin(ent.box.Ref, path)
	if err != nil {
		return nil, err
	}
	return os.ReadFile(resolved)
}

// WriteFile writes a file inside the sandbox, creating parent directories.
func (e *Executor) WriteFile(_ context.Context, id sandbox.SandboxID, path string, content []byte) error {
	ent, err := e.lookup(id)
	if err != nil {
		return err
	}
	resolved, err := safeJoin(ent.box.Ref, path)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(resolved), 0o755); err != nil {
		return fmt.Errorf("mkdir parent: %w", err)
	}
	return os.WriteFile(resolved, content, 0o644)
}

// ListDir lists one directory level inside the sandbox.
func (e *Executor) ListDir(_ context.Context, id sandbox.SandboxID, path string) ([]sandbox.DirEntry, error) {
	ent, err := e.lookup(id)
	if err != nil {
		return nil, err
	}
	resolved, err := safeJoin(ent.box.Ref, path)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(resolved)
	if err != nil {
		return nil, err
	}
	out := make([]sandbox.DirEntry, 0, len(entries))
	for _, de := range entries {
		info, err := de.Info()
		if err != nil {
			continue
		}
		out = append(out, sandbox.DirEntry{
			Name:  de.Name(),
			IsDir: de.IsDir(),
			Size:  info.Size(),
		})
	}
	return out, nil
}

// Teardown removes the sandbox's working directory.
func (e *Executor) Teardown(_ context.Context, id sandbox.SandboxID) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	ent, ok := e.sandboxes[id]
	if !ok {
		return sandbox.ErrNotFound
	}
	delete(e.sandboxes, id)
	return os.RemoveAll(ent.box.Ref)
}

func (e *Executor) lookup(id sandbox.SandboxID) (*entry, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	ent, ok := e.sandboxes[id]
	if !ok {
		return nil, sandbox.ErrNotFound
	}
	return ent, nil
}

// safeJoin resolves rel against base and rejects results that escape base.
// Path traversal is the only injection vector here that matters: the LLM
// supplies untrusted relative paths through the file_* tools.
func safeJoin(base, rel string) (string, error) {
	cleaned := filepath.Clean(rel)
	if filepath.IsAbs(cleaned) || strings.HasPrefix(cleaned, "..") || strings.Contains(cleaned, "/../") {
		return "", sandbox.ErrPathEscape
	}
	joined := filepath.Join(base, cleaned)
	abs, err := filepath.Abs(joined)
	if err != nil {
		return "", err
	}
	baseAbs, err := filepath.Abs(base)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(abs, baseAbs+string(filepath.Separator)) && abs != baseAbs {
		return "", sandbox.ErrPathEscape
	}
	return abs, nil
}

func drain(r io.Reader, buf *strings.Builder, cb func(string), wg *sync.WaitGroup) {
	defer wg.Done()
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 4096), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		buf.WriteString(line)
		buf.WriteByte('\n')
		if cb != nil {
			cb(line)
		}
	}
}

func mergeEnv(base, overlay map[string]string) map[string]string {
	out := make(map[string]string, len(base)+len(overlay))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range overlay {
		out[k] = v
	}
	return out
}

func envSlice(m map[string]string) []string {
	// Inherit PATH and a few other host vars so bash, common tools resolve.
	out := []string{}
	for _, k := range []string{"PATH", "HOME", "LANG", "TERM"} {
		if v, ok := os.LookupEnv(k); ok {
			out = append(out, k+"="+v)
		}
	}
	for k, v := range m {
		out = append(out, k+"="+v)
	}
	return out
}
