# Connections Consolidation — Phase 1

**Status**: Approved 2026-07-09 (Drew)
**Branch**: `feat/connections-consolidation`
**Decisions**: Page name stays **Connections** (`/settings/connections`); provider-**sectioned** list (not flat); unified **Check health** verb replaces provider-native "Refresh token"/"Validate" as the primary action label; ADO repo-import parity is **Phase 2** (separate plan, not this branch).

## Problem

`/settings/github` (GitHub App installations, WP10) and `/settings/connections` (Azure DevOps connections, WP11) were built as parallel work packages and shipped as fragmented sibling experiences:

- Two sidebar entries for one concept ("connect a git provider"); Connections is missing from the `/settings` landing grid entirely.
- GitHub has **no Add button once populated** (external install redirect exists only in the empty state and the reconnect callout); ADO has a persistent Add button + in-app dialog.
- Workspace assignment is a full sub-page for GitHub (`/settings/github/[id]/configure`, stale styling, raw fetch) and **absent from the ADO UI** (the `allowedWorkspaces` field exists on `git-connections` but the dialog omits it).
- Vocabulary diverges: Refresh token / Configure workspaces vs Validate / Scan / Edit.
- GitHub cards lack a Scan action even though installation-level scans exist (`startInstallationScan`).

The data-model split (`github-installations` vs `git-connections`) is **intentional and stays**: GitHub App installation tokens are Temporal-auto-refreshed; ADO uses admin-entered Entra service-principal / PAT credentials with on-demand validation. This is a presentation-layer consolidation only.

## Goal

One `/settings/connections` page that presents all git-provider connections in provider sections with a single Add flow, consistent card anatomy and verbs, and workspace assignment for both providers. `/settings/github` becomes a redirect.

## Non-goals (Phase 2 — separate plan)

- ADO repositories feeding repo import (`RepositoryBrowser`, `ImportAppForm`, `RepositoryWizard` are GitHub-only today and remain so).
- Any change to the `github-installations` / `git-connections` collection split or the Temporal refresh machinery.
- New providers (GitLab, Bitbucket) — but the Add-connection picker and provider-section pattern must make adding one a drop-in.

## Key files

| Area | Path |
|---|---|
| Target page (server) | `orbit-www/src/app/(frontend)/settings/connections/page.tsx` |
| Old GitHub page → redirect | `orbit-www/src/app/(frontend)/settings/github/page.tsx` |
| Old configure sub-page → redirect | `orbit-www/src/app/(frontend)/settings/github/[id]/configure/` |
| ADO client (merge target) | `orbit-www/src/components/features/connections/ConnectionsClient.tsx` |
| GitHub client (merge source) | `orbit-www/src/components/features/github-installations/GitHubInstallationsClient.tsx` |
| Sidebar nav | `orbit-www/src/components/app-sidebar.tsx` (`navSettingsData`) |
| Settings landing grid | `orbit-www/src/app/(frontend)/settings/page.tsx` (`settingsItems`) |
| GitHub server actions | `orbit-www/src/app/actions/github-installations.ts` |
| ADO server actions | `orbit-www/src/app/actions/git-connections.ts` |
| GitHub scan action | `orbit-www/src/app/actions/discovery.ts` (`startInstallationScan`) |
| Install callback (CSRF) | `orbit-www/src/app/api/github/installation/callback/route.ts` |
| Installation PATCH API (workspaces) | `orbit-www/src/app/api/github/installations/[id]/route.ts` |
| Data loaders | `orbit-www/src/lib/github/installations-core.ts`, `orbit-www/src/lib/connections/connections-core.ts` |

---

## WI1 — Unified Connections page

Merge both clients into a single provider-sectioned experience rendered by `/settings/connections`. The server page loads installations (`listInstallationsAdminCore`) and connections (`listConnectionsAdminCore`) in parallel and passes both to the unified client.

**UAC**

1. `/settings/connections` shows header **"Connections"** with subtitle covering both providers (e.g. "Connect GitHub and Azure DevOps to import repositories and run catalog discovery."), and a persistent **Add connection** button in the header.
2. Below the header, connections render in **provider sections** — "GitHub" first, then "Azure DevOps" — each with a section label + provider icon. A section renders only when it has ≥1 item.
3. When there are no connections of either provider, a single global empty state renders (dashed box) with an **Add connection** button; no empty per-provider sections.
4. **Add connection** opens a provider-picker dialog with two options:
   - **GitHub** → initiates the existing GitHub App install redirect (`github.com/apps/{GITHUB_APP_NAME}/installations/new?state=…`), preserving the state-token generation (see WI4 for server verification).
   - **Azure DevOps** → opens the existing `ConnectionDialog` create form unchanged (name, org, project, base URL, service-principal/PAT auth).
