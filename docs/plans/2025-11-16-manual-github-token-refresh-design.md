# Manual GitHub Token Refresh Testing Design

**Created**: 2025-11-16
**Status**: Design Complete - Ready for Implementation
**Context**: GitHub App Installation workflow token refresh testing

## Problem Statement

The GitHub App installation token refresh workflow runs on a 50-minute timer, making it difficult to test in real-time during development. Activity failures have been observed in the Temporal UI when the timer fires, but the 50-minute wait makes debugging slow and inefficient.

**Current Behavior**:
- Token refresh workflow sleeps for 50 minutes between refreshes
- Activity failures visible in Temporal UI at http://localhost:8080
- No way to trigger refresh on-demand for testing
- Debugging requires waiting for natural timer to fire

## Design Goals

1. Enable on-demand token refresh testing without waiting 50 minutes
2. Test within real workflow context (not bypass workflow logic)
3. Provide admin-friendly UI for triggering manual refreshes
4. Keep solution production-ready (useful beyond testing)
5. Preserve existing 50-minute automatic refresh behavior

## Solution: Workflow Signal Handler

### Architecture

Add a Temporal signal handler to the `GitHubTokenRefreshWorkflow` that allows triggering an immediate token refresh while preserving the existing timer-based behavior.

**Components**:
1. **Workflow Signal Handler** - Listens for `trigger-refresh` signal
2. **Admin API Endpoint** - REST endpoint to send signal to workflow
3. **UI Button** - Admin interface button to trigger refresh
4. **Monitoring** - Temporal UI, database, and logs for verification

### Design Decision: Signal-Based Approach

**Chosen**: Workflow signal handler with admin UI button

**Alternatives Considered**:
- ❌ Reduce timer duration (1-2 min) - Requires code changes, not production-ready
- ❌ Direct activity trigger via CLI - Bypasses workflow context
- ❌ Environment variable override - Less discoverable, requires restart
- ❌ Temporal query + manual inspection - Still requires waiting for timer

**Why Signal-Based**:
- Tests within real workflow context
- No disruption to production behavior
- Reusable admin tool
- No waiting required
- Production-ready

## Implementation Details

### 1. Workflow Modifications

**File**: `temporal-workflows/internal/workflows/github_token_refresh_workflow.go`

```go
func GitHubTokenRefreshWorkflow(ctx workflow.Context, input GitHubTokenRefreshWorkflowInput) error {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting GitHub token refresh workflow", "installationId", input.InstallationID)

	// Activity options (unchanged)
	ao := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, ao)

	// Initial refresh (unchanged)
	var result RefreshTokenResult
	err := workflow.ExecuteActivity(ctx, "RefreshGitHubInstallationTokenActivity", input.InstallationID).Get(ctx, &result)
	if err != nil {
		logger.Error("Initial token refresh failed", "error", err)
		workflow.ExecuteActivity(ctx, "UpdateInstallationStatusActivity", input.InstallationID, "refresh_failed", err.Error())
	} else {
		logger.Info("Initial token refresh succeeded", "expiresAt", result.ExpiresAt)
	}

	// Setup signal channel for manual refresh
	refreshSignal := workflow.GetSignalChannel(ctx, "trigger-refresh")

	// Run indefinitely until workflow is cancelled
	for {
		// Create selector to wait for timer OR signal
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
			workflow.ExecuteActivity(ctx, "UpdateInstallationStatusActivity", input.InstallationID, "refresh_failed", err.Error())
		} else {
			logger.Info("Token refresh succeeded", "expiresAt", result.ExpiresAt)
			workflow.ExecuteActivity(ctx, "UpdateInstallationStatusActivity", input.InstallationID, "active", "")
		}
	}
}
```

**Key Changes**:
- Added `refreshSignal` channel listening for `"trigger-refresh"` signal
- Replaced `workflow.Sleep()` with `workflow.NewSelector()` to handle both timer and signal
- Timer resets after each refresh (whether triggered by timer or signal)
- Logging distinguishes between automatic and manual refreshes

