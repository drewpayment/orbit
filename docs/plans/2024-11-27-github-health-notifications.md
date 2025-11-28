# GitHub Health Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Notify users when their GitHub App installation has expired tokens via persistent toast notifications.

**Architecture:** React Context provider wraps the app and polls a server action every 5 minutes. Toast component reads context and displays persistent notification. Dismissal state stored in SessionStorage.

**Tech Stack:** Next.js Server Actions, React Context, Sonner toast library, SessionStorage

---

## Task 1: Create getGitHubHealth Server Action

**Files:**
- Modify: `orbit-www/src/app/actions/templates.ts`

**Step 1: Add GitHubHealthStatus type**

Add after the existing `GitHubOrg` interface (around line 1215):

```typescript
export interface GitHubInstallationHealth {
  id: string
  accountLogin: string
  accountType: 'User' | 'Organization'
  avatarUrl?: string
  tokenValid: boolean
  workspaceLinked: boolean
}

export interface GitHubHealthStatus {
  healthy: boolean
  installations: GitHubInstallationHealth[]
  availableOrgs: GitHubOrg[]
}
```

**Step 2: Create getGitHubHealth function**

Add after `getAvailableOrgs` function:

```typescript
export async function getGitHubHealth(workspaceId: string): Promise<GitHubHealthStatus> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { healthy: true, installations: [], availableOrgs: [] }
  }

  const payload = await getPayload({ config })

  // Check workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return { healthy: true, installations: [], availableOrgs: [] }
  }

  // Get ALL GitHub installations (not filtered by workspace)
  const allInstallations = await payload.find({
    collection: 'github-installations',
    where: {
      status: { not_equals: 'suspended' },
    },
    limit: 100,
  })

  const now = new Date()
  const installations: GitHubInstallationHealth[] = allInstallations.docs.map(inst => {
    const tokenExpiresAt = inst.tokenExpiresAt ? new Date(inst.tokenExpiresAt) : null
    const tokenValid = inst.status === 'active' && tokenExpiresAt !== null && tokenExpiresAt > now

    const allowedWorkspaceIds = (inst.allowedWorkspaces || []).map((w: any) =>
      typeof w === 'string' ? w : w.id
    )
    const workspaceLinked = allowedWorkspaceIds.includes(workspaceId)

    return {
      id: inst.id as string,
      accountLogin: inst.accountLogin,
      accountType: inst.accountType as 'User' | 'Organization',
      avatarUrl: inst.accountAvatarUrl || undefined,
      tokenValid,
      workspaceLinked,
    }
  })

  // Check if any installation has invalid token
  const hasInvalidToken = installations.some(inst => !inst.tokenValid)

  // Available orgs are only those with valid tokens AND linked to workspace
  const availableOrgs: GitHubOrg[] = installations
    .filter(inst => inst.tokenValid && inst.workspaceLinked)
    .map(inst => ({
      name: inst.accountLogin,
      avatarUrl: inst.avatarUrl,
      installationId: inst.id,
    }))

  return {
    healthy: !hasInvalidToken,
    installations,
    availableOrgs,
  }
}
```

**Step 3: Commit**

```bash
git add orbit-www/src/app/actions/templates.ts
git commit -m "feat: add getGitHubHealth server action for token status checking"
```

---

## Task 2: Create GitHubHealthContext

**Files:**
- Create: `orbit-www/src/contexts/GitHubHealthContext.tsx`

**Step 1: Create the context file**

