# Manual Testing Guide - GitHub Token Refresh

**Feature:** Manual token refresh capability for GitHub App installations
**Date:** 2025-11-17
**Implementation Plan:** `2025-11-16-manual-github-token-refresh-implementation.md`

---

## Quick Start

### Prerequisites Check

Run the automated verification script:
```bash
cd /Users/drew.payment/dev/orbit/temporal-workflows
./verify-worker.sh
```

This will verify:
- Worker binary exists and compiles
- Signal handler implemented in workflow
- Temporal infrastructure running
- Frontend server running

### Start Required Services

If verification script shows missing services:

**1. Start Temporal Infrastructure:**
```bash
cd /Users/drew.payment/dev/orbit
make docker-up
```

Wait for services to be healthy (~30 seconds):
- Temporal server: localhost:7233
- Temporal UI: http://localhost:8080
- PostgreSQL: localhost:5432 (Temporal), localhost:5433 (App)

**2. Start Temporal Worker (Terminal 1):**
```bash
cd /Users/drew.payment/dev/orbit/temporal-workflows
./bin/worker
```

Expected output:
```
INFO  Temporal worker started
INFO  Listening to task queue: github-token-refresh
INFO  Activities registered: RefreshGitHubInstallationTokenActivity, UpdateInstallationStatusActivity
```

**3. Start Frontend (Terminal 2):**
```bash
cd /Users/drew.payment/dev/orbit/orbit-www
bun run dev
```

Expected output:
```
Local:   http://localhost:3000
```

---

## Test Scenarios

### Scenario 1: Happy Path - Successful Manual Refresh

**Objective:** Verify manual refresh triggers successfully and updates database

**Steps:**

1. **Navigate to GitHub Settings**
   - Open: http://localhost:3000/settings/github
   - Expected: List of GitHub installations displayed

2. **Locate Active Installation**
   - Find installation card with:
     - Status badge: "Active" or "Refresh Failed"
     - Workflow status: "Running"
   - Note the installation ID (visible in URL or card)

3. **Trigger Manual Refresh**
   - Click "Test Refresh Now" button
   - Expected:
     - Button text changes to "⏳ Refreshing..."
     - Button becomes disabled
     - Success message appears: "✅ Refresh triggered successfully. Check Temporal UI for results."
     - Page reloads after 3 seconds

4. **Verify Signal in Temporal UI**
   - Open: http://localhost:8080
   - Search for workflow: `github-token-refresh:<installation-id>`
   - Click on the workflow
   - Navigate to "Events" tab
   - Scroll to most recent events

   **Expected Events (newest first):**
   ```
   [N] ActivityTaskCompleted
       Activity: UpdateInstallationStatusActivity

   [N-1] ActivityTaskCompleted
       Activity: RefreshGitHubInstallationTokenActivity
       Result: { success: true, expiresAt: "2025-11-17T21:XX:XXZ" }

   [N-2] ActivityTaskScheduled
       Activity: RefreshGitHubInstallationTokenActivity

   [N-3] SignalReceived
       Signal Name: trigger-refresh
       Input: (empty)
   ```

5. **Verify Database Update**
   - Open Payload Admin: http://localhost:3000/admin
   - Navigate: Collections > GitHub Installations
   - Find the installation you triggered
   - Check fields:
     - `tokenLastRefreshedAt`: Should be current timestamp (within last minute)
     - `tokenExpiresAt`: Should be ~1 hour from now
     - `status`: Should be "active"
     - `installationToken`: Value should have changed (new encrypted token)

**Success Criteria:**
- ✅ Signal received by workflow
- ✅ Activity executed successfully
- ✅ Database updated with new token
- ✅ Timestamp matches current time
- ✅ UI shows success message

---

### Scenario 2: Error Handling - Workflow Not Running

**Objective:** Verify button is disabled when workflow not running

**Steps:**

1. Find installation with `temporalWorkflowStatus` != "running"
   - Could be "stopped", "failed", or null