### 2. Admin API Endpoint

**File**: `orbit-www/src/app/api/github/installations/[id]/refresh/route.ts`

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
    // Verify user is admin
    const payload = await getPayload({ config: configPromise })
    // TODO: Add actual auth check for admin role

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
        { error: 'Token refresh workflow is not running' },
        { status: 400 }
      )
    }

    // Send signal to workflow
    const client = await getTemporalClient()
    const workflowId = installation.temporalWorkflowId || `github-token-refresh:${params.id}`

    const handle = client.workflow.getHandle(workflowId)
    await handle.signal('trigger-refresh')

    console.log('[GitHub Token Refresh] Manual refresh triggered for installation:', params.id)

    return NextResponse.json({
      status: 'success',
      message: 'Token refresh triggered. Check Temporal UI for results.',
      workflowId,
    })

  } catch (error) {
    console.error('[GitHub Token Refresh] Failed to trigger refresh:', error)
    return NextResponse.json(
      { error: 'Failed to trigger token refresh', details: error.message },
      { status: 500 }
    )
  }
}
```

**Features**:
- Verifies installation exists
- Checks workflow is running
- Sends signal to correct workflow
- Returns clear error messages
- Logs all manual refresh triggers

### 3. Admin UI Button

**File**: `orbit-www/src/app/(frontend)/settings/github/page.tsx` (modify InstallationCard component)

```typescript
function InstallationCard({ installation }) {
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

      // Optionally refresh installation data after a few seconds
      setTimeout(() => {
        window.location.reload()
      }, 3000)

    } catch (error) {
      setLastRefreshResult(`❌ Failed: ${error.message}`)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="border rounded-lg p-4">
      {/* Existing installation card content */}

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

      {/* Existing card footer */}
    </div>
  )
}
```

**Features**:
- Shows loading state while triggering
- Displays success/error messages
- Disabled when workflow not running
- Auto-refreshes page after successful trigger
- Clear visual feedback

## Monitoring & Verification

### Success Indicators

**1. Temporal UI** (http://localhost:8080)
- Navigate to workflow: `github-token-refresh:<installation-id>`
- Check Events tab for:
  - ✅ `SignalReceived` event with name `trigger-refresh`
  - ✅ `ActivityTaskScheduled` for `RefreshGitHubInstallationTokenActivity`
  - ✅ `ActivityTaskCompleted` (indicates success)

**2. Database Updates** (github-installations collection)
- ✅ `tokenLastRefreshedAt` updates to current timestamp
- ✅ `tokenExpiresAt` set to ~1 hour from now
- ✅ `status` field is `"active"`
- ✅ `installationToken` value changes (new encrypted token)

**3. Application Logs**
- ✅ "Manual refresh signal received" in workflow logs
- ✅ Activity completion logs with no errors

### Common Failure Scenarios

| Error Message | Cause | Solution |
|---------------|-------|----------|
| "failed to fetch installation" | Installation ID doesn't exist in database | Verify correct installation ID |
| "failed to create token" | GitHub API issue | Check app credentials, permissions, installation not suspended |
| "failed to encrypt token" | Encryption key not configured | Set ENCRYPTION_KEY environment variable |
| "failed to update installation" | Database connection issue | Verify Payload connection, check MongoDB |
| "Workflow not running" | Workflow not started or cancelled | Check temporalWorkflowStatus field, restart if needed |

## Edge Cases & Considerations

### Production Readiness

**Keep Signal Handler in Production**: ✅ Recommended
- Useful for admins to force token refresh if needed
- Helpful for debugging production issues
- No security concerns (admin-only access)

**Rate Limiting**: Consider adding:
- Max 1 manual refresh per minute per installation
- Prevents accidental spam/abuse
- Temporal handles duplicate signals gracefully (queues, doesn't duplicate activity execution)

**Audit Logging**: Track all manual refreshes:
- Who triggered the refresh
- When it was triggered
- Result (success/failure)

### Edge Cases

1. **Workflow Not Running**
   - API returns 400 error
   - UI button disabled
   - Admin must restart workflow manually

2. **Refresh Already in Progress**
   - Signal queues, doesn't interrupt current activity
   - Activity won't run twice simultaneously
   - Safe to send multiple signals

3. **Signal During Timer Sleep**
   - Selector immediately wakes up
   - Processes signal without waiting for timer
   - Timer resets after refresh completes

4. **Multiple Rapid Signals**
   - Temporal queues signals
   - Each signal triggers one refresh cycle
   - Consider UI-level debouncing (disable button for 60s after click)

## Testing Strategy

### Development Testing

1. **Initial Setup**
   - Ensure GitHub App installed and workflow running
   - Verify Temporal worker is running
   - Check Temporal UI accessible at http://localhost:8080

2. **Trigger Manual Refresh**
   - Navigate to `/settings/github`
   - Click "Test Refresh Now" button
   - Observe loading state

3. **Verify in Temporal UI**
   - Open workflow in Temporal UI
   - Check Events tab for `SignalReceived`
   - Verify `ActivityTaskCompleted` (or check failure details)

4. **Check Database**
   - Open Payload admin: http://localhost:3000/admin
   - Navigate to github-installations collection
   - Verify `tokenLastRefreshedAt` updated

5. **Review Logs**
   - Check Temporal worker logs
   - Look for "Manual refresh signal received"
   - Check for any activity errors

### Debugging Current Failures

With manual trigger capability, you can now:
1. Trigger refresh on-demand
2. Immediately see error in Temporal UI
3. Check detailed error message in activity failure
4. Fix issue (credentials, permissions, etc.)
5. Trigger again to verify fix
6. No 50-minute wait between attempts

## Implementation Checklist

- [ ] Modify `github_token_refresh_workflow.go` to add signal handler
- [ ] Create API endpoint `/api/github/installations/[id]/refresh/route.ts`
- [ ] Add "Test Refresh Now" button to GitHub settings UI
- [ ] Test signal triggering via UI
- [ ] Verify in Temporal UI (signal received, activity runs)
- [ ] Verify database updates after manual refresh
- [ ] Test error handling (workflow not running, etc.)
- [ ] Add rate limiting (optional but recommended)
- [ ] Document manual refresh capability for admins
- [ ] Commit changes

## Future Enhancements

1. **Refresh History UI**
   - Show last 10 refresh attempts with timestamps
   - Display success/failure status
   - Link to Temporal UI for details

2. **Webhook for Refresh Completion**
   - Notify admin when refresh completes
   - Show toast notification in UI

3. **Scheduled Manual Refreshes**
   - Allow admin to schedule one-time refresh
   - Useful for testing at specific times

4. **Multi-Installation Batch Refresh**
   - Trigger refresh for all installations
   - Useful for testing at scale

## References

- **Workflow Implementation**: `temporal-workflows/internal/workflows/github_token_refresh_workflow.go`
- **Activity Implementation**: `temporal-workflows/internal/activities/github_token_activities.go`
- **Temporal Client**: `orbit-www/src/lib/temporal/client.ts`
- **GitHub Settings UI**: `orbit-www/src/app/(frontend)/settings/github/page.tsx`
- **Parent Plan**: `docs/plans/2025-11-13-github-app-installation.md` (Task 6-7)

## Success Criteria

✅ Admin can trigger token refresh on-demand from UI
✅ Manual refresh works within existing workflow context
✅ Temporal UI shows signal received and activity completion
✅ Database updates correctly after manual refresh
✅ Error messages are clear and actionable
✅ Solution is production-ready (kept after testing phase)
✅ No disruption to existing 50-minute automatic refresh cycle

---

**Design Status**: Ready for implementation
**Next Step**: Create implementation plan using `superpowers:writing-plans`
