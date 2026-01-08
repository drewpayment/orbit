# Bifrost Phase 4: Quotas & Approvals - Implementation Plan

**Status:** READY FOR IMPLEMENTATION
**Date:** 2026-01-08
**Phase:** 4 of 10
**Dependencies:** Phase 1-3 (Foundation, Multi-Tenancy, Governance)

## Overview

Implement application quotas with dual-tier approval workflows. Workspaces have a default quota of 5 applications. When exceeded, requests go through workspace admin → platform admin approval.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Approval tiers | Dual-tier: workspace admin → platform admin |
| Platform admin options | Both "approve single" and "increase quota" |
| Notifications | Email + UI (graceful degradation to log-only if email not configured) |
| Request submission UX | Modal confirmation when quota exceeded |
| Approval pages | Dedicated pages (not tabs) |
| Request fields | Application name/description only (no justification) |
| Rejection reason | Optional |

## Data Model

### KafkaApplicationQuotas Collection

```typescript
{
  id: string
  workspace: Relationship<Workspace>      // one-to-one
  applicationQuota: number                // overrides system default (5)
  setBy: Relationship<User>
  reason: string
  createdAt: Date
  updatedAt: Date
}
```

### KafkaApplicationRequests Collection

```typescript
{
  id: string
  workspace: Relationship<Workspace>
  requestedBy: Relationship<User>

  // Application details
  applicationName: string
  applicationSlug: string
  description: string

  // Status
  status: 'pending_workspace' | 'pending_platform' | 'approved' | 'rejected'

  // Workspace tier
  workspaceApprovedBy: Relationship<User> | null
  workspaceApprovedAt: Date | null

  // Platform tier
  platformApprovedBy: Relationship<User> | null
  platformApprovedAt: Date | null
  platformAction: 'approved_single' | 'increased_quota' | null

  // Rejection
  rejectedBy: Relationship<User> | null
  rejectedAt: Date | null
  rejectionReason: string | null

  createdAt: Date
  updatedAt: Date
}
```

## Implementation Tasks

### Task 1: Create KafkaApplicationQuotas Collection

**Files:**
- `orbit-www/src/collections/kafka/KafkaApplicationQuotas.ts` (new)
- `orbit-www/src/collections/kafka/index.ts` (update exports)
- `orbit-www/src/payload.config.ts` (add to collections)

**Implementation:**
- Create Payload collection with fields: workspace (relationship), applicationQuota (number), setBy (relationship to users), reason (text)
- Add unique constraint on workspace (one override per workspace)
- Workspace admin + platform admin access

**Verification:**
- [ ] Collection appears in Payload admin
- [ ] Can create/update quota override via admin UI
- [ ] Unique constraint prevents duplicate workspace entries

---

### Task 2: Create KafkaApplicationRequests Collection

**Files:**
- `orbit-www/src/collections/kafka/KafkaApplicationRequests.ts` (new)
- `orbit-www/src/collections/kafka/index.ts` (update exports)
- `orbit-www/src/payload.config.ts` (add to collections)

**Implementation:**
- Create Payload collection with all fields from data model
- Status field with enum: pending_workspace, pending_platform, approved, rejected
- Relationships to workspace, users (requestedBy, workspaceApprovedBy, platformApprovedBy, rejectedBy)
- Platform action enum: approved_single, increased_quota

**Verification:**
- [ ] Collection appears in Payload admin
- [ ] Can create request with all fields
- [ ] Status transitions work correctly

---

### Task 3: Implement Notification Service

**Files:**
- `orbit-www/src/lib/notifications/types.ts` (new)
- `orbit-www/src/lib/notifications/service.ts` (new)
- `orbit-www/src/lib/notifications/templates.ts` (new)

**Implementation:**
```typescript
// types.ts
interface NotificationPayload {
  to: { email: string; name: string }
  subject: string
  template: 'approval-submitted' | 'approval-needed' | 'request-approved' | 'request-rejected'
  data: Record<string, unknown>
}

interface NotificationResult {
  success: boolean
  channel: 'email' | 'log-only'
  error?: string
}

// service.ts
- sendNotification(payload) - tries email, falls back to log-only
- isEmailConfigured() - checks Payload email adapter at runtime
- Always logs notification for audit trail

// templates.ts
- getEmailContent(template, data) - returns subject + HTML body
```

