package local

import (
	"context"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/sandbox"
)

func TestEnsureCreatesWorkingDirectory(t *testing.T) {
	e, err := NewExecutor(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	box, err := e.Ensure(context.Background(), "wf-1", sandbox.EnsureOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if box.Backend != "local" {
		t.Errorf("backend = %q", box.Backend)
	}
	if !strings.HasSuffix(box.Ref, "wf-1") {
		t.Errorf("ref %q does not contain id", box.Ref)
	}
}

func TestEnsureIsIdempotent(t *testing.T) {
	e, _ := NewExecutor(t.TempDir())
	a, _ := e.Ensure(context.Background(), "wf-1", sandbox.EnsureOptions{})
	b, _ := e.Ensure(context.Background(), "wf-1", sandbox.EnsureOptions{})
	if a.Ref != b.Ref {
		t.Errorf("ref drift across Ensure calls: %q vs %q", a.Ref, b.Ref)
	}
}

func TestExec_RunsCommandAndCapturesOutput(t *testing.T) {
	e, _ := NewExecutor(t.TempDir())
	_, _ = e.Ensure(context.Background(), "wf-2", sandbox.EnsureOptions{})

	res, err := e.Exec(context.Background(), "wf-2", sandbox.ExecOptions{
		Command: "printf 'hi\\nthere\\n' && printf 'oops\\n' >&2 && exit 0",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.ExitCode != 0 {
		t.Errorf("exit code = %d", res.ExitCode)
	}
	if !strings.Contains(res.Stdout, "hi") || !strings.Contains(res.Stdout, "there") {
		t.Errorf("stdout missing expected lines: %q", res.Stdout)
	}
	if !strings.Contains(res.Stderr, "oops") {
		t.Errorf("stderr missing oops: %q", res.Stderr)
	}
}

func TestExec_StreamsLineCallbacks(t *testing.T) {
	e, _ := NewExecutor(t.TempDir())
	_, _ = e.Ensure(context.Background(), "wf-stream", sandbox.EnsureOptions{})

	var mu sync.Mutex
	var lines []string
	res, err := e.Exec(context.Background(), "wf-stream", sandbox.ExecOptions{
		Command: "for i in 1 2 3; do echo line-$i; done",
		OnStdout: func(line string) {
			mu.Lock()
			lines = append(lines, line)
			mu.Unlock()
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.ExitCode != 0 {
		t.Errorf("exit code = %d", res.ExitCode)
	}
	if len(lines) != 3 {
		t.Fatalf("expected 3 streamed lines, got %d: %v", len(lines), lines)
	}
}

func TestExec_NonzeroExitCaptured(t *testing.T) {
	e, _ := NewExecutor(t.TempDir())
	_, _ = e.Ensure(context.Background(), "wf-3", sandbox.EnsureOptions{})

	res, err := e.Exec(context.Background(), "wf-3", sandbox.ExecOptions{
		Command: "exit 7",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.ExitCode != 7 {
		t.Errorf("exit code = %d, want 7", res.ExitCode)
	}
}

func TestFileIOAndListDir(t *testing.T) {
	e, _ := NewExecutor(t.TempDir())
	_, _ = e.Ensure(context.Background(), "wf-fs", sandbox.EnsureOptions{})

	ctx := context.Background()
	if err := e.WriteFile(ctx, "wf-fs", "subdir/hello.txt", []byte("hi")); err != nil {
		t.Fatal(err)
	}
	got, err := e.ReadFile(ctx, "wf-fs", "subdir/hello.txt")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "hi" {
		t.Errorf("read = %q", string(got))
	}

	entries, err := e.ListDir(ctx, "wf-fs", "subdir")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name != "hello.txt" || entries[0].IsDir {
		t.Errorf("entries = %+v", entries)
	}
}

func TestPathEscapeRejected(t *testing.T) {
	e, _ := NewExecutor(t.TempDir())
	_, _ = e.Ensure(context.Background(), "wf-esc", sandbox.EnsureOptions{})

	cases := []string{"../etc/passwd", "/etc/passwd", "subdir/../../oops"}
	for _, p := range cases {
		_, err := e.ReadFile(context.Background(), "wf-esc", p)
		if err == nil {
			t.Errorf("ReadFile(%q) should reject path escape", p)
		}
	}
}

func TestTeardownRemovesDirectory(t *testing.T) {
	root := t.TempDir()
	e, _ := NewExecutor(root)
	box, _ := e.Ensure(context.Background(), "wf-tear", sandbox.EnsureOptions{})

	// Confirm dir exists.
	expected := filepath.Join(root, "wf-tear")
	if box.Ref != expected {
		t.Errorf("ref = %q, want %q", box.Ref, expected)
	}

	if err := e.Teardown(context.Background(), "wf-tear"); err != nil {
		t.Fatal(err)
	}
	// Subsequent Exec returns ErrNotFound.
	_, err := e.Exec(context.Background(), "wf-tear", sandbox.ExecOptions{Command: "true"})
	if err != sandbox.ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

func TestExecRespectsEnvOverrides(t *testing.T) {
	e, _ := NewExecutor(t.TempDir())
	_, _ = e.Ensure(context.Background(), "wf-env", sandbox.EnsureOptions{
		Env: map[string]string{"BASE_VAR": "from-base"},
	})

	res, err := e.Exec(context.Background(), "wf-env", sandbox.ExecOptions{
		Command:      "echo base=$BASE_VAR override=$OVERRIDE_VAR",
		EnvOverrides: map[string]string{"OVERRIDE_VAR": "from-override"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.Stdout, "base=from-base") || !strings.Contains(res.Stdout, "override=from-override") {
		t.Errorf("stdout = %q", res.Stdout)
	}
}
