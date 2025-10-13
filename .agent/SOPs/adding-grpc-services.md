# SOP: Adding gRPC Services

**Created**: 2025-01-15
**Last Updated**: 2025-01-15
**Trigger**: When creating a new microservice or adding gRPC endpoints

## Purpose
This SOP documents the complete workflow for adding a new gRPC service to the Orbit monorepo, from protobuf definition to implementation and testing.

## Prerequisites
- Go 1.21+ installed
- Node.js 18.20.2+ installed (for buf CLI)
- `make proto-gen` working (buf installed via orbit-www/node_modules)
- Understanding of protobuf syntax
- Familiarity with Go project structure

## Step-by-Step Process

### Phase 1: Define the Protobuf Contract

#### 1.1 Create Proto File
Create `proto/[service-name].proto`:

```protobuf
syntax = "proto3";

package orbit.[service];

option go_package = "github.com/drewpayment/orbit/proto/gen/go/[service]";

import "google/protobuf/timestamp.proto";

// Service definition
service [Service]Service {
  rpc Create[Entity](Create[Entity]Request) returns (Create[Entity]Response);
  rpc Get[Entity](Get[Entity]Request) returns (Get[Entity]Response);
  rpc List[Entities](List[Entities]Request) returns (List[Entities]Response);
  rpc Update[Entity](Update[Entity]Request) returns (Update[Entity]Response);
  rpc Delete[Entity](Delete[Entity]Request) returns (Delete[Entity]Response);
}

// Message definitions
message [Entity] {
  string id = 1;
  string workspace_id = 2;
  string name = 3;
  google.protobuf.Timestamp created_at = 4;
  google.protobuf.Timestamp updated_at = 5;
}

message Create[Entity]Request {
  string workspace_id = 1;
  string name = 2;
}

message Create[Entity]Response {
  [Entity] entity = 1;
}

// Add other request/response messages
```

#### 1.2 Update buf.yaml (if needed)
Ensure `proto/buf.yaml` includes the new service:

```yaml
version: v1
breaking:
  use:
    - FILE
lint:
  use:
    - DEFAULT
```

#### 1.3 Generate Code
```bash
make proto-gen
```

**Verify**:
- Go code generated in `proto/gen/go/[service]/`
- TypeScript code generated in `orbit-www/src/lib/proto/`
- No compilation errors

### Phase 2: Create Go Service

#### 2.1 Create Service Directory
```bash
mkdir -p services/[service-name]/{cmd/server,internal/{domain,service,grpc,temporal}}
cd services/[service-name]
```

#### 2.2 Initialize Go Module
```bash
go mod init github.com/drewpayment/orbit/services/[service-name]
```

#### 2.3 Add Proto Module Dependency
```bash
go mod edit -replace github.com/drewpayment/orbit/proto=../../proto
go get github.com/drewpayment/orbit/proto@latest
go get google.golang.org/grpc
go get google.golang.org/protobuf
```

#### 2.4 Create Domain Layer
`internal/domain/[entity].go`:

```go
package domain

import (
    "time"
)

// [Entity] represents the business entity
type [Entity] struct {
    ID          string
    WorkspaceID string
    Name        string
    CreatedAt   time.Time
    UpdatedAt   time.Time
}

// Validate performs business rule validation
func (e *[Entity]) Validate() error {
    if e.WorkspaceID == "" {
        return ErrInvalidWorkspaceID
    }
    if e.Name == "" {
        return ErrInvalidName
    }
    return nil
}
```

`internal/domain/errors.go`:

```go
package domain

import "errors"

var (
    ErrNotFound            = errors.New("entity not found")
    ErrInvalidWorkspaceID  = errors.New("invalid workspace ID")
    ErrInvalidName         = errors.New("invalid name")
    ErrAlreadyExists       = errors.New("entity already exists")
)
```

#### 2.5 Create Service Layer
`internal/service/[entity]_service.go`:

