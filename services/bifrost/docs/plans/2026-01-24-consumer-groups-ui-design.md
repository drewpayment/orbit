# Consumer Groups UI Design

**Date**: 2026-01-24
**Status**: Draft
**Author**: Claude (brainstorming session)

## Overview

Replace the "Coming Soon" placeholder in the virtual cluster detail page with a working Consumer Groups panel that lists groups, shows lag metrics, and allows resetting offsets.

## Scope

**In Scope**:
- List consumer groups with state (Stable, Empty, Dead, etc.)
- Show lag metrics (total lag, per-partition lag on expand)
- Show subscribed topics and member count
- Reset offsets functionality (earliest, latest, timestamp)

**Out of Scope** (future work):
- Delete consumer group
- Detailed member management
- Offset seek to specific offset value

## Architecture

### Data Flow

```
ConsumerGroupsPanel → Server Action → Bifrost Admin API → Kafka APIs (via proxy)
```

The Bifrost admin service uses the same Kafka protocol modifiers we implemented for consumer group operations, applying the appropriate group prefix filtering.

### Backend (Bifrost Admin API)

New gRPC methods to add:

```protobuf
service BifrostAdmin {
  // ... existing methods ...

  rpc ListConsumerGroups(ListConsumerGroupsRequest) returns (ListConsumerGroupsResponse);
  rpc DescribeConsumerGroup(DescribeConsumerGroupRequest) returns (DescribeConsumerGroupResponse);
  rpc ResetConsumerGroupOffsets(ResetConsumerGroupOffsetsRequest) returns (ResetConsumerGroupOffsetsResponse);
}
```

### Frontend (orbit-www)

- `ConsumerGroupsPanel` component (following TopicsPanel pattern)
- Server actions in `actions/bifrost.ts`
- Expandable rows showing per-partition lag

## Data Model

### ConsumerGroup (list view)

```typescript
interface ConsumerGroup {
  groupId: string           // Virtual (unprefixed) group ID
  state: 'Stable' | 'PreparingRebalance' | 'CompletingRebalance' | 'Empty' | 'Dead'
  members: number           // Member count
  topics: string[]          // Subscribed topics (virtual names)
  totalLag: number          // Sum of lag across all partitions
}
```

### ConsumerGroupDetail (expanded view)

```typescript
interface ConsumerGroupDetail extends ConsumerGroup {
  partitions: PartitionLag[]
}

interface PartitionLag {
  topic: string
  partition: number
  currentOffset: number
  endOffset: number
  lag: number
  consumerId: string        // Which member owns this partition
}
```

### Reset Options

```typescript
type ResetType = 'earliest' | 'latest' | 'timestamp'

interface ResetOffsetsRequest {
  groupId: string
  topic: string             // Reset per-topic
  resetType: ResetType
  timestamp?: number        // Only for 'timestamp' type
}
```

## UI Design

### ConsumerGroupsPanel Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Consumer Groups                                    [Refresh] ⟳  │
├─────────────────────────────────────────────────────────────────┤
│ Group ID          State    Members  Topics   Total Lag  Actions │
├─────────────────────────────────────────────────────────────────┤
│ ▶ my-consumer     Stable      3       2        1,234            │
│ ▶ order-processor Empty       0       1            0            │
│ ▼ payment-handler Stable      2       1          456     [...]  │
│   ┌─────────────────────────────────────────────────────────────┐
│   │ Topic: payments  Partition: 0  Offset: 1000  Lag: 234       │
│   │ Topic: payments  Partition: 1  Offset: 1100  Lag: 222       │
│   │                                                             │
│   │ [Reset Offsets ▼]  → earliest | latest | to timestamp       │
│   └─────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────┘
```

### Key Interactions

1. **Expand/Collapse**: Click row to show partition-level detail
2. **Reset Offsets**: Dropdown with options (earliest, latest, timestamp)
3. **Confirmation**: Reset requires confirmation dialog (destructive action)
4. **Refresh**: Manual refresh button (auto-refresh optional)

## Implementation Tasks

### Phase 1: Backend (Bifrost Admin API)

1. **Add protobuf definitions** for consumer group messages in `proto/bifrost_admin.proto`
2. **Implement ListConsumerGroups RPC** - queries Kafka ListGroups + DescribeGroups, filters by prefix
3. **Implement DescribeConsumerGroup RPC** - gets partition-level lag via OffsetFetch + ListOffsets
4. **Implement ResetConsumerGroupOffsets RPC** - calls OffsetCommit with new offsets

### Phase 2: Frontend (orbit-www)

5. **Generate TypeScript client** from updated protos (`make proto-gen`)
6. **Create server actions** for consumer group operations in `actions/bifrost.ts`
7. **Build ConsumerGroupsPanel** component with list view
8. **Add expandable row** with partition lag detail
9. **Implement reset offsets** action with confirmation dialog
10. **Replace placeholder** in `cluster-detail-client.tsx`

### Phase 3: Testing & Polish

11. **Unit tests** for Bifrost admin service methods
12. **Integration tests** for end-to-end flow
13. **Manual testing** with e2e test script

## Technical Notes

### Calculating Lag

Lag = EndOffset - CurrentOffset

To get lag:
1. `OffsetFetch` → Get current committed offset per partition
2. `ListOffsets` (with timestamp=-1) → Get end offset (latest) per partition
3. Subtract to get lag

### Group State Mapping

Kafka group states:
- `Stable` - Group is stable with assigned partitions
- `PreparingRebalance` - Group is preparing for rebalance
- `CompletingRebalance` - Group is completing rebalance
- `Empty` - Group has no members
- `Dead` - Group is being deleted

### Reset Offsets Implementation

1. Consumer group must be in `Empty` or `Dead` state (no active consumers)
2. Determine new offset based on reset type:
   - `earliest`: ListOffsets with timestamp=-2
   - `latest`: ListOffsets with timestamp=-1
   - `timestamp`: ListOffsets with specified timestamp
3. Call OffsetCommit with new offset values

## Dependencies

- Bifrost consumer group protocol modifiers (completed)
- Kafka admin client in Bifrost service
- Proto generation toolchain

## Success Criteria

1. Consumer groups panel loads and displays groups for virtual cluster
2. Expanding a group shows per-partition lag
3. Reset offsets works for empty groups
4. UI matches existing panel styling (TopicsPanel, ServiceAccountsPanel)
