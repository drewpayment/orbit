# Kafka Message Browser & Producer — Implementation Plan

**Date:** 2026-03-28
**Author:** Gage (Principal Software Engineer)
**Based on:** [Design Document](./2026-03-28-kafka-message-browser-design.md)
**Branch:** `feat/kafka-message-browser`

---

## Phase A: Bifrost Admin API Expansion (3 days)

### A.1 — Proto Definitions (0.5 day)

**File:** `proto/idp/gateway/v1/gateway.proto`

Add 8 new RPCs to `BifrostAdminService`:

```protobuf
// Topic Management
rpc CreateTopic(CreateTopicRequest) returns (CreateTopicResponse);
rpc DeleteTopic(DeleteTopicRequest) returns (DeleteTopicResponse);
rpc DescribeTopic(DescribeTopicRequest) returns (DescribeTopicResponse);
rpc UpdateTopicConfig(UpdateTopicConfigRequest) returns (UpdateTopicConfigResponse);
rpc ListTopics(ListTopicsRequest) returns (ListTopicsResponse);

// Metrics
rpc GetTopicMetrics(GetTopicMetricsRequest) returns (GetTopicMetricsResponse);

// Message Operations
rpc BrowseMessages(BrowseMessagesRequest) returns (BrowseMessagesResponse);
rpc ProduceMessage(ProduceMessageRequest) returns (ProduceMessageResponse);
```

**Message types to define:**

- All request types include `string virtual_cluster_id` and `string topic_name`
- `BrowseMessagesRequest`: add `repeated int32 partitions`, `SeekType seek_type`, `int64 start_offset`, `int32 limit`, `string cursor`
- `BrowseMessagesResponse`: `repeated KafkaMessage messages`, `string next_cursor`, `bool has_more`
- `ProduceMessageRequest`: add `optional int32 partition`, `bytes key`, `bytes value`, `map<string, string> headers`
- `ProduceMessageResponse`: `int32 partition`, `int64 offset`, `int64 timestamp`
- `KafkaMessage`: `int32 partition`, `int64 offset`, `int64 timestamp`, `bytes key`, `bytes value`, `map<string, string> headers`, `int32 key_size`, `int32 value_size`, `bool truncated`
- `SeekType` enum: `NEWEST`, `OLDEST`, `OFFSET`

**Regenerate proto:**
```bash
cd proto && buf generate
```

**Verification:** Proto compiles cleanly, Go and Connect-ES types generated.

---

### A.2 — Bifrost Topic CRUD Handlers (1.25 days)

**File:** `services/bifrost/internal/admin/service.go`

Follow the existing handler pattern (e.g., `ListConsumerGroups`):

1. Look up virtual cluster: `vc, ok := s.vcStore.Get(req.VirtualClusterId)`
2. Create Kafka admin client: `NewKafkaAdminClient(vc.PhysicalBootstrapServers)`
3. Apply prefix translation: `physicalTopic := vc.TopicPrefix + req.TopicName`
4. Execute Kafka operation via `kadm` wrapper
5. Strip prefix from response data

**Handler implementations:**

| Handler | kadm Method | Prefix Handling |
|---------|-------------|-----------------|
| `CreateTopic` | `admin.CreateTopic(ctx, partitions, replicationFactor, configs, physicalTopic)` | Prepend `TopicPrefix` to topic name |
| `DeleteTopic` | `admin.DeleteTopics(ctx, physicalTopic)` | Prepend prefix |
| `DescribeTopic` | `admin.DescribeTopicConfigs(ctx, physicalTopic)` + `admin.ListEndOffsets(ctx, physicalTopic)` | Prepend prefix, strip from response |
| `UpdateTopicConfig` | `admin.AlterTopicConfigs(ctx, configs, physicalTopic)` | Prepend prefix |
| `ListTopics` | `admin.ListTopics(ctx)` | Filter by prefix, strip prefix from results |

**Verification:** Each handler tested against live Redpanda in docker-compose.

---

### A.3 — Bifrost Metrics Handler (0.25 day)

**File:** `services/bifrost/internal/admin/service.go`

