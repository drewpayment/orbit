package agent

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/agent/sandbox"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// --- fakes ---

type fakeGitHubTokenClient struct {
	resp services.InstallationToken
	err  error

	gotWorkspaceID, gotOwner, gotRepo string
	calls                              int
}

func (f *fakeGitHubTokenClient) GetInstallationTokenForRepo(_ context.Context, workspaceID, owner, repo string) (services.InstallationToken, error) {
	f.calls++
	f.gotWorkspaceID, f.gotOwner, f.gotRepo = workspaceID, owner, repo
	return f.resp, f.err
}

type fakeSandboxExecutor struct {
	res sandbox.ExecResult
	err error

	gotCmd string
	gotEnv map[string]string
}

func (f *fakeSandboxExecutor) Ensure(_ context.Context, _ sandbox.SandboxID, _ sandbox.EnsureOptions) (sandbox.Sandbox, error) {
	return sandbox.Sandbox{}, nil
}
func (f *fakeSandboxExecutor) Exec(_ context.Context, _ sandbox.SandboxID, opts sandbox.ExecOptions) (sandbox.ExecResult, error) {
	f.gotCmd = opts.Command
	f.gotEnv = opts.EnvOverrides
	return f.res, f.err
}
func (f *fakeSandboxExecutor) ReadFile(_ context.Context, _ sandbox.SandboxID, _ string) ([]byte, error) {
	return nil, nil
}
func (f *fakeSandboxExecutor) WriteFile(_ context.Context, _ sandbox.SandboxID, _ string, _ []byte) error {
	return nil
}
func (f *fakeSandboxExecutor) ListDir(_ context.Context, _ sandbox.SandboxID, _ string) ([]sandbox.DirEntry, error) {
	return nil, nil
}
func (f *fakeSandboxExecutor) Teardown(_ context.Context, _ sandbox.SandboxID) error { return nil }
func (f *fakeSandboxExecutor) Backend() string                                       { return "fake" }

// --- url parsing / safety helpers ---

func TestParseGitHubRepoURL(t *testing.T) {
	cases := []struct {
		name, in        string
		wantOwner, wantRepo string
		wantErr         bool
	}{
		{"https plain", "https://github.com/drewpayment/orbit", "drewpayment", "orbit", false},
		{"https .git", "https://github.com/drewpayment/orbit.git", "drewpayment", "orbit", false},
		{"https trailing slash", "https://github.com/foo/bar/", "foo", "bar", false},
		{"https with embedded creds (stripped)", "https://user:pat@github.com/foo/bar.git", "foo", "bar", false},
		{"https with subpath dropped", "https://github.com/foo/bar/tree/main", "foo", "bar", false},
		{"http (rejected)", "http://github.com/foo/bar", "", "", true},
		{"ssh (rejected)", "git@github.com:foo/bar.git", "", "", true},
		{"other host (rejected)", "https://gitlab.com/foo/bar", "", "", true},
		{"only owner", "https://github.com/foo", "", "", true},
		{"empty", "", "", "", true},
		{"injection chars", "https://github.com/foo/bar;rm", "", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			owner, repo, err := parseGitHubRepoURL(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got owner=%q repo=%q", owner, repo)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if owner != tc.wantOwner || repo != tc.wantRepo {
				t.Errorf("got owner=%q repo=%q, want owner=%q repo=%q", owner, repo, tc.wantOwner, tc.wantRepo)
			}
		})
	}
}

func TestIsSafeGitRef(t *testing.T) {
	if !isSafeGitRef("main") {
		t.Error("main should be safe")
	}
	if !isSafeGitRef("release/v1.2.3") {
		t.Error("slash-versioned tag should be safe")
	}
	if isSafeGitRef("foo;rm -rf /") {
		t.Error("shell metachars must be rejected")
	}
	if isSafeGitRef("..") {
		t.Error("`..` must be rejected (path traversal)")
	}
	if isSafeGitRef("a..b") {
		t.Error("embedded `..` must be rejected")
	}
	if isSafeGitRef("") {
		t.Error("empty must be rejected")
	}
}

func TestCloneRepoSlug(t *testing.T) {
	if got := cloneRepoSlug("Drewpayment/Verofront"); got != "drewpayment-verofront" {
		t.Errorf("slug = %q", got)
	}
	if got := cloneRepoSlug("Foo!!Bar"); got != "foo-bar" {
		t.Errorf("slug = %q", got)
	}
	if got := cloneRepoSlug(""); got != "repo" {
		t.Errorf("slug = %q", got)
	}
}

func TestExtractCloneMarkers(t *testing.T) {
	out := "Cloning into 'whatever'...\nremote: Counting objects\nORBIT_HEAD_SHA=abc123\nORBIT_BRANCH=main\n"
	sha, br := extractCloneMarkers(out)
	if sha != "abc123" || br != "main" {
		t.Errorf("sha=%q branch=%q", sha, br)
	}
}

