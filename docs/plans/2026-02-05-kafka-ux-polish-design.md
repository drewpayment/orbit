# Kafka UX Polish (2.4) - Design Document

## Overview

Add retry functionality and error visibility for failed/partial Kafka application provisioning. Surface provisioning issues in both workspace and admin views with appropriate detail levels.

## Background

When a Kafka Application is created, a Temporal workflow provisions virtual clusters for each enabled environment (dev, stage, prod). This can fail or partially succeed. Currently:
- `KafkaApplication` has: `provisioningStatus` (pending|in_progress|completed|partial|failed), `provisioningError`, `provisioningDetails`
- `retryVirtualClusterProvisioning(applicationId)` server action exists but has no UI
- Workspace view shows virtual clusters but not application-level provisioning status
- Admin view (Gateway tab) shows Bifrost config, not Payload CMS application data

## Goals

1. Surface provisioning failures to workspace users with actionable retry
2. Give platform admins detailed error information for debugging
3. Non-disruptive integration with existing UI patterns

## Non-Goals

- Temporal UI integration (explicitly excluded per Drew)
- Changing the underlying provisioning workflow
- Real-time status updates (polling is acceptable)

## Design Decisions

| Aspect | Decision |
|--------|----------|
| Error detail - Workspace | Moderate: "dev environment failed: connection timeout" |
| Error detail - Admin | Detailed: Full error messages, workflow IDs |
| Retry UX | Inline button, immediate action (no confirmation modal) |
| Feedback | Spinner on button + toast on completion |
| Failed retry behavior | Update badge only, don't auto-show modal |
| Edge cases | Disable retry during in_progress, debounce clicks |

## Architecture

### Data Flow

```
KafkaApplication (Payload CMS)
├── provisioningStatus: pending | in_progress | completed | partial | failed
├── provisioningError: string (top-level error message)
├── provisioningDetails: {
│     dev?: { status, error?, message? }
│     stage?: { status, error?, message? }
│     prod?: { status, error?, message? }
│   }
└── provisioningWorkflowId: string (for admin debugging)
```

### Workspace View Design

**Approach:** Banner + Modal

When any application in the workspace has `provisioningStatus` of `failed` or `partial`:

1. **Alert Banner** at top of VirtualClustersList:
   - "1 application has provisioning issues" (or "N applications...")
   - "View Details" button opens modal

2. **Error Details Modal** (moderate detail):
   - Application name
   - Overall status
   - Per-environment breakdown:
     - ✅ dev: Provisioned successfully
     - ❌ stage: Connection timeout
     - ✅ prod: Provisioned successfully
   - "Retry Provisioning" button
   - "Contact Support" link for persistent failures

3. **Retry Flow:**
   - Click retry → button shows spinner
   - Calls `retryVirtualClusterProvisioning(applicationId)`
   - Toast: "Provisioning started"
   - On completion (poll or refresh): Toast success/failure
   - Modal stays open, status updates

### Admin View Design

**Approach:** New sub-tab in Gateway tab

Add "Provisioning" sub-tab to GatewayTab (alongside Virtual Clusters, Credentials, Status):

1. **List View:**
   - Shows all applications with `provisioningStatus` != `completed`
   - Columns: Application, Workspace, Status, Last Error, Workflow ID
   - Filter by status (failed, partial, in_progress, pending)

2. **Detail View** (click row or expand):
   - Full error messages (not truncated)
   - Stack traces if available
   - Workflow ID (copyable)
   - Timestamp of last attempt
   - Per-environment detailed breakdown
   - Retry button

3. **Bulk Actions:**
   - "Retry All Failed" button (optional, future enhancement)

## Component Structure

### New Components

```
orbit-www/src/components/features/kafka/
├── ProvisioningAlert.tsx          # Banner for workspace view
├── ProvisioningErrorModal.tsx     # Modal with error details
├── RetryProvisioningButton.tsx    # Shared retry button component
└── ProvisioningStatusBadge.tsx    # Status badge with appropriate styling

orbit-www/src/app/(frontend)/platform/kafka/components/
└── ProvisioningTab.tsx            # Admin provisioning issues tab
```