| Handler | kadm Method | Notes |
|---------|-------------|-------|
| `GetTopicMetrics` | `admin.ListEndOffsets(ctx, physicalTopic)` + `admin.ListStartOffsets(ctx, physicalTopic)` | Calculate message count per partition from offset delta. Also return total bytes via `admin.DescribeTopicConfigs()` if `log.dirs` exposes size. |

---

### A.4 — Bifrost Message Browse/Produce Handlers (0.5 day)

**File:** `services/bifrost/internal/admin/service.go`

**`BrowseMessages` implementation:**

```go
func (s *Service) BrowseMessages(ctx context.Context, req *gatewayv1.BrowseMessagesRequest) (*gatewayv1.BrowseMessagesResponse, error) {
    vc, ok := s.vcStore.Get(req.VirtualClusterId)
    if !ok { return error response }

    physicalTopic := vc.TopicPrefix + req.TopicName

    // Create a temporary consumer (no consumer group)
    client, err := kgo.NewClient(
        kgo.SeedBrokers(vc.PhysicalBootstrapServers),
        kgo.ConsumeTopics(physicalTopic),
        kgo.ConsumePartitions(map[string]map[int32]kgo.Offset{
            physicalTopic: buildOffsetMap(req),
        }),
    )
    defer client.Close()

    // Fetch up to `limit` messages
    fetches := client.PollRecords(ctx, int(req.Limit))

    // Build response with truncation
    messages := convertRecords(fetches, req.Limit)
    nextCursor := buildCursor(messages)

    return &gatewayv1.BrowseMessagesResponse{
        Messages: messages,
        NextCursor: nextCursor,
        HasMore: len(messages) == int(req.Limit),
    }, nil
}
```

**Seek type resolution:**
- `NEWEST`: Use `kgo.NewOffset().AtEnd().Relative(-limit)` — start from latest minus limit
- `OLDEST`: Use `kgo.NewOffset().AtStart()`
- `OFFSET`: Use `kgo.NewOffset().At(req.StartOffset)`

**Cursor encoding:** Base64-encoded JSON `{"partitions":{"0":142,"1":89}}` — each partition's last-read offset +1.

**`ProduceMessage` implementation:**

```go
func (s *Service) ProduceMessage(ctx context.Context, req *gatewayv1.ProduceMessageRequest) (*gatewayv1.ProduceMessageResponse, error) {
    vc, ok := s.vcStore.Get(req.VirtualClusterId)
    if !ok { return error response }

    physicalTopic := vc.TopicPrefix + req.TopicName

    client, err := kgo.NewClient(kgo.SeedBrokers(vc.PhysicalBootstrapServers))
    defer client.Close()

    record := &kgo.Record{
        Topic: physicalTopic,
        Key:   req.Key,
        Value: req.Value,
    }
    if req.Partition != nil {
        record.Partition = *req.Partition
    }
    for k, v := range req.Headers {
        record.Headers = append(record.Headers, kgo.RecordHeader{Key: k, Value: []byte(v)})
    }

    results := client.ProduceSync(ctx, record)
    r := results[0]
    return &gatewayv1.ProduceMessageResponse{
        Partition: r.Record.Partition,
        Offset:    r.Record.Offset,
        Timestamp: r.Record.Timestamp.UnixMilli(),
    }, r.Err
}
```

**Message truncation:** If `len(record.Value) > 1MB`, truncate to 1MB and set `truncated: true`.

---

### A.5 — Bifrost Handler Tests (0.5 day)

**File:** `services/bifrost/internal/admin/service_test.go`

Test each new handler with:
- Valid virtual cluster ID → success path
- Unknown virtual cluster ID → error response
- Prefix translation verified (physical name includes prefix, response strips it)

---

## Phase B: Adapter Migration (2 days)

### B.1 — Create `bifrost/client.go` (1 day)

**File:** `services/kafka/internal/adapters/bifrost/client.go`

Implements the existing `KafkaAdapter` interface by calling Bifrost's admin gRPC:

```go
package bifrost

type Client struct {
    bifrostClient gatewayv1.BifrostAdminServiceClient
    vcID          string // virtual cluster ID for this adapter instance
}

func NewClient(bifrostAddr string, virtualClusterID string) (*Client, error) {
    conn, err := grpc.Dial(bifrostAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
    // ...
    return &Client{
        bifrostClient: gatewayv1.NewBifrostAdminServiceClient(conn),
        vcID: virtualClusterID,
    }, nil
}
```

