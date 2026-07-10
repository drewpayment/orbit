# ADO Repo-Import Parity — Phase 2 of Connections Consolidation

**Status**: Approved 2026-07-09 (Drew) — follows `2026-07-09-connections-consolidation.md` (Phase 1, merged as PR #83 / c43744c)
**Branch**: `feat/ado-import-parity`

## Problem

Azure DevOps connections (`git-connections`) can back catalog-discovery *scans*, but nothing else:

- **Manual import is GitHub-only.** `ImportAppForm` loads only `github-installations`; `importRepository` (`app/actions/apps.ts`) parses URLs with a `github.com` regex and rejects everything else; `RepositoryBrowser` lists repos only via `listInstallationRepositories`.
- **The `apps.repository` group can't represent an ADO repo.** Fields are `owner/name/url/installationId/branch` — no provider discriminator, no `git-connections` linkage, no slot for ADO's project (three-part org/project/repo coordinate).
- **Discovery accept is provider-lossy.** `lib/discovery/import.ts` reads only `discovery.installation`; an accepted ADO entity becomes an `apps` row with no provider, no connection, and (because the scanner stores `RepoRef.Owner = project` and drops the org) no way to reconstruct its clone URL.
- **The agent clone path hard-rejects non-GitHub.** `orbit_repo_clone_activity.go` `parseGitHubRepoURL` requires host `github.com` + two path segments, and the clone URL literal is `x-access-token:${token}@github.com/...`.

## Goal

An ADO connection is a first-class repo source: browse/import its repos from the import form, accepted discovery proposals keep their provider + connection, and the agent can clone an ADO-backed app using the connection's credentials.

## Non-goals

- Template *creation* into ADO (`UseTemplateForm`, `PrepareGitHubRemoteActivity`, `services/repository` git-provider client) — GitHub-only stays.
- New providers beyond ADO; changes to scan/proposal flows (already provider-aware).
- Backfilling provider fields on pre-existing `apps` rows (absent provider ⇒ treated as GitHub; document this invariant).

## Canonical decisions

- **Provider value**: `azure-devops` everywhere new (matches `git-connections.provider` and the catalog workflow input; do NOT introduce `azure_devops`).
- **ADO coordinate**: never overload `owner` — new `apps` rows store `provider`, `organization` (in `owner`), `project` (new field), `name`, and full `url`; the `connection` relationship is the auth root.
- **ADO repo listing** is served by TS server actions calling ADO REST directly (reusing `lib/connections/token-core.ts` `resolveConnectionToken` for basic-pat/bearer auth) — no new Go/gRPC surface for listing.
- **Clone auth**: the Go agent activity resolves ADO credentials via the existing internal endpoint `POST /api/internal/git-connections/token` and builds `https://{user}:{PAT}@dev.azure.com/{org}/{project}/_git/{repo}` for `basic-pat`, or bearer via `http.extraheader` for `service-principal`.

## Key files

| Area | Path |
|---|---|
| Apps collection | `orbit-www/src/collections/Apps.ts` (`repository` group) |
| Import action | `orbit-www/src/app/actions/apps.ts` (`importRepository`) |
| GitHub listing actions (mirror) | `orbit-www/src/app/actions/github.ts` |
| New ADO listing actions | `orbit-www/src/app/actions/azure-devops.ts` (new) |
| ADO token core (reuse) | `orbit-www/src/lib/connections/token-core.ts` |
| Import form | `orbit-www/src/components/features/apps/ImportAppForm.tsx` |
| Repo browser | `orbit-www/src/components/features/apps/RepositoryBrowser.tsx` |
| Discovery accept | `orbit-www/src/lib/discovery/import.ts` |
| Discovered entities (read) | `orbit-www/src/collections/discovery/DiscoveredEntities.ts` |
| Git connections (read) | `orbit-www/src/collections/connections/GitConnections.ts` |
| Agent clone activity | `temporal-workflows/internal/activities/agent/orbit_repo_clone_activity.go` |
| GitHub token client (pattern) | `temporal-workflows/internal/services/payload_github_client.go` |
| ADO REST client (pattern) | `temporal-workflows/internal/activities/ado_scan_activities.go` |

---

## WI1 — `apps.repository` provider model

**UAC**
1. `repository` group gains: `provider` (select `github` | `azure-devops`, no default — absent means legacy GitHub), `connection` (relationship → `git-connections`, ADO rows only), `project` (text, ADO rows only). Existing fields unchanged; existing docs remain valid with no migration.
2. Field-level admin descriptions state the invariant: GitHub rows use `installationId`, ADO rows use `connection` + `project`; `owner` holds the GitHub owner or the ADO organization.
3. `orbit-www` payload types regenerated (`payload-types.ts`) and tsc stays at 0 errors.

## WI2 — ADO repo listing server actions

New `orbit-www/src/app/actions/azure-devops.ts`, mirroring `actions/github.ts` semantics:

**UAC**
1. `getWorkspaceGitConnections(workspaceId)` returns active `git-connections` where `allowedWorkspaces` contains the workspace — same shape/gating pattern as `getWorkspaceGitHubInstallations` (session required, membership checked), secrets never returned.
2. `listConnectionRepositories(connectionId, page?)` lists repos via ADO REST `GET {base}/{org}/{project}/_apis/git/repositories?api-version=7.1` (all projects of the org when the connection has no project: enumerate `_apis/projects` then fan in). Returns the same `Repository` shape the browser consumes (`name`, `fullName` = display coordinate, `defaultBranch`, `private`, plus `project`), auth via `resolveConnectionToken` (works for both basic-pat and bearer).
3. `searchConnectionRepositories(connectionId, query)` filters by name (client-side filter over the listing is acceptable — ADO has no repo-search API equivalent).
4. Failures (bad PAT, 404 org, network) return `{ success: false, error }` — never throw to the client, never leak the token.
5. Unit tests (TDD) cover: happy path with project-scoped connection, org-wide fan-in, auth header selection for basic-pat vs bearer, error mapping.

## WI3 — Provider-aware import UI + action

**UAC**
1. `ImportAppForm` shows a source selector when the workspace has both providers available (GitHub installations AND ADO connections); with only one provider it preselects it without extra chrome. Empty-state alert links to `/settings/connections` (already does post-Phase 1).
2. Selecting an ADO connection drives `RepositoryBrowser` through the WI2 actions (list + search + pagination), same UX as GitHub browsing.
3. Selecting an ADO repo fills the URL field with `https://dev.azure.com/{org}/{project}/_git/{repo}` (or the connection's `baseUrl` for on-prem) and the name field with the repo name.
4. `importRepository` accepts either `{installationId}` (GitHub, unchanged) or `{connectionId}` (ADO): validates the connection is allowed for the workspace, parses/derives org+project+repo, and writes the WI1 fields (`provider: 'azure-devops'`, `connection`, `owner`=org, `project`, `name`, `url`). GitHub behavior byte-for-byte unchanged.
5. Manual URL entry accepts `dev.azure.com/{org}/{project}/_git/{repo}` URLs (and the connection's baseUrl host) with a validation message that names both accepted shapes; unparseable URLs still rejected.
6. The imported app's detail view renders without regression for both providers (repo link points at the right host).
7. Unit tests (TDD): URL parsing for both providers (incl. on-prem baseUrl + `_git` shape), workspace-authorization rejection, field mapping onto the created doc.

## WI4 — Discovery accept keeps provider + connection

**UAC**
1. `importDiscoveredService` (and the api/global-entity variants where they store repo linkage) copies onto the created row: `provider` (from the discovered entity's source), `connection` (when present), and for ADO reconstructs `owner`=organization from the linked `git-connections` doc (the scanner stores project in `RepoRef.Owner` — do not trust it as org) plus `project`.
2. Accepted GitHub proposals are unchanged (still `installationId`, no provider regression — absent-provider invariant OK, setting `provider: 'github'` preferred).
3. An accepted ADO service yields an `apps` row from which a clone URL is reconstructable (org + project + name + url all present).
4. Unit tests (TDD): ADO accept maps connection/org/project correctly; GitHub accept unchanged; entity with neither linkage fails soft (no crash, logged).

## WI5 — Provider-aware agent clone (Go)

`temporal-workflows/internal/activities/agent/orbit_repo_clone_activity.go`:

**UAC**
1. URL parsing generalized: `github.com/{owner}/{repo}` (existing behavior + tests preserved) and `{host}/{org}/{project}/_git/{repo}` (dev.azure.com or a configured on-prem host). Anything else rejected with today's clear error.
2. Credential resolution branches by parsed provider: GitHub path unchanged (`token-for-repo`); ADO path calls `POST /api/internal/git-connections/token` (new small client method following `payload_github_client.go` conventions, X-API-Key auth) with the connection id carried on the app/workflow input — and must handle both `authMode: basic-pat` (clone URL `https://pat:{token}@{host}/...` — username arbitrary) and `bearer` (clone via `git -c http.extraheader="AUTHORIZATION: Bearer {token}" clone ...`; the token must NOT appear in the clone URL or logs).
3. The activity input carries the provider/connection linkage (threaded from the app doc through the workflow input — find where the GitHub repo URL/installation currently enters the workflow and extend that seam; do not query Payload from inside the activity beyond the existing token endpoints).
4. Tokens never logged; error messages name host/org/project/repo but never credentials.
5. Table-driven unit tests (TDD, `go test -race`): URL parse matrix (github, dev.azure.com, on-prem base, garbage), auth-mode → clone-command construction (assert bearer never lands in URL), GitHub path regression.
6. `temporal-workflows` builds (`go build ./...`) and existing tests pass.

## WI6 — Quality gates (all engineers)

1. TDD throughout; `cd orbit-www && bunx tsc --noEmit` → 0 errors; no new `as any` casts (Tech Debt Metrics gate counts them repo-wide, threshold +5 — aim for 0).
2. `bunx vitest run <changed test files>` green; `cd temporal-workflows && go test -race ./...` green; `go build ./...` green.
3. eslint/golangci-lint clean on touched files.

## WI7 — QA validation (agent-browser)

Full walkthrough on local dev. **Known limitation**: no real ADO org credentials exist in local dev, so ADO listing/clone are validated for UI wiring + graceful failure (clear error surfaced, no crash, no secret leak); the happy-path listing is covered by WI2 unit tests. A real-ADO smoke test needs Drew's credentials and is listed as a post-merge manual step.

---

## Sequencing

1. **Engineer C** (frontend, WI1+WI2+WI3) and **Engineer E** (Go, WI5) in parallel — disjoint trees (`orbit-www` vs `temporal-workflows`); E's workflow-input threading may touch the TS side where the workflow is started — coordinate through the PM if so.
2. **Engineer D** (WI4) after C lands (depends on WI1 fields).
3. QA (WI7), then PR.
