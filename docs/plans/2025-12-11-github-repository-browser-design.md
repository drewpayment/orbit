# GitHub Repository Browser for Import Flow

**Date:** 2025-12-11
**Status:** Design Complete

## Overview

Improve the repository import experience by allowing users to browse and select repositories from their connected GitHub installations, rather than manually entering URLs.

## Goals

- Let users browse repositories from GitHub installations allowed for their workspace
- Auto-select installation when workspace has only one
- Provide searchable, paginated repository list
- Maintain manual URL entry as fallback for public repos or when no installations exist
- Link imported apps to their GitHub installation for future operations

## User Flow

### Primary Flow (GitHub Browser)

1. User navigates to `/apps/import`
2. User selects a Workspace from dropdown
3. System checks for GitHub installations allowed for that workspace:
   - **One installation**: Auto-select it, show repo browser immediately
   - **Multiple installations**: Show installation picker (org name + avatar), then repo browser
   - **No installations**: Show manual URL input with hint to install GitHub App
4. User searches/browses repositories in flat searchable list
5. User clicks a repository to select it
6. Form auto-fills Application Name from repo name
7. User optionally edits name, adds description
8. User clicks "Import Repository"

### Fallback Flow (Manual URL)

- Below the repo browser, a link: "Or enter a repository URL manually"
- Clicking expands to show the URL input field (like current form)
- Works for public repos without any GitHub installation

## API & Server Actions

### New: `getWorkspaceGitHubInstallations`

```typescript
async function getWorkspaceGitHubInstallations(workspaceId: string): Promise<{
  installations: Array<{
    id: string
    accountLogin: string
    accountAvatarUrl: string
    accountType: 'Organization' | 'User'
  }>
}>
```

- Input: `workspaceId`
- Returns: List of GitHub installations allowed for that workspace

### New: `listInstallationRepositories`

```typescript
async function listInstallationRepositories(
  installationId: string,
  page?: number,      // default 1
  perPage?: number    // default 30
): Promise<{
  repos: Array<{
    name: string
    fullName: string
    description: string | null
    private: boolean
    defaultBranch: string
  }>
  hasMore: boolean
}>
```

- Uses existing `getInstallationOctokit()` to get authenticated client
- Calls GitHub API to list repos accessible to the installation

### New: `searchInstallationRepositories`

```typescript
async function searchInstallationRepositories(
  installationId: string,
  query: string
): Promise<{
  repos: Array<{...}>  // same shape as above
  hasMore: boolean
}>
```

- Searches all repos accessible to the installation matching query

### Updated: `importRepository`

- Add optional `installationId` parameter
- When provided, store it on the App record (`repository.installationId`)
- This links the app to its GitHub installation for future operations

## Frontend Components

### Modified: `ImportAppForm.tsx`

New internal state:

```typescript
interface ImportFormState {
  selectedInstallation: Installation | null
  availableInstallations: Installation[]
  showManualInput: boolean  // default false
  repos: Repository[]
  repoSearchQuery: string
  isLoadingRepos: boolean
  selectedRepo: Repository | null
}
```

Conditional rendering based on installation availability and manual mode toggle.

### New: `RepositoryBrowser`

```typescript
interface RepositoryBrowserProps {
  installationId: string
  onSelect: (repo: Repository) => void
  isLoading: boolean
}
```

Renders:
- Search input field at top
- Scrollable list of repository cards (name, private/public badge, description truncated)
- "Load more" button when `hasMore` is true
- Loading skeleton while fetching
- Empty state: "No repositories found"

Search behavior:
- Filter loaded repos client-side first
- If no matches and query length > 2, show "Search all repositories" button
- Button triggers `searchInstallationRepositories` server action

### New: `InstallationPicker`

```typescript
interface InstallationPickerProps {
  installations: Installation[]
  selected: Installation | null
  onSelect: (installation: Installation) => void
}
```

Renders:
- Dropdown with org avatar + account name for each installation
- Only rendered when `installations.length > 1`

## Form Layout

### When installations exist:

```
┌─────────────────────────────────────────────────┐
│ Import Repository                               │
│ Add an existing repository to your catalog.     │
├─────────────────────────────────────────────────┤
│ Workspace                                       │
│ [Engineering                              ▼]    │
│                                                 │
│ GitHub Installation          (only if multiple) │
│ [acme-org                                 ▼]    │
│                                                 │
│ Repository                                      │
│ [🔍 Search repositories...                  ]   │
│ ┌─────────────────────────────────────────────┐ │
│ │ acme-api          (private)                 │ │
│ │ acme-web          (public)                  │ │
│ │ shared-utils      (private)                 │ │
│ │ ...                                         │ │
│ │ [Load more]                                 │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ Or enter a repository URL manually ▼            │
│                                                 │
│ Application Name                                │
│ [acme-api                                   ]   │
│                                                 │
│ Description (optional)                          │
│ [                                           ]   │
│                                                 │
│ [Cancel]  [Import Repository]                   │
└─────────────────────────────────────────────────┘
```

### When no installations exist:

- Workspace dropdown shown
- Info box: "No GitHub integrations available. Install a GitHub App in Settings, or enter a URL manually."
- Manual URL input shown by default (expanded)
- Rest of form as current

## Error Handling

### Error Scenarios

1. **Installation token expired**
   - Show inline error: "GitHub connection expired. Reconnect in Settings."
   - Link to `/settings/github`

2. **GitHub API rate limit**
   - Show: "GitHub API limit reached. Try again in a few minutes."
   - Disable search temporarily

3. **No repos accessible**
   - If installation has `repositorySelection: 'selected'` and empty list
   - Show: "No repositories available. Update GitHub App permissions to add repositories."

4. **Search returns no results**
   - Show: "No repositories matching '[query]'"
   - Option to clear search

5. **Network failure during repo load**
   - Show retry button inline

### Edge Cases

1. **User changes workspace after selecting repo**
   - Reset `selectedInstallation`, `repos`, and `selectedRepo`
   - Re-fetch installations for new workspace

2. **User expands manual input after selecting repo**
   - Keep the selected repo visible but grayed
   - If they type a URL, clear the repo selection

3. **Repo already imported** (nice-to-have, not v1)
   - Could show "(already imported)" badge on repos that exist in current workspace

## Files to Modify/Create

| File | Action |
|------|--------|
| `orbit-www/src/app/actions/github.ts` | Create - new server actions |
| `orbit-www/src/components/features/apps/ImportAppForm.tsx` | Modify - integrate browser |
| `orbit-www/src/components/features/apps/RepositoryBrowser.tsx` | Create - new component |
| `orbit-www/src/components/features/apps/InstallationPicker.tsx` | Create - new component |

## Implementation Notes

- Use existing `getInstallationOctokit()` from `orbit-www/src/lib/github/octokit.ts`
- GitHub installations are stored in `GitHubInstallations` collection with `allowedWorkspaces` relationship
- Apps collection already has `repository.installationId` field available
