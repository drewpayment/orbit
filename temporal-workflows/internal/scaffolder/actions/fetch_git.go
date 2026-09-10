package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

//go:embed fetch_git.input.schema.json
var fetchGitInputSchema []byte

//go:embed fetch_git.output.schema.json
var fetchGitOutputSchema []byte

// FetchGit clones a git repository into a scoped directory under the run's
// work directory, so a later fs:render/git:push step can operate on it.
type FetchGit struct {
	tokenService TokenService
}

// NewFetchGit constructs the fetch:git action. tokenService may be nil: it
// is only consulted when a step's `installationId` input is set.
func NewFetchGit(tokenService TokenService) *FetchGit {
	return &FetchGit{tokenService: tokenService}
}

type fetchGitInput struct {
	URL            string `json:"url"`
	Ref            string `json:"ref"`
	Path           string `json:"path"`
	InstallationID string `json:"installationId"`
}

type fetchGitOutput struct {
	Path string `json:"path"`
}

// Name implements scaffolder.Action.
func (a *FetchGit) Name() string { return "fetch:git" }

// InputSchema implements scaffolder.Action.
func (a *FetchGit) InputSchema() json.RawMessage { return fetchGitInputSchema }

// OutputSchema implements scaffolder.Action.
func (a *FetchGit) OutputSchema() json.RawMessage { return fetchGitOutputSchema }

// Plan describes the clone destination without touching the filesystem.
func (a *FetchGit) Plan(_ context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) ([]scaffolder.PlannedChange, error) {
	in, err := parseFetchGitInput(input)
	if err != nil {
		return nil, err
	}
	dest, err := resolveFetchDest(rc.WorkDir, in.Path, in.URL)
	if err != nil {
		return nil, err
	}
	return []scaffolder.PlannedChange{{
		Kind:        "fetch",
		Name:        in.URL,
		Description: fmt.Sprintf("clone %s into %s", in.URL, dest),
	}}, nil
}

// Execute clones the repository.
func (a *FetchGit) Execute(ctx context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
	in, err := parseFetchGitInput(input)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(rc.WorkDir) == "" {
		return nil, fmt.Errorf("fetch:git: run has no work directory")
	}
	dest, err := resolveFetchDest(rc.WorkDir, in.Path, in.URL)
	if err != nil {
		return nil, err
	}

	token := ""
	if in.InstallationID != "" {
		if a.tokenService == nil {
			return nil, fmt.Errorf("fetch:git: no token service configured")
		}
		t, err := a.tokenService.GetInstallationToken(ctx, in.InstallationID)
		if err != nil {
			return nil, fmt.Errorf("fetch:git: get installation token: %w", err)
		}
		token = t
	}

	rc.Heartbeat("fetch:git", in.URL)
	if err := activities.CloneGitRepo(ctx, dest, in.URL, in.Ref, token); err != nil {
		return nil, fmt.Errorf("fetch:git: %w", err)
	}

	return json.Marshal(fetchGitOutput{Path: dest})
}

func parseFetchGitInput(raw json.RawMessage) (fetchGitInput, error) {
	var in fetchGitInput
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, fmt.Errorf("fetch:git: decode input: %w", err)
		}
	}
	if strings.TrimSpace(in.URL) == "" {
		return in, fmt.Errorf("fetch:git: `url` is required")
	}
	return in, nil
}

// resolveFetchDest computes the clone destination under workDir: the
// author-supplied path when given, otherwise a name derived from url. It
// rejects a path that would escape workDir (e.g. "../../etc") — the
// destination came through a template author's `${{ }}` expression, which
// this action treats as untrusted input.
func resolveFetchDest(workDir, relPath, url string) (string, error) {
	if strings.TrimSpace(relPath) == "" {
		relPath = deriveRepoDirName(url)
	}
	if filepath.IsAbs(relPath) {
		return "", fmt.Errorf("fetch:git: `path` must be relative to the work directory")
	}
	joined := filepath.Join(workDir, relPath)
	rel, err := filepath.Rel(workDir, joined)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("fetch:git: `path` escapes the work directory")
	}
	return joined, nil
}

// deriveRepoDirName takes the last path segment of url, minus a trailing
// ".git", as a default clone directory name.
func deriveRepoDirName(url string) string {
	trimmed := strings.TrimSuffix(strings.TrimRight(url, "/"), ".git")
	if i := strings.LastIndexByte(trimmed, '/'); i >= 0 {
		trimmed = trimmed[i+1:]
	}
	if trimmed == "" {
		return "repo"
	}
	return trimmed
}