**Method mapping (11 methods):**

| KafkaAdapter Method | Bifrost RPC Call |
|---|---|
| `ValidateConnection(ctx)` | `bifrostClient.GetStatus(ctx, &GetStatusRequest{})` |
| `Close()` | Close gRPC connection |
| `CreateTopic(ctx, spec)` | `bifrostClient.CreateTopic(ctx, &CreateTopicRequest{VirtualClusterId: c.vcID, TopicName: spec.Name, ...})` |
| `DeleteTopic(ctx, name)` | `bifrostClient.DeleteTopic(ctx, &DeleteTopicRequest{VirtualClusterId: c.vcID, TopicName: name})` |
| `DescribeTopic(ctx, name)` | `bifrostClient.DescribeTopic(ctx, &DescribeTopicRequest{VirtualClusterId: c.vcID, TopicName: name})` |
| `UpdateTopicConfig(ctx, name, configs)` | `bifrostClient.UpdateTopicConfig(ctx, &UpdateTopicConfigRequest{VirtualClusterId: c.vcID, TopicName: name, ConfigEntries: configs})` |
| `ListTopics(ctx)` | `bifrostClient.ListTopics(ctx, &ListTopicsRequest{VirtualClusterId: c.vcID})` |
| `CreateACL(ctx, acl)` | `bifrostClient.UpsertTopicACL(ctx, ...)` (already exists) |
| `DeleteACL(ctx, filter)` | `bifrostClient.RevokeTopicACL(ctx, ...)` (already exists) |
| `ListACLs(ctx)` | `bifrostClient.ListTopicACLs(ctx, ...)` (already exists) |
| `GetTopicMetrics(ctx, name)` | `bifrostClient.GetTopicMetrics(ctx, &GetTopicMetricsRequest{VirtualClusterId: c.vcID, TopicName: name})` |
| `GetConsumerGroupLag(ctx, group, topic)` | `bifrostClient.DescribeConsumerGroup(ctx, ...)` (already exists) |
| `ListConsumerGroups(ctx)` | `bifrostClient.ListConsumerGroups(ctx, ...)` (already exists) |

Also add two new methods for message operations:

| New Method | Bifrost RPC Call |
|---|---|
| `BrowseMessages(ctx, topic, partitions, seekType, offset, limit, cursor)` | `bifrostClient.BrowseMessages(ctx, ...)` |
| `ProduceMessage(ctx, topic, partition, key, value, headers)` | `bifrostClient.ProduceMessage(ctx, ...)` |

**Note:** The `KafkaAdapter` interface in `adapter.go` needs these two new methods added.

---

### B.2 — Wire New Adapter in main.go (0.5 day)

**File:** `services/kafka/cmd/server/main.go`

Replace:
```go
adapterFactory := &kafkaAdapterFactory{} // creates apache.Client directly to Redpanda
```

With:
```go
adapterFactory := &bifrostAdapterFactory{bifrostAddr: cfg.BifrostAdminAddr}
// Creates bifrost.Client connected to Bifrost admin gRPC
```

**New config:**
```go
type Config struct {
    GRPCPort         int
    Environment      string
    DatabaseURL      string
    BifrostAdminAddr string // e.g., "bifrost:50060"
}
```

**docker-compose.yml** update: Add `BIFROST_ADMIN_ADDR=bifrost:50060` to kafka-service environment.

---

### B.3 — Adapter Migration Tests (0.5 day)

**File:** `services/kafka/internal/adapters/bifrost/client_test.go`

Test each adapter method with a mock Bifrost gRPC server:
- Verify correct RPC is called with correct parameters
- Verify prefix handling (adapter passes virtual names, Bifrost handles physical)
- Verify error propagation

**Integration test (build-tag gated):** With real docker-compose stack, verify:
- Create topic through new adapter → topic exists in Redpanda
- List topics → returns created topic (without prefix)
- Delete topic → topic gone

---

## Phase C: Message Browser Feature (5 days)

### C.1 — Kafka Service Proto & Handlers (1 day)

**File:** `proto/idp/kafka/v1/kafka.proto`

