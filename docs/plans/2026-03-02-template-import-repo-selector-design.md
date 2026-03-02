# Template Import: Searchable Repository Selector

**Date:** 2026-03-02
**Status:** Approved

## Problem

The Import Template form uses a plain text field for the GitHub Repository URL. Users must type a full URL manually, even though only repos accessible via the workspace's GitHub App installation will work. This is error-prone and provides no discoverability.

## Design

Replace the text URL input with a searchable combobox that lists repositories accessible to the workspace's GitHub App installation.

### Form Layout (top to bottom)

1. **Workspace** — Select dropdown (moved to top, since repo list depends on it)
2. **GitHub Repository** — New `RepositoryCombobox` component
3. **Manifest File Path** — Text input (unchanged, defaults to `orbit-template.yaml`)

### RepositoryCombobox Behavior

- Built with shadcn Command + Popover (both already in project)
- Disabled until a workspace is selected
- On workspace selection: resolves GitHub installation via `getWorkspaceGitHubInstallations(workspaceId)`
- On open: pre-loads first page (30 repos) via `listInstallationRepositories(installationId)`
- On type (3+ chars, 300ms debounce): searches via `searchInstallationRepositories(installationId, query)`
- Each dropdown item shows: repo name, description (truncated), lock icon if private
- Selecting a repo sets `repoUrl` to `https://github.com/{fullName}`

### Edge Cases

- **No GitHub App installation for workspace:** Show inline message with link to workspace settings
- **Multiple installations:** Use first active one (most workspaces have one)
- **Search returns no results:** Show "No repositories found" empty state
- **Loading states:** Spinner in combobox while fetching

### Existing Backend

All server actions already exist in `orbit-www/src/app/actions/github.ts`:
- `getWorkspaceGitHubInstallations(workspaceId)` — resolves installation ID
- `listInstallationRepositories(installationId, page, perPage)` — paginated repo list
- `searchInstallationRepositories(installationId, query)` — search (3+ char minimum)

No backend changes needed.

### Files to Change

- `orbit-www/src/components/features/templates/ImportTemplateForm.tsx` — Restructure form, replace URL input with combobox
- `orbit-www/src/components/features/templates/RepositoryCombobox.tsx` — New component

### Decisions

- Selector-only, no manual URL fallback (if repo isn't accessible via GitHub App, import won't work anyway)
- Workspace field moved to top since repo list depends on it
- Pre-load first page + debounced search for best discoverability
