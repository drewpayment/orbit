package actions

import "github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"

// DefaultActions builds every production action, wired against deps, ready
// to pass to scaffolder.NewRegistry. Actions whose dependency is missing
// from deps are omitted rather than registered in a broken state:
//
//   - github:repo:create, github:repo:create-from-template, fetch:git,
//     git:push all need deps.TokenService for an authenticated call; the
//     latter two still register (and work unauthenticated) without it, but
//     the two github:repo:* actions are omitted without a TokenService since
//     they always require GitHub auth.
//   - catalog:entity:register needs deps.CatalogClient; omitted without one.
//
// debug:log and http:request take no dependencies and are always included.
func DefaultActions(deps Deps) []scaffolder.Action {
	out := []scaffolder.Action{
		NewDebugLog(),
		NewHTTPRequest(),
		NewFSRender(),
		NewFetchGit(deps.TokenService),
		NewGitPush(deps.TokenService),
	}

	if deps.TokenService != nil {
		clientFactory := deps.GitHubClient
		if clientFactory == nil {
			clientFactory = defaultGitHubClientFactory(deps.GitHubBaseURL)
		}
		out = append(out,
			NewGitHubRepoCreate(deps.TokenService, clientFactory),
			NewGitHubRepoCreateFromTemplate(deps.TokenService, clientFactory),
		)
	}

	if deps.CatalogClient != nil {
		out = append(out, NewCatalogEntityRegister(deps.CatalogClient))
	}

	return out
}

// DescriptorActions returns every production action, including the ones
// DefaultActions omits when their dependency is missing.
//
// It exists only to export the registry's descriptors (names and JSON
// schemas), which are static per action and do not touch any dependency. The
// returned actions are wired with nil deps and MUST NOT be executed: use
// DefaultActions for anything that runs.
//
// The repository service serves ListActions from a JSON file generated off
// this list, because temporal-workflows/internal/... is not importable across
// the module boundary and depending on the whole worker module there would
// drag in the Temporal SDK and minio for a set of static schemas.
func DescriptorActions() []scaffolder.Action {
	return []scaffolder.Action{
		NewDebugLog(),
		NewHTTPRequest(),
		NewFSRender(),
		NewFetchGit(nil),
		NewGitPush(nil),
		NewGitHubRepoCreate(nil, nil),
		NewGitHubRepoCreateFromTemplate(nil, nil),
		NewCatalogEntityRegister(nil),
	}
}
