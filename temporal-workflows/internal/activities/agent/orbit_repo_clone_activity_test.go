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
	calls                             int
}

func (f *fakeGitHubTokenClient) GetInstallationTokenForRepo(_ context.Context, workspaceID, owner, repo string) (services.InstallationToken, error) {
	f.calls++
	f.gotWorkspaceID, f.gotOwner, f.gotRepo = workspaceID, owner, repo
	return f.resp, f.err
}

type fakeADOTokenClient struct {
	resp services.ADOConnectionToken
	err  error

	gotConnectionID string
	calls           int
}

func (f *fakeADOTokenClient) GetConnectionToken(_ context.Context, connectionID string) (services.ADOConnectionToken, error) {
	f.calls++
	f.gotConnectionID = connectionID
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
		name, in            string
		wantOwner, wantRepo string
		wantErr             bool
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

func TestParseRepoURL(t *testing.T) {
	cases := []struct {
		name, in                                       string
		wantProvider, wantOwner, wantProject, wantRepo string
		wantErr                                        bool
	}{
		// GitHub (parity with parseGitHubRepoURL)
		{"github plain", "https://github.com/drewpayment/orbit", providerGitHub, "drewpayment", "", "orbit", false},
		{"github .git", "https://github.com/drewpayment/orbit.git", providerGitHub, "drewpayment", "", "orbit", false},
		{"github subpath dropped", "https://github.com/foo/bar/tree/main", providerGitHub, "foo", "", "bar", false},
		{"github embedded creds", "https://user:pat@github.com/foo/bar.git", providerGitHub, "foo", "", "bar", false},
		// Azure DevOps (dev.azure.com + on-prem host)
		{"ado dev.azure.com", "https://dev.azure.com/myorg/myproject/_git/myrepo", providerADO, "myorg", "myproject", "myrepo", false},
		{"ado .git suffix", "https://dev.azure.com/myorg/myproject/_git/myrepo.git", providerADO, "myorg", "myproject", "myrepo", false},
		{"ado on-prem host", "https://tfs.corp.local/acme/platform/_git/svc", providerADO, "acme", "platform", "svc", false},
		{"ado trailing slash", "https://dev.azure.com/o/p/_git/r/", providerADO, "o", "p", "r", false},
		{"ado query dropped", "https://dev.azure.com/o/p/_git/r?path=/x", providerADO, "o", "p", "r", false},
		// Rejections
		{"http rejected", "http://github.com/foo/bar", "", "", "", "", true},
		{"ssh rejected", "git@github.com:foo/bar.git", "", "", "", "", true},
		{"gitlab rejected", "https://gitlab.com/foo/bar", "", "", "", "", true},
		{"ado missing _git", "https://dev.azure.com/org/project/repo", "", "", "", "", true},
		{"ado _git wrong position", "https://dev.azure.com/org/_git/repo", "", "", "", "", true},
		{"ado injection in repo", "https://dev.azure.com/org/proj/_git/re;po", "", "", "", "", true},
		{"empty", "", "", "", "", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseRepoURL(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %+v", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.Provider != tc.wantProvider || got.Owner != tc.wantOwner || got.Project != tc.wantProject || got.Repo != tc.wantRepo {
				t.Errorf("got %+v, want provider=%q owner=%q project=%q repo=%q",
					got, tc.wantProvider, tc.wantOwner, tc.wantProject, tc.wantRepo)
			}
		})
	}
}

