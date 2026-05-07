package k8s

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/sandbox"
)

// stubRunner records the kubectl invocations the executor would have made
// and returns scripted responses. Tests assert on both arg sequences and
// stdin so we can verify manifest contents and command shape.
type stubRunner struct {
	mu sync.Mutex
	// scripted maps a deterministic key derived from argv to a response.
	// Args without a registered key fall through to a 0-exit empty response.
	scripted map[string]stubResp
	calls    []stubCall
}

type stubResp struct {
	stdout   string
	stderr   string
	exitCode int
	err      error
}

type stubCall struct {
	argv  []string
	stdin string
}

func newStub() *stubRunner {
	return &stubRunner{scripted: map[string]stubResp{}}
}

func (s *stubRunner) on(matcher string, resp stubResp) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.scripted[matcher] = resp
}

// keyFor matches against the first verb plus any subcommand. Tests register
// behavior keyed by short prefixes like "apply -f -" or "wait" or
// "exec".
func (s *stubRunner) keyFor(argv []string) string {
	// strip "-n <ns>" prefix when present.
	if len(argv) >= 2 && argv[0] == "-n" {
		argv = argv[2:]
	}
	if len(argv) == 0 {
		return ""
	}
	switch argv[0] {
	case "apply":
		return "apply"
	case "wait":
		return "wait"
	case "exec":
		// distinguish exec-list vs exec-cat vs exec-other by the trailing
		// command if present.
		for i, a := range argv {
			if a == "--" && i+1 < len(argv) {
				return "exec-" + argv[i+1]
			}
		}
		return "exec"
	case "get":
		return "get"
	case "delete":
		return "delete-" + argv[1]
	}
	return argv[0]
}

func (s *stubRunner) Run(_ context.Context, argv []string, stdin io.Reader) (string, string, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := stubCall{argv: append([]string(nil), argv...)}
	if stdin != nil {
		b, _ := io.ReadAll(stdin)
		c.stdin = string(b)
	}
	s.calls = append(s.calls, c)
	resp, ok := s.scripted[s.keyFor(argv)]
	if !ok {
		return "", "", 0, nil
	}
	return resp.stdout, resp.stderr, resp.exitCode, resp.err
}

func (s *stubRunner) RunStreaming(ctx context.Context, argv []string, stdin io.Reader, onStdout, onStderr func(string)) (int, error) {
	stdout, stderr, code, err := s.Run(ctx, argv, stdin)
	if err != nil {
		return code, err
	}
	if onStdout != nil {
		for _, line := range strings.Split(strings.TrimRight(stdout, "\n"), "\n") {
			if line != "" {
				onStdout(line)
			}
		}
	}
	if onStderr != nil {
		for _, line := range strings.Split(strings.TrimRight(stderr, "\n"), "\n") {
			if line != "" {
				onStderr(line)
			}
		}
	}
	return code, nil
}

func (s *stubRunner) callsByKey(key string) []stubCall {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []stubCall{}
	for _, c := range s.calls {
		if s.keyFor(c.argv) == key {
			out = append(out, c)
		}
	}
	return out
}

func newTestExecutor(t *testing.T) (*Executor, *stubRunner) {
	t.Helper()
	runner := newStub()
	// Default success for the stages Ensure walks through.
	runner.on("apply", stubResp{stdout: "pod/foo created", exitCode: 0})
	runner.on("wait", stubResp{stdout: "condition met", exitCode: 0})
	runner.on("get", stubResp{stdout: "", exitCode: 0})
	exec := NewExecutor(runner, Options{
		Namespace:    "test-ns",
		DefaultImage: "test-image:latest",
		WorkingDir:   "/home/agent/workspace",
	})
	return exec, runner
}

