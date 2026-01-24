# Consumer Groups UI Implementation Plan

**Date**: 2026-01-24
**Status**: Ready for Implementation
**Design Doc**: `services/bifrost/docs/plans/2026-01-24-consumer-groups-ui-design.md`

## Overview

Implement the Consumer Groups panel in the Orbit UI to display consumer groups with lag metrics and provide offset reset functionality.

## Phase 1: Protobuf Definitions

### Task 1.1: Add Consumer Group Messages to gateway.proto

**File**: `proto/idp/gateway/v1/gateway.proto`

Add after line 340 (after ClientActivityResponse):

```protobuf
// ============================================================================
// Consumer Group Messages (Monitoring & Management)
// ============================================================================

enum ConsumerGroupState {
  CONSUMER_GROUP_STATE_UNSPECIFIED = 0;
  CONSUMER_GROUP_STATE_STABLE = 1;
  CONSUMER_GROUP_STATE_PREPARING_REBALANCE = 2;
  CONSUMER_GROUP_STATE_COMPLETING_REBALANCE = 3;
  CONSUMER_GROUP_STATE_EMPTY = 4;
  CONSUMER_GROUP_STATE_DEAD = 5;
}

enum OffsetResetType {
  OFFSET_RESET_TYPE_UNSPECIFIED = 0;
  OFFSET_RESET_TYPE_EARLIEST = 1;
  OFFSET_RESET_TYPE_LATEST = 2;
  OFFSET_RESET_TYPE_TIMESTAMP = 3;
}

message ConsumerGroupSummary {
  string group_id = 1;                    // Virtual (unprefixed) group ID
  ConsumerGroupState state = 2;
  int32 member_count = 3;
  repeated string topics = 4;             // Virtual topic names
  int64 total_lag = 5;
}

message PartitionLag {
  string topic = 1;                       // Virtual topic name
  int32 partition = 2;
  int64 current_offset = 3;
  int64 end_offset = 4;
  int64 lag = 5;
  string consumer_id = 6;                 // Member owning this partition
}

message ConsumerGroupDetail {
  string group_id = 1;
  ConsumerGroupState state = 2;
  int32 member_count = 3;
  repeated string topics = 4;
  int64 total_lag = 5;
  repeated PartitionLag partitions = 6;
}
```

### Task 1.2: Add Consumer Group RPCs to BifrostAdminService

**File**: `proto/idp/gateway/v1/gateway.proto`

Add to the BifrostAdminService definition (after ListTopicACLs):

```protobuf
  // Consumer group monitoring
  rpc ListConsumerGroups(ListConsumerGroupsRequest) returns (ListConsumerGroupsResponse);
  rpc DescribeConsumerGroup(DescribeConsumerGroupRequest) returns (DescribeConsumerGroupResponse);
  rpc ResetConsumerGroupOffsets(ResetConsumerGroupOffsetsRequest) returns (ResetConsumerGroupOffsetsResponse);
```

Add request/response messages:

```protobuf
// Consumer Group Requests
message ListConsumerGroupsRequest {
  string virtual_cluster_id = 1;
}

message ListConsumerGroupsResponse {
  repeated ConsumerGroupSummary groups = 1;
  string error = 2;
}

message DescribeConsumerGroupRequest {
  string virtual_cluster_id = 1;
  string group_id = 2;                    // Virtual group ID
}

message DescribeConsumerGroupResponse {
  ConsumerGroupDetail group = 1;
  string error = 2;
}

message ResetConsumerGroupOffsetsRequest {
  string virtual_cluster_id = 1;
  string group_id = 2;                    // Virtual group ID
  string topic = 3;                       // Virtual topic name (reset per-topic)
  OffsetResetType reset_type = 4;
  int64 timestamp = 5;                    // Only used if reset_type = TIMESTAMP
}

message ResetConsumerGroupOffsetsResponse {
  bool success = 1;
  string error = 2;
  repeated PartitionLag new_offsets = 3;  // New offset positions after reset
}
```

### Task 1.3: Generate Proto Code

```bash
make proto-gen
```

**Verification**:
- Check `proto/gen/go/idp/gateway/v1/gateway.pb.go` for new types
- Check `orbit-www/src/lib/proto/` for TypeScript definitions

---

## Phase 2: Bifrost Admin Service Implementation

### Task 2.1: Create Kafka Admin Client

**File**: `services/bifrost/internal/admin/kafka_client.go` (new)

