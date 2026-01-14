# App Settings Slide-out Panel

**Date:** 2025-12-13
**Status:** Design Complete

## Overview

Add settings functionality to the app detail page via a slide-out sheet panel. Users can edit app configuration, health checks, branch selection, and delete the app.

## UI Pattern

- **Trigger:** Settings button on AppDetail page header
- **Component:** Sheet (shadcn/ui) sliding from right with backdrop
- **Dismiss:** Click backdrop or X button (warns if unsaved changes)
- **Layout:** Single scrollable panel with 4 sections, form-level save button

## Sections

### 1. General
| Field | Type | Validation |
|-------|------|------------|
| name | Text input | Required, max 100 chars |
| description | Textarea | Optional, max 500 chars |

### 2. Health Check
| Field | Type | Validation |
|-------|------|------------|
| url | Text input | Optional, valid URL format |
| method | Select | GET, HEAD, POST (default: GET) |
| interval | Number | Min 30 seconds (default: 60) |
| timeout | Number | Min 1 second (default: 10) |
| expectedStatus | Number | Valid HTTP status (default: 200) |

All fields shown. Validation on save.

### 3. Repository
| Field | Type | Notes |
|-------|------|-------|
| URL | Read-only display | Shows `owner/repo` with external link, or "No repository linked" |
| branch | Searchable select | Fetches branches from GitHub API |

Branch dropdown:
- Uses app's `repository.installationId` to fetch branches
- Shows loading state while fetching
- If no installation linked: disabled with message "Link a GitHub installation to select branches"
- Searchable/filterable, but only allows selecting existing branches

### 4. Danger Zone
- Red-tinted background
- Heading: "Delete Application"
- Warning: "This action cannot be undone. This will permanently delete the app and all associated deployments."
- Type-to-confirm input: User must type exact app name
- Delete button: Disabled until input matches, triggers immediately (not part of main save)

## Panel Layout

```
┌─────────────────────────────────────────┐
│ Settings                            [X] │
├─────────────────────────────────────────┤
│                                         │
│ General                                 │
│ ─────────────────────────────────────── │
│ Name                                    │
│ [my-app                            ]    │
│                                         │
│ Description                             │
│ [                                  ]    │
│ [                                  ]    │
│                                         │
│ Health Check                            │
│ ─────────────────────────────────────── │
│ URL                                     │
│ [https://api.example.com/health    ]    │
│                                         │
│ Method              Interval (seconds)  │
│ [GET ▼]             [60            ]    │
│                                         │
│ Timeout (seconds)   Expected Status     │
│ [10             ]   [200           ]    │
│                                         │
│ Repository                              │
│ ─────────────────────────────────────── │
│ URL                                     │
│ drewpayment/cfp-stats ↗ (read-only)     │
│                                         │
│ Branch                                  │
│ [main                              ▼]   │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Danger Zone                         │ │
│ │ ─────────────────────────────────── │ │
│ │ Delete Application                  │ │
│ │ This action cannot be undone...     │ │
│ │                                     │ │
│ │ Type "my-app" to confirm            │ │
│ │ [                              ]    │ │
│ │                                     │ │
│ │ [Delete Application] (disabled)     │ │
│ └─────────────────────────────────────┘ │
│                                         │
├─────────────────────────────────────────┤
│              [Cancel] [Save Changes]    │
└─────────────────────────────────────────┘
```

## Server Actions

### `updateAppSettings`
```typescript
async function updateAppSettings(
  appId: string,
  data: {
    name: string
    description?: string
    healthConfig?: {
      url?: string
      method?: 'GET' | 'HEAD' | 'POST'
      interval?: number
      timeout?: number
      expectedStatus?: number
    }
    branch?: string
  }
): Promise<{ success: boolean; error?: string }>
```
- Validates workspace member access
- Updates app fields via Payload

### `getRepositoryBranches`
```typescript
async function getRepositoryBranches(
  installationId: string,
  owner: string,
  repo: string
): Promise<{ success: boolean; branches?: string[]; error?: string }>
```
- Fetches branches from GitHub API
- Uses installation token for authentication

### `deleteApp`
```typescript
async function deleteApp(
  appId: string,
  confirmName: string
): Promise<{ success: boolean; error?: string }>
```
- Validates confirmName matches app name exactly
- Deletes app (Payload cascades to deployments via hooks)
- Requires workspace owner/admin role

## Error Handling

- **Form validation:** Inline errors under fields (zod validation)
- **Server errors:** Toast notification
- **Unsaved changes:** Confirm dialog when dismissing with pending edits

## Success Feedback

- **Save:** Toast "Settings saved", panel closes
- **Delete:** Toast "App deleted", redirect to `/apps`

## Files to Create/Modify

| File | Action |
|------|--------|
| `orbit-www/src/components/features/apps/AppSettingsSheet.tsx` | Create - main settings panel |
| `orbit-www/src/components/features/apps/AppDetail.tsx` | Modify - wire up Settings button |
| `orbit-www/src/app/actions/apps.ts` | Modify - add updateAppSettings, deleteApp |
| `orbit-www/src/app/actions/github.ts` | Modify - add getRepositoryBranches |