5. GitHub cards preserve all current capabilities: status badge (Active / Refresh failed / Needs reconnect / Suspended), token-health line ("Token valid until … " / "Token EXPIRED"), refresh-outcome feedback, the `needs_reconnect` callout with **Reconnect on GitHub**, repository-selection subtitle, and assigned-workspace badges.
6. ADO cards preserve all current capabilities: provider/status badges, org/project/baseUrl subtitle, last-validated + auth-mode summary line, error text when status is `error` — and gain assigned-workspace badges (parity with GitHub cards).
7. Card actions are consistent across providers:
   - **Check health** — primary action on both. GitHub: runs the existing token refresh (`refreshInstallationToken` + poll loop). ADO: runs `validateConnection`. Outcome is surfaced inline or via toast in both cases.
   - **Scan** — on both. GitHub: `startInstallationScan(installationId)`; ADO: `startConnectionScan(connectionId)` (existing). Both toast a pointer to Discovery.
   - **Workspaces** — on both, opens the shared workspace dialog (WI2).
   - Provider-specific: GitHub gets **Manage on GitHub** (external link); ADO gets **Edit** (existing credential dialog).
   - **Remove** — on both, via AlertDialog. GitHub keeps its blast-radius app-count warning and "does not uninstall on GitHub" copy; ADO keeps its existing confirm.
8. Page remains platform-admin-gated (`isPlatformAdmin`, redirect otherwise) and secrets never round-trip to the client (PAT-less/token-less projections preserved).
9. `GitHubInstallationsClient.tsx` and its page-level usage are removed once merged (no dead component left exported/rendered).

## WI2 — Shared workspace-assignment dialog

Replace `/settings/github/[id]/configure` with an in-page dialog usable by both providers.

**UAC**

1. **Workspaces** on any card opens a dialog listing all workspaces as checkboxes, pre-checked from the record's `allowedWorkspaces`.
2. Saving persists to the correct collection: `github-installations` (existing PATCH `/api/github/installations/[id]` or a new server action — prefer a server action for consistency) or `git-connections` (`updateConnection`).
3. The card's workspace badges reflect the change after save (router.refresh() is acceptable).
4. The `/settings/github/[id]/configure` page and `configure-client.tsx` are deleted; the route redirects to `/settings/connections` (WI3.4).
5. ADO connections can now be workspace-scoped from the UI (previously impossible).
6. Dialog uses the same shadcn styling as the rest of the page (no `text-gray-*` legacy styling carried over).

## WI3 — Navigation & redirects

**UAC**

1. Sidebar `navSettingsData` has a single **Connections** entry (Plug icon); the **GitHub** entry is removed.
2. `/settings` landing grid (`settingsItems`) includes a **Connections** card ("Connect GitHub and Azure DevOps for repository import and catalog discovery"); the GitHub card is removed.
3. `GET /settings/github` permanently redirects to `/settings/connections`.
4. `GET /settings/github/[id]/configure` permanently redirects to `/settings/connections`.
5. No remaining internal links point at `/settings/github` (grep the repo; the install-callback success redirect and any toasts/buttons now land on `/settings/connections`).

## WI4 — CSRF state verification on GitHub install callback

`installation/callback/route.ts` carries `TODO: Implement state verification` — the client generates a `state` param (sessionStorage) but the server never verifies it.

**UAC**

1. When Orbit initiates an install/reconnect, the state token is generated server-side (server action or route) and stored in an **HttpOnly, Secure, SameSite=Lax cookie** (short TTL, ~15 min) before redirecting to GitHub; the same value rides the `state` query param.
2. The callback verifies `state` against the cookie: match → proceed (and clear the cookie); mismatch → no doc upsert, redirect to `/settings/connections?error=…` with a user-visible error message.
3. **GitHub-initiated installs** (user installs from GitHub's side; no Orbit state exists): callback must not hard-fail. Analyze and pick the safe behavior — acceptable: require an authenticated platform-admin session on the callback and treat the GitHub API (App JWT) as source of truth for installation data, logging the unsolicited install. Document the chosen behavior in the route comment.
4. Legitimate end-to-end flow (Add connection → GitHub → callback → doc upserted → refresh workflow started) still works.
5. Unit tests cover: valid state, mismatched state, absent state (both cookie-absent and param-absent variants).

## WI5 — Quality gates (all engineers)

1. TDD: tests written first for new logic (component behavior, callback verification, workspace-save actions).
2. `cd orbit-www && pnpm exec tsc --noEmit` → **0 errors** (this was cleaned to 0 in PR #78; keep it there).
3. `make lint-frontend` passes.
4. New/changed tests pass via targeted `pnpm exec vitest run <paths>`. Note: ~98 vitest failures pre-exist on main (env/timing debt) — do not chase those; do not add to them.

## WI6 — QA validation (agent-browser)

Full UAC walkthrough against local dev (`http://localhost:3000`, seeded platform-admin login), with screenshots per UAC group, following the repo's agent-browser pre-flight/post-flight hygiene rules. Pass/fail report per criterion; failures loop back to engineering before PR.

---

## Phase 2 (deferred — write separate plan when Phase 1 ships)

ADO repo-import parity: list ADO repos through a `git-connections` connection, provider field on imported repos, ADO clone-token path (`token-for-repo` equivalent), and provider-aware `RepositoryBrowser` / `ImportAppForm` / `RepositoryWizard`. Until then, ADO cards must not advertise import capability.
