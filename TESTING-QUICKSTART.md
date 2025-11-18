# Quick Start - Manual Token Refresh Testing

**Time Required:** 5-10 minutes
**Current Status:** Implementation complete, ready for manual testing

---

## 1. Pre-Flight Check (30 seconds)

```bash
cd /Users/drew.payment/dev/orbit/temporal-workflows
./verify-worker.sh
```

This will tell you which services need to be started.

---

## 2. Start Services (2 minutes)

### Terminal 1 - Temporal Infrastructure
```bash
cd /Users/drew.payment/dev/orbit
make docker-up
# Wait ~30 seconds for services to start
```

### Terminal 2 - Temporal Worker
```bash
cd /Users/drew.payment/dev/orbit/temporal-workflows
./bin/worker
# Leave running
```

### Terminal 3 - Frontend
```bash
cd /Users/drew.payment/dev/orbit/orbit-www
bun run dev
# Leave running
```

---

## 3. Quick Test (2 minutes)

1. **Open browser:** http://localhost:3000/settings/github

2. **Click:** "Test Refresh Now" button

3. **Verify success message:**
   ```
   ✅ Refresh triggered successfully. Check Temporal UI for results.
   ```

4. **Check Temporal UI:** http://localhost:8080
   - Search: `github-token-refresh:`
   - Events tab: Look for "SignalReceived" event

5. **Check database:** http://localhost:3000/admin
   - Collections > GitHub Installations
   - Verify `tokenLastRefreshedAt` is current time

---

## 4. Done!

If all steps passed:
- Implementation is working correctly
- Proceed to Task 5 (Update Documentation)
- See detailed testing guide: `docs/plans/MANUAL-TESTING-GUIDE-token-refresh.md`

If something failed:
- Check troubleshooting section in testing guide
- Verify all environment variables set
- Check worker and frontend logs for errors

---

## Environment Variables Needed

```bash
# GitHub App credentials
GITHUB_APP_ID=your_app_id
GITHUB_APP_PRIVATE_KEY_PATH=/path/to/private-key.pem
# OR
GITHUB_APP_PRIVATE_KEY_BASE64=base64_encoded_key

# Token encryption
ENCRYPTION_KEY=base64_32_byte_key

# Generate encryption key if missing:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Useful Links

- **Implementation Plan:** `docs/plans/2025-11-16-manual-github-token-refresh-implementation.md`
- **Testing Guide:** `docs/plans/MANUAL-TESTING-GUIDE-token-refresh.md`
- **Testing Summary:** `docs/plans/TASK-4-TESTING-SUMMARY.md`
- **Temporal UI:** http://localhost:8080
- **Frontend:** http://localhost:3000
- **Payload Admin:** http://localhost:3000/admin

---

## What You're Testing

**Feature:** Manual token refresh for GitHub App installations

**How it works:**
1. User clicks "Test Refresh Now" in UI
2. API sends signal to Temporal workflow
3. Workflow immediately refreshes token
4. Database updated with new token
5. Success message shown to user

**Benefits:**
- No waiting 50 minutes to test token refresh
- Can debug issues immediately
- Can verify fixes without long delays

---

## Success = All These True

- [ ] Button appears and is clickable
- [ ] Success message shows after click
- [ ] Temporal UI shows SignalReceived event
- [ ] Database `tokenLastRefreshedAt` updates to now
- [ ] No errors in browser console
- [ ] No errors in worker logs
- [ ] Page doesn't crash

**Good luck!** 🚀
