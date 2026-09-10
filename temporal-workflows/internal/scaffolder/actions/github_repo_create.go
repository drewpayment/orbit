package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

//go:embed github_repo_create.input.schema.json
var githubRepoCreateInputSchema []byte

//go:embed github_repo_create.output.schema.json
var githubRepoCreateOutputSchema []byte

// GitHubRepoCreate wraps GitHubRepoClient.CreateRepository: it creates an
// empty GitHub repository.
type GitHubRepoCreate struct {
	tokenService  TokenService
	clientFactory GitHubClientFactory
}

// NewGitHubRepoCreate constructs the github:repo:create action.
func NewGitHubRepoCreate(tokenService TokenService, clientFactory GitHubClientFactory) *GitHubRepoCreate {
	if clientFactory == nil {
		clientFactory = defaultGitHubClientFactory("")
	}
	return &GitHubRepoCreate{tokenService: tokenService, clientFactory: clientFactory}
}

// defaultGitHubClientFactory wraps services.NewGitHubTemplateClient.
func defaultGitHubClientFactory(baseURL string) GitHubClientFactory {
	return func(token string) GitHubRepoClient {
		return services.NewGitHubTemplateClient(baseURL, token)
	}
}

type githubRepoCreateInput struct {
	Org            string `json:"org"`
	Name           string `json:"name"`
	Description    string `json:"description"`
	Private        bool   `json:"private"`
	InstallationID string `json:"installationId"`
}

type githubRepoCreateOutput struct {
	RepoURL  string `json:"repoUrl"`
	RepoName string `json:"repoName"`
}

// Name implements scaffolder.Action.
func (a *GitHubRepoCreate) Name() string { return "github:repo:create" }

// InputSchema implements scaffolder.Action.
func (a *GitHubRepoCreate) InputSchema() json.RawMessage { return githubRepoCreateInputSchema }

// OutputSchema implements scaffolder.Action.
func (a *GitHubRepoCreate) OutputSchema() json.RawMessage { return githubRepoCreateOutputSchema }

// Plan describes the repository that would be created, without creating it.
func (a *GitHubRepoCreate) Plan(_ context.Context, _ scaffolder.ActionRunContext, input json.RawMessage) ([]scaffolder.PlannedChange, error) {
	in, err := parseGitHubRepoCreateInput(input)
	if err != nil {
		return nil, err
	}
	return []scaffolder.PlannedChange{{
		Kind:        "repo",
		Name:        in.Name,
		Description: fmt.Sprintf("create GitHub repository %s/%s", in.Org, in.Name),
	}}, nil
}

// Execute creates the repository and returns its URL and name.
func (a *GitHubRepoCreate) Execute(ctx context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
	in, err := parseGitHubRepoCreateInput(input)
	if err != nil {
		return nil, err
	}
	token, err := a.resolveToken(ctx, in.InstallationID)
	if err != nil {
		return nil, err
	}

	rc.Heartbeat("github:repo:create", in.Org, in.Name)
	client := a.clientFactory(token)
	repoURL, err := client.CreateRepository(ctx, in.Org, in.Name, in.Description, in.Private)
	if err != nil {
		return nil, fmt.Errorf("github:repo:create: %w", err)
	}

	return json.Marshal(githubRepoCreateOutput{RepoURL: repoURL, RepoName: in.Name})
}

func (a *GitHubRepoCreate) resolveToken(ctx context.Context, installationID string) (string, error) {
	if a.tokenService == nil {
		return "", fmt.Errorf("github:repo:create: no token service configured")
	}
	token, err := a.tokenService.GetInstallationToken(ctx, installationID)
	if err != nil {
		return "", fmt.Errorf("github:repo:create: get installation token: %w", err)
	}
	return token, nil
}

func parseGitHubRepoCreateInput(raw json.RawMessage) (githubRepoCreateInput, error) {
	var in githubRepoCreateInput
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, fmt.Errorf("github:repo:create: decode input: %w", err)
		}
	}
	if strings.TrimSpace(in.Org) == "" {
		return in, fmt.Errorf("github:repo:create: `org` is required")
	}
	if strings.TrimSpace(in.Name) == "" {
		return in, fmt.Errorf("github:repo:create: `name` is required")
	}
	if strings.TrimSpace(in.InstallationID) == "" {
		return in, fmt.Errorf("github:repo:create: `installationId` is required")
	}
	return in, nil
}
