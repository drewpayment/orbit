package actions

import (
	"context"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// TokenService resolves a GitHub App installation id to a short-lived
// installation access token. Mirrors activities.TokenService so both the v1
// template-instantiation activities and these scaffolder actions authenticate
// against GitHub the same way.
type TokenService interface {
	GetInstallationToken(ctx context.Context, installationID string) (string, error)
}

// GitHubRepoClient is the subset of services.GitHubTemplateClient the
// github:repo:* actions need. An interface here (rather than depending on
// the concrete client) lets tests supply a fake instead of doing real HTTP.
type GitHubRepoClient interface {
	CreateRepoFromTemplate(ctx context.Context, sourceOwner, sourceRepo, targetOrg, targetName, description string, private bool) (string, error)
	CreateRepository(ctx context.Context, org, name, description string, private bool) (string, error)
}

// GitHubClientFactory builds a GitHubRepoClient authenticated with a
// resolved installation token. Production wiring points this at
// services.NewGitHubTemplateClient; tests point it at a fake.
type GitHubClientFactory func(token string) GitHubRepoClient

// CatalogEntityClient registers a catalog entity against orbit-www's
// internal API on behalf of the catalog:entity:register action. Satisfied
// by *services.PayloadCatalogEntityClient — see that type's doc comment for
// the (currently unimplemented server-side) contract.
type CatalogEntityClient interface {
	RegisterEntity(ctx context.Context, in services.CatalogEntityRegisterInput) (*services.CatalogEntityRegisterResult, error)
}

// Deps are the live collaborators DefaultActions wires into every action
// that needs one. Constructed once at worker startup and passed by value;
// fields left zero simply mean the actions that need them are omitted by
// DefaultActions (nil dependency, not a nil-checked global).
type Deps struct {
	// TokenService resolves a GitHub installation token. Required by
	// github:repo:create, github:repo:create-from-template, fetch:git and
	// git:push whenever a step's `installationId` input is set.
	TokenService TokenService
	// GitHubClient builds the GitHub API client used by github:repo:*.
	// Defaults to wrapping services.NewGitHubTemplateClient against
	// GitHubBaseURL when left nil.
	GitHubClient GitHubClientFactory
	// GitHubBaseURL overrides the GitHub API base URL (tests, GHE). Empty
	// means the client's own default (https://api.github.com).
	GitHubBaseURL string
	// CatalogClient registers entities for catalog:entity:register. That
	// action is omitted from DefaultActions when this is nil.
	CatalogClient CatalogEntityClient
}