```go
package admin

import (
    "context"
    "github.com/twmb/franz-go/pkg/kadm"
    "github.com/twmb/franz-go/pkg/kgo"
)

// KafkaAdminClient wraps franz-go admin client for consumer group operations.
type KafkaAdminClient struct {
    client *kgo.Client
    admin  *kadm.Client
}

// NewKafkaAdminClient creates a client connected to the physical Kafka cluster.
func NewKafkaAdminClient(bootstrapServers string) (*KafkaAdminClient, error) {
    // Implementation
}

// ListGroups returns all consumer groups on the cluster.
func (k *KafkaAdminClient) ListGroups(ctx context.Context) ([]kadm.DescribedGroup, error)

// DescribeGroup returns detailed info about a specific group.
func (k *KafkaAdminClient) DescribeGroup(ctx context.Context, groupID string) (*kadm.DescribedGroup, error)

// FetchGroupOffsets returns committed offsets for a group.
func (k *KafkaAdminClient) FetchGroupOffsets(ctx context.Context, groupID string) (kadm.OffsetResponses, error)

// FetchEndOffsets returns end offsets for topics.
func (k *KafkaAdminClient) FetchEndOffsets(ctx context.Context, topics []string) (kadm.ListedOffsets, error)

// CommitOffsets commits new offsets for a group.
func (k *KafkaAdminClient) CommitOffsets(ctx context.Context, groupID string, offsets map[string]map[int32]kgo.Offset) error
```

### Task 2.2: Implement ListConsumerGroups

**File**: `services/bifrost/internal/admin/service.go`

Add method:

```go
func (s *Service) ListConsumerGroups(ctx context.Context, req *gatewayv1.ListConsumerGroupsRequest) (*gatewayv1.ListConsumerGroupsResponse, error) {
    // 1. Get virtual cluster config (for prefixes and bootstrap servers)
    vc, ok := s.vcStore.Get(req.VirtualClusterId)
    if !ok {
        return nil, status.Errorf(codes.NotFound, "virtual cluster %s not found", req.VirtualClusterId)
    }

    // 2. Create Kafka admin client
    client, err := NewKafkaAdminClient(vc.PhysicalBootstrapServers)
    if err != nil {
        return nil, status.Errorf(codes.Internal, "failed to connect to Kafka: %v", err)
    }
    defer client.Close()

    // 3. List all groups from Kafka
    groups, err := client.ListGroups(ctx)

    // 4. Filter by group prefix and unprefix
    var result []*gatewayv1.ConsumerGroupSummary
    for _, g := range groups {
        if !strings.HasPrefix(g.Group, vc.GroupPrefix) {
            continue
        }
        virtualGroupID := strings.TrimPrefix(g.Group, vc.GroupPrefix)

        // 5. Calculate lag for each group
        lag, topics := s.calculateGroupLag(ctx, client, g, vc)

        result = append(result, &gatewayv1.ConsumerGroupSummary{
            GroupId:     virtualGroupID,
            State:       mapGroupState(g.State),
            MemberCount: int32(len(g.Members)),
            Topics:      topics,
            TotalLag:    lag,
        })
    }

    return &gatewayv1.ListConsumerGroupsResponse{Groups: result}, nil
}
```

### Task 2.3: Implement DescribeConsumerGroup

**File**: `services/bifrost/internal/admin/service.go`

Add method to get detailed partition-level lag information.

### Task 2.4: Implement ResetConsumerGroupOffsets

**File**: `services/bifrost/internal/admin/service.go`

Add method:

```go
func (s *Service) ResetConsumerGroupOffsets(ctx context.Context, req *gatewayv1.ResetConsumerGroupOffsetsRequest) (*gatewayv1.ResetConsumerGroupOffsetsResponse, error) {
    // 1. Validate group is empty (can't reset active group)
    // 2. Determine target offsets based on reset_type
    // 3. Commit new offsets
    // 4. Return new offset positions
}
```

### Task 2.5: Add Unit Tests

**File**: `services/bifrost/internal/admin/service_test.go`

Add tests for:
- ListConsumerGroups with prefix filtering
- DescribeConsumerGroup with lag calculation
- ResetConsumerGroupOffsets validation and execution

**Verification**: `cd services/bifrost && go test -v -race ./internal/admin/...`

---

## Phase 3: Frontend Implementation

### Task 3.1: Create Server Actions

**File**: `orbit-www/src/app/actions/bifrost.ts` (extend existing or create new)

```typescript
'use server'

import { createGrpcTransport } from '@connectrpc/connect-node'
import { createClient } from '@connectrpc/connect'
import { BifrostAdminService } from '@/lib/proto/idp/gateway/v1/gateway_connect'

export async function listConsumerGroups(virtualClusterId: string) {
  const client = createClient(BifrostAdminService, transport)
  const response = await client.listConsumerGroups({ virtualClusterId })
  if (response.error) {
    throw new Error(response.error)
  }
  return response.groups
}

export async function describeConsumerGroup(virtualClusterId: string, groupId: string) {
  const client = createClient(BifrostAdminService, transport)
  const response = await client.describeConsumerGroup({ virtualClusterId, groupId })
  if (response.error) {
    throw new Error(response.error)
  }
  return response.group
}

export async function resetConsumerGroupOffsets(
  virtualClusterId: string,
  groupId: string,
  topic: string,
  resetType: 'earliest' | 'latest' | 'timestamp',
  timestamp?: number
) {
  const client = createClient(BifrostAdminService, transport)
  const response = await client.resetConsumerGroupOffsets({
    virtualClusterId,
    groupId,
    topic,
    resetType: mapResetType(resetType),
    timestamp: timestamp ? BigInt(timestamp) : undefined,
  })
  if (response.error) {
    throw new Error(response.error)
  }
  return { success: response.success, newOffsets: response.newOffsets }
}
```