### Server Actions

Existing:
- `retryVirtualClusterProvisioning(applicationId)` - already implemented

New:
- `listApplicationsWithProvisioningIssues(workspaceId?)` - returns applications with failed/partial status
- `getApplicationProvisioningDetails(applicationId)` - returns full details for admin view

## UI Specifications

### Provisioning Alert Banner (Workspace)

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️  1 application has provisioning issues    [View Details] │
└─────────────────────────────────────────────────────────────┘
```

- Yellow/warning styling
- Dismissible per session (optional)
- Shows count of affected applications

### Error Modal (Workspace - Moderate Detail)

```
┌─────────────────────────────────────────────────────────────┐
│ Provisioning Issues                                    [X]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ payments-service                                            │
│ Status: Partial Failure                                     │
│                                                             │
│ Environment Status:                                         │
│ ✅ dev    - Provisioned successfully                        │
│ ❌ stage  - Connection timeout                              │
│ ✅ prod   - Provisioned successfully                        │
│                                                             │
│ ┌─────────────────────┐  ┌─────────────────────┐           │
│ │  Retry Provisioning │  │  Contact Support    │           │
│ └─────────────────────┘  └─────────────────────┘           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Admin Provisioning Tab

```
┌─────────────────────────────────────────────────────────────┐
│ [Virtual Clusters] [Credentials] [Provisioning] [Status]    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Filter: [All ▼]  [Refresh]  [Retry All Failed]             │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ payments-service (acme-corp)           PARTIAL  ⟳      │ │
│ │ Workflow: wf_abc123...  |  2 min ago                    │ │
│ │                                                         │ │
│ │ ✅ dev    OK                                            │ │
│ │ ❌ stage  Error: ECONNREFUSED 10.0.0.5:9092            │ │
│ │           at KafkaClient.connect (kafka.js:234)        │ │
│ │           at async createVirtualCluster...             │ │
│ │ ✅ prod   OK                                            │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## State Management

### Workspace View

- Fetch provisioning issues on mount via `listApplicationsWithProvisioningIssues(workspaceId)`
- Store in component state
- Refresh after retry completes
- Optional: Poll every 30s while modal is open and status is in_progress

### Admin View

- Fetch all applications with issues on tab mount
- Real-time updates not required (manual refresh)
- Filter state managed locally

## Error Handling

### Retry Failures

If retry itself fails:
- Toast error: "Failed to start provisioning: {error}"
- Button returns to default state
- User can try again

### Network Errors

- Standard error boundary handling
- Toast notification for failed fetches
- Graceful degradation (hide banner if fetch fails)

## Testing Strategy

1. **Unit Tests:**
   - ProvisioningAlert renders with correct count
   - ProvisioningErrorModal displays environment breakdown
   - RetryProvisioningButton handles loading/error states

2. **Integration Tests:**
   - Clicking retry calls server action
   - Modal updates after successful retry
   - Admin tab filters correctly

3. **E2E Tests:**
   - Full flow: Create application → Simulate failure → Retry → Success

## Migration / Rollout

No database migrations required. Feature can be enabled incrementally:
1. Deploy new components (hidden)
2. Enable workspace banner
3. Enable admin tab
4. Monitor for issues

## Open Questions

None - all decisions captured from brainstorming session.

## References

- Server action: `orbit-www/src/app/actions/kafka-applications.ts:348` (retryVirtualClusterProvisioning)
- Types: `ApplicationData`, `ProvisioningDetails`, `EnvironmentProvisioningResult`
- Workspace view: `orbit-www/src/components/features/kafka/VirtualClustersList.tsx`
- Admin view: `orbit-www/src/app/(frontend)/platform/kafka/components/GatewayTab.tsx`
