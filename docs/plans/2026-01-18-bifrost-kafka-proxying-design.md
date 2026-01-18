# Bifrost Full Kafka Proxying - Design Document

> **For Claude:** This design was created through brainstorming. Use superpowers:writing-plans to create implementation plan.

**Goal:** Implement full Kafka protocol proxying in Bifrost with SASL authentication, upstream Kafka connection, topic/group rewriting, and per-virtual-cluster metrics.

**Architecture:** Integrate our BifrostProxy with the vendored kafka-proxy processor, bridging our SASLHandler to the processor's LocalSasl mechanism, and extending response modification to apply tenant-specific prefix rewriting.

**Tech Stack:** Go, vendored grepplabs/kafka-proxy protocol handling, SASL/PLAIN authentication

---

## Current State

### What We Have

1. **BifrostProxy scaffold** (`bifrost_proxy.go`):
   - TCP listener accepting connections
   - Connection tracking (active/total)
   - Graceful shutdown
   - Placeholder `handleConnection()` with TODOs

2. **SASLHandler** (`auth/sasl.go`):
   - `Authenticate(username, password)` → `ConnectionContext`
   - Returns prefixes (topic, group, txnID) and upstream bootstrap servers

3. **Rewriter** (`proxy/rewriter.go`):
   - `PrefixTopic/UnprefixTopic`, `PrefixGroup/UnprefixGroup`, `PrefixTransactionID/UnprefixTransactionID`
   - `FilterTopics()` for metadata responses

4. **Vendored kafka-proxy processor**:
   - `processor` with `RequestsLoop`/`ResponsesLoop`
   - `LocalSasl` for SASL handshake handling
   - `responseModifier` for rewriting broker addresses
   - Full Kafka protocol parsing via schema-based decoders

5. **Metrics collector** (`metrics/collector.go`):
   - Connection metrics
   - Per-virtual-cluster tracking ready

### Integration Points

```
BifrostProxy.handleConnection(clientConn)
    │
    ├─► Create LocalSasl with our SASLHandler (via PasswordAuthenticator adapter)
    │
    ├─► Connect to upstream Kafka (ConnectionContext.BootstrapServers)
    │
    ├─► Create processor with:
    │   - LocalSasl (auth)
    │   - NetAddressMappingFunc (broker rewriting)
    │   - [NEW] Topic/Group rewriter hooks
    │
    └─► Run RequestsLoop and ResponsesLoop goroutines
```

## Design Decisions

### 1. SASL Integration Approach

**Decision:** Implement `PasswordAuthenticator` adapter that wraps our `auth.SASLHandler`.

The vendored code flow:
```
LocalSasl.receiveAndSendSASLAuthV0/V1
  → LocalSaslPlain.doLocalAuth(saslAuthBytes)
    → PasswordAuthenticator.Authenticate(username, password)
      → returns (ok bool, status int32, err error)
```

Our adapter needs to:
1. Call `auth.SASLHandler.Authenticate(username, password)`
2. On success, store `ConnectionContext` for later use
3. Return `(true, 0, nil)` on success, `(false, status, nil)` on auth failure

**Key insight:** The processor's `LocalSasl` only returns error/success - it doesn't return the ConnectionContext. We need to modify the flow to capture context after successful auth.

**Solution:** Create a `BifrostAuthenticator` that:
- Implements `PasswordAuthenticator`
- Stores last successful `ConnectionContext` in a sync.Map keyed by connection
- Provides `GetContext(conn)` to retrieve after auth completes

### 2. Upstream Kafka Connection

**Decision:** Connect to upstream Kafka AFTER successful SASL auth.

Flow:
1. Accept client connection
2. Perform SASL handshake (validates credentials, gets ConnectionContext)
3. Connect to `ConnectionContext.BootstrapServers`
4. Start proxying with request/response rewriting

The processor expects both connections (client, broker) upfront. We need to:
1. Handle SASL ourselves first
2. Then create processor with both connections
3. Run proxy loops

### 3. Topic/Group Rewriting Strategy

**Decision:** Extend response modifiers and add request interceptors.

**Request-side rewriting (client → broker):**
- Intercept after parsing `RequestKeyVersion`
- For produce/fetch/metadata requests: prefix topic names
- For consumer group operations: prefix group IDs
- For transactions: prefix transaction IDs

**Response-side rewriting (broker → client):**
- Use existing `responseModifier` infrastructure
- Add topic/group unprefixing to metadata responses
- Filter out topics not belonging to tenant

**API operations requiring rewriting:**

