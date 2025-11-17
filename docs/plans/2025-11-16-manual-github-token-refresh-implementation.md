# Manual GitHub Token Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add on-demand token refresh capability to GitHub App installation workflow via signal handler and admin UI button.

**Architecture:** Extend existing `GitHubTokenRefreshWorkflow` with Temporal signal handler using Selector pattern to wait for either 50-minute timer or manual `trigger-refresh` signal. Add REST API endpoint and admin UI button to send signal to workflow.

**Tech Stack:** Go (Temporal workflows), TypeScript/Next.js (API + UI), React (admin button)

**Design Document:** `docs/plans/2025-11-16-manual-github-token-refresh-design.md`

---

## Task 1: Add Signal Handler to Workflow

**Files:**
- Modify: `temporal-workflows/internal/workflows/github_token_refresh_workflow.go:49-73`

### Step 1.1: Modify workflow to use Selector pattern

**Current Code (lines 49-73):**
```go
// Run indefinitely until workflow is cancelled
for {
    // Sleep for 50 minutes (10 min before token expires)
    err := workflow.Sleep(ctx, 50*time.Minute)
    if err != nil {
        // Workflow cancelled (app uninstalled)
        logger.Info("Workflow cancelled, stopping token refresh", "error", err)
        return err
    }

    // Refresh token
    var result RefreshTokenResult
    err = workflow.ExecuteActivity(ctx, "RefreshGitHubInstallationTokenActivity", input.InstallationID).Get(ctx, &result)

    if err != nil {
        logger.Error("Token refresh failed", "error", err)
        // Update status but continue trying
        workflow.ExecuteActivity(ctx, "UpdateInstallationStatusActivity", input.InstallationID, "refresh_failed", err.Error())
    } else {
        logger.Info("Token refresh succeeded", "expiresAt", result.ExpiresAt)
        // Update status to active
        workflow.ExecuteActivity(ctx, "UpdateInstallationStatusActivity", input.InstallationID, "active", "")
    }
}
```

**Replace with:**
```go
// Setup signal channel for manual refresh triggers
refreshSignal := workflow.GetSignalChannel(ctx, "trigger-refresh")

// Run indefinitely until workflow is cancelled
for {
    // Create selector to wait for either timer or signal
    selector := workflow.NewSelector(ctx)

    // Add 50-minute timer branch
    timerFuture := workflow.NewTimer(ctx, 50*time.Minute)
    selector.AddFuture(timerFuture, func(f workflow.Future) {
        logger.Info("Timer fired (50 min elapsed), refreshing token")
    })

    // Add manual refresh signal branch
    selector.AddReceive(refreshSignal, func(c workflow.ReceiveChannel, more bool) {
        logger.Info("Manual refresh signal received, triggering immediate refresh")
    })

    // Wait for either timer or signal
    selector.Select(ctx)

    // Refresh token (same logic as before)
    var result RefreshTokenResult
    err = workflow.ExecuteActivity(ctx, "RefreshGitHubInstallationTokenActivity", input.InstallationID).Get(ctx, &result)

    if err != nil {
        logger.Error("Token refresh failed", "error", err)
        // Update status but continue trying
        workflow.ExecuteActivity(ctx, "UpdateInstallationStatusActivity", input.InstallationID, "refresh_failed", err.Error())
    } else {
        logger.Info("Token refresh succeeded", "expiresAt", result.ExpiresAt)
        // Update status to active
        workflow.ExecuteActivity(ctx, "UpdateInstallationStatusActivity", input.InstallationID, "active", "")
    }
}
```

### Step 1.2: Verify Go code compiles

Run:
```bash
cd temporal-workflows
go build ./internal/workflows/
```

Expected: No compilation errors

### Step 1.3: Commit workflow changes

