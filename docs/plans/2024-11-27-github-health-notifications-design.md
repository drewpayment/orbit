# GitHub Health Notifications Design

## Overview

Notify users when their GitHub App installation has token issues that require manual intervention. Uses a persistent toast notification with SessionStorage-based dismissal.

## Problem

When Docker restarts or the Temporal token refresh workflow fails, users have no indication that their GitHub integration is broken. They only discover this when attempting to use a feature (like template instantiation) and the org dropdown is empty.

## Solution

1. **Enhanced API** - `getGitHubHealth` server action returns diagnostic context
2. **Persistent Toast** - Global notification when token issues detected
3. **Background Polling** - Check every 5 minutes while app is open

## Data Model

### GitHubHealthStatus

```typescript
interface GitHubHealthStatus {
  healthy: boolean
  installations: Array<{
    id: string
    accountLogin: string
    accountType: 'User' | 'Organization'
    avatarUrl?: string
    tokenValid: boolean      // status === 'active' && tokenExpiresAt > now
    workspaceLinked: boolean // for context, not a health issue
  }>
  // Filtered to healthy + workspace-linked installations
  availableOrgs: GitHubOrg[]
}
```

### Health Check Logic

Token is valid when:
- `status === 'active'`
- `tokenExpiresAt > Date.now()`

No Temporal API calls required - just a database read.

## Architecture

### React Context

```typescript
interface GitHubHealthContext {
  health: GitHubHealthStatus | null
  isLoading: boolean
  lastChecked: Date | null
  dismissedUntil: string | null  // ISO timestamp or null
  dismiss: (duration: 'session' | '1hour' | '24hours') => void
  refresh: () => Promise<void>
}
```

### Provider Placement

```tsx
// app/(frontend)/layout.tsx
<AuthProvider>
  <GitHubHealthProvider>
    {children}
    <GitHubHealthToast />
  </GitHubHealthProvider>
</AuthProvider>
```

### Polling Behavior

- **Interval**: Every 5 minutes
- **Skip if dismissed**: Respects user's dismissal duration
- **Storage**: `dismissedUntil` stored in SessionStorage (clears on tab close)
- **Auth-gated**: Only polls for logged-in users

## Toast UX

### Visual Design

```
┌─────────────────────────────────────────────────────────┐
│ ⚠️  GitHub Connection Issue                         ✕  │
│                                                         │
│  Your GitHub token for "drewpayment" has expired.      │
│  Repository operations will fail until resolved.        │
│                                                         │
│  [Refresh Token]  [Go to Settings]  [Dismiss ▾]        │
└─────────────────────────────────────────────────────────┘
```

### Behaviors

- **Position**: Bottom-right, above other toasts (Sonner persistent toast)
- **Dismiss options**: "For this session", "For 1 hour", "For 24 hours"
- **Auto-clear**: Disappears when health check passes
- **Multiple installations**: Shows "2 GitHub connections need attention" with settings link

### SessionStorage

Key: `orbit:github-health-dismissed`

Value: ISO timestamp string of when dismissal expires, or `"session"` for session-only

## Files to Create/Modify

### New Files

1. `orbit-www/src/contexts/GitHubHealthContext.tsx` - Provider and context
2. `orbit-www/src/components/GitHubHealthToast.tsx` - Toast component

### Modified Files

1. `orbit-www/src/app/actions/templates.ts` - Add `getGitHubHealth` action
2. `orbit-www/src/app/(frontend)/layout.tsx` - Wrap with provider
3. `orbit-www/src/app/(frontend)/templates/[slug]/use/page.tsx` - Use enhanced diagnostic info

## Future Considerations

- Could extend to other integration health checks (future integrations)
- Could add "Don't show again" option with localStorage
- Could integrate with a more comprehensive notification system