```go
package service

import (
    "context"
    "github.com/drewpayment/orbit/services/[service-name]/internal/domain"
)

type [Entity]Service struct {
    // Dependencies (database, other services, etc.)
}

func New[Entity]Service() *[Entity]Service {
    return &[Entity]Service{}
}

func (s *[Entity]Service) Create(ctx context.Context, workspaceID, name string) (*domain.[Entity], error) {
    entity := &domain.[Entity]{
        WorkspaceID: workspaceID,
        Name:        name,
    }

    if err := entity.Validate(); err != nil {
        return nil, err
    }

    // TODO: Persist to database

    return entity, nil
}

func (s *[Entity]Service) Get(ctx context.Context, id string) (*domain.[Entity], error) {
    // TODO: Implement
    return nil, domain.ErrNotFound
}

// Implement other methods
```

#### 2.6 Create gRPC Handler
`internal/grpc/server.go`:

```go
package grpc

import (
    pb "github.com/drewpayment/orbit/proto/gen/go/[service]"
    "github.com/drewpayment/orbit/services/[service-name]/internal/service"
)

type Server struct {
    pb.Unimplemented[Service]ServiceServer
    service *service.[Entity]Service
}

func NewServer(svc *service.[Entity]Service) *Server {
    return &Server{
        service: svc,
    }
}
```

`internal/grpc/[entity]_handler.go`:

```go
package grpc

import (
    "context"

    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"
    "google.golang.org/protobuf/types/known/timestamppb"

    pb "github.com/drewpayment/orbit/proto/gen/go/[service]"
    "github.com/drewpayment/orbit/services/[service-name]/internal/domain"
)

func (s *Server) Create[Entity](
    ctx context.Context,
    req *pb.Create[Entity]Request,
) (*pb.Create[Entity]Response, error) {
    // Validate request
    if req.WorkspaceId == "" {
        return nil, status.Error(codes.InvalidArgument, "workspace_id is required")
    }

    // Call service layer
    entity, err := s.service.Create(ctx, req.WorkspaceId, req.Name)
    if err != nil {
        return nil, convertDomainError(err)
    }

    // Convert to protobuf
    return &pb.Create[Entity]Response{
        Entity: domainToProto(entity),
    }, nil
}

func domainToProto(e *domain.[Entity]) *pb.[Entity] {
    return &pb.[Entity]{
        Id:          e.ID,
        WorkspaceId: e.WorkspaceID,
        Name:        e.Name,
        CreatedAt:   timestamppb.New(e.CreatedAt),
        UpdatedAt:   timestamppb.New(e.UpdatedAt),
    }
}

func convertDomainError(err error) error {
    switch err {
    case domain.ErrNotFound:
        return status.Error(codes.NotFound, err.Error())
    case domain.ErrInvalidWorkspaceID, domain.ErrInvalidName:
        return status.Error(codes.InvalidArgument, err.Error())
    case domain.ErrAlreadyExists:
        return status.Error(codes.AlreadyExists, err.Error())
    default:
        return status.Error(codes.Internal, "internal server error")
    }
}
```

#### 2.7 Create Main Entry Point
`cmd/server/main.go`:

```go
package main

import (
    "fmt"
    "log"
    "net"

    "google.golang.org/grpc"
    "google.golang.org/grpc/reflection"

    pb "github.com/drewpayment/orbit/proto/gen/go/[service]"
    grpcHandler "github.com/drewpayment/orbit/services/[service-name]/internal/grpc"
    "github.com/drewpayment/orbit/services/[service-name]/internal/service"
)

func main() {
    // Initialize service
    svc := service.New[Entity]Service()

    // Create gRPC server
    grpcServer := grpc.NewServer()
    pb.Register[Service]ServiceServer(grpcServer, grpcHandler.NewServer(svc))

    // Enable reflection for grpcurl
    reflection.Register(grpcServer)

    // Start listening
    lis, err := net.Listen("tcp", ":50051")
    if err != nil {
        log.Fatalf("failed to listen: %v", err)
    }

    fmt.Println("[Service] service listening on :50051")
    if err := grpcServer.Serve(lis); err != nil {
        log.Fatalf("failed to serve: %v", err)
    }
}
```

### Phase 3: Testing

#### 3.1 Create Service Tests
`internal/service/[entity]_service_test.go`:

