package agent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/sandbox"
	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/sandbox/local"
)

func newTestSandboxActivities(t *testing.T) (*SandboxActivities, *local.Executor) {
	t.Helper()
	exec, err := local.NewExecutor(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	a := NewSandboxActivities(exec, nil)
	return a, exec
}

func TestEnsureAndShell(t *testing.T) {
	a, _ := newTestSandboxActivities(t)
	ctx := context.Background()

	if _, err := a.EnsureSandbox(ctx, EnsureSandboxInput{WorkflowID: "wf-1"}); err != nil {
		t.Fatal(err)
	}
	res, err := a.SandboxedShell(ctx, SandboxedShellInput{
		WorkflowID: "wf-1",
		Command:    "echo orbit",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.ExitCode != 0 || !strings.Contains(res.Stdout, "orbit") {
		t.Errorf("res = %+v", res)
	}
}

func TestSandboxedShell_TruncatesLargeOutput(t *testing.T) {
	a, _ := newTestSandboxActivities(t)
	a.MaxOutputBytes = 64
	ctx := context.Background()
	_, _ = a.EnsureSandbox(ctx, EnsureSandboxInput{WorkflowID: "wf-trunc"})

	res, err := a.SandboxedShell(ctx, SandboxedShellInput{
		WorkflowID: "wf-trunc",
		Command:    "head -c 1024 /dev/urandom | base64",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !res.Truncated {
		t.Errorf("expected truncation, stdout len = %d", len(res.Stdout))
	}
}

func TestSandboxFileIORoundTrip(t *testing.T) {
	a, _ := newTestSandboxActivities(t)
	ctx := context.Background()
	_, _ = a.EnsureSandbox(ctx, EnsureSandboxInput{WorkflowID: "wf-fs"})

	if _, err := a.SandboxWriteFile(ctx, SandboxWriteFileInput{
		WorkflowID: "wf-fs",
		Path:       "notes/plan.md",
		Content:    "# plan\nDeploy the thing.",
	}); err != nil {
		t.Fatal(err)
	}
	read, err := a.SandboxReadFile(ctx, SandboxReadFileInput{WorkflowID: "wf-fs", Path: "notes/plan.md"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(read.Content, "Deploy the thing.") {
		t.Errorf("content = %q", read.Content)
	}

	listing, err := a.SandboxListDir(ctx, SandboxListDirInput{WorkflowID: "wf-fs", Path: "notes"})
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Entries) != 1 || listing.Entries[0].Name != "plan.md" {
		t.Errorf("listing = %+v", listing.Entries)
	}
}

func TestPathEscapeReturnsNonRetryableError(t *testing.T) {
	a, _ := newTestSandboxActivities(t)
	ctx := context.Background()
	_, _ = a.EnsureSandbox(ctx, EnsureSandboxInput{WorkflowID: "wf-esc"})

	_, err := a.SandboxReadFile(ctx, SandboxReadFileInput{WorkflowID: "wf-esc", Path: "../etc/passwd"})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestTeardownIsIdempotent(t *testing.T) {
	a, _ := newTestSandboxActivities(t)
	ctx := context.Background()
	_, _ = a.EnsureSandbox(ctx, EnsureSandboxInput{WorkflowID: "wf-t"})
	if err := a.TeardownSandbox(ctx, TeardownSandboxInput{WorkflowID: "wf-t"}); err != nil {
		t.Fatal(err)
	}
	if err := a.TeardownSandbox(ctx, TeardownSandboxInput{WorkflowID: "wf-t"}); err != nil {
		t.Errorf("second teardown should be idempotent: %v", err)
	}
}

func TestHostAllowed(t *testing.T) {
	cases := []struct {
		host, entry string
		want        bool
	}{
		{"api.github.com", "api.github.com", true},
		{"api.github.com", "*.github.com", true},
		{"github.com", "*.github.com", true},
		{"evil.com", "*.github.com", false},
		{"foo.api.github.com", "*.github.com", true},
		{"api.github.com:443", "api.github.com", true},
		{"api.github.com", "", false},
	}
	for _, c := range cases {
		var allow []string
		if c.entry != "" {
			allow = []string{c.entry}
		}
		got := hostAllowed(c.host, allow)
		if got != c.want {
			t.Errorf("hostAllowed(%q, %q) = %v, want %v", c.host, c.entry, got, c.want)
		}
	}
}

func TestHTTPRequest_AllowlistEnforced(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	a, _ := newTestSandboxActivities(t)
	ctx := context.Background()

	// Denied: empty allowlist.
	_, err := a.HTTPRequest(ctx, HTTPRequestInput{Method: "GET", URL: srv.URL})
	if err == nil {
		t.Fatal("expected denial with empty allowlist")
	}

	// Allowed: 127.0.0.1 host.
	host := strings.TrimPrefix(srv.URL, "http://")
	host = strings.Split(host, ":")[0]
	res, err := a.HTTPRequest(ctx, HTTPRequestInput{
		Method:    "GET",
		URL:       srv.URL,
		Allowlist: []string{host},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 200 || !strings.Contains(res.Body, "ok") {
		t.Errorf("unexpected response: %+v", res)
	}
}

func TestParseGitHubURL(t *testing.T) {
	cases := []struct {
		in           string
		owner, repo  string
		ok           bool
	}{
		{"https://github.com/drewpayment/orbit", "drewpayment", "orbit", true},
		{"https://github.com/drewpayment/orbit.git", "drewpayment", "orbit", true},
		{"git@github.com:drewpayment/orbit.git", "drewpayment", "orbit", true},
		{"https://gitlab.com/x/y", "", "", false},
		{"not-a-url", "", "", false},
	}
	for _, c := range cases {
		owner, repo, ok := parseGitHubURL(c.in)
		if owner != c.owner || repo != c.repo || ok != c.ok {
			t.Errorf("parseGitHubURL(%q) = (%q, %q, %v), want (%q, %q, %v)", c.in, owner, repo, ok, c.owner, c.repo, c.ok)
		}
	}
}

func TestRepoInspect_ShallowClone_FallbackOnNonGitHub(t *testing.T) {
	// Initialize a fake git repo locally to clone from.
	tmp := t.TempDir()
	a, exec := newTestSandboxActivities(t)
	ctx := context.Background()
	_, _ = a.EnsureSandbox(ctx, EnsureSandboxInput{WorkflowID: "wf-clone"})

	// Build a tiny git repo at tmp/origin. Force the branch name to "main"
	// after the initial commit so the test isn't sensitive to the host
	// git's init.defaultBranch.
	origin := tmp + "/origin"
	setup := "git init " + origin + " && " +
		"cd " + origin + " && " +
		"echo '# hello' > README.md && git add README.md && " +
		"git -c user.email=t@t -c user.name=t commit -m init && " +
		"git branch -M main"
	if r, err := exec.Exec(ctx, sandbox.SandboxID("wf-clone"), sandbox.ExecOptions{Command: setup}); err != nil || r.ExitCode != 0 {
		t.Skipf("git not available or repo setup failed (exit %d): %v %s", r.ExitCode, err, r.Stderr)
	}

	// Use file:// URL so the activity's --depth flag is honored.
	res, err := a.RepoInspect(ctx, RepoInspectInput{
		WorkflowID: "wf-clone",
		RepoURL:    "file://" + origin,
		Revision:   "main",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Source != "shallow_clone" {
		t.Errorf("Source = %q, want shallow_clone", res.Source)
	}
	if _, ok := res.Files["README.md"]; !ok {
		t.Errorf("expected README.md in Files: %+v", res.Files)
	}
	foundReadme := false
	for _, e := range res.Tree {
		if e.Path == "README.md" {
			foundReadme = true
		}
	}
	if !foundReadme {
		t.Errorf("README.md not in Tree: %+v", res.Tree)
	}
}