```bash
git add temporal-workflows/internal/workflows/github_token_refresh_workflow.go
git commit -m "feat: add signal handler for manual token refresh

- Replace workflow.Sleep with workflow.NewSelector
- Add refreshSignal channel listening for 'trigger-refresh'
- Support both automatic (50-min timer) and manual (signal) refresh
- Log source of refresh trigger (timer vs signal)

Enables on-demand testing without waiting 50 minutes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Create API Endpoint for Triggering Refresh

**Files:**
- Create: `orbit-www/src/app/api/github/installations/[id]/refresh/route.ts`

### Step 2.1: Create API route file

Create file: `orbit-www/src/app/api/github/installations/[id]/refresh/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { getTemporalClient } from '@/lib/temporal/client'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Get Payload instance
    const payload = await getPayload({ config: configPromise })

    // TODO: Add auth check - verify user is admin
    // const user = await getUser(request)
    // if (user.role !== 'admin') {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    // }

    // Get installation to verify it exists
    const installation = await payload.findByID({
      collection: 'github-installations',
      id: params.id,
    })

    if (!installation) {
      return NextResponse.json(
        { error: 'Installation not found' },
        { status: 404 }
      )
    }

    // Check if workflow is running
    if (installation.temporalWorkflowStatus !== 'running') {
      return NextResponse.json(
        {
          error: 'Token refresh workflow is not running',
          status: installation.temporalWorkflowStatus
        },
        { status: 400 }
      )
    }

    // Send signal to workflow
    const client = await getTemporalClient()
    const workflowId = installation.temporalWorkflowId || `github-token-refresh:${params.id}`

    try {
      const handle = client.workflow.getHandle(workflowId)
      await handle.signal('trigger-refresh')
    } catch (workflowError) {
      console.error('[GitHub Token Refresh] Failed to signal workflow:', workflowError)
      return NextResponse.json(
        {
          error: 'Failed to signal workflow',
          details: workflowError.message
        },
        { status: 500 }
      )
    }

    console.log('[GitHub Token Refresh] Manual refresh triggered for installation:', params.id)

    return NextResponse.json({
      status: 'success',
      message: 'Token refresh triggered. Check Temporal UI for results.',
      workflowId,
    })

  } catch (error) {
    console.error('[GitHub Token Refresh] Failed to trigger refresh:', error)
    return NextResponse.json(
      {
        error: 'Failed to trigger token refresh',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
```

### Step 2.2: Test API endpoint compiles

Run:
```bash
cd orbit-www
bun run build
```

Expected: No TypeScript errors

### Step 2.3: Commit API endpoint

```bash
git add orbit-www/src/app/api/github/installations/[id]/refresh/route.ts
git commit -m "feat: add API endpoint for manual token refresh

- Create POST /api/github/installations/:id/refresh endpoint
- Verify installation exists and workflow is running
- Send 'trigger-refresh' signal to Temporal workflow
- Return clear error messages for common failure cases
- Log all manual refresh triggers for audit trail

Next: Add UI button to trigger endpoint.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Add UI Button to GitHub Settings Page

**Files:**
- Modify: `orbit-www/src/app/(frontend)/settings/github/github-settings-client.tsx`

### Step 3.1: Add refresh state and handler to InstallationCard

Find the `InstallationCard` component and add state at the top:

**Add after component definition:**
```typescript
function InstallationCard({ installation }: { installation: any }) {
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshResult, setLastRefreshResult] = useState<string | null>(null)

  async function handleManualRefresh() {
    setRefreshing(true)
    setLastRefreshResult(null)

    try {
      const res = await fetch(`/api/github/installations/${installation.id}/refresh`, {
        method: 'POST',
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Refresh failed')
      }

      setLastRefreshResult('✅ Refresh triggered successfully. Check Temporal UI for results.')

      // Refresh installation data after a few seconds
      setTimeout(() => {
        window.location.reload()
      }, 3000)

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setLastRefreshResult(`❌ Failed: ${errorMessage}`)
    } finally {
      setRefreshing(false)
    }
  }

  // ... existing component code ...
```

### Step 3.2: Add button to InstallationCard UI

Find the section with existing buttons (likely near "Configure" button) and add:

**Add before closing div of button container:**
```typescript
<div className="mt-4 flex items-center gap-3">
  <Button
    onClick={handleManualRefresh}
    disabled={refreshing || installation.temporalWorkflowStatus !== 'running'}
    variant="secondary"
    size="sm"
  >
    {refreshing ? (
      <>⏳ Refreshing...</>
    ) : (
      <>🔄 Test Refresh Now</>
    )}
  </Button>

  {lastRefreshResult && (
    <span className="text-sm">{lastRefreshResult}</span>
  )}
</div>
```

### Step 3.3: Add useState import if missing

At the top of the file, ensure useState is imported:

```typescript
import { useState } from 'react'
```

### Step 3.4: Verify UI compiles

Run:
```bash
cd orbit-www
bun run build
```

Expected: No TypeScript or React errors

### Step 3.5: Commit UI changes

```bash
git add orbit-www/src/app/(frontend)/settings/github/github-settings-client.tsx
git commit -m "feat: add manual token refresh button to GitHub settings

- Add 'Test Refresh Now' button to InstallationCard component
- Show loading state while triggering refresh
- Display success/error messages inline
- Disable button when workflow not running
- Auto-reload page after successful trigger

Completes manual refresh testing capability.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: End-to-End Testing

**Prerequisites:**
- Temporal server running (http://localhost:7233)
- Temporal UI accessible (http://localhost:8080)
- Frontend dev server running (http://localhost:3000)
- At least one GitHub installation with workflow running

### Step 4.1: Verify Temporal worker is running with new workflow code

**Important:** The Temporal worker must be restarted to pick up workflow changes.

Run:
```bash
# Stop existing worker (if running)
# Rebuild and restart worker
cd temporal-workflows
go build -o bin/worker ./cmd/worker
./bin/worker
```

Expected: Worker starts without errors and registers activities

### Step 4.2: Navigate to GitHub settings in browser

Open: http://localhost:3000/settings/github

Expected: See list of GitHub installations with "Test Refresh Now" button

### Step 4.3: Click "Test Refresh Now" button

1. Click the button on an installation card
2. Observe button text changes to "⏳ Refreshing..."
3. Wait for response

Expected:
- Success message: "✅ Refresh triggered successfully. Check Temporal UI for results."
- Page reloads after 3 seconds

### Step 4.4: Verify signal in Temporal UI

1. Open: http://localhost:8080
2. Find workflow: `github-token-refresh:<installation-id>`
3. Click "Events" tab
4. Look for recent events

Expected Events (in order):
- `SignalReceived` - name: "trigger-refresh"
- `ActivityTaskScheduled` - activity: "RefreshGitHubInstallationTokenActivity"
- `ActivityTaskCompleted` - indicates success

**If you see `ActivityTaskFailed`:**
- Click on the failed activity event
- Read the error message
- Common issues:
  - GitHub credentials not configured
  - Installation ID type mismatch
  - Encryption key not set
  - Database connection issue

### Step 4.5: Verify database updates

1. Open Payload admin: http://localhost:3000/admin
2. Navigate to Collections > GitHub Installations
3. Find the installation you triggered refresh for
4. Check fields:

Expected Updates:
- `tokenLastRefreshedAt` - Should be current timestamp (within last minute)
- `tokenExpiresAt` - Should be ~1 hour from now
- `status` - Should be "active" (if successful)
- `installationToken` - Value should have changed (new encrypted token)

### Step 4.6: Test error scenarios

**Test 1: Workflow not running**
1. Find installation with `temporalWorkflowStatus` = "stopped"
2. Click "Test Refresh Now" button
3. Expected: Button should be disabled

**Test 2: Invalid installation ID**
1. Try to POST to `/api/github/installations/invalid-id/refresh`
2. Expected: 404 error "Installation not found"

**Test 3: Rapid clicking (rate limiting)**
1. Click "Test Refresh Now" multiple times quickly
2. Expected: Button disabled after first click
3. Temporal queues signals (each triggers one refresh)

### Step 4.7: Document test results

Create a test summary in the plan:

```markdown
## Test Results (YYYY-MM-DD)

✅ Signal handler added to workflow
✅ API endpoint responds correctly
✅ UI button triggers refresh
✅ Temporal UI shows SignalReceived event
✅ Activity executes successfully
✅ Database updates with new token
✅ Error handling works as expected

**Issues Found:**
- [None] or [List any issues discovered]

**Next Steps:**
- [Any follow-up work needed]
```

---

## Task 5: Update Documentation

**Files:**
- Modify: `docs/plans/2025-11-13-github-app-installation.md`

### Step 5.1: Update Task 6 status in GitHub App installation plan

Find Task 6 in the plan and update status:

**Change:**
```markdown
### Task 6: Implement Token Refresh Workflow (Go) ✅ COMPLETE
```

**To:**
```markdown
### Task 6: Implement Token Refresh Workflow (Go) ✅ COMPLETE + ENHANCED

**Enhancement (2025-11-16):** Added manual refresh signal handler
- See: `docs/plans/2025-11-16-manual-github-token-refresh-implementation.md`
- Enables on-demand testing via admin UI button
- No waiting for 50-minute timer during development
```

### Step 5.2: Commit documentation update

```bash
git add docs/plans/2025-11-13-github-app-installation.md
git commit -m "docs: update GitHub app plan with manual refresh enhancement

Reference new manual refresh implementation plan.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Optional - Add Rate Limiting (Production Hardening)

**Skip this task if you want to test immediately. Can be added later.**

**Files:**
- Create: `orbit-www/src/lib/rate-limit.ts`
- Modify: `orbit-www/src/app/api/github/installations/[id]/refresh/route.ts`

### Step 6.1: Create simple in-memory rate limiter

Create file: `orbit-www/src/lib/rate-limit.ts`

```typescript
// Simple in-memory rate limiter
// For production, use Redis or similar distributed store

interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimits = new Map<string, RateLimitEntry>()

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = rateLimits.get(key)

  // Clean up expired entries
  if (entry && entry.resetAt < now) {
    rateLimits.delete(key)
  }

  const current = rateLimits.get(key)

  if (!current) {
    // First request in window
    rateLimits.set(key, {
      count: 1,
      resetAt: now + windowMs,
    })
    return true
  }

  if (current.count >= maxRequests) {
    // Rate limit exceeded
    return false
  }

  // Increment count
  current.count++
  return true
}

export function getRateLimitInfo(key: string): { remaining: number; resetAt: number } | null {
  const entry = rateLimits.get(key)
  if (!entry) return null

  return {
    remaining: Math.max(0, 5 - entry.count), // Assuming max 5 requests
    resetAt: entry.resetAt,
  }
}
```

### Step 6.2: Add rate limiting to API endpoint

Modify the API route to add rate limiting at the start:

```typescript
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Rate limit: 1 refresh per minute per installation
  const rateLimitKey = `github-refresh:${params.id}`
  const allowed = checkRateLimit(rateLimitKey, 1, 60000) // 1 request per 60 seconds

  if (!allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded. Please wait 1 minute between manual refreshes.',
      },
      { status: 429 }
    )
  }

  try {
    // ... rest of existing code ...
```

### Step 6.3: Import rate limiter

Add import at top of route file:

```typescript
import { checkRateLimit } from '@/lib/rate-limit'
```

### Step 6.4: Test rate limiting

1. Click "Test Refresh Now"
2. Immediately click again
3. Expected: 429 error "Rate limit exceeded"

### Step 6.5: Commit rate limiting

```bash
git add orbit-www/src/lib/rate-limit.ts
git add orbit-www/src/app/api/github/installations/[id]/refresh/route.ts
git commit -m "feat: add rate limiting to manual token refresh

- Limit to 1 refresh per minute per installation
- Prevent accidental spam/abuse
- Return 429 status when limit exceeded
- In-memory implementation (TODO: Redis for production)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Verification Checklist

Before considering this complete, verify:

- [ ] Workflow code compiles without errors
- [ ] API endpoint responds to POST requests
- [ ] UI button appears in GitHub settings page
- [ ] Clicking button shows loading state
- [ ] Temporal UI shows `SignalReceived` event
- [ ] Activity executes (check for `ActivityTaskCompleted` or `ActivityTaskFailed`)
- [ ] Database updates after successful refresh
- [ ] Error messages are clear and helpful
- [ ] Rate limiting prevents spam (if implemented)
- [ ] All code committed with clear messages

## Troubleshooting Common Issues

### Issue: "Workflow not found" error when sending signal

**Cause:** Workflow ID doesn't match or workflow not running

**Fix:**
1. Check `temporalWorkflowId` field in database
2. Verify workflow is running in Temporal UI
3. Restart workflow if needed

### Issue: Activity fails with "failed to fetch installation"

**Cause:** Installation ID doesn't exist or wrong type

**Fix:**
1. Verify installation exists in `github-installations` collection
2. Check `installationId` field type (should be string for Payload ID)
3. Ensure PayloadClient implementation is correct

### Issue: Activity fails with "failed to create token"

**Cause:** GitHub API authentication issue

**Fix:**
1. Verify `GITHUB_APP_ID` environment variable set
2. Verify `GITHUB_APP_PRIVATE_KEY_PATH` or `GITHUB_APP_PRIVATE_KEY_BASE64` set
3. Check GitHub App not suspended
4. Verify installation ID is correct GitHub installation ID (number)

### Issue: Activity fails with "failed to encrypt token"

**Cause:** Encryption key not configured

**Fix:**
1. Generate encryption key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
2. Set `ENCRYPTION_KEY` environment variable
3. Restart Temporal worker

### Issue: Button doesn't appear or is always disabled

**Cause:** React state or condition issue

**Fix:**
1. Check browser console for React errors
2. Verify `temporalWorkflowStatus` field in database is "running"
3. Check button condition logic in component

## Success Criteria

✅ **Complete when:**
1. Clicking "Test Refresh Now" button triggers immediate token refresh
2. Temporal UI shows `SignalReceived` and `ActivityTaskCompleted` events
3. Database `tokenLastRefreshedAt` field updates to current time
4. No errors in Temporal worker logs
5. Clear success/error messages displayed in UI
6. All code committed with descriptive messages

## Next Steps After Implementation

1. **Debug Current Failures:**
   - Now that you can trigger refresh on-demand
   - Check actual error message in Temporal UI
   - Fix underlying issue (credentials, permissions, etc.)
   - Test again immediately

2. **Production Considerations:**
   - Add admin-only authentication to API endpoint
   - Implement distributed rate limiting (Redis)
   - Add audit logging for all manual refreshes
   - Monitor refresh success rate in production

3. **Future Enhancements:**
   - Add refresh history UI (last 10 attempts)
   - Real-time status updates via WebSocket
   - Batch refresh for all installations
   - Scheduled manual refreshes

---

**Plan Status:** Ready for execution
**Estimated Time:** 30-45 minutes (excluding optional Task 6)
**Complexity:** Low-Medium (mostly straightforward integration work)