// --- activity behavior ---

func newRepoCloneActivities(exec sandbox.SandboxExecutor, tokens *fakeGitHubTokenClient, ctx OrbitContextClient) *OrbitRepoCloneActivities {
	return NewOrbitRepoCloneActivities(exec, tokens, ctx, nil)
}

func TestOrbitRepoClone_RequiresOneOfAppIDOrRepoURL(t *testing.T) {
	a := newRepoCloneActivities(&fakeSandboxExecutor{}, &fakeGitHubTokenClient{}, &fakeOrbitContextClient{})
	_, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID: "wf-1", WorkspaceID: "ws-1",
	})
	if err == nil || !strings.Contains(err.Error(), "app_id or repo_url required") {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestOrbitRepoClone_HappyPath_RepoURL(t *testing.T) {
	exec := &fakeSandboxExecutor{res: sandbox.ExecResult{
		ExitCode: 0,
		Stdout:   "ORBIT_HEAD_SHA=deadbeefcafe\nORBIT_BRANCH=main\n",
	}}
	tokens := &fakeGitHubTokenClient{resp: services.InstallationToken{
		Token:          "ghs_xxx",
		ExpiresAt:      "2030-01-01T00:00:00Z",
		InstallationID: 42,
		AccountLogin:   "drewpayment",
	}}
	a := newRepoCloneActivities(exec, tokens, &fakeOrbitContextClient{})

	res, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID:  "wf-1",
		WorkspaceID: "ws-1",
		RepoURL:     "https://github.com/drewpayment/verofront",
	})
	if err != nil {
		t.Fatal(err)
	}
	if tokens.calls != 1 {
		t.Errorf("token calls = %d", tokens.calls)
	}
	if tokens.gotWorkspaceID != "ws-1" || tokens.gotOwner != "drewpayment" || tokens.gotRepo != "verofront" {
		t.Errorf("token client got ws=%q owner=%q repo=%q",
			tokens.gotWorkspaceID, tokens.gotOwner, tokens.gotRepo)
	}
	if exec.gotEnv["GITHUB_TOKEN"] != "ghs_xxx" {
		t.Errorf("token not projected as env var; got env=%+v", exec.gotEnv)
	}
	if strings.Contains(exec.gotCmd, "ghs_xxx") {
		t.Errorf("raw token leaked into command string: %q", exec.gotCmd)
	}
	if !strings.Contains(exec.gotCmd, "drewpayment/verofront.git") {
		t.Errorf("expected owner/repo in command, got %q", exec.gotCmd)
	}
	if !strings.Contains(exec.gotCmd, "git remote set-url origin") {
		t.Errorf("expected token scrub via remote set-url, got %q", exec.gotCmd)
	}
	if res.HeadSHA != "deadbeefcafe" || res.Branch != "main" {
		t.Errorf("res = %+v", res)
	}
	if res.ClonePath != "repo/drewpayment-verofront" {
		t.Errorf("clone_path = %q", res.ClonePath)
	}
	if res.InstallationID != 42 {
		t.Errorf("installation_id = %d", res.InstallationID)
	}
}

func TestOrbitRepoClone_HappyPath_AppID(t *testing.T) {
	exec := &fakeSandboxExecutor{res: sandbox.ExecResult{
		ExitCode: 0,
		Stdout:   "ORBIT_HEAD_SHA=abc\nORBIT_BRANCH=develop\n",
	}}
	tokens := &fakeGitHubTokenClient{resp: services.InstallationToken{
		Token: "ghs_yyy", InstallationID: 7, AccountLogin: "acme",
		ExpiresAt: "2030-01-01T00:00:00Z",
	}}
	ctxClient := &fakeOrbitContextClient{
		app: services.AppDetails{
			ID:   "app-1",
			Name: "checkout",
			Repository: &services.AppRepository{
				URL:    "https://github.com/acme/checkout",
				Owner:  "acme",
				Name:   "checkout",
				Branch: "main",
			},
		},
	}
	a := newRepoCloneActivities(exec, tokens, ctxClient)

	res, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID: "wf-2", WorkspaceID: "ws-1", AppID: "app-1", Revision: "develop",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ctxClient.gotAppID != "app-1" {
		t.Errorf("app_id not threaded to context client: %q", ctxClient.gotAppID)
	}
	if tokens.gotOwner != "acme" || tokens.gotRepo != "checkout" {
		t.Errorf("token resolved to wrong repo: %q/%q", tokens.gotOwner, tokens.gotRepo)
	}
	if !strings.Contains(exec.gotCmd, "--branch=develop") {
		t.Errorf("revision flag missing: %q", exec.gotCmd)
	}
	if res.Branch != "develop" {
		t.Errorf("branch = %q", res.Branch)
	}
}