**Verification:**
- [ ] Notifications logged when email not configured
- [ ] Graceful degradation (no errors when email unavailable)
- [ ] Unit tests for service logic

---

### Task 4: Implement Quota Checking Logic

**Files:**
- `orbit-www/src/lib/kafka/quotas.ts` (new)
- `orbit-www/src/app/actions/kafka-quotas.ts` (new)

**Implementation:**
```typescript
// quotas.ts
const SYSTEM_DEFAULT_QUOTA = 5

async function getEffectiveQuota(workspaceId: string): Promise<number>
async function getQuotaUsage(workspaceId: string): Promise<number>
async function canCreateApplication(workspaceId: string): Promise<boolean>
async function getWorkspaceQuotaInfo(workspaceId: string): Promise<{
  used: number
  quota: number
  remaining: number
  hasOverride: boolean
}>

// kafka-quotas.ts (server actions)
export async function getWorkspaceQuotaInfo(workspaceId: string)
export async function setWorkspaceQuotaOverride(workspaceId: string, newQuota: number, reason: string)
```

**Verification:**
- [ ] Returns system default (5) when no override exists
- [ ] Returns override value when one exists
- [ ] Correctly counts active applications
- [ ] Unit tests for quota logic

---

### Task 5: Update Application Creation with Quota Check

**Files:**
- `orbit-www/src/app/actions/kafka-applications.ts` (update)

**Implementation:**
- Modify `createKafkaApplication` to check quota before creating
- Return `{ success: false, error: 'quota_exceeded', quotaInfo: {...} }` when over quota
- Existing flow unchanged when under quota

**Verification:**
- [ ] Applications created normally when under quota
- [ ] Returns quota_exceeded when at/over quota
- [ ] QuotaInfo includes used/quota/remaining

---

### Task 6: Implement Application Request Server Actions

**Files:**
- `orbit-www/src/app/actions/kafka-application-requests.ts` (new)

**Implementation:**
```typescript
// Submit request
export async function submitApplicationRequest(
  workspaceId: string,
  applicationName: string,
  description: string
): Promise<{ success: boolean; requestId?: string; error?: string }>

// Workspace admin actions
export async function approveRequestAsWorkspaceAdmin(requestId: string)
export async function rejectRequestAsWorkspaceAdmin(requestId: string, reason?: string)

// Platform admin actions
export async function approveRequestAsPlatformAdmin(
  requestId: string,
  action: 'single' | 'increase_quota'
)
export async function rejectRequestAsPlatformAdmin(requestId: string, reason?: string)

// Query actions
export async function getMyRequests(workspaceId: string)
export async function getPendingWorkspaceApprovals(workspaceId: string)
export async function getPendingPlatformApprovals()
```

**Authorization checks in each action:**
- submitApplicationRequest: user is workspace member
- workspace admin actions: user is workspace admin, request in pending_workspace
- platform admin actions: user is platform admin, request in pending_platform

**Verification:**
- [ ] Request created with pending_workspace status
- [ ] Workspace approval moves to pending_platform
- [ ] Platform approval creates application
- [ ] Platform approval with increase_quota creates/updates quota override
- [ ] Rejections set status and optional reason
- [ ] Authorization enforced on all actions

---

### Task 7: Add Collection Hooks for Notifications and App Creation

**Files:**
- `orbit-www/src/collections/kafka/KafkaApplicationRequests.ts` (update hooks)

**Implementation:**
```typescript
hooks: {
  afterChange: [
    async ({ doc, previousDoc, operation, req }) => {
      if (operation === 'create') {
        // Notify workspace admins
        await notifyWorkspaceAdmins(doc)
      }

      if (operation === 'update') {
        // pending_workspace → pending_platform: notify platform admins
        if (previousDoc.status === 'pending_workspace' && doc.status === 'pending_platform') {
          await notifyPlatformAdmins(doc)
        }

        // → approved: create application, notify requester
        if (doc.status === 'approved' && previousDoc.status !== 'approved') {
          await createApplicationFromRequest(doc)
          if (doc.platformAction === 'increased_quota') {
            await createOrUpdateQuotaOverride(doc)
          }
          await notifyRequester(doc, 'approved')
        }

        // → rejected: notify requester
        if (doc.status === 'rejected' && previousDoc.status !== 'rejected') {
          await notifyRequester(doc, 'rejected')
        }
      }
    }
  ]
}
```