```go
package service

import (
    "context"
    "testing"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestCreate[Entity](t *testing.T) {
    tests := []struct {
        name        string
        workspaceID string
        entityName  string
        wantErr     bool
    }{
        {
            name:        "valid entity",
            workspaceID: "ws-123",
            entityName:  "Test Entity",
            wantErr:     false,
        },
        {
            name:        "missing workspace ID",
            workspaceID: "",
            entityName:  "Test Entity",
            wantErr:     true,
        },
        {
            name:        "missing name",
            workspaceID: "ws-123",
            entityName:  "",
            wantErr:     true,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            svc := New[Entity]Service()
            entity, err := svc.Create(context.Background(), tt.workspaceID, tt.entityName)

            if tt.wantErr {
                assert.Error(t, err)
                assert.Nil(t, entity)
            } else {
                require.NoError(t, err)
                assert.NotNil(t, entity)
                assert.Equal(t, tt.workspaceID, entity.WorkspaceID)
                assert.Equal(t, tt.entityName, entity.Name)
            }
        })
    }
}
```

#### 3.2 Run Tests
```bash
cd services/[service-name]
go test -v -race ./...
```

### Phase 4: Integration with Frontend

#### 4.1 Create TypeScript Client Wrapper
`orbit-www/src/lib/grpc/[service]-client.ts`:

```typescript
import { createPromiseClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { [Service]Service } from '@/lib/proto/[service]_connect';

const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_[SERVICE]_URL || 'http://localhost:50051',
});

export const [service]Client = createPromiseClient([Service]Service, transport);
```

#### 4.2 Use in Frontend
```typescript
import { [service]Client } from '@/lib/grpc/[service]-client';

export async function createEntity(workspaceId: string, name: string) {
  try {
    const response = await [service]Client.create[Entity]({
      workspaceId,
      name,
    });
    return response.entity;
  } catch (error) {
    console.error('Failed to create entity:', error);
    throw error;
  }
}
```

### Phase 5: Update Build System

#### 5.1 Update Makefile
Add targets for the new service:

```makefile
.PHONY: test-[service]
test-[service]:
    cd services/[service-name] && go test -v -race -cover ./...

.PHONY: build-[service]
build-[service]:
    cd services/[service-name] && go build -o bin/[service] ./cmd/server
```

#### 5.2 Update Docker Compose (if needed)
Add service to `docker-compose.yml`:

```yaml
[service]:
  build:
    context: .
    dockerfile: services/[service-name]/Dockerfile
  ports:
    - "50051:50051"
  environment:
    - DATABASE_URL=postgresql://...
  depends_on:
    - postgres
```

## Common Mistakes to Avoid

1. ❌ **Forgetting to run `make proto-gen`** - Always regenerate after proto changes
2. ❌ **Not adding proto module replace** - Service won't find generated code
3. ❌ **Wrong gRPC error codes** - Use `codes.InvalidArgument`, not `codes.Unknown`
4. ❌ **Exposing internal errors** - Convert domain errors to gRPC status codes
5. ❌ **No workspace isolation** - Always validate and filter by workspace_id
6. ❌ **Missing validation** - Validate at gRPC layer AND service layer
7. ❌ **Not enabling reflection** - Makes testing with grpcurl impossible

## Verification Checklist

- [ ] Proto file follows naming conventions
- [ ] `make proto-gen` completes without errors
- [ ] Go module initialized with proto replace
- [ ] Domain layer has no external dependencies
- [ ] Service layer implements all business logic
- [ ] gRPC layer converts errors properly
- [ ] Unit tests cover all service methods
- [ ] gRPC server starts successfully
- [ ] Frontend can import generated TypeScript client
- [ ] Makefile includes new service targets

## Testing the Service

### Manual Testing with grpcurl
```bash
# List services
grpcurl -plaintext localhost:50051 list

# Call method
grpcurl -plaintext -d '{"workspace_id": "ws-123", "name": "Test"}' \
  localhost:50051 orbit.[service].[Service]Service/Create[Entity]
```

### Integration Testing
```bash
# Start service
cd services/[service-name] && go run cmd/server/main.go

# In another terminal, run frontend
cd orbit-www && pnpm dev

# Test from browser console
```

## Related Documentation
- See: [../system/api-architecture.md](../system/api-architecture.md) for gRPC patterns
- See: [../system/project-structure.md](../system/project-structure.md) for directory layout
- See: [error-handling.md](error-handling.md) for error handling patterns
- See: [../tasks/feature-repository-service.md](../tasks/feature-repository-service.md) for reference implementation
