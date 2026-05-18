// Package k8s is a SandboxExecutor backed by kubectl. The temporal worker
// pod ships with a kubectl binary and a ServiceAccount that grants pod CRUD
// + exec rights in the sandbox namespace. Each agent run gets a fresh pod
// rendered from the template in this package, with workspace cloud creds
// projected from a Secret reference, plus a NetworkPolicy enforcing the
// workspace egress allowlist.
//
// We shell out to kubectl rather than pulling in client-go to keep the
// worker binary lean and the surface area easy to audit. A Runner
// abstraction makes the executor testable without a real cluster.
package k8s

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/sandbox"
)

// DefaultNamespace is where sandbox pods land. Mirrors namespace.yaml.
const DefaultNamespace = "orbit-agent-sandbox"

// DefaultImage is used when EnsureOptions.Image is empty.
const DefaultImage = "orbit-agent-sandbox:latest"

// DefaultWorkingDir is the path inside the sandbox where the agent's
// per-run working files live (see pod-template.yaml volumeMount).
const DefaultWorkingDir = "/home/agent/workspace"

// Runner shells commands out to the host. The default implementation runs
// the configured kubectl binary; tests substitute their own implementation.
type Runner interface {
	// Run executes argv with optional stdin. Returns combined stdout/stderr
	// and the exit code. err is non-nil only for IO/process problems
	// (failed to start, network glitch); a non-zero exit code surfaces in
	// the result, not as an error.
	Run(ctx context.Context, argv []string, stdin io.Reader) (stdout, stderr string, exitCode int, err error)

	// RunStreaming is like Run but invokes line callbacks as output arrives.
	// Used for the agent's shell_exec tool so the workflow can render
	// command output progressively.
	RunStreaming(ctx context.Context, argv []string, stdin io.Reader, onStdout, onStderr func(string)) (exitCode int, err error)
}

// kubectlRunner is the default Runner; it invokes the configured kubectl
// binary via os/exec.
type kubectlRunner struct{ binary string }

// NewKubectlRunner returns a Runner that shells out to the given kubectl
// binary. Empty string defaults to "kubectl" on PATH.
func NewKubectlRunner(binary string) Runner {
	if binary == "" {
		binary = "kubectl"
	}
	return &kubectlRunner{binary: binary}
}

func (r *kubectlRunner) Run(ctx context.Context, argv []string, stdin io.Reader) (string, string, int, error) {
	cmd := exec.CommandContext(ctx, r.binary, argv...)
	if stdin != nil {
		cmd.Stdin = stdin
	}
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	err := cmd.Run()
	exitCode := 0
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			exitCode = ee.ExitCode()
			err = nil
		} else {
			return out.String(), errb.String(), -1, err
		}
	}
	return out.String(), errb.String(), exitCode, nil
}