**Verification:**
- [ ] Notifications sent on status transitions
- [ ] Application created when approved
- [ ] Quota override created when platformAction is increased_quota
- [ ] Hook errors don't break status updates (try/catch)

---

### Task 8: Create QuotaExceededModal Component

**Files:**
- `orbit-www/src/components/features/kafka/QuotaExceededModal.tsx` (new)

**Implementation:**
```typescript
interface QuotaExceededModalProps {
  open: boolean
  onClose: () => void
  onSubmitRequest: () => void
  quotaInfo: { used: number; quota: number }
  applicationName: string
  isSubmitting: boolean
}

// Modal content:
// "Your workspace has reached its application quota (X of Y)."
// "Would you like to submit a request for approval?"
// [Cancel] [Submit Request]
```

**Verification:**
- [ ] Shows current quota usage
- [ ] Cancel closes modal
- [ ] Submit Request triggers callback
- [ ] Loading state during submission

---

### Task 9: Update CreateApplicationDialog with Quota Flow

**Files:**
- `orbit-www/src/components/features/kafka/CreateApplicationDialog.tsx` (update)

**Implementation:**
- On submit, call createKafkaApplication
- If quota_exceeded returned, show QuotaExceededModal
- If user confirms, call submitApplicationRequest
- Show success message: "Request submitted for approval"

**Verification:**
- [ ] Normal creation works when under quota
- [ ] QuotaExceededModal shown when over quota
- [ ] Request submitted successfully
- [ ] Success/error feedback to user

---

### Task 10: Create RequestStatusBadge Component

**Files:**
- `orbit-www/src/components/features/kafka/RequestStatusBadge.tsx` (new)

**Implementation:**
```typescript
interface RequestStatusBadgeProps {
  status: 'pending_workspace' | 'pending_platform' | 'approved' | 'rejected'
}

// Visual badges:
// pending_workspace: yellow "Pending WS Approval"
// pending_platform: blue "Pending Platform Approval"
// approved: green "Approved"
// rejected: red "Rejected"
```

**Verification:**
- [ ] Correct colors for each status
- [ ] Accessible contrast ratios

---

### Task 11: Create ApprovalActionsDropdown Component

**Files:**
- `orbit-www/src/components/features/kafka/ApprovalActionsDropdown.tsx` (new)

**Implementation:**
```typescript
interface ApprovalActionsDropdownProps {
  requestId: string
  tier: 'workspace' | 'platform'
  onActionComplete: () => void
}

// For workspace tier:
// - "Approve" button
// - "Reject" button (opens optional reason modal)

// For platform tier:
// - "Approve" dropdown:
//   - "Approve this request"
//   - "Approve & increase workspace quota"
// - "Reject" button (opens optional reason modal)
```

**Verification:**
- [ ] Workspace tier shows simple approve/reject
- [ ] Platform tier shows dropdown with two approve options
- [ ] Reject modal has optional reason field
- [ ] Loading states during actions
- [ ] Calls onActionComplete after success

---

### Task 12: Create Workspace Pending Approvals Page

**Files:**
- `orbit-www/src/app/(dashboard)/[workspace]/kafka/pending-approvals/page.tsx` (new)

**Implementation:**
- Fetch pending_workspace requests for workspace
- Check user is workspace admin (redirect if not)
- Table with columns: Application Name, Requested By, Date, Actions
- Use ApprovalActionsDropdown for actions
- Empty state: "No pending approval requests"

**Verification:**
- [ ] Only workspace admins can access
- [ ] Shows only pending_workspace requests
- [ ] Approve/reject actions work
- [ ] List refreshes after action
- [ ] Empty state when no requests

---

### Task 13: Create Platform Pending Approvals Page

**Files:**
- `orbit-www/src/app/(dashboard)/platform/kafka/pending-approvals/page.tsx` (new)

**Implementation:**
- Fetch all pending_platform requests
- Check user is platform admin (redirect if not)
- Table with columns: Workspace, Application Name, Requested By, WS Approved By, Date, Actions
- Use ApprovalActionsDropdown with tier='platform'
- Empty state: "No pending approval requests"

