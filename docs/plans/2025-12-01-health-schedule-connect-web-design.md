# Health Schedule Management - Connect-Web Design

## Problem

Health check schedules need to be created/updated/deleted when Apps are saved with healthConfig. Previous attempts using `@connectrpc/connect-node` broke Next.js webpack bundling.

## Root Cause Analysis

| Package | Protocol | Next.js Compatible |
|---------|----------|-------------------|
| `@connectrpc/connect-web` | HTTP/1.1 + JSON (Connect) | Yes |
| `@connectrpc/connect-node` | HTTP/2 + Binary (gRPC) | No - native dependencies |

All existing gRPC clients in the codebase use `connect-web` successfully. The failed `template-client.ts` used `connect-node`, which caused the bundling issues.

## Solution

Use `@connectrpc/connect-web` for health schedule management, matching the pattern of all other gRPC clients in the codebase.

## Architecture

```
App saved in Payload
    ↓
afterChange hook (Apps.ts)
    ↓
health-client.ts (connect-web)
    ↓
HTTP/1.1 + JSON (Connect protocol)
    ↓
Go HealthService (repository-service:50051)
    ↓
Temporal Schedule created/updated/deleted
```

## Implementation

### 1. Create health-client.ts

```typescript
// orbit-www/src/lib/grpc/health-client.ts
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { HealthService } from '@/lib/proto/idp/health/v1/health_pb';

const transport = createConnectTransport({
  baseUrl: process.env.REPOSITORY_SERVICE_URL || 'http://localhost:50051',
});

export const healthClient = createClient(HealthService, transport);
```

### 2. Update Apps.ts Hooks

```typescript
// orbit-www/src/collections/Apps.ts
import { healthClient } from '@/lib/grpc/health-client';

hooks: {
  afterChange: [
    async ({ doc, previousDoc, operation }) => {
      const healthConfigChanged =
        doc.healthConfig?.url !== previousDoc?.healthConfig?.url ||
        doc.healthConfig?.interval !== previousDoc?.healthConfig?.interval;

      if (!healthConfigChanged && operation === 'update') {
        return doc;
      }

      // Fire and forget - don't block the save
      healthClient.manageSchedule({
        appId: doc.id,
        healthConfig: doc.healthConfig?.url ? {
          url: doc.healthConfig.url,
          method: doc.healthConfig.method || 'GET',
          expectedStatus: doc.healthConfig.expectedStatus || 200,
          interval: doc.healthConfig.interval || 60,
          timeout: doc.healthConfig.timeout || 10,
        } : undefined,
      }).catch(err => console.error('Failed to manage health schedule:', err));

      return doc;
    },
  ],
  afterDelete: [
    async ({ doc }) => {
      healthClient.deleteSchedule({ appId: doc.id })
        .catch(err => console.error('Failed to delete health schedule:', err));
    },
  ],
}
```

## Why This Works

1. **Connect protocol**: Go services using `connectrpc` automatically support both gRPC (HTTP/2) and Connect (HTTP/1.1+JSON) protocols on the same port
2. **Browser-compatible**: `connect-web` is designed for browser environments and works with webpack
3. **Same pattern**: Matches all other gRPC clients in the codebase

## Files to Modify

1. `orbit-www/src/lib/grpc/health-client.ts` - Create new file
2. `orbit-www/src/collections/Apps.ts` - Add hooks

## Testing

1. Create an app with healthConfig.url set
2. Verify Temporal schedule is created (check Temporal UI)
3. Update app's healthConfig
4. Verify schedule is updated
5. Delete app
6. Verify schedule is deleted