Add to `KafkaService`:
```protobuf
rpc BrowseTopicMessages(BrowseTopicMessagesRequest) returns (BrowseTopicMessagesResponse);
rpc ProduceTopicMessage(ProduceTopicMessageRequest) returns (ProduceTopicMessageResponse);
```

**File:** `services/kafka/internal/grpc/message_handler.go` (new)

Implements access control + delegation to Bifrost adapter:

```go
func (s *KafkaServer) BrowseTopicMessages(ctx context.Context, req *kafkav1.BrowseTopicMessagesRequest) (*kafkav1.BrowseTopicMessagesResponse, error) {
    // 1. Extract user/workspace from metadata
    // 2. Look up topic → get workspace_id, virtual_cluster_id
    // 3. Verify ownership or share access (read permission)
    // 4. Call adapter.BrowseMessages(...)
    // 5. Apply size limits, truncation
    // 6. Return response with canProduce flag
}
```

**Regenerate proto:** `cd proto && buf generate`

**Verification:** Handler compiles, returns mock data.

---

### C.2 — Server Actions (0.5 day)

**File:** `orbit-www/src/app/actions/kafka-messages.ts` (new)

Three actions:

```typescript
export async function browseTopicMessages(input: BrowseInput): Promise<BrowseResult>
export async function produceTopicMessage(input: ProduceInput): Promise<ProduceResult>
export async function getMessagePermissions(topicId: string): Promise<PermissionsResult>
```

Each follows the established pattern:
1. `getPayloadUserFromSession()` for auth
2. Look up topic in Payload → get workspace, virtualCluster
3. Verify ownership or share access
4. Call Kafka service gRPC via Connect-ES client
5. Return typed result

---

### C.3 — TopicMessagesPanel + MessageFilterToolbar + MessagesTable (1.5 days)

**Files:**
- `orbit-www/src/components/features/kafka/TopicMessagesPanel.tsx`
- `orbit-www/src/components/features/kafka/MessageFilterToolbar.tsx`
- `orbit-www/src/components/features/kafka/MessagesTable.tsx`
- `orbit-www/src/hooks/useTopicMessages.ts`

**`useTopicMessages` hook:**
```typescript
export function useTopicMessages(topicId: string, workspaceSlug: string) {
  const [messages, setMessages] = useState<KafkaMessage[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [seekMode, setSeekMode] = useState<'NEWEST' | 'OLDEST' | 'OFFSET'>('NEWEST')
  const [partition, setPartition] = useState<number | null>(null)
  const [offset, setOffset] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [canProduce, setCanProduce] = useState(false)

  async function fetchMessages(resetCursor = false) { ... }
  async function loadMore() { ... }

  return { messages, loading, hasMore, canProduce, seekMode, setSeekMode, ... }
}
```

**MessagesTable columns:**
| Column | Width | Content |
|--------|-------|---------|
| Partition | 80px | Numeric badge |
| Offset | 100px | Numeric |
| Timestamp | 180px | Relative time (e.g., "2 min ago") with full timestamp on hover |
| Key | 150px | Truncated at 64 chars, monospace |
| Value | flex | Truncated at 256 chars, monospace |
| Size | 80px | Formatted bytes (e.g., "4.2 KB") |

---

### C.4 — MessageRow + MessageDetail with Monaco (0.5 day)

**Files:**
- `orbit-www/src/components/features/kafka/MessageRow.tsx`
- `orbit-www/src/components/features/kafka/MessageDetail.tsx`

**MessageDetail:** Expanded view with three tabs:
- **Value:** Monaco editor (read-only), JSON auto-detected and pretty-printed
- **Key:** Monaco editor (read-only), smaller
- **Headers:** Key-value table

Monaco loaded dynamically:
```tsx
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })
```

---

### C.5 — ProduceMessageSheet (0.5 day)

**File:** `orbit-www/src/components/features/kafka/ProduceMessageSheet.tsx`

Uses existing `Sheet` component. Form fields:
- Partition selector (optional — auto-assign if not set)
- Key editor (Monaco, compact height)
- Value editor (Monaco, larger)
- Headers (dynamic key-value rows with add/remove)
- Submit button with loading state

Calls `produceTopicMessage` server action on submit. Shows toast on success/error.

---