**Verification:**
- [ ] Only platform admins can access
- [ ] Shows only pending_platform requests
- [ ] Both approve options work (single and increase quota)
- [ ] Reject works with optional reason
- [ ] List refreshes after action

---

### Task 14: Add My Requests Section to Applications List

**Files:**
- `orbit-www/src/app/(dashboard)/[workspace]/kafka/applications/page.tsx` (update)
- `orbit-www/src/components/features/kafka/MyRequestsList.tsx` (new)

**Implementation:**
- Add "My Requests" section above applications list (when user has requests)
- Show user's pending and recently rejected requests (last 30 days)
- Use RequestStatusBadge for status
- Collapsible if many requests

**Verification:**
- [ ] Shows user's own requests only
- [ ] Status badges display correctly
- [ ] Section hidden when no requests
- [ ] Rejected requests show reason if provided

---

### Task 15: Add Navigation Links to Approval Pages

**Files:**
- `orbit-www/src/components/layout/WorkspaceSidebar.tsx` (update, if exists)
- `orbit-www/src/app/(dashboard)/[workspace]/kafka/layout.tsx` (update)
- `orbit-www/src/app/(dashboard)/platform/kafka/layout.tsx` (update)

**Implementation:**
- Add "Pending Approvals" link in workspace kafka navigation (for workspace admins)
- Add "Pending Approvals" link in platform kafka navigation (for platform admins)
- Show badge with count of pending requests

**Verification:**
- [ ] Links visible only to appropriate roles
- [ ] Badge count updates correctly
- [ ] Navigation works

---

### Task 16: Integration Tests

**Files:**
- `orbit-www/src/tests/kafka-quotas.test.ts` (new)
- `orbit-www/src/tests/kafka-application-requests.test.ts` (new)

**Implementation:**
- Test quota checking logic
- Test full approval flow: submit → ws approve → platform approve → app created
- Test rejection flows
- Test quota override creation
- Test authorization enforcement

**Verification:**
- [ ] All tests pass
- [ ] Edge cases covered (concurrent requests, race conditions)

---

## File Summary

### New Files (16)
- `orbit-www/src/collections/kafka/KafkaApplicationQuotas.ts`
- `orbit-www/src/collections/kafka/KafkaApplicationRequests.ts`
- `orbit-www/src/lib/notifications/types.ts`
- `orbit-www/src/lib/notifications/service.ts`
- `orbit-www/src/lib/notifications/templates.ts`
- `orbit-www/src/lib/kafka/quotas.ts`
- `orbit-www/src/app/actions/kafka-quotas.ts`
- `orbit-www/src/app/actions/kafka-application-requests.ts`
- `orbit-www/src/components/features/kafka/QuotaExceededModal.tsx`
- `orbit-www/src/components/features/kafka/RequestStatusBadge.tsx`
- `orbit-www/src/components/features/kafka/ApprovalActionsDropdown.tsx`
- `orbit-www/src/components/features/kafka/MyRequestsList.tsx`
- `orbit-www/src/app/(dashboard)/[workspace]/kafka/pending-approvals/page.tsx`
- `orbit-www/src/app/(dashboard)/platform/kafka/pending-approvals/page.tsx`
- `orbit-www/src/tests/kafka-quotas.test.ts`
- `orbit-www/src/tests/kafka-application-requests.test.ts`

### Modified Files (6)
- `orbit-www/src/collections/kafka/index.ts`
- `orbit-www/src/payload.config.ts`
- `orbit-www/src/app/actions/kafka-applications.ts`
- `orbit-www/src/components/features/kafka/CreateApplicationDialog.tsx`
- `orbit-www/src/app/(dashboard)/[workspace]/kafka/applications/page.tsx`
- Navigation/layout files for approval page links

## Success Criteria

1. [ ] Workspace quota of 5 enforced by default
2. [ ] Users can submit requests when over quota
3. [ ] Workspace admins can approve/reject in first tier
4. [ ] Platform admins can approve (single or +quota) or reject in second tier
5. [ ] Applications created automatically on final approval
6. [ ] Notifications sent at each status change (email if configured, always logged)
7. [ ] All roles see appropriate UI for their permissions
8. [ ] Full test coverage for quota logic and approval flow