### Task 3.2: Create ConsumerGroupsPanel Component

**File**: `orbit-www/src/components/features/kafka/ConsumerGroupsPanel.tsx` (new)

Follow TopicsPanel.tsx pattern:
- Table with Group ID, State, Members, Topics, Total Lag columns
- Expandable rows showing partition-level detail
- Refresh button
- Reset offsets action with confirmation dialog

```typescript
'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RefreshCw, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { listConsumerGroups, describeConsumerGroup, resetConsumerGroupOffsets } from '@/app/actions/bifrost'

interface ConsumerGroupsPanelProps {
  virtualClusterId: string
  virtualClusterName: string
  environment: string
}

export function ConsumerGroupsPanel({
  virtualClusterId,
  virtualClusterName,
  environment,
}: ConsumerGroupsPanelProps) {
  // Implementation following TopicsPanel pattern
}
```

### Task 3.3: Create ExpandedGroupRow Component

**File**: `orbit-www/src/components/features/kafka/ExpandedGroupRow.tsx` (new)

Shows partition-level lag when a row is expanded.

### Task 3.4: Create ResetOffsetsDialog Component

**File**: `orbit-www/src/components/features/kafka/ResetOffsetsDialog.tsx` (new)

Dialog for resetting offsets with options (earliest, latest, timestamp).

### Task 3.5: Integrate into Cluster Detail Page

**File**: `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/clusters/[clusterId]/cluster-detail-client.tsx`

Replace the "Coming Soon" placeholder (lines 236-254) with:

```tsx
<TabsContent value="consumer-groups">
  <ConsumerGroupsPanel
    virtualClusterId={cluster.id}
    virtualClusterName={cluster.name}
    environment={cluster.environment}
  />
</TabsContent>
```

---

## Phase 4: Testing & Integration

### Task 4.1: Manual Testing with E2E Script

Use the existing `cmd/consumergrouptest/main.go` to create test consumer groups, then verify they appear in the UI.

### Task 4.2: Frontend Component Tests

**File**: `orbit-www/src/components/features/kafka/ConsumerGroupsPanel.test.tsx` (new)

Test:
- Renders loading state
- Renders empty state
- Renders groups with correct data
- Expandable row interaction
- Reset offsets dialog

**Verification**: `cd orbit-www && pnpm exec vitest run`

### Task 4.3: Integration Test

Verify end-to-end flow:
1. Create virtual cluster via Bifrost admin API
2. Create consumer group via Kafka client
3. Call ListConsumerGroups API
4. Verify group appears with correct (unprefixed) ID

---

## Files to Create/Modify

### New Files
1. `services/bifrost/internal/admin/kafka_client.go` - Kafka admin client wrapper
2. `orbit-www/src/components/features/kafka/ConsumerGroupsPanel.tsx` - Main component
3. `orbit-www/src/components/features/kafka/ExpandedGroupRow.tsx` - Partition detail
4. `orbit-www/src/components/features/kafka/ResetOffsetsDialog.tsx` - Reset dialog
5. `orbit-www/src/components/features/kafka/ConsumerGroupsPanel.test.tsx` - Tests

### Modified Files
1. `proto/idp/gateway/v1/gateway.proto` - Add consumer group messages/RPCs
2. `services/bifrost/internal/admin/service.go` - Implement consumer group methods
3. `services/bifrost/internal/admin/service_test.go` - Add unit tests
4. `orbit-www/src/app/actions/bifrost.ts` - Add server actions
5. `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/clusters/[clusterId]/cluster-detail-client.tsx` - Wire up component

---

## Verification Checklist

- [ ] `make proto-gen` succeeds
- [ ] `cd services/bifrost && go test -v -race ./...` passes
- [ ] `cd orbit-www && pnpm build` succeeds
- [ ] `cd orbit-www && pnpm exec vitest run` passes
- [ ] Consumer groups panel shows groups from test script
- [ ] Expanding a row shows partition lag
- [ ] Reset offsets works on empty groups

---

## Dependencies

- Bifrost consumer group protocol modifiers (completed in previous work)
- franz-go library (already a dependency in Bifrost)
- Connect-ES gRPC client (already used in orbit-www)
