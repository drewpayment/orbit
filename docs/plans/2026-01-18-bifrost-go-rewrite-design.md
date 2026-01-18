# Bifrost Go Rewrite Design

**Status:** Draft
**Date:** 2026-01-18
**Author:** Claude + Drew Payment

## Overview

Rewrite Bifrost from Kotlin to Go, using [grepplabs/kafka-proxy](https://github.com/grepplabs/kafka-proxy) as the foundation. This creates a single Go service that handles both the control plane (Admin gRPC API) and data plane (Kafka protocol proxy).

## Goals

1. **Working Kafka proxy** - The current Kotlin Bifrost has no proxy listener; Go version will actually proxy Kafka traffic
2. **Maintainability** - Go codebase that the team can maintain long-term
3. **Consolidation** - Merge bifrost-callback functionality into single service
4. **Consistency** - Align with existing Go services pattern (`services/bifrost/`)

## Non-Goals (for MVP)

- Feature parity with all Kotlin filter logic
- Production TLS certificate management
- High availability / clustering

---

## Architecture

### High-Level Design

```
                                    ┌─────────────────────────────────────────┐
                                    │            Bifrost (Go)                 │
                                    │                                         │
Kafka Clients ──────────────────────┤  ┌─────────────────────────────────┐   │
  (SASL auth)        :9092 TCP      │  │      Kafka Proxy Layer          │   │
                                    │  │  (forked grepplabs/kafka-proxy) │   │
                                    │  │                                 │   │
                                    │  │  - TLS termination (optional)   │   │
                                    │  │  - SASL authentication          │   │
                                    │  │  - Virtual cluster routing      │   │
                                    │  │  - Topic/group/txn prefixing    │   │
                                    │  │  - Metadata rewriting           │   │
                                    │  └──────────────┬──────────────────┘   │
                                    │                 │                       │
                                    │  ┌──────────────▼──────────────────┐   │
                                    │  │        In-Memory Stores         │   │
                                    │  │                                 │   │
                                    │  │  - VirtualClusterStore          │   │
                                    │  │  - CredentialStore              │   │
                                    │  └──────────────▲──────────────────┘   │
                                    │                 │                       │
Orbit (Temporal) ───────────────────┤  ┌──────────────┴──────────────────┐   │
                     :50060 gRPC    │  │       Admin gRPC API            │   │
                                    │  │                                 │   │
                                    │  │  - UpsertVirtualCluster         │   │
                                    │  │  - UpsertCredential             │   │
                                    │  │  - GetStatus / GetFullConfig    │   │
                                    │  └─────────────────────────────────┘   │
                                    │                                         │
Prometheus ─────────────────────────┤  :8080 /metrics                         │
                                    │                                         │
                                    └─────────────────────────────────────────┘
                                                      │
                                                      │ :9092 (internal)
                                                      ▼
                                              ┌───────────────┐
                                              │   Redpanda    │
                                              │   (Kafka)     │
                                              └───────────────┘
```

### Directory Structure

```
services/bifrost/
├── cmd/
│   └── bifrost/
│       └── main.go              # Entry point
├── internal/
│   ├── admin/
│   │   ├── server.go            # gRPC server setup
│   │   └── service.go           # BifrostAdminService implementation
│   ├── auth/
│   │   ├── credential.go        # Credential type
│   │   ├── store.go             # CredentialStore
│   │   └── sasl.go              # SASL authentication handler
│   ├── config/
│   │   ├── virtual_cluster.go   # VirtualCluster type
│   │   └── store.go             # VirtualClusterStore
│   ├── proxy/
│   │   ├── proxy.go             # Main proxy orchestration
│   │   ├── handler.go           # Connection handler
│   │   ├── router.go            # Virtual cluster routing (SNI + SASL)
│   │   └── rewriter.go          # Topic/group/txn prefix rewriting
│   └── metrics/
│       └── collector.go         # Prometheus metrics
├── go.mod
├── go.sum
└── Dockerfile
```

### Module Dependencies

```go
module github.com/drewpayment/orbit/services/bifrost

require (
    // Forked kafka-proxy (or imported as dependency initially)
    github.com/grepplabs/kafka-proxy v0.x.x

    // gRPC
    google.golang.org/grpc v1.60.0
    google.golang.org/protobuf v1.32.0

    // Prometheus
    github.com/prometheus/client_golang v1.18.0

    // Logging
    go.uber.org/zap v1.26.0

    // Internal proto definitions
    github.com/drewpayment/orbit/proto
)
```

---

## Component Design

### 1. Virtual Cluster Routing

Clients are routed to virtual clusters via two mechanisms (platform configurable):

#### SASL Username-Based (Default)

1. Client connects to Bifrost on port 9092
2. Client sends SASL/PLAIN authentication
3. Bifrost looks up username in CredentialStore
4. Credential contains `virtualClusterId`
5. VirtualClusterStore returns config with prefixes

```go
type Credential struct {
    ID               string
    Username         string
    PasswordHash     string
    VirtualClusterID string
    Permissions      []string
}

type VirtualCluster struct {
    ID                   string
    TopicPrefix          string    // e.g., "myapp-dev-"
    GroupPrefix          string    // e.g., "myapp-dev-"
    TransactionIDPrefix  string    // e.g., "myapp-dev-"
    BootstrapServers     string    // Physical Kafka brokers
    AdvertisedHost       string    // What clients see
    AdvertisedPort       int32
}
```

#### SNI-Based (When TLS Enabled)

1. Client connects with TLS to `myapp.dev.kafka.orbit.io:9092`
2. Bifrost extracts SNI hostname from TLS handshake
3. VirtualClusterStore lookup by `advertisedHost`
4. SASL auth still required, but routing determined by SNI

Platform configuration determines which mode:

```go
type ProxyConfig struct {
    RoutingMode    string // "sasl", "sni", "both"
    TLSEnabled     bool
    TLSCertFile    string
    TLSKeyFile     string
    // ...
}
```

### 2. Request/Response Rewriting

All topic, group, and transaction ID references are prefixed/unprefixed:

**Inbound (client → broker):**
- `PRODUCE`: Prefix topic names
- `FETCH`: Prefix topic names
- `METADATA`: Prefix topic names (or return all if empty)
- `CREATE_TOPICS`: Prefix topic names
- `FIND_COORDINATOR`: Prefix group ID
- `JOIN_GROUP`, `SYNC_GROUP`, etc.: Prefix group ID
- `INIT_PRODUCER_ID`: Prefix transaction ID

**Outbound (broker → client):**
- `METADATA`: Strip prefix from topic names, filter to only tenant's topics
- Other responses: Strip prefixes where applicable

### 3. Admin gRPC API

Implements the existing proto service (`proto/idp/gateway/v1/gateway.proto`):

```protobuf
service BifrostAdminService {
    // Virtual Clusters
    rpc UpsertVirtualCluster(UpsertVirtualClusterRequest) returns (UpsertVirtualClusterResponse);
    rpc DeleteVirtualCluster(DeleteVirtualClusterRequest) returns (DeleteVirtualClusterResponse);
    rpc ListVirtualClusters(ListVirtualClustersRequest) returns (ListVirtualClustersResponse);

    // Credentials
    rpc UpsertCredential(UpsertCredentialRequest) returns (UpsertCredentialResponse);
    rpc RevokeCredential(RevokeCredentialRequest) returns (RevokeCredentialResponse);
    rpc ListCredentials(ListCredentialsRequest) returns (ListCredentialsResponse);

    // Status
    rpc GetStatus(GetStatusRequest) returns (GetStatusResponse);
    rpc GetFullConfig(GetFullConfigRequest) returns (GetFullConfigResponse);
}
```

### 4. Metrics

Prometheus metrics exposed on `:8080/metrics`:

```
# Proxy metrics
bifrost_connections_active{virtual_cluster="..."} gauge
bifrost_connections_total{virtual_cluster="..."} counter
bifrost_bytes_total{virtual_cluster="...", direction="in|out"} counter
bifrost_requests_total{virtual_cluster="...", api_key="..."} counter
bifrost_request_duration_seconds{virtual_cluster="...", api_key="..."} histogram

# Health
bifrost_up gauge
bifrost_config_last_sync_timestamp gauge
```

---

## MVP Scope

### Included in MVP

| Feature | Description |
|---------|-------------|
| SASL/PLAIN authentication | Validate credentials against in-memory store |
| Virtual cluster routing | Route based on SASL username → credential → virtual cluster |
| Topic name prefixing | Transparent prefix add/remove on all topic operations |
| Consumer group prefixing | Transparent prefix add/remove on all group operations |
| Transaction ID prefixing | Transparent prefix add/remove for exactly-once |
| Metadata response rewriting | Advertise Bifrost address, filter to tenant's topics |
| Prometheus metrics | Connection counts, bytes, requests, latency |
| Admin gRPC API | UpsertVirtualCluster, UpsertCredential, GetStatus, GetFullConfig |
| TLS termination | Optional TLS on client-facing port |
| SNI-based routing | When TLS enabled, route by hostname |
| Platform-configurable routing | Choose SASL-only, SNI-only, or both |

### Deferred to Future Iterations

| Feature | Description | Priority |
|---------|-------------|----------|
| Read-only mode | Block write operations for a virtual cluster | Medium |
| Topic creation policies | Validate retention, partition count, etc. | Medium |
| Cross-app ACLs | Allow app A to consume from app B's topics | Medium |
| Activity/lineage reporting | Report produce/consume activity to Orbit | Medium |
| SASL/SCRAM support | Stronger auth mechanism | Low |
| Rate limiting | Per-virtual-cluster throughput limits | Low |
| Schema validation | Validate messages against Schema Registry | Low |

---

## Configuration

### Environment Variables

```bash
# Proxy
BIFROST_PROXY_PORT=9092
BIFROST_ROUTING_MODE=sasl          # sasl, sni, both
BIFROST_TLS_ENABLED=false
BIFROST_TLS_CERT_FILE=/etc/bifrost/tls.crt
BIFROST_TLS_KEY_FILE=/etc/bifrost/tls.key

# Upstream Kafka
KAFKA_BOOTSTRAP_SERVERS=redpanda:9092

# Admin API
BIFROST_ADMIN_PORT=50060

# Metrics
BIFROST_METRICS_PORT=8080

# Logging
BIFROST_LOG_LEVEL=info
```

### Docker Compose

```yaml
bifrost:
  container_name: orbit-bifrost
  build:
    context: .
    dockerfile: services/bifrost/Dockerfile
  ports:
    - "9092:9092"    # Kafka proxy (via Traefik)
    - "50060:50060"  # Admin gRPC
    - "8080:8080"    # Metrics
  environment:
    - BIFROST_PROXY_PORT=9092
    - BIFROST_ADMIN_PORT=50060
    - BIFROST_METRICS_PORT=8080
    - BIFROST_ROUTING_MODE=sasl
    - KAFKA_BOOTSTRAP_SERVERS=redpanda:9092
  depends_on:
    redpanda:
      condition: service_healthy
```

---

## Migration Plan

### Phase 1: Build Go Bifrost

1. Fork grepplabs/kafka-proxy (or vendor it)
2. Create `services/bifrost/` directory structure
3. Implement in-memory stores (VirtualClusterStore, CredentialStore)
4. Implement Admin gRPC API
5. Integrate proxy with stores for auth and routing
6. Add topic/group/transaction rewriting
7. Add Prometheus metrics

### Phase 2: Testing

1. Unit tests for stores, auth, rewriting
2. Integration tests with Redpanda
3. Test with existing Orbit Temporal workflows
4. Validate metrics in Prometheus

### Phase 3: Cutover

1. Update docker-compose.yml to use new Go Bifrost
2. Update Traefik to route to new Bifrost
3. Deprecate Kotlin Bifrost (`gateway/bifrost/`)
4. Remove bifrost-callback service (merged)

### Phase 4: Cleanup

1. Delete `gateway/bifrost/` (Kotlin)
2. Delete `services/bifrost-callback/`
3. Update documentation

---

## Decisions

1. **Vendor strategy**: Vendor kafka-proxy code directly into `services/bifrost/internal/proxy/`. Remove git references so it becomes part of the Orbit repository. This gives us full control without fork maintenance overhead.

2. **Proto sharing**: Use the existing shared proto module at `proto/`. Import via Go module replace directive:
   ```go
   replace github.com/drewpayment/orbit/proto => ../../proto
   ```

3. **Testing infrastructure**: Use Redpanda in docker-compose for integration tests (same as other services).

---

## References

- [grepplabs/kafka-proxy](https://github.com/grepplabs/kafka-proxy) - Foundation for proxy
- [segmentio/kafka-go](https://github.com/segmentio/kafka-go) - Kafka protocol library
- [Existing Kotlin Bifrost](../gateway/bifrost/) - Logic to port
- [Bifrost Admin Proto](../proto/idp/gateway/v1/gateway.proto) - gRPC API definition