func TestEnsure_AppliesPodAndPolicyAndWaits(t *testing.T) {
	exec, runner := newTestExecutor(t)
	ctx := context.Background()

	box, err := exec.Ensure(ctx, "wf-1", sandbox.EnsureOptions{
		Image:           "custom:1",
		Env:             map[string]string{"AZURE_TOKEN": "secret-value"},
		EgressAllowlist: []string{"api.azure.com", "*.azure.com"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if box.Backend != "k8s" || box.Ref != "/home/agent/workspace" {
		t.Errorf("box = %+v", box)
	}

	applyCalls := runner.callsByKey("apply")
	if len(applyCalls) != 2 {
		t.Fatalf("expected 2 apply calls (pod + networkpolicy), got %d", len(applyCalls))
	}
	if !strings.Contains(applyCalls[0].stdin, "kind: Pod") || !strings.Contains(applyCalls[0].stdin, "image: custom:1") {
		t.Errorf("pod manifest missing custom image:\n%s", applyCalls[0].stdin)
	}
	if !strings.Contains(applyCalls[0].stdin, "AZURE_TOKEN") {
		t.Errorf("env var not projected:\n%s", applyCalls[0].stdin)
	}
	if !strings.Contains(applyCalls[1].stdin, "kind: NetworkPolicy") {
		t.Errorf("expected NetworkPolicy in second apply:\n%s", applyCalls[1].stdin)
	}
	if !strings.Contains(applyCalls[1].stdin, "*.azure.com") {
		t.Errorf("allowlist annotation missing:\n%s", applyCalls[1].stdin)
	}

	if waits := runner.callsByKey("wait"); len(waits) != 1 {
		t.Errorf("expected 1 wait call, got %d", len(waits))
	}
}

func TestEnsure_IsIdempotent(t *testing.T) {
	exec, runner := newTestExecutor(t)
	ctx := context.Background()
	a, err := exec.Ensure(ctx, "wf-2", sandbox.EnsureOptions{})
	if err != nil {
		t.Fatal(err)
	}
	b, err := exec.Ensure(ctx, "wf-2", sandbox.EnsureOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if a.Ref != b.Ref {
		t.Errorf("Ref drift across Ensure calls")
	}
	// Should NOT call apply twice for the same id.
	if len(runner.callsByKey("apply")) != 1 {
		t.Errorf("expected 1 apply, got %d", len(runner.callsByKey("apply")))
	}
}

func TestEnsure_PropagatesApplyFailure(t *testing.T) {
	runner := newStub()
	runner.on("apply", stubResp{stderr: "denied", exitCode: 1})
	exec := NewExecutor(runner, Options{Namespace: "ns", DefaultImage: "img"})

	_, err := exec.Ensure(context.Background(), "wf-3", sandbox.EnsureOptions{})
	if err == nil || !strings.Contains(err.Error(), "denied") {
		t.Fatalf("expected denied error, got %v", err)
	}
}

func TestExec_BuildsCDAndEnvScript(t *testing.T) {
	exec, runner := newTestExecutor(t)
	ctx := context.Background()
	if _, err := exec.Ensure(ctx, "wf-exec", sandbox.EnsureOptions{}); err != nil {
		t.Fatal(err)
	}
	runner.on("exec-bash", stubResp{stdout: "hi\nthere\n", exitCode: 0})

	res, err := exec.Exec(ctx, "wf-exec", sandbox.ExecOptions{
		Command:      "echo hi && echo there",
		EnvOverrides: map[string]string{"FOO": "bar baz"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.ExitCode != 0 || !strings.Contains(res.Stdout, "hi") {
		t.Errorf("unexpected result %+v", res)
	}

	bashCalls := runner.callsByKey("exec-bash")
	if len(bashCalls) == 0 {
		t.Fatal("expected exec-bash call")
	}
	scriptArg := bashCalls[len(bashCalls)-1].argv[len(bashCalls[len(bashCalls)-1].argv)-1]
	if !strings.Contains(scriptArg, "cd '/home/agent/workspace'") {
		t.Errorf("script missing cd: %q", scriptArg)
	}
	if !strings.Contains(scriptArg, "export FOO='bar baz'") {
		t.Errorf("script missing env override: %q", scriptArg)
	}
	if !strings.Contains(scriptArg, "echo hi && echo there") {
		t.Errorf("script missing user command: %q", scriptArg)
	}
}

func TestExec_StreamsLineCallbacks(t *testing.T) {
	exec, runner := newTestExecutor(t)
	ctx := context.Background()
	_, _ = exec.Ensure(ctx, "wf-stream", sandbox.EnsureOptions{})
	runner.on("exec-bash", stubResp{stdout: "a\nb\nc\n", exitCode: 0})

	var lines []string
	res, err := exec.Exec(ctx, "wf-stream", sandbox.ExecOptions{
		Command:  "true",
		OnStdout: func(line string) { lines = append(lines, line) },
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.ExitCode != 0 {
		t.Errorf("exit = %d", res.ExitCode)
	}
	if len(lines) != 3 || lines[0] != "a" || lines[2] != "c" {
		t.Errorf("expected 3 streamed lines a/b/c, got %v", lines)
	}
}

func TestReadFile_ExecCat(t *testing.T) {
	exec, runner := newTestExecutor(t)
	ctx := context.Background()
	_, _ = exec.Ensure(ctx, "wf-rf", sandbox.EnsureOptions{})
	runner.on("exec-cat", stubResp{stdout: "hello", exitCode: 0})

	got, err := exec.ReadFile(ctx, "wf-rf", "notes.md")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "hello" {
		t.Errorf("got %q", string(got))
	}
	cat := runner.callsByKey("exec-cat")
	if len(cat) == 0 {
		t.Fatal("no cat call")
	}
	if !contains(cat[0].argv, "/home/agent/workspace/notes.md") {
		t.Errorf("cat path = %v", cat[0].argv)
	}
}

func TestWriteFile_StdinAndMkdir(t *testing.T) {
	exec, runner := newTestExecutor(t)
	ctx := context.Background()
	_, _ = exec.Ensure(ctx, "wf-wf", sandbox.EnsureOptions{})

	if err := exec.WriteFile(ctx, "wf-wf", "deep/nested/file.txt", []byte("content here")); err != nil {
		t.Fatal(err)
	}
	bash := runner.callsByKey("exec-bash")
	if len(bash) == 0 {
		t.Fatal("no exec-bash call")
	}
	last := bash[len(bash)-1]
	if last.stdin != "content here" {
		t.Errorf("stdin = %q", last.stdin)
	}
	scriptArg := last.argv[len(last.argv)-1]
	if !strings.Contains(scriptArg, "mkdir -p '/home/agent/workspace/deep/nested'") {
		t.Errorf("script missing mkdir: %q", scriptArg)
	}
	if !strings.Contains(scriptArg, "cat > '/home/agent/workspace/deep/nested/file.txt'") {
		t.Errorf("script missing tee: %q", scriptArg)
	}
}

func TestListDir_ParsesFindOutput(t *testing.T) {
	exec, runner := newTestExecutor(t)
	ctx := context.Background()
	_, _ = exec.Ensure(ctx, "wf-ls", sandbox.EnsureOptions{})
	runner.on("exec-bash", stubResp{
		stdout:   "d\t4096\tsubdir\nf\t12\tnotes.md\n",
		exitCode: 0,
	})

	entries, err := exec.ListDir(ctx, "wf-ls", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("entries = %+v", entries)
	}
	if entries[0].Name != "subdir" || !entries[0].IsDir {
		t.Errorf("entry 0 = %+v", entries[0])
	}
	if entries[1].Name != "notes.md" || entries[1].IsDir || entries[1].Size != 12 {
		t.Errorf("entry 1 = %+v", entries[1])
	}
}

func TestPathEscapeRejected(t *testing.T) {
	exec, _ := newTestExecutor(t)
	ctx := context.Background()
	_, _ = exec.Ensure(ctx, "wf-esc", sandbox.EnsureOptions{})

	cases := []string{"../etc/passwd", "/etc/passwd", "subdir/../../oops"}
	for _, p := range cases {
		_, err := exec.ReadFile(ctx, "wf-esc", p)
		if !errors.Is(err, sandbox.ErrPathEscape) {
			t.Errorf("ReadFile(%q) err = %v, want ErrPathEscape", p, err)
		}
	}
}

func TestTeardown_DeletesPodAndPolicy(t *testing.T) {
	exec, runner := newTestExecutor(t)
	ctx := context.Background()
	_, _ = exec.Ensure(ctx, "wf-td", sandbox.EnsureOptions{
		EgressAllowlist: []string{"api.example.com"},
	})

	if err := exec.Teardown(ctx, "wf-td"); err != nil {
		t.Fatal(err)
	}
	if calls := runner.callsByKey("delete-pod"); len(calls) != 1 {
		t.Errorf("expected 1 delete-pod call, got %d", len(calls))
	}
	if calls := runner.callsByKey("delete-networkpolicy"); len(calls) != 1 {
		t.Errorf("expected 1 delete-networkpolicy call, got %d", len(calls))
	}
}

func TestTeardown_IsIdempotentReturnsErrNotFoundSecondTime(t *testing.T) {
	exec, _ := newTestExecutor(t)
	ctx := context.Background()
	_, _ = exec.Ensure(ctx, "wf-td2", sandbox.EnsureOptions{})
	if err := exec.Teardown(ctx, "wf-td2"); err != nil {
		t.Fatal(err)
	}
	if err := exec.Teardown(ctx, "wf-td2"); err != sandbox.ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

func TestSanitizeName(t *testing.T) {
	cases := map[string]string{
		"agent-abc-123":  "agent-abc-123",
		"AGENT_FOO/Bar":  "agent-foo-bar",
		"":               "x",
		strings.Repeat("a", 80): strings.Repeat("a", 50),
	}
	for in, want := range cases {
		if got := sanitizeName(in); got != want {
			t.Errorf("sanitizeName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRenderEnvList_Deterministic(t *testing.T) {
	out := renderEnvList(map[string]string{"B": "1", "A": "2"})
	// A must come before B for determinism.
	if !strings.Contains(out, fmt.Sprintf("- name: A\n          value: \"2\"\n        - name: B")) {
		t.Errorf("env list not sorted: %q", out)
	}
}

func TestYAMLQuote(t *testing.T) {
	cases := map[string]string{
		"plain":   `"plain"`,
		"a\"b":    `"a\"b"`,
		"a\\b":    `"a\\b"`,
		"a\nb":    `"a\nb"`,
		"\x01":    `"\x01"`,
	}
	for in, want := range cases {
		if got := yamlQuote(in); got != want {
			t.Errorf("yamlQuote(%q) = %q, want %q", in, got, want)
		}
	}
}

func contains(arr []string, s string) bool {
	for _, a := range arr {
		if a == s {
			return true
		}
	}
	return false
}