func TestOrbitRepoClone_BadRevision_Rejected(t *testing.T) {
	a := newRepoCloneActivities(
		&fakeSandboxExecutor{},
		&fakeGitHubTokenClient{resp: services.InstallationToken{Token: "t"}},
		&fakeOrbitContextClient{},
	)
	_, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID: "wf-1", WorkspaceID: "ws-1",
		RepoURL:  "https://github.com/foo/bar",
		Revision: "main; rm -rf /",
	})
	if err == nil || !strings.Contains(err.Error(), "invalid revision") {
		t.Fatalf("expected revision validation error, got %v", err)
	}
}

func TestOrbitRepoClone_InstallationNotFound_SurfacesNonRetryable(t *testing.T) {
	tokens := &fakeGitHubTokenClient{err: services.ErrInstallationNotFound}
	a := newRepoCloneActivities(&fakeSandboxExecutor{}, tokens, &fakeOrbitContextClient{})
	_, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID: "wf-1", WorkspaceID: "ws-1",
		RepoURL: "https://github.com/foo/bar",
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "no GitHub App installation connected") {
		t.Errorf("error should explain missing install: %v", err)
	}
}

func TestOrbitRepoClone_TokenExpired_SurfacesNonRetryable(t *testing.T) {
	tokens := &fakeGitHubTokenClient{err: services.ErrInstallationTokenExpired}
	a := newRepoCloneActivities(&fakeSandboxExecutor{}, tokens, &fakeOrbitContextClient{})
	_, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID: "wf-1", WorkspaceID: "ws-1",
		RepoURL: "https://github.com/foo/bar",
	})
	if err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expected expired error, got %v", err)
	}
}

func TestOrbitRepoClone_AppMissingRepo(t *testing.T) {
	ctxClient := &fakeOrbitContextClient{
		app: services.AppDetails{ID: "app-no-repo", Name: "naked"},
	}
	a := newRepoCloneActivities(&fakeSandboxExecutor{},
		&fakeGitHubTokenClient{resp: services.InstallationToken{Token: "t"}},
		ctxClient)
	_, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID: "wf-1", WorkspaceID: "ws-1", AppID: "app-no-repo",
	})
	if err == nil || !strings.Contains(err.Error(), "no repository URL") {
		t.Fatalf("expected AppMissingRepo error, got %v", err)
	}
}

func TestOrbitRepoClone_AppNotFound_PassesThrough(t *testing.T) {
	ctxClient := &fakeOrbitContextClient{getErr: services.ErrAppNotFound}
	a := newRepoCloneActivities(&fakeSandboxExecutor{},
		&fakeGitHubTokenClient{resp: services.InstallationToken{Token: "t"}},
		ctxClient)
	_, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID: "wf-1", WorkspaceID: "ws-1", AppID: "missing",
	})
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected AppNotFound, got %v", err)
	}
}

func TestOrbitRepoClone_GitCloneFailure_RedactsToken(t *testing.T) {
	exec := &fakeSandboxExecutor{res: sandbox.ExecResult{
		ExitCode: 128,
		// Simulate git echoing back the URL it tried to fetch from,
		// including the embedded token. The activity must redact it.
		Stderr: "fatal: unable to access 'https://x-access-token:ghs_SECRET_VALUE@github.com/foo/bar.git/': bad credentials",
	}}
	tokens := &fakeGitHubTokenClient{resp: services.InstallationToken{
		Token: "ghs_SECRET_VALUE", InstallationID: 1, AccountLogin: "foo",
		ExpiresAt: "2030-01-01T00:00:00Z",
	}}
	a := newRepoCloneActivities(exec, tokens, &fakeOrbitContextClient{})

	_, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID: "wf-1", WorkspaceID: "ws-1",
		RepoURL: "https://github.com/foo/bar",
	})
	if err == nil {
		t.Fatal("expected error from non-zero exit")
	}
	if strings.Contains(err.Error(), "ghs_SECRET_VALUE") {
		t.Errorf("token leaked into error message: %v", err)
	}
	if !strings.Contains(err.Error(), "***REDACTED***") {
		t.Errorf("expected redaction marker in error: %v", err)
	}
}

func TestOrbitRepoClone_ExecError_RedactsToken(t *testing.T) {
	exec := &fakeSandboxExecutor{err: errors.New("dialing 'https://x-access-token:ghs_LEAKED@github.com': failed")}
	tokens := &fakeGitHubTokenClient{resp: services.InstallationToken{Token: "ghs_LEAKED"}}
	a := newRepoCloneActivities(exec, tokens, &fakeOrbitContextClient{})

	_, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID: "wf-1", WorkspaceID: "ws-1",
		RepoURL: "https://github.com/foo/bar",
	})
	if err == nil {
		t.Fatal("expected error from executor")
	}
	if strings.Contains(err.Error(), "ghs_LEAKED") {
		t.Errorf("token leaked into error: %v", err)
	}
}
