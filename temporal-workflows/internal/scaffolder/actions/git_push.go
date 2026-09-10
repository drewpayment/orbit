package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
)

//go:embed git_push.input.schema.json
var gitPushInputSchema []byte

//go:embed git_push.output.schema.json
var gitPushOutputSchema []byte

// pushFunc matches activities.PushRepo's signature. A field of this type
// lets tests substitute a fake so Execute's orchestration (parsing,
// validation, token resolution, error wrapping) can be exercised without
// shelling out to git — the git mechanics themselves are covered directly
// against activities.PushRepo's own tests.
type pushFunc func(ctx context.Context, in activities.PushRepoInput) error

// GitPush wraps activities.PushRepo: it pushes whatever is at `path` to
// `repoUrl`, generalizing the v1 PushToNewRepo activity from "push a
// freshly rendered template" to "push whatever is at path".
type GitPush struct {
	tokenService TokenService
	push         pushFunc
}

// NewGitPush constructs the git:push action. tokenService may be nil: it is
// only consulted when a step's `installationId` input is set.
func NewGitPush(tokenService TokenService) *GitPush {
	return &GitPush{tokenService: tokenService, push: activities.PushRepo}
}

type gitPushInput struct {
	Path           string `json:"path"`
	RepoURL        string `json:"repoUrl"`
	Branch         string `json:"branch"`
	CommitMessage  string `json:"commitMessage"`
	InstallationID string `json:"installationId"`
}

type gitPushOutput struct {
	RepoURL string `json:"repoUrl"`
	Branch  string `json:"branch"`
}

// Name implements scaffolder.Action.
func (a *GitPush) Name() string { return "git:push" }

// InputSchema implements scaffolder.Action.
func (a *GitPush) InputSchema() json.RawMessage { return gitPushInputSchema }

// OutputSchema implements scaffolder.Action.
func (a *GitPush) OutputSchema() json.RawMessage { return gitPushOutputSchema }

// Plan describes the push without performing it.
func (a *GitPush) Plan(_ context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) ([]scaffolder.PlannedChange, error) {
	in, err := parseGitPushInput(input)
	if err != nil {
		return nil, err
	}
	if err := requireWithinWorkDir(rc.WorkDir, in.Path); err != nil {
		return nil, fmt.Errorf("git:push: %w", err)
	}
	branch := in.Branch
	if branch == "" {
		branch = "main"
	}
	return []scaffolder.PlannedChange{{
		Kind:        "push",
		Name:        in.RepoURL,
		Description: fmt.Sprintf("push %s to %s (%s)", in.Path, in.RepoURL, branch),
	}}, nil
}

// Execute pushes path to repoUrl.
func (a *GitPush) Execute(ctx context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
	in, err := parseGitPushInput(input)
	if err != nil {
		return nil, err
	}
	if err := requireWithinWorkDir(rc.WorkDir, in.Path); err != nil {
		return nil, fmt.Errorf("git:push: %w", err)
	}
	branch := in.Branch
	if branch == "" {
		branch = "main"
	}

	token := ""
	if in.InstallationID != "" {
		if a.tokenService == nil {
			return nil, fmt.Errorf("git:push: no token service configured")
		}
		t, err := a.tokenService.GetInstallationToken(ctx, in.InstallationID)
		if err != nil {
			return nil, fmt.Errorf("git:push: get installation token: %w", err)
		}
		token = t
	}

	rc.Heartbeat("git:push", in.RepoURL)
	if err := a.push(ctx, activities.PushRepoInput{
		WorkDir:       in.Path,
		RepoURL:       in.RepoURL,
		Branch:        branch,
		CommitMessage: in.CommitMessage,
		Token:         token,
	}); err != nil {
		return nil, fmt.Errorf("git:push: %w", err)
	}

	return json.Marshal(gitPushOutput{RepoURL: in.RepoURL, Branch: branch})
}

func parseGitPushInput(raw json.RawMessage) (gitPushInput, error) {
	var in gitPushInput
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, fmt.Errorf("git:push: decode input: %w", err)
		}
	}
	if strings.TrimSpace(in.Path) == "" {
		return in, fmt.Errorf("git:push: `path` is required")
	}
	if strings.TrimSpace(in.RepoURL) == "" {
		return in, fmt.Errorf("git:push: `repoUrl` is required")
	}
	if !activities.IsSafeGitURL(in.RepoURL) {
		return in, fmt.Errorf("git:push: `repoUrl` must be http(s)://, ssh://, or user@host:path form")
	}
	return in, nil
}