```typescript
'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { getGitHubHealth, type GitHubHealthStatus } from '@/app/actions/templates'

const POLL_INTERVAL = 5 * 60 * 1000 // 5 minutes
const STORAGE_KEY = 'orbit:github-health-dismissed'

interface GitHubHealthContextType {
  health: GitHubHealthStatus | null
  isLoading: boolean
  lastChecked: Date | null
  dismissedUntil: Date | null
  dismiss: (duration: 'session' | '1hour' | '24hours') => void
  refresh: () => Promise<void>
}

const GitHubHealthContext = createContext<GitHubHealthContextType | null>(null)

export function useGitHubHealth() {
  const context = useContext(GitHubHealthContext)
  if (!context) {
    throw new Error('useGitHubHealth must be used within GitHubHealthProvider')
  }
  return context
}

interface GitHubHealthProviderProps {
  children: React.ReactNode
  workspaceId: string | null
}

export function GitHubHealthProvider({ children, workspaceId }: GitHubHealthProviderProps) {
  const [health, setHealth] = useState<GitHubHealthStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [dismissedUntil, setDismissedUntil] = useState<Date | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // Load dismissed state from SessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (stored) {
      if (stored === 'session') {
        // Session dismissal - already dismissed for this session
        setDismissedUntil(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)) // Far future
      } else {
        const dismissedDate = new Date(stored)
        if (dismissedDate > new Date()) {
          setDismissedUntil(dismissedDate)
        } else {
          // Expired, remove from storage
          sessionStorage.removeItem(STORAGE_KEY)
        }
      }
    }
  }, [])

  const checkHealth = useCallback(async () => {
    if (!workspaceId) return

    // Skip if dismissed
    if (dismissedUntil && dismissedUntil > new Date()) {
      return
    }

    setIsLoading(true)
    try {
      const result = await getGitHubHealth(workspaceId)
      setHealth(result)
      setLastChecked(new Date())

      // If health is now good, clear any dismissal
      if (result.healthy) {
        setDismissedUntil(null)
        sessionStorage.removeItem(STORAGE_KEY)
      }
    } catch (error) {
      console.error('[GitHubHealth] Failed to check health:', error)
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, dismissedUntil])

  const dismiss = useCallback((duration: 'session' | '1hour' | '24hours') => {
    let until: Date

    if (duration === 'session') {
      sessionStorage.setItem(STORAGE_KEY, 'session')
      until = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // Far future for session
    } else if (duration === '1hour') {
      until = new Date(Date.now() + 60 * 60 * 1000)
      sessionStorage.setItem(STORAGE_KEY, until.toISOString())
    } else {
      until = new Date(Date.now() + 24 * 60 * 60 * 1000)
      sessionStorage.setItem(STORAGE_KEY, until.toISOString())
    }

    setDismissedUntil(until)
  }, [])

  const refresh = useCallback(async () => {
    // Clear dismissal and force refresh
    setDismissedUntil(null)
    sessionStorage.removeItem(STORAGE_KEY)
    await checkHealth()
  }, [checkHealth])

  // Initial check and polling
  useEffect(() => {
    if (!workspaceId) return

    // Initial check
    checkHealth()

    // Set up polling
    intervalRef.current = setInterval(checkHealth, POLL_INTERVAL)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [workspaceId, checkHealth])

  return (
    <GitHubHealthContext.Provider
      value={{
        health,
        isLoading,
        lastChecked,
        dismissedUntil,
        dismiss,
        refresh,
      }}
    >
      {children}
    </GitHubHealthContext.Provider>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/contexts/GitHubHealthContext.tsx
git commit -m "feat: add GitHubHealthContext with 5-minute polling and SessionStorage dismissal"
```

---

## Task 3: Create GitHubHealthToast Component

**Files:**
- Create: `orbit-www/src/components/GitHubHealthToast.tsx`

**Step 1: Create the toast component**

```typescript
'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useGitHubHealth } from '@/contexts/GitHubHealthContext'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AlertTriangle, ChevronDown, ExternalLink, RefreshCw } from 'lucide-react'

const TOAST_ID = 'github-health-toast'

export function GitHubHealthToast() {
  const { health, dismissedUntil, dismiss, refresh } = useGitHubHealth()
  const toastShownRef = useRef(false)

  useEffect(() => {
    // Don't show if dismissed
    if (dismissedUntil && dismissedUntil > new Date()) {
      toast.dismiss(TOAST_ID)
      toastShownRef.current = false
      return
    }

    // Don't show if healthy or no data yet
    if (!health || health.healthy) {
      toast.dismiss(TOAST_ID)
      toastShownRef.current = false
      return
    }

    // Find installations with invalid tokens
    const invalidInstallations = health.installations.filter(inst => !inst.tokenValid)

    if (invalidInstallations.length === 0) {
      toast.dismiss(TOAST_ID)
      toastShownRef.current = false
      return
    }

    // Show persistent toast
    if (!toastShownRef.current) {
      toastShownRef.current = true

      const accountNames = invalidInstallations.map(i => i.accountLogin).join(', ')
      const message = invalidInstallations.length === 1
        ? `Your GitHub token for "${accountNames}" has expired.`
        : `${invalidInstallations.length} GitHub connections need attention.`

      toast.custom(
        (t) => (
          <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4 shadow-lg max-w-md">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-amber-900 dark:text-amber-100">
                  GitHub Connection Issue
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  {message}
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Repository operations will fail until resolved.
                </p>

                <div className="flex items-center gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-amber-300 dark:border-amber-700"
                    onClick={() => {
                      refresh()
                      toast.dismiss(t)
                      toastShownRef.current = false
                    }}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Refresh
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-amber-300 dark:border-amber-700"
                    onClick={() => {
                      window.location.href = '/settings/github'
                    }}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Settings
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-amber-700 dark:text-amber-300"
                      >
                        Dismiss
                        <ChevronDown className="h-3 w-3 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => {
                        dismiss('session')
                        toast.dismiss(t)
                        toastShownRef.current = false
                      }}>
                        For this session
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        dismiss('1hour')
                        toast.dismiss(t)
                        toastShownRef.current = false
                      }}>
                        For 1 hour
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        dismiss('24hours')
                        toast.dismiss(t)
                        toastShownRef.current = false
                      }}>
                        For 24 hours
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </div>
        ),
        {
          id: TOAST_ID,
          duration: Infinity,
          position: 'bottom-right',
        }
      )
    }
  }, [health, dismissedUntil, dismiss, refresh])

  return null
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/components/GitHubHealthToast.tsx
git commit -m "feat: add GitHubHealthToast component with persistent notification"
```

