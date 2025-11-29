# Health Monitoring - Phase 3 Design

## Overview

Phase 3 of the Application Lifecycle Catalog adds active health monitoring for applications. This enables Orbit to proactively check application health endpoints and track status over time.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Basic HTTP checks | Foundation first - URL polling, status code verification, up/down status |
| Execution | Temporal scheduled tasks | Native Temporal pattern, clean per-app isolation |
| Storage | Payload + history table | Current status in App, historical checks in separate collection |
| Alerts | Deferred | Focus on monitoring infrastructure; alerts in future phase |
| Architecture | Per-App Schedule | One Temporal schedule per app - clean isolation, easy enable/disable |

## Architecture

### Schedule Lifecycle

```
App Created/Updated with healthConfig.url → Create/Update Temporal Schedule
App Updated without healthConfig.url     → Delete Temporal Schedule
App Deleted                              → Delete Temporal Schedule
```

### Components

1. **Payload Hook** (`Apps.ts`): `afterChange` hook detects healthConfig changes
2. **Server Action**: Calls gRPC `HealthService.ManageSchedule(appId, healthConfig)`
3. **Go Service**: Creates/updates/deletes Temporal schedules
4. **Temporal Schedule**: Named `health-check-{appId}`, triggers workflow at configured interval

### Schedule Configuration

```go
client.ScheduleClient().Create(ctx, client.ScheduleOptions{
    ID: fmt.Sprintf("health-check-%s", appId),
    Spec: client.ScheduleSpec{
        Intervals: []client.ScheduleIntervalSpec{{
            Every: time.Duration(interval) * time.Second,
        }},
    },
    Action: &client.ScheduleWorkflowAction{
        Workflow: HealthCheckWorkflow,
        Args:     []any{appId, healthConfig},
    },
})
```

## Workflow & Activity Design

### HealthCheckWorkflow

Simple workflow that executes one activity and completes:

```go
func HealthCheckWorkflow(ctx workflow.Context, appId string, config HealthConfig) error {
    result, err := workflow.ExecuteActivity(ctx, PerformHealthCheckActivity, appId, config).Get(ctx, nil)
    if err != nil {
        // Activity failed - still record as "down"
        workflow.ExecuteActivity(ctx, RecordHealthResultActivity, appId, HealthResult{Status: "down", Error: err.Error()})
        return nil
    }
    workflow.ExecuteActivity(ctx, RecordHealthResultActivity, appId, result)
    return nil
}
```

### PerformHealthCheckActivity

- Makes HTTP request to `config.url` using `config.method`
- Applies `config.timeout` as request deadline
- Returns `HealthResult{Status, ResponseTime, StatusCode, Error}`

### Status Determination Logic

| Condition | Status |
|-----------|--------|
| Response matches expectedStatus | `healthy` |
| Response is 5xx or timeout | `down` |
| Response is 4xx or other error | `degraded` |

### RecordHealthResultActivity

- Calls Payload API to update `app.status` field
- Creates new document in `health-checks` collection for history

No retries within workflow - the schedule triggers again at next interval. Failed checks are recorded as failures.

## Data Model

### New Collection: HealthChecks

```typescript
// collections/HealthChecks.ts
export const HealthChecks: CollectionConfig = {
  slug: 'health-checks',
  admin: {
    group: 'Monitoring',
    defaultColumns: ['app', 'status', 'responseTime', 'createdAt'],
  },
  fields: [
    {
      name: 'app',
      type: 'relationship',
      relationTo: 'apps',
      required: true,
      index: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: ['healthy', 'degraded', 'down'],
    },
    {
      name: 'statusCode',
      type: 'number',
    },
    {
      name: 'responseTime',
      type: 'number', // milliseconds
    },
    {
      name: 'error',
      type: 'text',
    },
    {
      name: 'checkedAt',
      type: 'date',
      required: true,
      index: true,
    },
  ],
  timestamps: true,
}
```

### Data Retention

Phase 3: No automatic cleanup. Future phase will add cleanup workflow for records older than 7/30 days.

### Access Control

Same workspace-scoped access as Apps - users can only see health checks for apps in their workspaces.

## Frontend UI

### AppDetail.tsx Enhancements

1. **Health Check Card Update:**
   - Show last check time: "Last checked 30s ago"
   - Show response time: "Response: 245ms"
   - Visual indicator with status color

2. **New Health History Section:**
   - Table showing recent checks (last 10-20)
   - Columns: Time, Status, Response Time, Status Code
   - Link to "View All" for paginated history

### Server Action

- `getHealthHistory(appId, limit)` - fetches recent health checks for an app

### AppCard.tsx

No changes needed - already shows status indicator that updates when `app.status` changes.

## Out of Scope (Future Phases)

- Alert notifications (webhook, email, Slack)
- Response body validation
- Header configuration
- Non-HTTP monitors (TCP, DNS, etc.)
- SSL certificate monitoring
- Graphs and trend visualization
- Data retention/cleanup automation
- Retry logic within checks

## Dependencies

- Existing `healthConfig` schema on Apps (already implemented)
- Temporal server with schedule support
- Payload API accessible from Go services