| ApiKey | Operation | Rewrite Needed |
|--------|-----------|----------------|
| 0 | Produce | Topics (request) |
| 1 | Fetch | Topics (request/response) |
| 2 | ListOffsets | Topics (request/response) |
| 3 | Metadata | Topics (request - optional, response) |
| 8 | OffsetCommit | Group, Topics (request) |
| 9 | OffsetFetch | Group, Topics (request/response) |
| 10 | FindCoordinator | Group/TxnID (request), Address (response) |
| 11 | JoinGroup | Group (request) |
| 12 | Heartbeat | Group (request) |
| 13 | LeaveGroup | Group (request) |
| 14 | SyncGroup | Group (request) |
| 15 | DescribeGroups | Groups (request/response) |
| 16 | ListGroups | Groups (response) |
| 19 | CreateTopics | Topics (request) |
| 20 | DeleteTopics | Topics (request) |
| 22 | InitProducerId | TxnID (request) |
| 24 | AddPartitionsToTxn | Topics, TxnID (request) |
| 25 | AddOffsetsToTxn | Group, TxnID (request) |
| 26 | EndTxn | TxnID (request) |
| 28 | TxnOffsetCommit | Group, Topics, TxnID (request) |
| 37 | CreatePartitions | Topics (request) |
| 32 | DescribeConfigs | Topics (request/response) |
| 33 | AlterConfigs | Topics (request) |

### 4. Per-Virtual-Cluster Metrics

**Decision:** Add virtual cluster label to existing metrics and create new tenant-specific metrics.

Metrics to add/extend:
- `bifrost_connections_active{virtual_cluster="vc-123"}` - active connections per VC
- `bifrost_requests_total{virtual_cluster="vc-123", api_key="0"}` - requests per VC
- `bifrost_bytes_in{virtual_cluster="vc-123"}` - bytes received per VC
- `bifrost_bytes_out{virtual_cluster="vc-123"}` - bytes sent per VC

Implementation:
- Pass `virtual_cluster_id` label to processor context
- Update `proxyRequestsTotal`, `proxyResponsesBytes` to include VC label
- Add new `bifrost_` prefixed metrics distinct from vendored `proxy_` metrics

## Implementation Architecture

### New Files

```
services/bifrost/internal/proxy/
  ├── bifrost_authenticator.go    # PasswordAuthenticator adapter for SASLHandler
  ├── bifrost_connection.go       # Per-connection proxy handler
  ├── bifrost_rewriter.go         # Request/response rewriting middleware
  └── bifrost_metrics.go          # Per-VC metrics wrappers
```

### Modified Files

```
services/bifrost/internal/proxy/
  ├── bifrost_proxy.go            # Update handleConnection() to use full proxy
  └── processor.go                # Add rewriter hooks (minimal changes)
```

### Connection Handler Flow

```go
func (p *BifrostProxy) handleConnection(clientConn net.Conn) {
    // 1. Create per-connection authenticator
    auth := NewBifrostAuthenticator(p.saslHandler, clientConn)

    // 2. Create LocalSasl with our authenticator
    localSasl := NewLocalSasl(LocalSaslParams{
        enabled: true,
        timeout: 30 * time.Second,
        passwordAuthenticator: auth,
    })

    // 3. Perform SASL handshake (reads from clientConn, writes response)
    if err := performSASLHandshake(clientConn, localSasl); err != nil {
        // Auth failed, close connection
        return
    }

    // 4. Get connection context (has bootstrap servers, prefixes)
    ctx := auth.GetContext()

    // 5. Connect to upstream Kafka
    brokerConn, err := net.Dial("tcp", ctx.BootstrapServers)
    if err != nil {
        return
    }
    defer brokerConn.Close()

    // 6. Record per-VC metrics
    p.metrics.ConnectionOpened(ctx.VirtualClusterID)
    defer p.metrics.ConnectionClosed(ctx.VirtualClusterID)

    // 7. Create rewriter with tenant prefixes
    rewriter := NewRewriter(ctx)

    // 8. Create processor with rewriting
    proc := newProcessor(ProcessorConfig{
        LocalSasl:             nil,  // Already done
        NetAddressMappingFunc: p.addressMapper,
        // Pass rewriter context for request/response modification
    }, ctx.BootstrapServers)

    // 9. Start proxy loops
    go proc.RequestsLoop(brokerConn, clientConn)
    proc.ResponsesLoop(clientConn, brokerConn)
}
```

## Testing Strategy

1. **Unit tests**: Each new component (authenticator, connection handler, rewriter)
2. **Integration tests**: Full connection flow with mock Kafka
3. **Contract tests**: Verify Kafka protocol compliance
4. **Load tests**: Multiple concurrent connections, verify metrics accuracy

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Protocol version incompatibility | Test against multiple Kafka client versions |
| Rewriter misses API operation | Audit all API keys, table-driven test coverage |
| Memory pressure from buffering | Use streaming where possible, limit response sizes |
| Connection leak on errors | Consistent defer cleanup pattern |

## Success Criteria

1. Kafka clients can connect through Bifrost with SASL/PLAIN
2. Each tenant sees only their prefixed topics/groups
3. Per-virtual-cluster metrics are accurately recorded
4. No degradation from vendored kafka-proxy performance baseline
