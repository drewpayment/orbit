# Kafka Topic Message Browser & Producer — Design Document

**Date:** 2026-03-28
**Author:** Jon (Product Manager) with Gage (Principal Engineer) and Miguel (Next.js Architect)
**Status:** Design Complete — Ready for Implementation Planning
**Inspired by:** [kafbat/kafka-ui](https://github.com/kafbat/kafka-ui)

---

## 1. Problem Statement

Orbit users can create Kafka topics, manage schemas, configure ACLs, and share topics across workspaces — but they cannot see what's actually in them. To inspect messages, users must use external tools (kafkacat, kafka-console-consumer) with manual SASL credentials. This breaks the "single pane of glass" promise of the IDP.

This feature adds the ability to **browse messages** on topics a user owns or has access to, and **produce new messages** — directly from the Orbit UI.

---

## 2. Scope

### In Scope (MVP)
- Browse messages on any topic the user owns or has shared access to
- Produce messages to topics the user has write access to
- Cursor-based pagination with seek modes (newest, oldest, from offset)
- Partition filtering
- Row expansion with full message content (key, value, headers) in Monaco editor
- JSON auto-detection and pretty-printing
- Access-aware UI (hide produce button for read-only users)
- **Bifrost adapter migration** — route ALL broker operations through Bifrost (eliminates direct Redpanda connections)

### Out of Scope (v2)
- Live tailing mode (SSE streaming)
- Schema Registry auto-deserialization (Avro/Protobuf)
- Advanced filters (regex, time range, CEL expressions)
- Reproduce message action (pre-fill produce form from existing message)
- Consumer group offset tracking in browser
- Serde selector dropdowns

---

## 3. Architecture Overview

### Data Flow

```
Browser → Next.js Server Action → Kafka Service (gRPC) → Bifrost Admin (gRPC) → Redpanda Broker
```

### Responsibility Split

| Layer | Owns | Does NOT Own |
|-------|------|-------------|
| **Next.js** | Session auth, server actions, UI rendering | Business logic, broker communication |
| **Kafka Service** | Access control (ownership + share verification), pagination, message formatting, size limits | Broker protocol, topic prefix translation |
| **Bifrost** | Broker connections, topic prefix translation, SASL, raw consume/produce | Auth, business logic, who can see what |

### Key Principle

The frontend never knows Bifrost exists. The Kafka service is the single API surface for all Kafka operations. Bifrost RPCs are "dumb" broker operations — take a virtual cluster ID + topic name, handle prefix translation internally, return raw bytes.

---

## 4. Bifrost Admin API Expansion

### New RPCs in `gateway.proto`

**Topic Management (5 new):**

| RPC | Input | Output | Notes |
|-----|-------|--------|-------|
| `CreateTopic` | virtual_cluster_id, topic_name, partitions, replication_factor, config | success | Translates to physical name via prefix |
| `DeleteTopic` | virtual_cluster_id, topic_name | success | |
| `DescribeTopic` | virtual_cluster_id, topic_name | partition_count, config, offsets | |
| `UpdateTopicConfig` | virtual_cluster_id, topic_name, config_entries | success | |
| `ListTopics` | virtual_cluster_id | topic_names[] | Strips prefix from returned names |

**Metrics (1 new):**

| RPC | Input | Output |
|-----|-------|--------|
| `GetTopicMetrics` | virtual_cluster_id, topic_name | message_count, bytes, per_partition_offsets |

**Message Operations (2 new):**

| RPC | Input | Output |
|-----|-------|--------|
| `BrowseMessages` | virtual_cluster_id, topic_name, partitions[], start_offset, seek_type, limit | messages[], next_cursor |
| `ProduceMessage` | virtual_cluster_id, topic_name, partition, key, value, headers[] | offset, partition, timestamp |

**v2 (deferred):**

| RPC | Input | Output |
|-----|-------|--------|
| `TailMessages` | virtual_cluster_id, topic_name, partitions[] | stream of messages |

### Seek Types

- `NEWEST` — start from latest offset (default)
- `OLDEST` — start from earliest offset
- `OFFSET` — start from user-specified numeric offset
- `TIMESTAMP` — start from user-specified timestamp (v2)

### Consumer Strategy

Bifrost creates a **temporary consumer** (no consumer group) using `AssignPartitions` at the requested offset, fetches `limit` messages, and tears down. No persistent state, no interference with production consumers.

---

## 5. Kafka Service API & Access Control

### New RPCs in `kafka.proto`

```protobuf
rpc BrowseTopicMessages(BrowseTopicMessagesRequest) returns (BrowseTopicMessagesResponse);
rpc ProduceTopicMessage(ProduceTopicMessageRequest) returns (ProduceTopicMessageResponse);
```

### Access Control Flow

Both RPCs follow the same auth pattern:

1. Extract `user_id` and `workspace_id` from gRPC metadata (set by Next.js server action)
2. Look up topic by `topic_id` — get workspace ownership and virtual cluster ID
3. **Ownership check:** Is the user a member of the topic's workspace? If yes → allow (read + write)
4. **Share check:** If not the owner's workspace, does an approved `kafka-topic-share` exist for this user's workspace?
   - Share with `read` or `read-write` permission → allow browse
   - Share with `write` or `read-write` permission → allow produce
   - No share → reject with `PermissionDenied`
5. **Delegate to Bifrost:** Call `BrowseMessages` or `ProduceMessage` with the topic's `virtual_cluster_id` and topic name

### Message Response Model

```protobuf
message KafkaMessage {
  int32 partition = 1;
  int64 offset = 2;
  int64 timestamp = 3;       // unix milliseconds
  bytes key = 4;              // nullable
  bytes value = 5;
  map<string, string> headers = 6;
  int32 key_size = 7;
  int32 value_size = 8;
  bool truncated = 9;
}
```

### Size Limits

| Limit | Value | Rationale |
|-------|-------|-----------|
| Messages per batch | 50 | Browser memory / render performance |
| Max message value returned | 1 MB | Matches Kafka default `max.message.bytes` |
| Max key returned | 10 KB | Keys are typically small |
| Produce max message size | 1 MB | Matches broker config |
| Table cell key truncation | 64 chars | Visual fit |
| Table cell value truncation | 256 chars | Visual fit |

Messages exceeding the return limit are truncated server-side with `truncated: true` flag.

### Cursor Design

Opaque base64-encoded string containing `{partition: offset}` pairs for each partition. The Kafka service passes this to Bifrost on the next page request. The frontend treats it as an opaque token.

---

## 6. Adapter Migration — `apache/client.go` → Bifrost gRPC

### Current State

The `KafkaAdapter` interface in the Kafka service has 11 broker-facing methods implemented in `apache/client.go` using franz-go, connecting directly to Redpanda. This bypasses Bifrost's abstraction layer.

### Target State

A new `bifrost/client.go` implementation of the same `KafkaAdapter` interface that calls Bifrost's admin gRPC instead. The interface is unchanged — only the implementation swaps.

### Migration Table

| KafkaAdapter Method | Current (franz-go) | After (Bifrost gRPC) | Bifrost RPC Exists? |
|---------------------|-------------------|---------------------|-------------------|
| `CreateTopic` | `kadm.CreateTopic()` | `bifrostClient.CreateTopic()` | **NEW** |
| `DeleteTopic` | `kadm.DeleteTopic()` | `bifrostClient.DeleteTopic()` | **NEW** |
| `DescribeTopic` | `kadm.DescribeTopicConfigs()` | `bifrostClient.DescribeTopic()` | **NEW** |
| `UpdateTopicConfig` | `kadm.AlterTopicConfigs()` | `bifrostClient.UpdateTopicConfig()` | **NEW** |
| `ListTopics` | `kadm.ListTopics()` | `bifrostClient.ListTopics()` | **NEW** |
| `CreateACL` | `kadm.CreateACLs()` | `bifrostClient.UpsertTopicACL()` | EXISTS |
| `DeleteACL` | `kadm.DeleteACLs()` | `bifrostClient.RevokeTopicACL()` | EXISTS |
| `ListACLs` | `kadm.DescribeACLs()` | `bifrostClient.ListTopicACLs()` | EXISTS |
| `GetTopicMetrics` | `kadm.ListEndOffsets()` | `bifrostClient.GetTopicMetrics()` | **NEW** |
| `GetConsumerGroupLag` | `kadm.Lag()` | `bifrostClient.DescribeConsumerGroup()` | EXISTS |
| `ListConsumerGroups` | `kadm.DescribeGroups()` | `bifrostClient.ListConsumerGroups()` | EXISTS |

### File Structure Change

```
services/kafka/internal/adapters/
  adapter.go            ← interface (unchanged)
  bifrost/client.go     ← NEW: implements KafkaAdapter via Bifrost gRPC
  apache/client.go      ← KEPT: used internally by Bifrost for broker ops
```

### Wire-Up Change

In `services/kafka/cmd/server/main.go`: replace `apache.NewClient(brokerAddr)` with `bifrost.NewClient(bifrostAdminAddr)`.

The `apache/client.go` file is NOT deleted — it remains as Bifrost's internal implementation. Bifrost itself still uses franz-go to talk to the broker. What changes is that the Kafka service no longer imports franz-go or connects to Redpanda directly.

---

## 7. Frontend Architecture

### Component Tree

```
topic-detail-client.tsx (existing — add "Messages" as 6th tab)
└── <TabsContent value="messages">
    └── <Suspense fallback={<MessagesSkeleton />}>
        └── <TopicMessagesPanel>  ← lazy loaded via dynamic()
            ├── <MessageFilterToolbar />
            │   ├── SeekMode select (Newest / Oldest / From Offset)
            │   ├── Offset input (shown only in "From Offset" mode)
            │   ├── Partition select (All / specific partition)
            │   └── Produce button (hidden if user has read-only access)
            ├── <MessagesTable />
            │   ├── Column headers (Partition, Offset, Timestamp, Key, Value, Actions)
            │   ├── <MessageRow /> (collapsible)
            │   │   └── <MessageDetail /> (expanded state)
            │   │       ├── Tabs: Key | Value | Headers
            │   │       ├── Monaco editor (read-only, JSON auto-detected)
            │   │       └── Metadata: timestamp, key size, value size, truncated badge
            │   ├── "Load more" button (cursor pagination)
            │   └── Empty state ("No messages yet. Produce your first message →")
            └── <ProduceMessageSheet />  ← existing Sheet component
                ├── Partition selector
                ├── Key editor (Monaco, compact)
                ├── Value editor (Monaco, larger)
                ├── Headers key-value input (add/remove rows)
                └── Submit with validation
```

### Lazy Loading Strategy

The entire Messages tab is lazy-loaded to ensure zero bundle impact on initial page load:

```tsx
const TopicMessagesPanel = dynamic(
  () => import('@/components/features/kafka/TopicMessagesPanel'),
  { ssr: false, loading: () => <MessagesSkeleton /> }
)
```

Monaco editors are further sub-split — only mounted on row expansion or when the produce sheet opens. Table cells use `<pre className="truncate">` for performance with 50+ visible rows.

### State Management

Single custom hook `useTopicMessages(topicId, workspaceSlug)` manages:
- Filter state (seek mode, offset, partition)
- Message buffer
- Pagination cursor
- Loading / error state

Calls server actions for data fetching. Consistent with the rest of the codebase — no new dependencies (no TanStack Query).

### Access-Aware Rendering

The server action returns `{ canBrowse, canProduce }` flags based on ownership/share permissions:
- `canBrowse = false` → Messages tab not shown at all
- `canProduce = false` → Produce button hidden, produce sheet never rendered
- `canProduce = true` → Produce button visible in toolbar

### Existing Components Reused

| Component | Source | Usage |
|-----------|--------|-------|
| `Sheet` | `components/ui/sheet.tsx` | Produce message sidebar |
| Monaco Editor | `@monaco-editor/react` (already installed) | Message detail + produce form |
| Radix Tabs | Already in `topic-detail-client.tsx` | 6th "Messages" tab |
| Toast | Existing toast system | Success/error notifications |

---

## 8. Server Actions & Data Flow

### New File: `orbit-www/src/app/actions/kafka-messages.ts`

**Actions:**

| Action | Input | Output |
|--------|-------|--------|
| `browseTopicMessages` | topicId, seekType, startOffset?, partition?, cursor? | messages[], nextCursor, hasMore, canProduce |
| `produceTopicMessage` | topicId, partition?, key?, value, headers? | success, offset, partition, timestamp, error? |
| `getMessagePermissions` | topicId | canBrowse, canProduce |

### Browse Data Flow

1. User clicks "Messages" tab → `useTopicMessages` hook calls `browseTopicMessages(topicId, 'NEWEST')`
2. Server action: `getPayloadUserFromSession()` → verify auth
3. Server action: look up topic in Payload → get `virtualClusterId`, `workspaceId`
4. Server action: verify ownership or share access → determine `canBrowse`/`canProduce`
5. Server action: call Kafka service gRPC `BrowseTopicMessages`
6. Kafka service: call Bifrost gRPC `BrowseMessages(virtualClusterId, topicName, ...)`
7. Bifrost: resolve physical topic name, create temporary consumer, fetch messages, return
8. Response flows back: Bifrost → Kafka service → server action → hook → UI

### Produce Data Flow

1. User fills produce sheet, clicks submit
2. Server action: auth + access check (must have `write` or `read-write` permission)
3. Server action: call Kafka service gRPC `ProduceTopicMessage`
4. Kafka service: call Bifrost gRPC `ProduceMessage(virtualClusterId, topicName, ...)`
5. Bifrost: resolve physical name, produce via franz-go, return offset/partition/timestamp
6. UI: toast success with offset, optionally refresh message list

### Error Handling

| Error Source | Handling |
|-------------|----------|
| Auth failure | Return before gRPC call, redirect to login if session expired |
| Permission denied | Return `{ error: "You don't have access to this topic" }` |
| Topic not found | Return `{ error: "Topic not found" }` |
| Broker unreachable | Return `{ error: "Unable to connect to Kafka broker" }` |
| Empty topic | Return `{ messages: [], hasMore: false }` — UI shows empty state |
| Produce failure | Return `{ success: false, error: "..." }` — UI shows toast error |

---

## 9. Implementation Phases

### Phase A: Bifrost Admin API Expansion (3 days)

| Task | Files | Days |
|------|-------|------|
| Add 9 new RPCs to `gateway.proto` | `proto/idp/gateway/v1/gateway.proto` | 0.5 |
| Regenerate proto (Go + TypeScript) | `proto/gen/go/`, `orbit-www/src/lib/proto/` | 0.25 |
| Implement topic CRUD handlers in Bifrost | `services/bifrost/internal/admin/` | 1.25 |
| Implement BrowseMessages + ProduceMessage handlers | `services/bifrost/internal/admin/` | 0.5 |
| Unit tests for all new handlers | `services/bifrost/internal/admin/` | 0.5 |

### Phase B: Adapter Migration (2 days)

| Task | Files | Days |
|------|-------|------|
| Create `bifrost/client.go` implementing `KafkaAdapter` via Bifrost gRPC | `services/kafka/internal/adapters/bifrost/` | 1 |
| Wire new adapter in `main.go`, remove direct Redpanda connection | `services/kafka/cmd/server/main.go` | 0.5 |
| Integration tests for all 11 adapter methods | `services/kafka/tests/` | 0.5 |

### Phase C: Message Browser Feature (5 days)

| Task | Files | Days |
|------|-------|------|
| Add `BrowseTopicMessages` + `ProduceTopicMessage` to `kafka.proto` + handlers | `proto/idp/kafka/v1/kafka.proto`, `services/kafka/internal/grpc/` | 1 |
| Server actions: `kafka-messages.ts` with auth + access control | `orbit-www/src/app/actions/kafka-messages.ts` | 0.5 |
| `TopicMessagesPanel` + `MessageFilterToolbar` + `MessagesTable` | `orbit-www/src/components/features/kafka/` | 1.5 |
| `MessageRow` + `MessageDetail` with Monaco expansion | `orbit-www/src/components/features/kafka/` | 0.5 |
| `ProduceMessageSheet` with Monaco editors + validation | `orbit-www/src/components/features/kafka/` | 0.5 |
| Wire Messages tab into `topic-detail-client.tsx` + `useTopicMessages` hook | `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/[topicId]/` | 0.5 |
| Empty state, access-aware rendering, error handling | Various | 0.5 |

### Phase D: QA & Cleanup (1 day)

| Task | Files | Days |
|------|-------|------|
| Frontend unit tests (Vitest) for components + hook | `orbit-www/src/components/features/kafka/__tests__/` | 0.5 |
| End-to-end manual QA via agent-browser | — | 0.25 |
| Update ROADMAP.md, clean up TODOs | `docs/ROADMAP.md` | 0.25 |

**Total: ~11 days**

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Messages browsable on owned topics | 100% of active topics |
| Messages browsable on shared topics | Respects share permissions (read/read-write) |
| Produce available on owned topics | 100% |
| Produce available on shared topics | Only with write/read-write permission |
| Direct Redpanda connections from Kafka service | 0 (all through Bifrost) |
| Page load impact from Messages tab | 0 bytes (fully lazy-loaded) |
| Browse response time (50 messages) | < 2 seconds |
| Produce response time | < 1 second |

---

## 11. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Bifrost topic CRUD RPCs reveal edge cases in prefix translation | Medium | Medium | Test with multiple virtual clusters and topic prefixes |
| Adapter migration breaks existing topic operations | Medium | High | Run full existing test suite after Phase B; feature flag the adapter swap if needed |
| Large messages (>1MB) cause browser performance issues | Low | Medium | Truncation with `truncated` flag; Monaco lazy-load only on expand |
| Temporary consumer in Bifrost leaks if not cleaned up | Low | High | Use `defer` for cleanup; add timeout to consumer lifecycle |
| Bifrost admin port (50060) not accessible from Kafka service in Docker | Low | Low | Verify docker-compose networking; both services on same Docker network |

---

## 12. v2 Roadmap

| Feature | Architecture Notes |
|---------|-------------------|
| **Live tailing** | Bifrost `TailMessages` server-stream → Kafka service stream → Next.js SSE route handler → EventSource in browser |
| **Schema Registry serde** | Query existing Schema Registry adapter for topic's subject → auto-deserialize Avro/Protobuf → show schema badge |
| **Advanced filters** | CEL expression evaluation in Kafka service (Go has CEL libraries) or client-side filtering |
| **Reproduce message** | Pre-fill produce sheet from row action menu — low effort once produce sheet exists |
| **Timestamp seek** | Add `TIMESTAMP` seek type to Bifrost `BrowseMessages` RPC |

---

## Appendix A: Existing Bifrost Admin RPCs (Already Available)

These do NOT need to be added — they're already in `gateway.proto`:

- `UpsertTopicACL` / `RevokeTopicACL` / `ListTopicACLs`
- `ListConsumerGroups` / `DescribeConsumerGroup` / `ResetConsumerGroupOffsets`
- `UpsertVirtualCluster` / `DeleteVirtualCluster` / `SetVirtualClusterReadOnly`
- `UpsertCredential` / `RevokeCredential` / `ListCredentials`
- `UpsertPolicy` / `DeletePolicy` / `ListPolicies`
- `GetStatus` / `ListVirtualClusters` / `GetFullConfig`