func TestIsSafeADOBaseURL(t *testing.T) {
	ok := []string{"https://dev.azure.com", "https://tfs.corp.local", "https://tfs.corp.local:8443"}
	bad := []string{"http://dev.azure.com", "https://dev.azure.com/", "https://dev.azure.com/path", "https://foo;rm", "", "dev.azure.com"}
	for _, s := range ok {
		if !isSafeADOBaseURL(s) {
			t.Errorf("%q should be a safe base URL", s)
		}
	}
	for _, s := range bad {
		if isSafeADOBaseURL(s) {
			t.Errorf("%q should be rejected", s)
		}
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
	return NewOrbitRepoCloneActivities(exec, tokens, &fakeADOTokenClient{}, ctx, nil)
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

// --- Azure DevOps clone paths ---

// newRepoCloneActivitiesADO wires an explicit ADO token client alongside the
// GitHub + context fakes.
func newRepoCloneActivitiesADO(exec sandbox.SandboxExecutor, ado *fakeADOTokenClient, ctx OrbitContextClient) *OrbitRepoCloneActivities {
	return NewOrbitRepoCloneActivities(exec, &fakeGitHubTokenClient{}, ado, ctx, nil)
}

// adoAppCtx returns a context client whose app resolves to an ADO repository
// with the given connection id.
func adoAppCtx(connectionID string) *fakeOrbitContextClient {
	return &fakeOrbitContextClient{
		app: services.AppDetails{
			ID:   "app-ado",
			Name: "payments",
			Repository: &services.AppRepository{
				URL:          "https://dev.azure.com/myorg/myproject/_git/payments",
				Owner:        "myorg",
				Name:         "payments",
				Branch:       "main",
				Provider:     providerADO,
				ConnectionID: connectionID,
				Project:      "myproject",
			},
		},
	}
}

func TestOrbitRepoClone_ADO_BasicPat_URLInjectsToken(t *testing.T) {
	exec := &fakeSandboxExecutor{res: sandbox.ExecResult{
		ExitCode: 0,
		Stdout:   "ORBIT_HEAD_SHA=adodead\nORBIT_BRANCH=main\n",
	}}
	ado := &fakeADOTokenClient{resp: services.ADOConnectionToken{
		Provider:     providerADO,
		Organization: "myorg",
		BaseURL:      "https://dev.azure.com",
		AuthMode:     "basic-pat",
		Token:        "ADO_PAT_SECRET",
	}}
	a := newRepoCloneActivitiesADO(exec, ado, adoAppCtx("conn-123"))

	res, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID: "wf-ado", WorkspaceID: "ws-1", AppID: "app-ado",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ado.calls != 1 || ado.gotConnectionID != "conn-123" {
		t.Errorf("ado client got calls=%d conn=%q", ado.calls, ado.gotConnectionID)
	}
	if exec.gotEnv["ADO_TOKEN"] != "ADO_PAT_SECRET" {
		t.Errorf("PAT not projected as env var; env=%+v", exec.gotEnv)
	}
	if strings.Contains(exec.gotCmd, "ADO_PAT_SECRET") {
		t.Errorf("raw PAT leaked into command: %q", exec.gotCmd)
	}
	// basic-pat: username:token injected via env var into the clone URL.
	if !strings.Contains(exec.gotCmd, "https://pat:${ADO_TOKEN}@dev.azure.com/myorg/myproject/_git/payments") {
		t.Errorf("expected PAT-injected clone URL, got %q", exec.gotCmd)
	}
	// and scrubbed to a bare origin afterward.
	if !strings.Contains(exec.gotCmd, `git remote set-url origin "https://dev.azure.com/myorg/myproject/_git/payments"`) {
		t.Errorf("expected origin scrub to bare URL, got %q", exec.gotCmd)
	}
	if res.Owner != "myorg" || res.Project != "myproject" || res.Repo != "payments" {
		t.Errorf("coordinates = %+v", res)
	}
	if res.InstallationID != 0 {
		t.Errorf("ADO clone should have no installation id, got %d", res.InstallationID)
	}
	if res.ClonePath != "repo/myorg-myproject-payments" {
		t.Errorf("clone_path = %q", res.ClonePath)
	}
}

func TestOrbitRepoClone_ADO_Bearer_UsesExtraHeaderNotURL(t *testing.T) {
	exec := &fakeSandboxExecutor{res: sandbox.ExecResult{
		ExitCode: 0,
		Stdout:   "ORBIT_HEAD_SHA=beef\nORBIT_BRANCH=main\n",
	}}
	ado := &fakeADOTokenClient{resp: services.ADOConnectionToken{
		Provider:     providerADO,
		Organization: "myorg",
		BaseURL:      "https://dev.azure.com",
		AuthMode:     "bearer",
		Token:        "BEARER_SECRET_TOKEN",
	}}
	a := newRepoCloneActivitiesADO(exec, ado, adoAppCtx("conn-b"))

	_, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID: "wf-ado-b", WorkspaceID: "ws-1", AppID: "app-ado",
	})
	if err != nil {
		t.Fatal(err)
	}
	if exec.gotEnv["ADO_TOKEN"] != "BEARER_SECRET_TOKEN" {
		t.Errorf("bearer token not projected as env var; env=%+v", exec.gotEnv)
	}
	// The literal token must appear nowhere in the command.
	if strings.Contains(exec.gotCmd, "BEARER_SECRET_TOKEN") {
		t.Errorf("raw bearer token leaked into command: %q", exec.gotCmd)
	}
	// Bearer is presented via http.extraheader, never in the URL.
	if !strings.Contains(exec.gotCmd, `http.extraheader="AUTHORIZATION: Bearer ${ADO_TOKEN}"`) {
		t.Errorf("expected bearer via extraheader, got %q", exec.gotCmd)
	}
	// The clone URL is bare — no credentials spliced in.
	if !strings.Contains(exec.gotCmd, `"https://dev.azure.com/myorg/myproject/_git/payments"`) {
		t.Errorf("expected bare clone URL, got %q", exec.gotCmd)
	}
	if strings.Contains(exec.gotCmd, "${ADO_TOKEN}@") || strings.Contains(exec.gotCmd, "pat:") {
		t.Errorf("bearer clone URL must not embed credentials: %q", exec.gotCmd)
	}
}

