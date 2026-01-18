# Bifrost Go Rewrite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Bifrost as a Go service that proxies Kafka traffic with multi-tenant virtual clusters, SASL authentication, and topic/group prefixing.

**Architecture:** Vendor grepplabs/kafka-proxy code into `services/bifrost/`, add Admin gRPC API for config sync from Orbit, extend processor to support per-connection virtual cluster context with topic/group/transaction ID rewriting.

**Tech Stack:** Go 1.24+, grepplabs/kafka-proxy (vendored), gRPC, Prometheus, Protobuf

**Reference Design:** `docs/plans/2026-01-18-bifrost-go-rewrite-design.md`

---

## Task 1: Initialize Go Module and Directory Structure

**Files:**
- Create: `services/bifrost/go.mod`
- Create: `services/bifrost/cmd/bifrost/main.go`
- Create: `services/bifrost/Dockerfile`
- Create: `services/bifrost/.gitignore`

**Step 1: Create directory structure**

```bash
mkdir -p services/bifrost/cmd/bifrost
mkdir -p services/bifrost/internal/admin
mkdir -p services/bifrost/internal/auth
mkdir -p services/bifrost/internal/config
mkdir -p services/bifrost/internal/proxy
mkdir -p services/bifrost/internal/metrics
```

**Step 2: Create go.mod**

```go
// services/bifrost/go.mod
module github.com/drewpayment/orbit/services/bifrost

go 1.24.0

replace github.com/drewpayment/orbit/proto => ../../proto

require (
    github.com/drewpayment/orbit/proto v0.0.0-00010101000000-000000000000
    github.com/prometheus/client_golang v1.18.0
    github.com/sirupsen/logrus v1.9.3
    github.com/stretchr/testify v1.9.0
    google.golang.org/grpc v1.60.0
)
```

**Step 3: Create main.go placeholder**

```go
// services/bifrost/cmd/bifrost/main.go
package main

import (
    "fmt"
    "os"
)

func main() {
    fmt.Println("Bifrost Gateway starting...")
    // TODO: Initialize and run
    os.Exit(0)
}
```

**Step 4: Create Dockerfile**

```dockerfile
# services/bifrost/Dockerfile
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Copy proto module first (for caching)
COPY proto/ ./proto/

# Copy bifrost module
COPY services/bifrost/ ./services/bifrost/

WORKDIR /app/services/bifrost

RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -o /bifrost ./cmd/bifrost

FROM alpine:3.19

RUN apk --no-cache add ca-certificates

COPY --from=builder /bifrost /bifrost

EXPOSE 9092 50060 8080

ENTRYPOINT ["/bifrost"]
```

**Step 5: Create .gitignore**

```gitignore
# services/bifrost/.gitignore
/bifrost
*.exe
*.test
*.out
.idea/
```

**Step 6: Initialize and verify module**

Run: `cd services/bifrost && go mod tidy`
Expected: go.sum created, dependencies resolved

**Step 7: Build to verify setup**

Run: `cd services/bifrost && go build ./cmd/bifrost`
Expected: Binary builds successfully

**Step 8: Commit**

```bash
git add services/bifrost/
git commit -m "feat(bifrost): initialize Go module structure

- Create services/bifrost/ with Go module
- Add cmd/bifrost/main.go placeholder
- Add Dockerfile for container builds
- Reference shared proto module"
```

---

## Task 2: Vendor kafka-proxy Core Code

**Files:**
- Create: `services/bifrost/internal/proxy/` (copy from kafka-proxy)
- Modify: `services/bifrost/go.mod` (add dependencies)

**Step 1: Copy kafka-proxy proxy package**

```bash
# Clone kafka-proxy to temp location
cd /tmp && rm -rf kafka-proxy
git clone --depth 1 https://github.com/grepplabs/kafka-proxy.git

# Copy proxy package (core proxy logic)
cp -r /tmp/kafka-proxy/proxy/* services/bifrost/internal/proxy/

# Copy config package (configuration types)
mkdir -p services/bifrost/internal/kafkaconfig
cp /tmp/kafka-proxy/config/config.go services/bifrost/internal/kafkaconfig/

# Copy needed pkg utilities
mkdir -p services/bifrost/internal/pkg/util
cp /tmp/kafka-proxy/pkg/libs/util/*.go services/bifrost/internal/pkg/util/
```

**Step 2: Update import paths in vendored code**

```bash
# Replace all import paths from grepplabs to orbit
find services/bifrost/internal/proxy -name "*.go" -exec sed -i '' \
  's|github.com/grepplabs/kafka-proxy/proxy|github.com/drewpayment/orbit/services/bifrost/internal/proxy|g' {} \;

find services/bifrost/internal/proxy -name "*.go" -exec sed -i '' \
  's|github.com/grepplabs/kafka-proxy/config|github.com/drewpayment/orbit/services/bifrost/internal/kafkaconfig|g' {} \;

find services/bifrost/internal/proxy -name "*.go" -exec sed -i '' \
  's|github.com/grepplabs/kafka-proxy/pkg/libs/util|github.com/drewpayment/orbit/services/bifrost/internal/pkg/util|g' {} \;

# Same for kafkaconfig
find services/bifrost/internal/kafkaconfig -name "*.go" -exec sed -i '' \
  's|github.com/grepplabs/kafka-proxy/pkg/libs/util|github.com/drewpayment/orbit/services/bifrost/internal/pkg/util|g' {} \;
```

**Step 3: Update go.mod with kafka-proxy dependencies**

Add to `services/bifrost/go.mod`:
```go
require (
    github.com/pkg/errors v0.9.1
    golang.org/x/net v0.20.0
)
```

**Step 4: Run go mod tidy**

Run: `cd services/bifrost && go mod tidy`
Expected: Dependencies resolved

**Step 5: Verify vendored code compiles**