2. Check button state
   - Expected: "Test Refresh Now" button is disabled (grayed out)
   - Hover tooltip (if implemented): "Workflow not running"

**Success Criteria:**
- ✅ Button is disabled
- ✅ No API call made when clicked
- ✅ User cannot trigger refresh on stopped workflow

---

### Scenario 3: Error Handling - GitHub API Failure

**Objective:** Verify error handling when GitHub API fails

**Prerequisites:** Temporarily break GitHub credentials or suspend installation

**Steps:**

1. Click "Test Refresh Now" on active installation

2. Check Temporal UI Events:
   ```
   [N] ActivityTaskFailed
       Activity: RefreshGitHubInstallationTokenActivity
       Error: "failed to create installation token: ..."
   ```

3. Check database:
   - `status`: Should be "refresh_failed"
   - `errorMessage`: Should contain actual error

4. Check workflow logs (Terminal 1):
   ```
   ERROR Token refresh failed error="..."
   ```

**Success Criteria:**
- ✅ Error logged in Temporal
- ✅ Database status updated to "refresh_failed"
- ✅ Workflow continues running (doesn't crash)
- ✅ Error message is descriptive

---

### Scenario 4: Rate Limiting (If Implemented - Task 6)

**Objective:** Verify rate limiting prevents spam

**Steps:**

1. Click "Test Refresh Now"
2. Immediately click again (within 60 seconds)

**Expected:**
- First click: Success
- Second click: Error message "Rate limit exceeded. Please wait 1 minute between manual refreshes."
- HTTP status: 429

**Success Criteria:**
- ✅ Rate limit enforced
- ✅ Clear error message
- ✅ No duplicate signals sent to Temporal

---

### Scenario 5: Multiple Rapid Clicks (Without Rate Limiting)

**Objective:** Verify Temporal queues signals correctly

**Steps:**

1. Click "Test Refresh Now" 3 times rapidly (before button disables)

2. Check Temporal UI Events
   - Expected: 3 `SignalReceived` events
   - Expected: 3 `ActivityTaskScheduled` events
   - All should process sequentially

**Expected Behavior:**
- Button disables after first click
- Temporal queues all 3 signals
- Each signal triggers one refresh
- Activities execute sequentially (not in parallel)

**Success Criteria:**
- ✅ All signals received
- ✅ All activities executed
- ✅ No race conditions
- ✅ Token refreshed 3 times

---

## Verification Checklist

Before marking Task 4 as complete, verify:

- [ ] Worker binary compiles without errors
- [ ] Worker starts and registers activities
- [ ] Frontend builds without TypeScript errors
- [ ] Frontend server starts and serves pages
- [ ] GitHub settings page loads
- [ ] "Test Refresh Now" button appears on installation cards
- [ ] Button shows loading state when clicked
- [ ] Temporal UI shows `SignalReceived` event
- [ ] Activity executes (check for `ActivityTaskCompleted` or `ActivityTaskFailed`)
- [ ] Database updates after successful refresh
- [ ] Error messages are clear and helpful
- [ ] Button disabled when workflow not running
- [ ] No console errors in browser or server logs

---

## Troubleshooting

### Issue: "Workflow not found" error when sending signal

**Symptoms:**
- API returns error: "Failed to signal workflow"
- Temporal logs: "workflow not found"

**Diagnosis:**
1. Check `temporalWorkflowId` field in database
2. Verify workflow is running in Temporal UI (search by ID)
3. Check workflow status: should be "Running", not "Completed" or "Failed"

**Fix:**
- Restart workflow by uninstalling and reinstalling GitHub App
- OR manually start workflow via Temporal CLI:
  ```bash
  temporal workflow start \
    --workflow-id github-token-refresh:<installation-id> \
    --type GitHubTokenRefreshWorkflow \
    --task-queue github-token-refresh \
    --input '{"InstallationID": "<installation-id>"}'
  ```

---

### Issue: Activity fails with "failed to fetch installation"

**Symptoms:**
- `ActivityTaskFailed` in Temporal UI
- Error: "installation not found" or "invalid installation ID"

**Diagnosis:**
1. Verify installation exists in `github-installations` collection
2. Check `installationId` field type (should be numeric GitHub ID)
3. Check Payload document ID vs GitHub installation ID (they're different!)

**Fix:**
- Ensure activity receives Payload document ID, not GitHub installation ID
- Activity should fetch installation from Payload, then use `installationId` field for GitHub API

---

### Issue: Activity fails with "failed to create token"

**Symptoms:**
- `ActivityTaskFailed` in Temporal UI
- Error: "GitHub App authentication failed"

**Diagnosis:**
1. Check environment variables:
   ```bash
   echo $GITHUB_APP_ID
   echo $GITHUB_APP_PRIVATE_KEY_PATH
   # OR
   echo $GITHUB_APP_PRIVATE_KEY_BASE64
   ```
2. Verify private key file exists and is readable
3. Check GitHub App not suspended

**Fix:**
- Set missing environment variables
- Restart Temporal worker to pick up new env vars
- Verify GitHub App permissions in GitHub settings

---

### Issue: Activity fails with "failed to encrypt token"

**Symptoms:**
- `ActivityTaskFailed` in Temporal UI
- Error: "encryption key not set" or "crypto error"

**Diagnosis:**
```bash
echo $ENCRYPTION_KEY
```

**Fix:**
1. Generate encryption key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
2. Set environment variable:
   ```bash
   export ENCRYPTION_KEY="<generated-key>"
   ```
3. Restart Temporal worker

---

### Issue: Button doesn't appear or is always disabled

**Symptoms:**
- Button missing from UI
- Button always grayed out

**Diagnosis:**
1. Open browser console (F12) - check for React errors
2. Check network tab - verify API calls succeed
3. Inspect installation object:
   ```javascript
   // In browser console
   console.log(installation)
   console.log(installation.temporalWorkflowStatus)
   ```

**Fix:**
- Verify `temporalWorkflowStatus` field in database is "running"
- Check component conditional logic
- Ensure React useState imported
- Clear browser cache

---

## Success Metrics

After completing all test scenarios, you should observe:

**Workflow Behavior:**
- Manual refresh completes in < 10 seconds
- Workflow continues running after manual refresh
- Next automatic refresh still occurs 50 minutes after last refresh
- Signal handler doesn't interfere with timer-based refreshes

**Database State:**
- `tokenLastRefreshedAt` updates immediately
- `tokenExpiresAt` shows ~1 hour expiration
- Encrypted token changes with each refresh
- Status reflects actual state ("active" vs "refresh_failed")

**User Experience:**
- Clear feedback during refresh
- Error messages are actionable
- No page crashes or console errors
- Button state accurately reflects workflow status

**System Reliability:**
- No memory leaks in worker
- Temporal workflows don't accumulate events excessively
- Database connections properly closed
- No orphaned workflows

---

## Performance Benchmarks

Record these metrics during testing:

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Time to signal delivery | < 1s | ___ | ___ |
| Activity execution time | < 5s | ___ | ___ |
| Database update time | < 1s | ___ | ___ |
| Total end-to-end time | < 10s | ___ | ___ |
| Concurrent refreshes (max) | 10+ | ___ | ___ |

---

## Next Steps After Testing

**If all tests pass:**
1. Update plan with test results (Step 4.7)
2. Proceed to Task 5 (Update Documentation)
3. Consider implementing Task 6 (Rate Limiting) for production

**If tests fail:**
1. Document failure details in plan
2. Use Temporal UI to diagnose root cause
3. Check worker logs for stack traces
4. Verify environment variables
5. Consult troubleshooting section
6. Fix issues and re-run tests

**Production Readiness:**
- [ ] Add authentication to API endpoint (admin-only)
- [ ] Implement distributed rate limiting (Redis)
- [ ] Add audit logging for all manual refreshes
- [ ] Set up monitoring/alerting for refresh failures
- [ ] Document runbook for common issues