func TestOrbitRepoClone_ADO_RawURL_NoConnection_Rejected(t *testing.T) {
	// A raw ADO URL (no app_id) has no connection linkage — must fail clearly.
	ado := &fakeADOTokenClient{}
	a := newRepoCloneActivitiesADO(&fakeSandboxExecutor{}, ado, &fakeOrbitContextClient{})

	_, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID: "wf-1", WorkspaceID: "ws-1",
		RepoURL: "https://dev.azure.com/myorg/myproject/_git/payments",
	})
	if err == nil || !strings.Contains(err.Error(), "linked git connection") {
		t.Fatalf("expected missing-connection error, got %v", err)
	}
	if ado.calls != 0 {
		t.Errorf("token client should not be called without a connection id")
	}
}

func TestOrbitRepoClone_ADO_NotConfigured(t *testing.T) {
	// adoClient nil → ADO clone fails with a clear not-configured error.
	a := NewOrbitRepoCloneActivities(&fakeSandboxExecutor{}, &fakeGitHubTokenClient{}, nil, adoAppCtx("conn-x"), nil)
	_, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID: "wf-1", WorkspaceID: "ws-1", AppID: "app-ado",
	})
	if err == nil || !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("expected not-configured error, got %v", err)
	}
}

func TestOrbitRepoClone_ADO_ConnectionNotFound_SurfacesNonRetryable(t *testing.T) {
	ado := &fakeADOTokenClient{err: services.ErrConnectionNotFound}
	a := newRepoCloneActivitiesADO(&fakeSandboxExecutor{}, ado, adoAppCtx("conn-gone"))
	_, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID: "wf-1", WorkspaceID: "ws-1", AppID: "app-ado",
	})
	if err == nil || !strings.Contains(err.Error(), "no longer exists") {
		t.Fatalf("expected connection-not-found error, got %v", err)
	}
}

func TestOrbitRepoClone_ADO_CloneFailure_RedactsToken(t *testing.T) {
	exec := &fakeSandboxExecutor{res: sandbox.ExecResult{
		ExitCode: 128,
		Stderr:   "fatal: Authentication failed for 'https://pat:ADO_PAT_SECRET@dev.azure.com/myorg/myproject/_git/payments'",
	}}
	ado := &fakeADOTokenClient{resp: services.ADOConnectionToken{
		Organization: "myorg", BaseURL: "https://dev.azure.com",
		AuthMode: "basic-pat", Token: "ADO_PAT_SECRET",
	}}
	a := newRepoCloneActivitiesADO(exec, ado, adoAppCtx("conn-123"))

	_, err := a.OrbitRepoClone(context.Background(), OrbitRepoCloneInput{
		WorkflowID: "wf-1", WorkspaceID: "ws-1", AppID: "app-ado",
	})
	if err == nil {
		t.Fatal("expected error from non-zero exit")
	}
	if strings.Contains(err.Error(), "ADO_PAT_SECRET") {
		t.Errorf("PAT leaked into error message: %v", err)
	}
	if !strings.Contains(err.Error(), "***REDACTED***") {
		t.Errorf("expected redaction marker in error: %v", err)
	}
}