Run: `cd services/bifrost && go build ./...`
Expected: BUILD SUCCESS (may have unused import warnings, that's OK)

**Step 6: Commit**

```bash
git add services/bifrost/
git commit -m "feat(bifrost): vendor kafka-proxy core code

- Copy proxy, protocol, config packages from grepplabs/kafka-proxy
- Update import paths to orbit module
- Approximately 15K lines of proven Kafka proxy code"
```

---

## Task 3: Implement VirtualClusterStore

**Files:**
- Create: `services/bifrost/internal/config/virtual_cluster.go`
- Create: `services/bifrost/internal/config/virtual_cluster_test.go`

**Step 1: Write the failing test**

```go
// services/bifrost/internal/config/virtual_cluster_test.go
package config

import (
    "testing"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
    gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

func TestVirtualClusterStore_Upsert(t *testing.T) {
    store := NewVirtualClusterStore()

    vc := &gatewayv1.VirtualClusterConfig{
        Id:                       "vc-123",
        ApplicationSlug:          "payments",
        Environment:              "dev",
        TopicPrefix:              "payments-dev-",
        GroupPrefix:              "payments-dev-",
        TransactionIdPrefix:      "payments-dev-",
        AdvertisedHost:           "payments.dev.kafka.orbit.io",
        AdvertisedPort:           9092,
        PhysicalBootstrapServers: "redpanda:9092",
    }

    store.Upsert(vc)

    got, ok := store.Get("vc-123")
    require.True(t, ok)
    assert.Equal(t, "payments-dev-", got.TopicPrefix)
}

func TestVirtualClusterStore_GetByAdvertisedHost(t *testing.T) {
    store := NewVirtualClusterStore()

    vc := &gatewayv1.VirtualClusterConfig{
        Id:             "vc-123",
        AdvertisedHost: "payments.dev.kafka.orbit.io",
        AdvertisedPort: 9092,
    }

    store.Upsert(vc)

    got, ok := store.GetByAdvertisedHost("payments.dev.kafka.orbit.io")
    require.True(t, ok)
    assert.Equal(t, "vc-123", got.Id)
}

func TestVirtualClusterStore_Delete(t *testing.T) {
    store := NewVirtualClusterStore()

    vc := &gatewayv1.VirtualClusterConfig{Id: "vc-123"}
    store.Upsert(vc)

    store.Delete("vc-123")

    _, ok := store.Get("vc-123")
    assert.False(t, ok)
}

func TestVirtualClusterStore_List(t *testing.T) {
    store := NewVirtualClusterStore()

    store.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-1"})
    store.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-2"})

    list := store.List()
    assert.Len(t, list, 2)
}
```

**Step 2: Run test to verify it fails**

Run: `cd services/bifrost && go test ./internal/config/... -v`
Expected: FAIL - package/types don't exist

**Step 3: Write minimal implementation**

```go
// services/bifrost/internal/config/virtual_cluster.go
package config

import (
    "sync"

    gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

// VirtualClusterStore is a thread-safe in-memory store for virtual cluster configs.
type VirtualClusterStore struct {
    mu              sync.RWMutex
    byID            map[string]*gatewayv1.VirtualClusterConfig
    byAdvertisedHost map[string]*gatewayv1.VirtualClusterConfig
}

// NewVirtualClusterStore creates a new empty store.
func NewVirtualClusterStore() *VirtualClusterStore {
    return &VirtualClusterStore{
        byID:             make(map[string]*gatewayv1.VirtualClusterConfig),
        byAdvertisedHost: make(map[string]*gatewayv1.VirtualClusterConfig),
    }
}

// Upsert adds or updates a virtual cluster config.
func (s *VirtualClusterStore) Upsert(vc *gatewayv1.VirtualClusterConfig) {
    s.mu.Lock()
    defer s.mu.Unlock()

    // Remove old advertised host mapping if exists
    if old, ok := s.byID[vc.Id]; ok {
        delete(s.byAdvertisedHost, old.AdvertisedHost)
    }

    s.byID[vc.Id] = vc
    if vc.AdvertisedHost != "" {
        s.byAdvertisedHost[vc.AdvertisedHost] = vc
    }
}

// Get retrieves a virtual cluster by ID.
func (s *VirtualClusterStore) Get(id string) (*gatewayv1.VirtualClusterConfig, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    vc, ok := s.byID[id]
    return vc, ok
}

// GetByAdvertisedHost retrieves a virtual cluster by its advertised hostname.
func (s *VirtualClusterStore) GetByAdvertisedHost(host string) (*gatewayv1.VirtualClusterConfig, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    vc, ok := s.byAdvertisedHost[host]
    return vc, ok
}

// Delete removes a virtual cluster by ID.
func (s *VirtualClusterStore) Delete(id string) {
    s.mu.Lock()
    defer s.mu.Unlock()

    if vc, ok := s.byID[id]; ok {
        delete(s.byAdvertisedHost, vc.AdvertisedHost)
        delete(s.byID, id)
    }
}

// List returns all virtual clusters.
func (s *VirtualClusterStore) List() []*gatewayv1.VirtualClusterConfig {
    s.mu.RLock()
    defer s.mu.RUnlock()

    result := make([]*gatewayv1.VirtualClusterConfig, 0, len(s.byID))
    for _, vc := range s.byID {
        result = append(result, vc)
    }
    return result
}

// Count returns the number of virtual clusters.
func (s *VirtualClusterStore) Count() int {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return len(s.byID)
}
```

**Step 4: Run test to verify it passes**

Run: `cd services/bifrost && go test ./internal/config/... -v`
Expected: PASS

**Step 5: Commit**

```bash
git add services/bifrost/internal/config/
git commit -m "feat(bifrost): implement VirtualClusterStore

- Thread-safe in-memory store for virtual cluster configs
- Indexed by ID and advertised host for fast lookups
- Used for SASL and SNI-based routing"
```

---

## Task 4: Implement CredentialStore

**Files:**
- Create: `services/bifrost/internal/auth/credential.go`
- Create: `services/bifrost/internal/auth/credential_test.go`

**Step 1: Write the failing test**

```go
// services/bifrost/internal/auth/credential_test.go
package auth

import (
    "testing"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
    gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

func TestCredentialStore_Upsert(t *testing.T) {
    store := NewCredentialStore()

    cred := &gatewayv1.CredentialConfig{
        Id:               "cred-123",
        VirtualClusterId: "vc-456",
        Username:         "payments-dev-myservice",
        PasswordHash:     "hashed-password",
    }

    store.Upsert(cred)

    got, ok := store.Get("cred-123")
    require.True(t, ok)
    assert.Equal(t, "payments-dev-myservice", got.Username)
}

func TestCredentialStore_GetByUsername(t *testing.T) {
    store := NewCredentialStore()

    cred := &gatewayv1.CredentialConfig{
        Id:       "cred-123",
        Username: "payments-dev-myservice",
    }

    store.Upsert(cred)

    got, ok := store.GetByUsername("payments-dev-myservice")
    require.True(t, ok)
    assert.Equal(t, "cred-123", got.Id)
}

func TestCredentialStore_Authenticate_Success(t *testing.T) {
    store := NewCredentialStore()

    // Use SHA256 hash of "secret123"
    cred := &gatewayv1.CredentialConfig{
        Id:           "cred-123",
        Username:     "testuser",
        PasswordHash: "fcf730b6d95236ecd3c9fc2d92d7b6b2bb061514961aec041d6c7a7192f592e4",
    }

    store.Upsert(cred)

    got, ok := store.Authenticate("testuser", "secret123")
    require.True(t, ok)
    assert.Equal(t, "cred-123", got.Id)
}

func TestCredentialStore_Authenticate_WrongPassword(t *testing.T) {
    store := NewCredentialStore()

    cred := &gatewayv1.CredentialConfig{
        Id:           "cred-123",
        Username:     "testuser",
        PasswordHash: "somehash",
    }

    store.Upsert(cred)

    _, ok := store.Authenticate("testuser", "wrongpassword")
    assert.False(t, ok)
}

func TestCredentialStore_ListByVirtualCluster(t *testing.T) {
    store := NewCredentialStore()

    store.Upsert(&gatewayv1.CredentialConfig{Id: "c1", VirtualClusterId: "vc-1"})
    store.Upsert(&gatewayv1.CredentialConfig{Id: "c2", VirtualClusterId: "vc-1"})
    store.Upsert(&gatewayv1.CredentialConfig{Id: "c3", VirtualClusterId: "vc-2"})

    list := store.ListByVirtualCluster("vc-1")
    assert.Len(t, list, 2)
}
```

**Step 2: Run test to verify it fails**

Run: `cd services/bifrost && go test ./internal/auth/... -v`
Expected: FAIL - package doesn't exist

**Step 3: Write minimal implementation**

```go
// services/bifrost/internal/auth/credential.go
package auth

import (
    "crypto/sha256"
    "encoding/hex"
    "sync"

    gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

// CredentialStore is a thread-safe in-memory store for credentials.
type CredentialStore struct {
    mu                 sync.RWMutex
    byID               map[string]*gatewayv1.CredentialConfig
    byUsername         map[string]*gatewayv1.CredentialConfig
    byVirtualCluster   map[string][]*gatewayv1.CredentialConfig
}

// NewCredentialStore creates a new empty credential store.
func NewCredentialStore() *CredentialStore {
    return &CredentialStore{
        byID:             make(map[string]*gatewayv1.CredentialConfig),
        byUsername:       make(map[string]*gatewayv1.CredentialConfig),
        byVirtualCluster: make(map[string][]*gatewayv1.CredentialConfig),
    }
}

// Upsert adds or updates a credential.
func (s *CredentialStore) Upsert(cred *gatewayv1.CredentialConfig) {
    s.mu.Lock()
    defer s.mu.Unlock()

    // Clean up old mappings if updating
    if old, ok := s.byID[cred.Id]; ok {
        delete(s.byUsername, old.Username)
        s.removeFromVCList(old.VirtualClusterId, old.Id)
    }

    s.byID[cred.Id] = cred
    s.byUsername[cred.Username] = cred

    // Add to virtual cluster index
    s.byVirtualCluster[cred.VirtualClusterId] = append(
        s.byVirtualCluster[cred.VirtualClusterId], cred)
}

func (s *CredentialStore) removeFromVCList(vcID, credID string) {
    list := s.byVirtualCluster[vcID]
    for i, c := range list {
        if c.Id == credID {
            s.byVirtualCluster[vcID] = append(list[:i], list[i+1:]...)
            return
        }
    }
}

// Get retrieves a credential by ID.
func (s *CredentialStore) Get(id string) (*gatewayv1.CredentialConfig, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    cred, ok := s.byID[id]
    return cred, ok
}

// GetByUsername retrieves a credential by username.
func (s *CredentialStore) GetByUsername(username string) (*gatewayv1.CredentialConfig, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    cred, ok := s.byUsername[username]
    return cred, ok
}

// Authenticate validates username/password and returns the credential if valid.
func (s *CredentialStore) Authenticate(username, password string) (*gatewayv1.CredentialConfig, bool) {
    s.mu.RLock()
    defer s.mu.RUnlock()

    cred, ok := s.byUsername[username]
    if !ok {
        return nil, false
    }

    // Hash the provided password and compare
    hash := sha256.Sum256([]byte(password))
    hashStr := hex.EncodeToString(hash[:])

    if hashStr != cred.PasswordHash {
        return nil, false
    }

    return cred, true
}

// Delete removes a credential by ID.
func (s *CredentialStore) Delete(id string) {
    s.mu.Lock()
    defer s.mu.Unlock()

    if cred, ok := s.byID[id]; ok {
        delete(s.byUsername, cred.Username)
        s.removeFromVCList(cred.VirtualClusterId, id)
        delete(s.byID, id)
    }
}

// ListByVirtualCluster returns all credentials for a virtual cluster.
func (s *CredentialStore) ListByVirtualCluster(vcID string) []*gatewayv1.CredentialConfig {
    s.mu.RLock()
    defer s.mu.RUnlock()

    list := s.byVirtualCluster[vcID]
    result := make([]*gatewayv1.CredentialConfig, len(list))
    copy(result, list)
    return result
}

// List returns all credentials.
func (s *CredentialStore) List() []*gatewayv1.CredentialConfig {
    s.mu.RLock()
    defer s.mu.RUnlock()

    result := make([]*gatewayv1.CredentialConfig, 0, len(s.byID))
    for _, cred := range s.byID {
        result = append(result, cred)
    }
    return result
}
```

**Step 4: Run test to verify it passes**

Run: `cd services/bifrost && go test ./internal/auth/... -v`
Expected: PASS

**Step 5: Commit**

```bash
git add services/bifrost/internal/auth/
git commit -m "feat(bifrost): implement CredentialStore

- Thread-safe in-memory store for service account credentials
- Indexed by ID, username, and virtual cluster
- SHA256 password validation for SASL authentication"
```

---

## Task 5: Implement Admin gRPC Service

**Files:**
- Create: `services/bifrost/internal/admin/server.go`
- Create: `services/bifrost/internal/admin/service.go`
- Create: `services/bifrost/internal/admin/service_test.go`

**Step 1: Write the failing test**

```go
// services/bifrost/internal/admin/service_test.go
package admin

import (
    "context"
    "testing"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"

    "github.com/drewpayment/orbit/services/bifrost/internal/auth"
    "github.com/drewpayment/orbit/services/bifrost/internal/config"
    gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

func TestService_UpsertVirtualCluster(t *testing.T) {
    vcStore := config.NewVirtualClusterStore()
    credStore := auth.NewCredentialStore()
    svc := NewService(vcStore, credStore)

    ctx := context.Background()
    req := &gatewayv1.UpsertVirtualClusterRequest{
        Config: &gatewayv1.VirtualClusterConfig{
            Id:          "vc-123",
            TopicPrefix: "test-",
        },
    }

    resp, err := svc.UpsertVirtualCluster(ctx, req)
    require.NoError(t, err)
    assert.True(t, resp.Success)

    // Verify it was stored
    vc, ok := vcStore.Get("vc-123")
    require.True(t, ok)
    assert.Equal(t, "test-", vc.TopicPrefix)
}

func TestService_UpsertCredential(t *testing.T) {
    vcStore := config.NewVirtualClusterStore()
    credStore := auth.NewCredentialStore()
    svc := NewService(vcStore, credStore)

    ctx := context.Background()
    req := &gatewayv1.UpsertCredentialRequest{
        Config: &gatewayv1.CredentialConfig{
            Id:       "cred-123",
            Username: "testuser",
        },
    }

    resp, err := svc.UpsertCredential(ctx, req)
    require.NoError(t, err)
    assert.True(t, resp.Success)
}

func TestService_GetStatus(t *testing.T) {
    vcStore := config.NewVirtualClusterStore()
    credStore := auth.NewCredentialStore()
    svc := NewService(vcStore, credStore)

    // Add some data
    vcStore.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-1"})
    vcStore.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-2"})

    ctx := context.Background()
    resp, err := svc.GetStatus(ctx, &gatewayv1.GetStatusRequest{})
    require.NoError(t, err)

    assert.Equal(t, "healthy", resp.Status)
    assert.Equal(t, int32(2), resp.VirtualClusterCount)
}

func TestService_GetFullConfig(t *testing.T) {
    vcStore := config.NewVirtualClusterStore()
    credStore := auth.NewCredentialStore()
    svc := NewService(vcStore, credStore)

    vcStore.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-1"})
    credStore.Upsert(&gatewayv1.CredentialConfig{Id: "cred-1", VirtualClusterId: "vc-1"})

    ctx := context.Background()
    resp, err := svc.GetFullConfig(ctx, &gatewayv1.GetFullConfigRequest{})
    require.NoError(t, err)

    assert.Len(t, resp.VirtualClusters, 1)
    assert.Len(t, resp.Credentials, 1)
}
```

**Step 2: Run test to verify it fails**

Run: `cd services/bifrost && go test ./internal/admin/... -v`
Expected: FAIL - package doesn't exist

**Step 3: Write minimal implementation**

```go
// services/bifrost/internal/admin/service.go
package admin

import (
    "context"
    "sync/atomic"

    "github.com/drewpayment/orbit/services/bifrost/internal/auth"
    "github.com/drewpayment/orbit/services/bifrost/internal/config"
    gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

// Service implements the BifrostAdminService gRPC interface.
type Service struct {
    gatewayv1.UnimplementedBifrostAdminServiceServer

    vcStore   *config.VirtualClusterStore
    credStore *auth.CredentialStore

    activeConnections int64 // atomic
}

// NewService creates a new admin service.
func NewService(vcStore *config.VirtualClusterStore, credStore *auth.CredentialStore) *Service {
    return &Service{
        vcStore:   vcStore,
        credStore: credStore,
    }
}

// SetActiveConnections updates the connection count (called by proxy).
func (s *Service) SetActiveConnections(count int64) {
    atomic.StoreInt64(&s.activeConnections, count)
}

// UpsertVirtualCluster adds or updates a virtual cluster configuration.
func (s *Service) UpsertVirtualCluster(ctx context.Context, req *gatewayv1.UpsertVirtualClusterRequest) (*gatewayv1.UpsertVirtualClusterResponse, error) {
    s.vcStore.Upsert(req.Config)
    return &gatewayv1.UpsertVirtualClusterResponse{Success: true}, nil
}

// DeleteVirtualCluster removes a virtual cluster.
func (s *Service) DeleteVirtualCluster(ctx context.Context, req *gatewayv1.DeleteVirtualClusterRequest) (*gatewayv1.DeleteVirtualClusterResponse, error) {
    s.vcStore.Delete(req.VirtualClusterId)
    return &gatewayv1.DeleteVirtualClusterResponse{Success: true}, nil
}

// ListVirtualClusters returns all virtual clusters.
func (s *Service) ListVirtualClusters(ctx context.Context, req *gatewayv1.ListVirtualClustersRequest) (*gatewayv1.ListVirtualClustersResponse, error) {
    return &gatewayv1.ListVirtualClustersResponse{
        VirtualClusters: s.vcStore.List(),
    }, nil
}

// UpsertCredential adds or updates a credential.
func (s *Service) UpsertCredential(ctx context.Context, req *gatewayv1.UpsertCredentialRequest) (*gatewayv1.UpsertCredentialResponse, error) {
    s.credStore.Upsert(req.Config)
    return &gatewayv1.UpsertCredentialResponse{Success: true}, nil
}

// RevokeCredential removes a credential.
func (s *Service) RevokeCredential(ctx context.Context, req *gatewayv1.RevokeCredentialRequest) (*gatewayv1.RevokeCredentialResponse, error) {
    s.credStore.Delete(req.CredentialId)
    return &gatewayv1.RevokeCredentialResponse{Success: true}, nil
}

// ListCredentials returns credentials, optionally filtered by virtual cluster.
func (s *Service) ListCredentials(ctx context.Context, req *gatewayv1.ListCredentialsRequest) (*gatewayv1.ListCredentialsResponse, error) {
    var creds []*gatewayv1.CredentialConfig
    if req.VirtualClusterId != "" {
        creds = s.credStore.ListByVirtualCluster(req.VirtualClusterId)
    } else {
        creds = s.credStore.List()
    }
    return &gatewayv1.ListCredentialsResponse{Credentials: creds}, nil
}

// GetStatus returns the current gateway status.
func (s *Service) GetStatus(ctx context.Context, req *gatewayv1.GetStatusRequest) (*gatewayv1.GetStatusResponse, error) {
    return &gatewayv1.GetStatusResponse{
        Status:              "healthy",
        ActiveConnections:   int32(atomic.LoadInt64(&s.activeConnections)),
        VirtualClusterCount: int32(s.vcStore.Count()),
        VersionInfo: map[string]string{
            "version": "1.0.0",
            "runtime": "go",
        },
    }, nil
}

// GetFullConfig returns all configuration for startup sync.
func (s *Service) GetFullConfig(ctx context.Context, req *gatewayv1.GetFullConfigRequest) (*gatewayv1.GetFullConfigResponse, error) {
    return &gatewayv1.GetFullConfigResponse{
        VirtualClusters: s.vcStore.List(),
        Credentials:     s.credStore.List(),
        // Policies and ACLs deferred for MVP
    }, nil
}

// SetVirtualClusterReadOnly is deferred for MVP.
func (s *Service) SetVirtualClusterReadOnly(ctx context.Context, req *gatewayv1.SetVirtualClusterReadOnlyRequest) (*gatewayv1.SetVirtualClusterReadOnlyResponse, error) {
    // TODO: Implement in future iteration
    return &gatewayv1.SetVirtualClusterReadOnlyResponse{Success: false}, nil
}

// Policy methods - deferred for MVP
func (s *Service) UpsertPolicy(ctx context.Context, req *gatewayv1.UpsertPolicyRequest) (*gatewayv1.UpsertPolicyResponse, error) {
    return &gatewayv1.UpsertPolicyResponse{Success: false}, nil
}

func (s *Service) DeletePolicy(ctx context.Context, req *gatewayv1.DeletePolicyRequest) (*gatewayv1.DeletePolicyResponse, error) {
    return &gatewayv1.DeletePolicyResponse{Success: false}, nil
}

func (s *Service) ListPolicies(ctx context.Context, req *gatewayv1.ListPoliciesRequest) (*gatewayv1.ListPoliciesResponse, error) {
    return &gatewayv1.ListPoliciesResponse{}, nil
}

// ACL methods - deferred for MVP
func (s *Service) UpsertTopicACL(ctx context.Context, req *gatewayv1.UpsertTopicACLRequest) (*gatewayv1.UpsertTopicACLResponse, error) {
    return &gatewayv1.UpsertTopicACLResponse{Success: false}, nil
}

func (s *Service) RevokeTopicACL(ctx context.Context, req *gatewayv1.RevokeTopicACLRequest) (*gatewayv1.RevokeTopicACLResponse, error) {
    return &gatewayv1.RevokeTopicACLResponse{Success: false}, nil
}

func (s *Service) ListTopicACLs(ctx context.Context, req *gatewayv1.ListTopicACLsRequest) (*gatewayv1.ListTopicACLsResponse, error) {
    return &gatewayv1.ListTopicACLsResponse{}, nil
}
```

**Step 4: Create server.go**

```go
// services/bifrost/internal/admin/server.go
package admin

import (
    "fmt"
    "net"

    "github.com/sirupsen/logrus"
    "google.golang.org/grpc"

    gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

// Server wraps the gRPC server for the Admin API.
type Server struct {
    grpcServer *grpc.Server
    service    *Service
    port       int
}

// NewServer creates a new admin server.
func NewServer(service *Service, port int) *Server {
    grpcServer := grpc.NewServer()
    gatewayv1.RegisterBifrostAdminServiceServer(grpcServer, service)

    return &Server{
        grpcServer: grpcServer,
        service:    service,
        port:       port,
    }
}

// Start begins listening for gRPC connections.
func (s *Server) Start() error {
    lis, err := net.Listen("tcp", fmt.Sprintf(":%d", s.port))
    if err != nil {
        return fmt.Errorf("failed to listen on port %d: %w", s.port, err)
    }

    logrus.Infof("Admin gRPC server listening on port %d", s.port)

    return s.grpcServer.Serve(lis)
}

// Stop gracefully shuts down the server.
func (s *Server) Stop() {
    logrus.Info("Stopping Admin gRPC server...")
    s.grpcServer.GracefulStop()
}
```

**Step 5: Run tests to verify they pass**

Run: `cd services/bifrost && go test ./internal/admin/... -v`
Expected: PASS

**Step 6: Commit**

```bash
git add services/bifrost/internal/admin/
git commit -m "feat(bifrost): implement Admin gRPC service

- BifrostAdminService for config sync from Orbit
- UpsertVirtualCluster, UpsertCredential, GetStatus, GetFullConfig
- Policy and ACL methods stubbed for future MVP iterations"
```

---

## Task 6: Implement SASL Authentication Handler

**Files:**
- Create: `services/bifrost/internal/auth/sasl.go`
- Create: `services/bifrost/internal/auth/sasl_test.go`

**Step 1: Write the failing test**

```go
// services/bifrost/internal/auth/sasl_test.go
package auth

import (
    "testing"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"

    "github.com/drewpayment/orbit/services/bifrost/internal/config"
    gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

func TestSASLHandler_Authenticate(t *testing.T) {
    credStore := NewCredentialStore()
    vcStore := config.NewVirtualClusterStore()

    // Setup test data
    vcStore.Upsert(&gatewayv1.VirtualClusterConfig{
        Id:          "vc-123",
        TopicPrefix: "test-",
    })

    credStore.Upsert(&gatewayv1.CredentialConfig{
        Id:               "cred-123",
        VirtualClusterId: "vc-123",
        Username:         "testuser",
        // SHA256 of "secret123"
        PasswordHash: "fcf730b6d95236ecd3c9fc2d92d7b6b2bb061514961aec041d6c7a7192f592e4",
    })

    handler := NewSASLHandler(credStore, vcStore)

    // Test successful auth
    ctx, err := handler.Authenticate("testuser", "secret123")
    require.NoError(t, err)
    assert.Equal(t, "cred-123", ctx.CredentialID)
    assert.Equal(t, "vc-123", ctx.VirtualClusterID)
    assert.Equal(t, "test-", ctx.TopicPrefix)
}

func TestSASLHandler_Authenticate_InvalidPassword(t *testing.T) {
    credStore := NewCredentialStore()
    vcStore := config.NewVirtualClusterStore()

    credStore.Upsert(&gatewayv1.CredentialConfig{
        Id:           "cred-123",
        Username:     "testuser",
        PasswordHash: "somehash",
    })

    handler := NewSASLHandler(credStore, vcStore)

    _, err := handler.Authenticate("testuser", "wrongpassword")
    assert.Error(t, err)
}

func TestSASLHandler_Authenticate_UnknownUser(t *testing.T) {
    credStore := NewCredentialStore()
    vcStore := config.NewVirtualClusterStore()

    handler := NewSASLHandler(credStore, vcStore)

    _, err := handler.Authenticate("unknownuser", "password")
    assert.Error(t, err)
}
```

**Step 2: Run test to verify it fails**

Run: `cd services/bifrost && go test ./internal/auth/... -v -run SASL`
Expected: FAIL - types don't exist

**Step 3: Write minimal implementation**

```go
// services/bifrost/internal/auth/sasl.go
package auth

import (
    "errors"

    "github.com/drewpayment/orbit/services/bifrost/internal/config"
)

var (
    ErrAuthFailed     = errors.New("authentication failed")
    ErrUnknownUser    = errors.New("unknown user")
    ErrInvalidCluster = errors.New("virtual cluster not found")
)

// ConnectionContext holds authenticated connection state.
type ConnectionContext struct {
    CredentialID     string
    VirtualClusterID string
    Username         string
    TopicPrefix      string
    GroupPrefix      string
    TxnIDPrefix      string
    BootstrapServers string
}

// SASLHandler handles SASL/PLAIN authentication.
type SASLHandler struct {
    credStore *CredentialStore
    vcStore   *config.VirtualClusterStore
}

// NewSASLHandler creates a new SASL handler.
func NewSASLHandler(credStore *CredentialStore, vcStore *config.VirtualClusterStore) *SASLHandler {
    return &SASLHandler{
        credStore: credStore,
        vcStore:   vcStore,
    }
}

// Authenticate validates credentials and returns connection context.
func (h *SASLHandler) Authenticate(username, password string) (*ConnectionContext, error) {
    // Authenticate against credential store
    cred, ok := h.credStore.Authenticate(username, password)
    if !ok {
        // Check if user exists for better error
        if _, exists := h.credStore.GetByUsername(username); !exists {
            return nil, ErrUnknownUser
        }
        return nil, ErrAuthFailed
    }

    // Get virtual cluster for this credential
    vc, ok := h.vcStore.Get(cred.VirtualClusterId)
    if !ok {
        return nil, ErrInvalidCluster
    }

    return &ConnectionContext{
        CredentialID:     cred.Id,
        VirtualClusterID: vc.Id,
        Username:         username,
        TopicPrefix:      vc.TopicPrefix,
        GroupPrefix:      vc.GroupPrefix,
        TxnIDPrefix:      vc.TransactionIdPrefix,
        BootstrapServers: vc.PhysicalBootstrapServers,
    }, nil
}
```

**Step 4: Run tests to verify they pass**

Run: `cd services/bifrost && go test ./internal/auth/... -v`
Expected: PASS

**Step 5: Commit**

```bash
git add services/bifrost/internal/auth/sasl.go services/bifrost/internal/auth/sasl_test.go
git commit -m "feat(bifrost): implement SASL authentication handler

- SASLHandler validates SASL/PLAIN credentials
- Returns ConnectionContext with virtual cluster prefixes
- Used by proxy to establish per-connection context"
```

---

## Task 7: Implement Topic/Group Rewriter

**Files:**
- Create: `services/bifrost/internal/proxy/rewriter.go`
- Create: `services/bifrost/internal/proxy/rewriter_test.go`

**Step 1: Write the failing test**

```go
// services/bifrost/internal/proxy/rewriter_test.go
package proxy

import (
    "testing"

    "github.com/stretchr/testify/assert"

    "github.com/drewpayment/orbit/services/bifrost/internal/auth"
)

func TestRewriter_PrefixTopic(t *testing.T) {
    ctx := &auth.ConnectionContext{
        TopicPrefix: "myapp-dev-",
    }
    r := NewRewriter(ctx)

    // Client sends "orders", should become "myapp-dev-orders"
    assert.Equal(t, "myapp-dev-orders", r.PrefixTopic("orders"))
}

func TestRewriter_UnprefixTopic(t *testing.T) {
    ctx := &auth.ConnectionContext{
        TopicPrefix: "myapp-dev-",
    }
    r := NewRewriter(ctx)

    // Broker returns "myapp-dev-orders", client sees "orders"
    result, ok := r.UnprefixTopic("myapp-dev-orders")
    assert.True(t, ok)
    assert.Equal(t, "orders", result)

    // Topic without our prefix (from another tenant)
    _, ok = r.UnprefixTopic("other-app-orders")
    assert.False(t, ok)
}

func TestRewriter_PrefixGroup(t *testing.T) {
    ctx := &auth.ConnectionContext{
        GroupPrefix: "myapp-dev-",
    }
    r := NewRewriter(ctx)

    assert.Equal(t, "myapp-dev-my-consumers", r.PrefixGroup("my-consumers"))
}

func TestRewriter_UnprefixGroup(t *testing.T) {
    ctx := &auth.ConnectionContext{
        GroupPrefix: "myapp-dev-",
    }
    r := NewRewriter(ctx)

    result, ok := r.UnprefixGroup("myapp-dev-my-consumers")
    assert.True(t, ok)
    assert.Equal(t, "my-consumers", result)
}

func TestRewriter_PrefixTransactionID(t *testing.T) {
    ctx := &auth.ConnectionContext{
        TxnIDPrefix: "myapp-dev-",
    }
    r := NewRewriter(ctx)

    assert.Equal(t, "myapp-dev-tx-123", r.PrefixTransactionID("tx-123"))
}

func TestRewriter_FilterTopics(t *testing.T) {
    ctx := &auth.ConnectionContext{
        TopicPrefix: "myapp-dev-",
    }
    r := NewRewriter(ctx)

    topics := []string{
        "myapp-dev-orders",
        "myapp-dev-users",
        "other-app-data",
        "__consumer_offsets",
    }

    filtered := r.FilterTopics(topics)
    assert.Len(t, filtered, 2)
    assert.Contains(t, filtered, "orders")
    assert.Contains(t, filtered, "users")
}
```

**Step 2: Run test to verify it fails**

Run: `cd services/bifrost && go test ./internal/proxy/rewriter_test.go -v`
Expected: FAIL - Rewriter type doesn't exist

**Step 3: Write minimal implementation**

```go
// services/bifrost/internal/proxy/rewriter.go
package proxy

import (
    "strings"

    "github.com/drewpayment/orbit/services/bifrost/internal/auth"
)

// Rewriter handles topic/group/transactionID prefix operations.
type Rewriter struct {
    ctx *auth.ConnectionContext
}

// NewRewriter creates a rewriter for a connection context.
func NewRewriter(ctx *auth.ConnectionContext) *Rewriter {
    return &Rewriter{ctx: ctx}
}

// PrefixTopic adds the tenant prefix to a topic name.
func (r *Rewriter) PrefixTopic(topic string) string {
    return r.ctx.TopicPrefix + topic
}

// UnprefixTopic removes the tenant prefix from a topic name.
// Returns false if the topic doesn't have our prefix (belongs to another tenant).
func (r *Rewriter) UnprefixTopic(topic string) (string, bool) {
    if !strings.HasPrefix(topic, r.ctx.TopicPrefix) {
        return "", false
    }
    return strings.TrimPrefix(topic, r.ctx.TopicPrefix), true
}

// PrefixGroup adds the tenant prefix to a consumer group ID.
func (r *Rewriter) PrefixGroup(group string) string {
    return r.ctx.GroupPrefix + group
}

// UnprefixGroup removes the tenant prefix from a consumer group ID.
func (r *Rewriter) UnprefixGroup(group string) (string, bool) {
    if !strings.HasPrefix(group, r.ctx.GroupPrefix) {
        return "", false
    }
    return strings.TrimPrefix(group, r.ctx.GroupPrefix), true
}

// PrefixTransactionID adds the tenant prefix to a transaction ID.
func (r *Rewriter) PrefixTransactionID(txnID string) string {
    return r.ctx.TxnIDPrefix + txnID
}

// UnprefixTransactionID removes the tenant prefix from a transaction ID.
func (r *Rewriter) UnprefixTransactionID(txnID string) (string, bool) {
    if !strings.HasPrefix(txnID, r.ctx.TxnIDPrefix) {
        return "", false
    }
    return strings.TrimPrefix(txnID, r.ctx.TxnIDPrefix), true
}

// FilterTopics filters a list of topics to only those belonging to this tenant.
// Returns virtual (unprefixed) topic names.
func (r *Rewriter) FilterTopics(topics []string) []string {
    result := make([]string, 0, len(topics))
    for _, topic := range topics {
        if virtual, ok := r.UnprefixTopic(topic); ok {
            result = append(result, virtual)
        }
    }
    return result
}

// HasTopicPrefix checks if we have a topic prefix configured.
func (r *Rewriter) HasTopicPrefix() bool {
    return r.ctx.TopicPrefix != ""
}
```

**Step 4: Run tests to verify they pass**

Run: `cd services/bifrost && go test ./internal/proxy/rewriter_test.go -v`
Expected: PASS

**Step 5: Commit**

```bash
git add services/bifrost/internal/proxy/rewriter.go services/bifrost/internal/proxy/rewriter_test.go
git commit -m "feat(bifrost): implement topic/group/txnID rewriter

- Prefix/unprefix operations for multi-tenant isolation
- FilterTopics for metadata response filtering
- Used by proxy to transparently rewrite Kafka protocol messages"
```

---

## Task 8: Implement Prometheus Metrics

**Files:**
- Create: `services/bifrost/internal/metrics/collector.go`
- Create: `services/bifrost/internal/metrics/collector_test.go`

**Step 1: Write the failing test**

```go
// services/bifrost/internal/metrics/collector_test.go
package metrics

import (
    "testing"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/stretchr/testify/assert"
)

func TestCollector_RecordConnection(t *testing.T) {
    // Create a new registry for testing
    reg := prometheus.NewRegistry()
    c := NewCollector()
    reg.MustRegister(c)

    c.RecordConnection("vc-123", true)
    c.RecordConnection("vc-123", true)
    c.RecordConnection("vc-123", false)

    // Verify metrics were recorded (no panic)
    assert.NotNil(t, c)
}

func TestCollector_RecordBytes(t *testing.T) {
    reg := prometheus.NewRegistry()
    c := NewCollector()
    reg.MustRegister(c)

    c.RecordBytes("vc-123", "in", 1024)
    c.RecordBytes("vc-123", "out", 2048)

    assert.NotNil(t, c)
}

func TestCollector_RecordRequest(t *testing.T) {
    reg := prometheus.NewRegistry()
    c := NewCollector()
    reg.MustRegister(c)

    c.RecordRequest("vc-123", 0, 0.005) // Produce request, 5ms

    assert.NotNil(t, c)
}
```

**Step 2: Run test to verify it fails**

Run: `cd services/bifrost && go test ./internal/metrics/... -v`
Expected: FAIL - package doesn't exist

**Step 3: Write minimal implementation**

```go
// services/bifrost/internal/metrics/collector.go
package metrics

import (
    "strconv"

    "github.com/prometheus/client_golang/prometheus"
)

// Collector holds Prometheus metrics for Bifrost.
type Collector struct {
    connectionsActive *prometheus.GaugeVec
    connectionsTotal  *prometheus.CounterVec
    bytesTotal        *prometheus.CounterVec
    requestsTotal     *prometheus.CounterVec
    requestDuration   *prometheus.HistogramVec
}

// NewCollector creates a new metrics collector.
func NewCollector() *Collector {
    return &Collector{
        connectionsActive: prometheus.NewGaugeVec(
            prometheus.GaugeOpts{
                Name: "bifrost_connections_active",
                Help: "Number of active client connections",
            },
            []string{"virtual_cluster"},
        ),
        connectionsTotal: prometheus.NewCounterVec(
            prometheus.CounterOpts{
                Name: "bifrost_connections_total",
                Help: "Total number of client connections",
            },
            []string{"virtual_cluster"},
        ),
        bytesTotal: prometheus.NewCounterVec(
            prometheus.CounterOpts{
                Name: "bifrost_bytes_total",
                Help: "Total bytes transferred",
            },
            []string{"virtual_cluster", "direction"},
        ),
        requestsTotal: prometheus.NewCounterVec(
            prometheus.CounterOpts{
                Name: "bifrost_requests_total",
                Help: "Total Kafka API requests",
            },
            []string{"virtual_cluster", "api_key"},
        ),
        requestDuration: prometheus.NewHistogramVec(
            prometheus.HistogramOpts{
                Name:    "bifrost_request_duration_seconds",
                Help:    "Request processing duration",
                Buckets: prometheus.DefBuckets,
            },
            []string{"virtual_cluster", "api_key"},
        ),
    }
}

// Describe implements prometheus.Collector.
func (c *Collector) Describe(ch chan<- *prometheus.Desc) {
    c.connectionsActive.Describe(ch)
    c.connectionsTotal.Describe(ch)
    c.bytesTotal.Describe(ch)
    c.requestsTotal.Describe(ch)
    c.requestDuration.Describe(ch)
}

// Collect implements prometheus.Collector.
func (c *Collector) Collect(ch chan<- prometheus.Metric) {
    c.connectionsActive.Collect(ch)
    c.connectionsTotal.Collect(ch)
    c.bytesTotal.Collect(ch)
    c.requestsTotal.Collect(ch)
    c.requestDuration.Collect(ch)
}

// RecordConnection records a connection event.
func (c *Collector) RecordConnection(virtualCluster string, opened bool) {
    if opened {
        c.connectionsActive.WithLabelValues(virtualCluster).Inc()
        c.connectionsTotal.WithLabelValues(virtualCluster).Inc()
    } else {
        c.connectionsActive.WithLabelValues(virtualCluster).Dec()
    }
}

// RecordBytes records bytes transferred.
func (c *Collector) RecordBytes(virtualCluster, direction string, bytes int64) {
    c.bytesTotal.WithLabelValues(virtualCluster, direction).Add(float64(bytes))
}

// RecordRequest records a Kafka API request.
func (c *Collector) RecordRequest(virtualCluster string, apiKey int16, durationSeconds float64) {
    apiKeyStr := strconv.Itoa(int(apiKey))
    c.requestsTotal.WithLabelValues(virtualCluster, apiKeyStr).Inc()
    c.requestDuration.WithLabelValues(virtualCluster, apiKeyStr).Observe(durationSeconds)
}
```

**Step 4: Run tests to verify they pass**

Run: `cd services/bifrost && go test ./internal/metrics/... -v`
Expected: PASS

**Step 5: Commit**

```bash
git add services/bifrost/internal/metrics/
git commit -m "feat(bifrost): implement Prometheus metrics collector

- Connection counts (active, total) by virtual cluster
- Bytes transferred by direction
- Request counts and duration histograms by API key"
```

---

## Task 9: Wire Up Main Entry Point

**Files:**
- Modify: `services/bifrost/cmd/bifrost/main.go`

**Step 1: Implement main.go with all components**

```go
// services/bifrost/cmd/bifrost/main.go
package main

import (
    "context"
    "net/http"
    "os"
    "os/signal"
    "strconv"
    "syscall"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
    "github.com/sirupsen/logrus"

    "github.com/drewpayment/orbit/services/bifrost/internal/admin"
    "github.com/drewpayment/orbit/services/bifrost/internal/auth"
    "github.com/drewpayment/orbit/services/bifrost/internal/config"
    "github.com/drewpayment/orbit/services/bifrost/internal/metrics"
)

func main() {
    // Configure logging
    logrus.SetFormatter(&logrus.TextFormatter{
        FullTimestamp: true,
    })
    logrus.SetLevel(logrus.InfoLevel)

    logrus.Info("Bifrost Gateway starting...")

    // Load configuration from environment
    cfg := loadConfig()

    // Initialize stores
    vcStore := config.NewVirtualClusterStore()
    credStore := auth.NewCredentialStore()

    // Initialize metrics
    collector := metrics.NewCollector()
    prometheus.MustRegister(collector)

    // Initialize admin service
    adminService := admin.NewService(vcStore, credStore)
    adminServer := admin.NewServer(adminService, cfg.AdminPort)

    // Initialize SASL handler (for future proxy integration)
    _ = auth.NewSASLHandler(credStore, vcStore)

    // Start metrics HTTP server
    go func() {
        mux := http.NewServeMux()
        mux.Handle("/metrics", promhttp.Handler())
        mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
            w.WriteHeader(http.StatusOK)
            w.Write([]byte("OK"))
        })
        mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
            w.WriteHeader(http.StatusOK)
            w.Write([]byte("READY"))
        })

        addr := ":" + strconv.Itoa(cfg.MetricsPort)
        logrus.Infof("Metrics server listening on %s", addr)
        if err := http.ListenAndServe(addr, mux); err != nil {
            logrus.Fatalf("Metrics server failed: %v", err)
        }
    }()

    // Start admin gRPC server
    go func() {
        if err := adminServer.Start(); err != nil {
            logrus.Fatalf("Admin server failed: %v", err)
        }
    }()

    // TODO: Start Kafka proxy (Task 10)
    logrus.Warn("Kafka proxy not yet implemented - only Admin API available")

    // Wait for shutdown signal
    ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
    defer stop()

    logrus.Info("Bifrost Gateway started successfully")
    <-ctx.Done()

    logrus.Info("Shutting down...")
    adminServer.Stop()
    logrus.Info("Bifrost Gateway stopped")
}

type Config struct {
    ProxyPort   int
    AdminPort   int
    MetricsPort int
    KafkaBrokers string
    LogLevel    string
}

func loadConfig() *Config {
    return &Config{
        ProxyPort:    getEnvInt("BIFROST_PROXY_PORT", 9092),
        AdminPort:    getEnvInt("BIFROST_ADMIN_PORT", 50060),
        MetricsPort:  getEnvInt("BIFROST_METRICS_PORT", 8080),
        KafkaBrokers: getEnv("KAFKA_BOOTSTRAP_SERVERS", "redpanda:9092"),
        LogLevel:     getEnv("BIFROST_LOG_LEVEL", "info"),
    }
}

func getEnv(key, defaultVal string) string {
    if val := os.Getenv(key); val != "" {
        return val
    }
    return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
    if val := os.Getenv(key); val != "" {
        if i, err := strconv.Atoi(val); err == nil {
            return i
        }
    }
    return defaultVal
}
```

**Step 2: Build and verify**

Run: `cd services/bifrost && go build ./cmd/bifrost`
Expected: Binary builds successfully

**Step 3: Run locally to test**

Run: `cd services/bifrost && ./bifrost`
Expected: Starts up, shows "Admin gRPC server listening on port 50060"

Verify in another terminal:
Run: `grpcurl -plaintext localhost:50060 list`
Expected: Shows `idp.gateway.v1.BifrostAdminService`

**Step 4: Commit**

```bash
git add services/bifrost/cmd/bifrost/main.go
git commit -m "feat(bifrost): wire up main entry point

- Initialize stores, metrics, admin server
- HTTP server for /metrics, /health, /ready
- Graceful shutdown handling
- Kafka proxy placeholder for next task"
```

---

## Task 10: Integrate Proxy with Authentication and Rewriting

**Files:**
- Create: `services/bifrost/internal/proxy/bifrost_proxy.go`
- Modify: `services/bifrost/cmd/bifrost/main.go`

This task integrates the vendored kafka-proxy code with our authentication and rewriting logic. This is the most complex task and involves modifying the vendored proxy code to support per-connection context.

**Step 1: Create BifrostProxy wrapper**

```go
// services/bifrost/internal/proxy/bifrost_proxy.go
package proxy

import (
    "fmt"
    "net"
    "sync"
    "sync/atomic"

    "github.com/sirupsen/logrus"

    "github.com/drewpayment/orbit/services/bifrost/internal/auth"
    "github.com/drewpayment/orbit/services/bifrost/internal/config"
    "github.com/drewpayment/orbit/services/bifrost/internal/metrics"
)

// BifrostProxy is the main Kafka proxy with multi-tenant support.
type BifrostProxy struct {
    listenAddr   string
    saslHandler  *auth.SASLHandler
    vcStore      *config.VirtualClusterStore
    metrics      *metrics.Collector

    listener     net.Listener
    connections  sync.Map // map[string]*Connection
    connCount    int64

    shutdown     chan struct{}
    wg           sync.WaitGroup
}

// NewBifrostProxy creates a new multi-tenant Kafka proxy.
func NewBifrostProxy(
    listenAddr string,
    saslHandler *auth.SASLHandler,
    vcStore *config.VirtualClusterStore,
    metricsCollector *metrics.Collector,
) *BifrostProxy {
    return &BifrostProxy{
        listenAddr:  listenAddr,
        saslHandler: saslHandler,
        vcStore:     vcStore,
        metrics:     metricsCollector,
        shutdown:    make(chan struct{}),
    }
}

// Start begins accepting connections.
func (p *BifrostProxy) Start() error {
    var err error
    p.listener, err = net.Listen("tcp", p.listenAddr)
    if err != nil {
        return fmt.Errorf("failed to listen on %s: %w", p.listenAddr, err)
    }

    logrus.Infof("Kafka proxy listening on %s", p.listenAddr)

    p.wg.Add(1)
    go p.acceptLoop()

    return nil
}

func (p *BifrostProxy) acceptLoop() {
    defer p.wg.Done()

    for {
        select {
        case <-p.shutdown:
            return
        default:
        }

        conn, err := p.listener.Accept()
        if err != nil {
            select {
            case <-p.shutdown:
                return
            default:
                logrus.Errorf("Accept error: %v", err)
                continue
            }
        }

        p.wg.Add(1)
        go p.handleConnection(conn)
    }
}

func (p *BifrostProxy) handleConnection(clientConn net.Conn) {
    defer p.wg.Done()
    defer clientConn.Close()

    connID := fmt.Sprintf("%s-%d", clientConn.RemoteAddr(), atomic.AddInt64(&p.connCount, 1))
    logrus.Debugf("New connection: %s", connID)

    // TODO: Implement full proxy logic
    // 1. Wait for SASL handshake
    // 2. Authenticate via p.saslHandler
    // 3. Get ConnectionContext with prefixes
    // 4. Create Rewriter
    // 5. Connect to upstream Kafka (from context.BootstrapServers)
    // 6. Proxy traffic with rewriting

    // For now, just log and close
    logrus.Warnf("Connection %s: proxy logic not yet implemented", connID)
}

// Stop gracefully shuts down the proxy.
func (p *BifrostProxy) Stop() {
    close(p.shutdown)
    if p.listener != nil {
        p.listener.Close()
    }
    p.wg.Wait()
    logrus.Info("Kafka proxy stopped")
}

// ActiveConnections returns the number of active connections.
func (p *BifrostProxy) ActiveConnections() int64 {
    return atomic.LoadInt64(&p.connCount)
}
```

**Step 2: Update main.go to start proxy**

Add to main.go after admin server start:

```go
    // Start Kafka proxy
    proxy := proxy.NewBifrostProxy(
        ":"+strconv.Itoa(cfg.ProxyPort),
        saslHandler,
        vcStore,
        collector,
    )
    if err := proxy.Start(); err != nil {
        logrus.Fatalf("Failed to start proxy: %v", err)
    }
    defer proxy.Stop()
```

**Step 3: Build and verify**

Run: `cd services/bifrost && go build ./cmd/bifrost`
Expected: Builds successfully

**Step 4: Test connection acceptance**

Run: `./bifrost` in one terminal
Run: `nc localhost 9092` in another terminal
Expected: Connection accepted, then closed with "proxy logic not yet implemented" in logs

**Step 5: Commit**

```bash
git add services/bifrost/
git commit -m "feat(bifrost): add BifrostProxy scaffold

- TCP listener accepting connections on :9092
- Placeholder for SASL auth and rewriting integration
- Connection tracking for metrics"
```

---

## Task 11: Update Docker Compose

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Update bifrost service definition**

Replace the existing bifrost service in docker-compose.yml:

```yaml
  # Bifrost Gateway (Go - Multi-tenant Kafka Proxy)
  bifrost:
    container_name: orbit-bifrost
    build:
      context: .
      dockerfile: services/bifrost/Dockerfile
    ports:
      - "9092:9092"    # Kafka proxy (via Traefik in production)
      - "50060:50060"  # Admin gRPC
      - "8080:8080"    # Metrics
    environment:
      - BIFROST_PROXY_PORT=9092
      - BIFROST_ADMIN_PORT=50060
      - BIFROST_METRICS_PORT=8080
      - KAFKA_BOOTSTRAP_SERVERS=redpanda:9092
      - BIFROST_LOG_LEVEL=info
    depends_on:
      redpanda:
        condition: service_healthy
    restart: unless-stopped
```

**Step 2: Update Traefik to route to Bifrost**

Update `infrastructure/traefik/dynamic.yml`:

```yaml
tcp:
  routers:
    kafka:
      entryPoints:
        - kafka
      rule: "HostSNI(`*`)"
      service: bifrost

  services:
    bifrost:
      loadBalancer:
        servers:
          - address: "bifrost:9092"
```

**Step 3: Build and test**

Run: `docker compose build bifrost`
Expected: Image builds successfully

Run: `docker compose up -d bifrost`
Expected: Container starts, logs show "Admin gRPC server listening"

**Step 4: Verify admin API**

Run: `grpcurl -plaintext localhost:50060 idp.gateway.v1.BifrostAdminService/GetStatus`
Expected: Returns status JSON

**Step 5: Commit**

```bash
git add docker-compose.yml infrastructure/traefik/dynamic.yml
git commit -m "feat(bifrost): update docker-compose for Go Bifrost

- Replace Kotlin Bifrost with Go version
- Update Traefik to route to new Bifrost
- Configure environment variables"
```

---

## Task 12: Delete Old Kotlin Bifrost

**Files:**
- Delete: `gateway/bifrost/` (entire directory)
- Delete: `services/bifrost-callback/` (merged into Bifrost)

**Step 1: Verify Go Bifrost is working**

Run: `docker compose up -d && docker compose logs bifrost`
Expected: Go Bifrost running, admin API responding

**Step 2: Delete Kotlin Bifrost**

```bash
rm -rf gateway/bifrost/
```

**Step 3: Delete bifrost-callback (merged)**

```bash
rm -rf services/bifrost-callback/
```

**Step 4: Update any references**

Search for remaining references:
```bash
grep -r "gateway/bifrost" --include="*.yml" --include="*.md" --include="*.go"
grep -r "bifrost-callback" --include="*.yml" --include="*.md" --include="*.go"
```

Update docker-compose.yml to remove bifrost-callback service if present.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove Kotlin Bifrost and bifrost-callback

- Delete gateway/bifrost/ (replaced by services/bifrost/)
- Delete services/bifrost-callback/ (merged into services/bifrost/)
- Go Bifrost now handles both control plane and data plane"
```

---

## Summary

This plan creates a working Go-based Bifrost with:

| Task | Component | Status |
|------|-----------|--------|
| 1 | Go module structure | Foundation |
| 2 | Vendored kafka-proxy | Core proxy code |
| 3 | VirtualClusterStore | Config storage |
| 4 | CredentialStore | Auth storage |
| 5 | Admin gRPC Service | Control plane API |
| 6 | SASL Handler | Authentication |
| 7 | Rewriter | Topic/group prefixing |
| 8 | Metrics Collector | Observability |
| 9 | Main entry point | Service wiring |
| 10 | BifrostProxy | Proxy scaffold |
| 11 | Docker Compose | Deployment |
| 12 | Cleanup | Remove old code |

**MVP delivers:**
- Admin gRPC API (full functionality)
- Prometheus metrics endpoint
- Health/readiness endpoints
- TCP listener scaffold (ready for full proxy implementation)

**Future work (separate plan):**
- Full proxy request/response handling with vendored kafka-proxy
- SASL authentication integration
- Topic/group/txnID rewriting in protocol messages
- Metadata response filtering