func (r *kubectlRunner) RunStreaming(ctx context.Context, argv []string, stdin io.Reader, onStdout, onStderr func(string)) (int, error) {
	cmd := exec.CommandContext(ctx, r.binary, argv...)
	if stdin != nil {
		cmd.Stdin = stdin
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return -1, fmt.Errorf("stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return -1, fmt.Errorf("stderr pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return -1, fmt.Errorf("start: %w", err)
	}
	wg := &sync.WaitGroup{}
	wg.Add(2)
	go pumpLines(stdoutPipe, onStdout, wg)
	go pumpLines(stderrPipe, onStderr, wg)
	waitErr := cmd.Wait()
	wg.Wait()
	if waitErr != nil {
		var ee *exec.ExitError
		if errors.As(waitErr, &ee) {
			return ee.ExitCode(), nil
		}
		return -1, waitErr
	}
	return 0, nil
}

func pumpLines(r io.Reader, cb func(string), wg *sync.WaitGroup) {
	defer wg.Done()
	if cb == nil {
		_, _ = io.Copy(io.Discard, r)
		return
	}
	buf := make([]byte, 4096)
	var carry strings.Builder
	for {
		n, err := r.Read(buf)
		if n > 0 {
			carry.Write(buf[:n])
			s := carry.String()
			for {
				idx := strings.IndexByte(s, '\n')
				if idx < 0 {
					break
				}
				cb(s[:idx])
				s = s[idx+1:]
			}
			carry.Reset()
			carry.WriteString(s)
		}
		if err != nil {
			if carry.Len() > 0 {
				cb(carry.String())
			}
			return
		}
	}
}

// Options configures the executor.
type Options struct {
	// Namespace defaults to DefaultNamespace.
	Namespace string
	// DefaultImage defaults to DefaultImage.
	DefaultImage string
	// WorkingDir defaults to DefaultWorkingDir; the path inside the pod
	// where the agent's working files live.
	WorkingDir string
	// ReadyTimeout caps how long Ensure waits for the pod to become Ready.
	// Defaults to 2 minutes.
	ReadyTimeout time.Duration
	// Logger is used for non-sensitive operational logs (pod created /
	// torn down). Sensitive command output is never logged here.
	Logger *slog.Logger
}

// Executor implements sandbox.SandboxExecutor over `kubectl`.
type Executor struct {
	runner   Runner
	opts     Options

	mu        sync.Mutex
	sandboxes map[sandbox.SandboxID]*entry
}

type entry struct {
	box        sandbox.Sandbox
	podName    string
	policyName string
	namespace  string
}

// NewExecutor constructs the executor.
func NewExecutor(runner Runner, opts Options) *Executor {
	if runner == nil {
		runner = NewKubectlRunner("")
	}
	if opts.Namespace == "" {
		opts.Namespace = DefaultNamespace
	}
	if opts.DefaultImage == "" {
		opts.DefaultImage = DefaultImage
	}
	if opts.WorkingDir == "" {
		opts.WorkingDir = DefaultWorkingDir
	}
	if opts.ReadyTimeout <= 0 {
		opts.ReadyTimeout = 2 * time.Minute
	}
	if opts.Logger == nil {
		opts.Logger = slog.Default()
	}
	return &Executor{
		runner:    runner,
		opts:      opts,
		sandboxes: map[sandbox.SandboxID]*entry{},
	}
}

// Backend identifies the implementation in audit logs.
func (e *Executor) Backend() string { return "k8s" }

// Ensure provisions a sandbox pod (and its NetworkPolicy) for id. If a pod
// for id already exists, it's reused; this matches the local executor's
// idempotency contract and lets activities self-heal across worker restarts.
func (e *Executor) Ensure(ctx context.Context, id sandbox.SandboxID, opts sandbox.EnsureOptions) (sandbox.Sandbox, error) {
	if id == "" {
		return sandbox.Sandbox{}, errors.New("k8s sandbox: empty id")
	}
	e.mu.Lock()
	if existing, ok := e.sandboxes[id]; ok {
		e.mu.Unlock()
		return existing.box, nil
	}
	e.mu.Unlock()

	podName := podNameFor(id)
	policyName := policyNameFor(id)

	// Look up an existing pod first (worker may have restarted). If found,
	// we reuse it without touching the manifest.
	if exists, err := e.podExists(ctx, podName); err == nil && exists {
		box := sandbox.Sandbox{
			ID:        id,
			Ref:       e.opts.WorkingDir,
			CreatedAt: time.Now(),
			Backend:   "k8s",
		}
		e.mu.Lock()
		e.sandboxes[id] = &entry{box: box, podName: podName, policyName: policyName, namespace: e.opts.Namespace}
		e.mu.Unlock()
		return box, nil
	}

	image := opts.Image
	if image == "" {
		image = e.opts.DefaultImage
	}
	manifest := renderPodManifest(podRenderInput{
		Namespace: e.opts.Namespace,
		PodName:   podName,
		Image:     image,
		Env:       opts.Env,
	})

	if _, stderr, code, err := e.runner.Run(ctx, []string{"apply", "-f", "-"}, strings.NewReader(manifest)); err != nil {
		return sandbox.Sandbox{}, fmt.Errorf("kubectl apply pod: %w (stderr=%s)", err, stderr)
	} else if code != 0 {
		return sandbox.Sandbox{}, fmt.Errorf("kubectl apply pod exit %d: %s", code, stderr)
	}

	if len(opts.EgressAllowlist) > 0 {
		policy := renderNetworkPolicyManifest(policyRenderInput{
			Namespace:  e.opts.Namespace,
			PolicyName: policyName,
			PodName:    podName,
			Allowlist:  opts.EgressAllowlist,
		})
		if _, stderr, code, err := e.runner.Run(ctx, []string{"apply", "-f", "-"}, strings.NewReader(policy)); err != nil {
			return sandbox.Sandbox{}, fmt.Errorf("kubectl apply networkpolicy: %w (stderr=%s)", err, stderr)
		} else if code != 0 {
			return sandbox.Sandbox{}, fmt.Errorf("kubectl apply networkpolicy exit %d: %s", code, stderr)
		}
	}

	// Wait for Ready.
	waitCtx, cancel := context.WithTimeout(ctx, e.opts.ReadyTimeout)
	defer cancel()
	if _, stderr, code, err := e.runner.Run(waitCtx, []string{
		"-n", e.opts.Namespace, "wait", "--for=condition=Ready", "pod/" + podName,
		"--timeout=" + strconv.Itoa(int(e.opts.ReadyTimeout.Seconds())) + "s",
	}, nil); err != nil {
		return sandbox.Sandbox{}, fmt.Errorf("kubectl wait: %w (stderr=%s)", err, stderr)
	} else if code != 0 {
		return sandbox.Sandbox{}, fmt.Errorf("pod not ready (exit %d): %s", code, stderr)
	}

	box := sandbox.Sandbox{
		ID:        id,
		Ref:       e.opts.WorkingDir,
		CreatedAt: time.Now(),
		Backend:   "k8s",
	}
	e.mu.Lock()
	e.sandboxes[id] = &entry{box: box, podName: podName, policyName: policyName, namespace: e.opts.Namespace}
	e.mu.Unlock()
	e.opts.Logger.Info("k8s sandbox ready", "id", id, "pod", podName, "namespace", e.opts.Namespace)
	return box, nil
}

// Exec runs a shell command inside the pod via `kubectl exec`.
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

	// Build the inner script: cd to working dir, project env overrides,
	// then run the command. We must keep this as a single bash invocation
	// so kubectl exec sees one process to wait on.
	workDir := opts.WorkingDir
	if workDir == "" {
		workDir = e.opts.WorkingDir
	}
	var script bytes.Buffer
	script.WriteString("cd ")
	script.WriteString(shellSingleQuote(workDir))
	script.WriteString(" && ")
	for k, v := range opts.EnvOverrides {
		script.WriteString("export ")
		script.WriteString(k)
		script.WriteString("=")
		script.WriteString(shellSingleQuote(v))
		script.WriteString(" && ")
	}
	script.WriteString(opts.Command)

	args := []string{"-n", ent.namespace, "exec", ent.podName, "--", "bash", "-lc", script.String()}

	var stdoutBuf, stderrBuf bytes.Buffer
	captureOut := func(line string) {
		stdoutBuf.WriteString(line)
		stdoutBuf.WriteByte('\n')
		if opts.OnStdout != nil {
			opts.OnStdout(line)
		}
	}
	captureErr := func(line string) {
		stderrBuf.WriteString(line)
		stderrBuf.WriteByte('\n')
		if opts.OnStderr != nil {
			opts.OnStderr(line)
		}
	}

	start := time.Now()
	exitCode, err := e.runner.RunStreaming(cctx, args, nil, captureOut, captureErr)
	if err != nil {
		return sandbox.ExecResult{}, fmt.Errorf("kubectl exec: %w", err)
	}
	return sandbox.ExecResult{
		ExitCode: exitCode,
		Stdout:   stdoutBuf.String(),
		Stderr:   stderrBuf.String(),
		Duration: time.Since(start),
	}, nil
}