---

## Task 4: Get Current Workspace ID Helper

**Files:**
- Create: `orbit-www/src/lib/workspace.ts`

**Step 1: Create workspace helper**

We need a way to get the current workspace ID on the client. Create a simple helper:

```typescript
'use server'

import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return null
  }

  const payload = await getPayload({ config })

  // Get user's first active workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
  })

  if (membership.docs.length === 0) {
    return null
  }

  const workspace = membership.docs[0].workspace
  return typeof workspace === 'string' ? workspace : workspace.id
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/lib/workspace.ts
git commit -m "feat: add getCurrentWorkspaceId server helper"
```

---

## Task 5: Create Client Wrapper for Provider

**Files:**
- Create: `orbit-www/src/components/providers/GitHubHealthProviderWrapper.tsx`

**Step 1: Create client wrapper that fetches workspace ID**

```typescript
'use client'

import { useEffect, useState } from 'react'
import { GitHubHealthProvider } from '@/contexts/GitHubHealthContext'
import { GitHubHealthToast } from '@/components/GitHubHealthToast'
import { getCurrentWorkspaceId } from '@/lib/workspace'

interface GitHubHealthProviderWrapperProps {
  children: React.ReactNode
}

export function GitHubHealthProviderWrapper({ children }: GitHubHealthProviderWrapperProps) {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getCurrentWorkspaceId()
      .then(setWorkspaceId)
      .finally(() => setIsLoading(false))
  }, [])

  // Don't block rendering while loading workspace
  if (isLoading) {
    return <>{children}</>
  }

  return (
    <GitHubHealthProvider workspaceId={workspaceId}>
      {children}
      <GitHubHealthToast />
    </GitHubHealthProvider>
  )
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/components/providers/GitHubHealthProviderWrapper.tsx
git commit -m "feat: add GitHubHealthProviderWrapper client component"
```

---

## Task 6: Integrate Provider into Layout

**Files:**
- Modify: `orbit-www/src/app/(frontend)/layout.tsx`

**Step 1: Read current layout**

First, read the current layout to understand the structure.

**Step 2: Add GitHubHealthProviderWrapper**

Import and wrap with the provider. Add inside any existing providers but wrapping the main content:

```typescript
import { GitHubHealthProviderWrapper } from '@/components/providers/GitHubHealthProviderWrapper'
```

Then wrap the children:

```tsx
<GitHubHealthProviderWrapper>
  {children}
</GitHubHealthProviderWrapper>
```

**Step 3: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/layout.tsx
git commit -m "feat: integrate GitHubHealthProvider into frontend layout"
```

---

## Task 7: Update Template Use Page with Enhanced Diagnostics

**Files:**
- Modify: `orbit-www/src/app/(frontend)/templates/[slug]/use/page.tsx`
- Modify: `orbit-www/src/components/features/templates/UseTemplateForm.tsx`

**Step 1: Update page to pass diagnostic info**

Update the page to use `getGitHubHealth` instead of `getAvailableOrgs` and pass diagnostic info to the form.

**Step 2: Update UseTemplateForm to show helpful messages**

When no orgs available, show contextual message based on diagnostic info:
- No installations: "No GitHub App installed. [Install GitHub App]"
- Token expired: "GitHub token expired. [Go to Settings]"
- No workspace linked: "GitHub not linked to this workspace. [Configure]"

**Step 3: Commit**

```bash
git add orbit-www/src/app/\(frontend\)/templates/\[slug\]/use/page.tsx
git add orbit-www/src/components/features/templates/UseTemplateForm.tsx
git commit -m "feat: add diagnostic messages to template use page when no orgs available"
```

---

## Summary

| Task | Description | Estimated Complexity |
|------|-------------|---------------------|
| 1 | Server action `getGitHubHealth` | Medium |
| 2 | GitHubHealthContext with polling | Medium |
| 3 | GitHubHealthToast component | Medium |
| 4 | getCurrentWorkspaceId helper | Simple |
| 5 | GitHubHealthProviderWrapper | Simple |
| 6 | Integrate into layout | Simple |
| 7 | Update template use page | Medium |

Total: 7 tasks, ~45-60 minutes estimated implementation time.