### C.6 — Wire Messages Tab (0.5 day)

**File:** `orbit-www/src/app/(frontend)/workspaces/[slug]/kafka/[topicId]/topic-detail-client.tsx`

Add 6th tab:
```tsx
<TabsTrigger value="messages">Messages</TabsTrigger>
// ...
<TabsContent value="messages">
  <Suspense fallback={<MessagesSkeleton />}>
    <TopicMessagesPanel topicId={topicId} workspaceSlug={slug} />
  </Suspense>
</TabsContent>
```

`TopicMessagesPanel` loaded via `dynamic()` with `ssr: false`.

**Access-aware rendering:**
- `canBrowse = false` → tab not rendered
- `canProduce = false` → produce button hidden

---

### C.7 — Empty State + Error Handling (0.5 day)

**Empty state:** "No messages in this topic yet. Produce your first message →" with arrow pointing to produce button.

**Error states:**
- Permission denied → "You don't have access to browse messages on this topic"
- Broker unreachable → "Unable to connect to Kafka broker. Please try again."
- General error → Toast with error message

---

## Phase D: QA & Cleanup (1 day)

### D.1 — Frontend Unit Tests (0.5 day)

**File:** `orbit-www/src/components/features/kafka/__tests__/TopicMessagesPanel.test.tsx`

Tests:
- Renders message table with mocked data
- SeekMode changes trigger re-fetch
- Partition filter works
- Produce button hidden when `canProduce = false`
- Load more button triggers cursor pagination
- Empty state shown when no messages

**File:** `orbit-www/src/app/actions/__tests__/kafka-messages.test.ts`

Tests:
- Auth check (unauthenticated → error)
- Ownership check (workspace member → allow)
- Share check (read share → allow browse, deny produce)
- Write share → allow both

### D.2 — Manual QA (0.25 day)

Verify in browser:
- Browse messages on owned topic (newest, oldest, from offset)
- Browse messages on shared topic (read-only — no produce button)
- Produce message and see it appear in refreshed list
- Expand row → Monaco shows full content with JSON formatting
- Partition filter narrows results
- Load more pagination works
- Large messages show truncation badge

### D.3 — Cleanup (0.25 day)

- Update `docs/ROADMAP.md` with message browser feature
- Remove any TODO comments added during implementation
- Verify tech debt metrics haven't regressed

---

## Verification Checkpoints

### Phase A

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| A.1 | Proto compiles | `cd proto && buf generate && buf lint` | Exit 0 |
| A.2 | Bifrost builds | `cd services/bifrost && go build ./...` | Exit 0 |
| A.3 | Bifrost tests pass | `cd services/bifrost && go test ./...` | All pass |
| A.4 | CreateTopic through Bifrost | Manual: create topic via gRPC, verify in Redpanda console | Topic visible with prefix |
| A.5 | BrowseMessages returns data | Manual: produce to topic, browse via gRPC | Messages returned |

### Phase B

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| B.1 | Kafka service builds | `cd services/kafka && go build ./...` | Exit 0 |
| B.2 | Kafka service tests pass | `cd services/kafka && go test ./...` | All pass |
| B.3 | No direct Redpanda imports | `grep -r "redpanda\|19092" services/kafka/cmd/` | 0 matches |
| B.4 | Adapter integration test | `go test -tags=integration ./internal/adapters/bifrost/...` | Topic CRUD works through Bifrost |

### Phase C

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| C.1 | Frontend builds | `cd orbit-www && bun run build` | Exit 0 |
| C.2 | Frontend tests pass | `cd orbit-www && bun run test:int` | No regressions |
| C.3 | Messages tab visible | Navigate to topic detail | 6th tab "Messages" present |
| C.4 | Browse returns messages | Click Messages tab on topic with data | Messages displayed in table |
| C.5 | Produce works | Submit produce form | Toast success, message in list |
| C.6 | Access control | View shared topic (read-only) | No produce button |

### Phase D

| # | Check | Command | Pass Criteria |
|---|-------|---------|---------------|
| D.1 | All tests pass | `bun run test:int` + `go test ./...` | 0 failures |
| D.2 | Tech debt metrics | Check CI | No regressions |
| D.3 | tsc clean | `npx tsc --noEmit` | Error count <= 114 |