// ReadFile reads a file inside the sandbox via `kubectl exec ... cat`.
func (e *Executor) ReadFile(ctx context.Context, id sandbox.SandboxID, path string) ([]byte, error) {
	ent, err := e.lookup(id)
	if err != nil {
		return nil, err
	}
	abs, err := joinSandboxPath(e.opts.WorkingDir, path)
	if err != nil {
		return nil, err
	}
	stdout, stderr, code, err := e.runner.Run(ctx, []string{
		"-n", ent.namespace, "exec", ent.podName, "--", "cat", abs,
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("kubectl exec cat: %w", err)
	}
	if code != 0 {
		return nil, fmt.Errorf("read file exit %d: %s", code, stderr)
	}
	return []byte(stdout), nil
}

// WriteFile writes a file via `kubectl exec ... mkdir -p && tee`. Stdin
// carries the content.
func (e *Executor) WriteFile(ctx context.Context, id sandbox.SandboxID, path string, content []byte) error {
	ent, err := e.lookup(id)
	if err != nil {
		return err
	}
	abs, err := joinSandboxPath(e.opts.WorkingDir, path)
	if err != nil {
		return err
	}
	parent := dirOf(abs)
	script := fmt.Sprintf("mkdir -p %s && cat > %s", shellSingleQuote(parent), shellSingleQuote(abs))
	args := []string{"-n", ent.namespace, "exec", "-i", ent.podName, "--", "bash", "-lc", script}
	if _, stderr, code, err := e.runner.Run(ctx, args, bytes.NewReader(content)); err != nil {
		return fmt.Errorf("kubectl exec write: %w", err)
	} else if code != 0 {
		return fmt.Errorf("write file exit %d: %s", code, stderr)
	}
	return nil
}

// ListDir lists the entries of a directory via a small shell snippet whose
// output is one entry per line: `<type>\t<size>\t<name>`. Type is `d` for
// directory, `f` for file, `o` for other (symlinks etc).
func (e *Executor) ListDir(ctx context.Context, id sandbox.SandboxID, path string) ([]sandbox.DirEntry, error) {
	ent, err := e.lookup(id)
	if err != nil {
		return nil, err
	}
	abs, err := joinSandboxPath(e.opts.WorkingDir, path)
	if err != nil {
		return nil, err
	}
	script := fmt.Sprintf(
		"find %s -maxdepth 1 -mindepth 1 -printf '%%y\\t%%s\\t%%f\\n' | sort -t '\\t' -k 3",
		shellSingleQuote(abs),
	)
	args := []string{"-n", ent.namespace, "exec", ent.podName, "--", "bash", "-lc", script}
	stdout, stderr, code, err := e.runner.Run(ctx, args, nil)
	if err != nil {
		return nil, fmt.Errorf("kubectl exec list: %w", err)
	}
	if code != 0 {
		return nil, fmt.Errorf("list dir exit %d: %s", code, stderr)
	}
	out := []sandbox.DirEntry{}
	for _, line := range strings.Split(strings.TrimSpace(stdout), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) < 3 {
			continue
		}
		size, _ := strconv.ParseInt(parts[1], 10, 64)
		out = append(out, sandbox.DirEntry{
			Name:  parts[2],
			IsDir: parts[0] == "d",
			Size:  size,
		})
	}
	return out, nil
}

