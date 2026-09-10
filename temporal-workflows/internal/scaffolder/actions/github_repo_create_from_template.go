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

//go:embed github_repo_create_from_template.input.schema.json
var githubRepoCreateFromTemplateInputSchema []byte

//go:embed github_repo_create_from_template.output.schema.json
var githubRepoCreateFromTemplateOutputSchema []byte

// GitHubRepoCreateFromTemplate wraps
// GitHubRepoClient.CreateRepoFromTemplate: it creates a new repository from
// a GitHub template repository, then clones the result into the run's work
// directory so later fs:render/git:push steps can operate on it.
type GitHubRepoCreateFromTemplate struct {
	tokenService  TokenService
	clientFactory GitHubClientFactory
}

// NewGitHubRepoCreateFromTemplate constructs the
// github:repo:create-from-template action.
func NewGitHubRepoCreateFromTemplate(tokenService TokenService, clientFactory GitHubClientFactory) *GitHubRepoCreateFromTemplate {
	if clientFactory == nil {
		clientFactory = defaultGitHubClientFactory("")
	}
	return &GitHubRepoCreateFromTemplate{tokenService: tokenService, clientFactory: clientFactory}
}

type githubRepoCreateFromTemplateInput struct {
	SourceOwner    string `json:"sourceOwner"`
	SourceRepo     string `json:"sourceRepo"`
	TargetOrg      string `json:"targetOrg"`
	Name           string `json:"name"`
	Description    string `json:"description"`
	Private        bool   `json:"private"`
	InstallationID string `json:"installationId"`
}

type githubRepoCreateFromTemplateOutput struct {
	RepoURL  string `json:"repoUrl"`
	RepoName string `json:"repoName"`
	Checkout string `json:"checkout"`
}

// Name implements scaffolder.Action.
func (a *GitHubRepoCreateFromTemplate) Name() string { return "github:repo:create-from-template" }

// InputSchema implements scaffolder.Action.
func (a *GitHubRepoCreateFromTemplate) InputSchema() json.RawMessage {
	return githubRepoCreateFromTemplateInputSchema
}

// OutputSchema implements scaffolder.Action.
func (a *GitHubRepoCreateFromTemplate) OutputSchema() json.RawMessage {
	return githubRepoCreateFromTemplateOutputSchema
}

// Plan describes the repository that would be created, without creating it.
func (a *GitHubRepoCreateFromTemplate) Plan(_ context.Context, _ scaffolder.ActionRunContext, input json.RawMessage) ([]scaffolder.PlannedChange, error) {
	in, err := parseGitHubRepoCreateFromTemplateInput(input)
	if err != nil {
		return nil, err
	}
	return []scaffolder.PlannedChange{{
		Kind:        "repo",
		Name:        in.Name,
		Description: fmt.Sprintf("create GitHub repository %s/%s from template %s/%s", in.TargetOrg, in.Name, in.SourceOwner, in.SourceRepo),
	}}, nil
}

// Execute creates the repository from the template and clones it into the
// run's work directory.
func (a *GitHubRepoCreateFromTemplate) Execute(ctx context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
	in, err := parseGitHubRepoCreateFromTemplateInput(input)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(rc.WorkDir) == "" {
		return nil, fmt.Errorf("github:repo:create-from-template: run has no work directory to check out into")
	}
	if a.tokenService == nil {
		return nil, fmt.Errorf("github:repo:create-from-template: no token service configured")
	}
	token, err := a.tokenService.GetInstallationToken(ctx, in.InstallationID)
	if err != nil {
		return nil, fmt.Errorf("github:repo:create-from-template: get installation token: %w", err)
	}

	rc.Heartbeat("github:repo:create-from-template", in.TargetOrg, in.Name)
	client := a.clientFactory(token)
	repoURL, err := client.CreateRepoFromTemplate(ctx, in.SourceOwner, in.SourceRepo, in.TargetOrg, in.Name, in.Description, in.Private)
	if err != nil {
		return nil, fmt.Errorf("github:repo:create-from-template: %w", err)
	}

	checkoutDir := filepath.Join(rc.WorkDir, "checkout")
	rc.Heartbeat("github:repo:create-from-template: cloning", repoURL)
	if err := activities.CloneGitRepo(ctx, checkoutDir, repoURL, "", token); err != nil {
		return nil, fmt.Errorf("github:repo:create-from-template: clone new repository: %w", err)
	}

	return json.Marshal(githubRepoCreateFromTemplateOutput{RepoURL: repoURL, RepoName: in.Name, Checkout: checkoutDir})
}

func parseGitHubRepoCreateFromTemplateInput(raw json.RawMessage) (githubRepoCreateFromTemplateInput, error) {
	var in githubRepoCreateFromTemplateInput
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, fmt.Errorf("github:repo:create-from-template: decode input: %w", err)
		}
	}
	for field, v := range map[string]string{
		"sourceOwner":    in.SourceOwner,
		"sourceRepo":     in.SourceRepo,
		"targetOrg":      in.TargetOrg,
		"name":           in.Name,
		"installationId": in.InstallationID,
	} {
		if strings.TrimSpace(v) == "" {
			return in, fmt.Errorf("github:repo:create-from-template: `%s` is required", field)
		}
	}
	return in, nil
}