// Teardown deletes the pod and (if any) NetworkPolicy.
func (e *Executor) Teardown(ctx context.Context, id sandbox.SandboxID) error {
	e.mu.Lock()
	ent, ok := e.sandboxes[id]
	delete(e.sandboxes, id)
	e.mu.Unlock()
	if !ok {
		return sandbox.ErrNotFound
	}

	// Pod first, then NetworkPolicy. --ignore-not-found makes both
	// idempotent.
	if _, stderr, code, err := e.runner.Run(ctx, []string{
		"-n", ent.namespace, "delete", "pod", ent.podName, "--ignore-not-found", "--wait=false",
	}, nil); err != nil {
		return fmt.Errorf("kubectl delete pod: %w (stderr=%s)", err, stderr)
	} else if code != 0 {
		return fmt.Errorf("kubectl delete pod exit %d: %s", code, stderr)
	}
	if _, _, _, err := e.runner.Run(ctx, []string{
		"-n", ent.namespace, "delete", "networkpolicy", ent.policyName, "--ignore-not-found", "--wait=false",
	}, nil); err != nil {
		// Best-effort; log but don't fail teardown.
		e.opts.Logger.Warn("kubectl delete networkpolicy failed", "err", err, "policy", ent.policyName)
	}
	e.opts.Logger.Info("k8s sandbox torn down", "id", id, "pod", ent.podName)
	return nil
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

// podExists checks `kubectl get pod ... --ignore-not-found -o name`.
// Returns true iff stdout contains "pod/<name>".
func (e *Executor) podExists(ctx context.Context, podName string) (bool, error) {
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	stdout, stderr, code, err := e.runner.Run(cctx, []string{
		"-n", e.opts.Namespace, "get", "pod", podName, "--ignore-not-found", "-o", "name",
	}, nil)
	if err != nil {
		return false, err
	}
	if code != 0 {
		return false, fmt.Errorf("get pod exit %d: %s", code, stderr)
	}
	return strings.Contains(stdout, "pod/"+podName), nil
}

// --- helpers ---

func podNameFor(id sandbox.SandboxID) string  { return "agent-sandbox-" + sanitizeName(string(id)) }
func policyNameFor(id sandbox.SandboxID) string { return "agent-sandbox-" + sanitizeName(string(id)) }

// sanitizeName produces a DNS-1123-friendly suffix from an arbitrary id.
// Workflow ids come from Temporal and are mostly safe but can contain '/',
// uppercase, etc.
func sanitizeName(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
			b.WriteRune(r)
		default:
			b.WriteRune('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if len(out) > 50 {
		out = out[:50]
	}
	if out == "" {
		out = "x"
	}
	return out
}

// shellSingleQuote wraps s in single quotes, escaping any embedded singles.
func shellSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// joinSandboxPath enforces the same containment rule as the local
// executor: no absolute paths, no `..`, must resolve under base.
func joinSandboxPath(base, rel string) (string, error) {
	if rel == "" {
		return base, nil
	}
	if strings.HasPrefix(rel, "/") {
		return "", sandbox.ErrPathEscape
	}
	cleaned := strings.TrimPrefix(rel, "./")
	if strings.HasPrefix(cleaned, "..") || strings.Contains(cleaned, "/../") || strings.Contains(cleaned, "/..") {
		return "", sandbox.ErrPathEscape
	}
	return base + "/" + cleaned, nil
}

func dirOf(p string) string {
	idx := strings.LastIndex(p, "/")
	if idx <= 0 {
		return "/"
	}
	return p[:idx]
}
