# API Architecture

**Last Updated**: 2025-01-15
**Scope**: gRPC service contracts and communication patterns

## Communication Patterns

### Frontend ↔ Backend
- **Protocol**: gRPC-Web (Connect-ES)
- **Transport**: HTTP/2
- **Format**: Protocol Buffers
- **Auth**: JWT tokens in metadata

### Service ↔ Service
- **Protocol**: gRPC
- **Transport**: HTTP/2
- **Format**: Protocol Buffers
- **Discovery**: Direct service URLs (future: service mesh)

### Async Operations
- **Engine**: Temporal
- **Use Cases**: Long-running repo operations, batch processing, scheduled tasks
- **Communication**: Temporal gRPC API

## gRPC Service Contracts

### Workspace Service (`proto/workspace.proto`)
```protobuf
service WorkspaceService {
  rpc CreateWorkspace(CreateWorkspaceRequest) returns (CreateWorkspaceResponse);
  rpc GetWorkspace(GetWorkspaceRequest) returns (GetWorkspaceResponse);
  rpc ListWorkspaces(ListWorkspacesRequest) returns (ListWorkspacesResponse);
  rpc UpdateWorkspace(UpdateWorkspaceRequest) returns (UpdateWorkspaceResponse);
  rpc DeleteWorkspace(DeleteWorkspaceRequest) returns (DeleteWorkspaceResponse);
}
```
**Port**: TBD (not yet implemented as Go service)

### Repository Service (`proto/repository.proto`)
```protobuf
service RepositoryService {
  rpc CreateRepository(CreateRepositoryRequest) returns (CreateRepositoryResponse);
  rpc GetRepository(GetRepositoryRequest) returns (GetRepositoryResponse);
  rpc ListRepositories(ListRepositoriesRequest) returns (ListRepositoriesResponse);
  rpc SyncRepository(SyncRepositoryRequest) returns (SyncRepositoryResponse);
  // Returns workflow ID for tracking
}
```
**Port**: 50051 (planned)

### API Catalog Service (`proto/api_catalog.proto`)
```protobuf
service ApiCatalogService {
  rpc RegisterApiSchema(RegisterApiSchemaRequest) returns (RegisterApiSchemaResponse);
  rpc GetApiSchema(GetApiSchemaRequest) returns (GetApiSchemaResponse);
  rpc ListApiSchemas(ListApiSchemasRequest) returns (ListApiSchemasResponse);
  rpc SearchSchemas(SearchSchemasRequest) returns (SearchSchemasResponse);
}
```
**Port**: 50052 (planned)

### Knowledge Service (`proto/knowledge.proto`)
```protobuf
service KnowledgeService {
  rpc CreateDocument(CreateDocumentRequest) returns (CreateDocumentResponse);
  rpc GetDocument(GetDocumentRequest) returns (GetDocumentResponse);
  rpc SearchDocuments(SearchDocumentsRequest) returns (SearchDocumentsResponse);
  rpc UpdateDocument(UpdateDocumentRequest) returns (UpdateDocumentResponse);
}
```
**Port**: 50053 (planned)

## Request/Response Patterns

### Standard Success Response
```protobuf
message CreateWorkspaceResponse {
  string id = 1;
  string name = 2;
  string slug = 3;
  google.protobuf.Timestamp created_at = 4;
}
```

### Standard Error Handling
- Use gRPC status codes: `INVALID_ARGUMENT`, `NOT_FOUND`, `ALREADY_EXISTS`, `INTERNAL`
- Include error details in status message
- Frontend displays user-friendly messages

### Pagination Pattern
```protobuf
message ListWorkspacesRequest {
  int32 page_size = 1;  // Max 100
  string page_token = 2; // Opaque continuation token
}

message ListWorkspacesResponse {
  repeated Workspace workspaces = 1;
  string next_page_token = 2;
  int32 total_count = 3;
}
```

### Long-Running Operations
```protobuf
message SyncRepositoryResponse {
  string workflow_id = 1;  // Temporal workflow ID
  string run_id = 2;       // Temporal run ID
}

// Client polls for status:
rpc GetWorkflowStatus(GetWorkflowStatusRequest) returns (GetWorkflowStatusResponse);
```

## Generated Code Usage

### Frontend (TypeScript)
```typescript
// Generated client in orbit-www/src/lib/proto/
import { WorkspaceService } from '@/lib/proto/workspace_connect';
import { createPromiseClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';

const transport = createConnectTransport({
  baseUrl: 'http://localhost:50050',
});

const client = createPromiseClient(WorkspaceService, transport);

const response = await client.createWorkspace({
  name: 'My Workspace',
  slug: 'my-workspace',
});
```

### Backend (Go)
```go
// Generated server interface
import pb "github.com/drewpayment/orbit/proto/gen/go/workspace"

type server struct {
    pb.UnimplementedWorkspaceServiceServer
    service *service.WorkspaceService
}

func (s *server) CreateWorkspace(
    ctx context.Context,
    req *pb.CreateWorkspaceRequest,
) (*pb.CreateWorkspaceResponse, error) {
    // Implementation
}
```

## Authentication & Authorization

### JWT Token Flow
1. User logs in via Payload CMS
2. Frontend receives JWT token
3. Token attached to gRPC metadata: `authorization: Bearer <token>`
4. Go services validate token via middleware

### Workspace Isolation
- All requests include `workspace_id` in context
- Services enforce workspace-level data isolation
- Database queries always filter by workspace

## Code Generation Workflow

### When to Regenerate
- After modifying any `.proto` file
- After pulling changes that include proto updates
- Before starting work on a new gRPC feature

### How to Regenerate
```bash
make proto-gen

# Or manually from frontend:
cd orbit-www && bun run generate:proto
```

### What Gets Generated
- **Go**: `proto/gen/go/` - Server interfaces, message types, clients
- **TypeScript**: `orbit-www/src/lib/proto/` - Connect-ES clients, message types

### Important Rules
- **NEVER** edit generated code manually
- **ALWAYS** commit generated code (for consistent builds)
- **CHECK** that both Go and TypeScript code compiles after regeneration

## Service Discovery

### Current Approach (Development)
- Hardcoded URLs in configuration
- Frontend: `http://localhost:50051` (repository service)
- Services: Direct URLs to other services

### Future Approach (Production)
- Service mesh (Istio/Linkerd) for discovery
- Environment-based configuration
- Health checks and circuit breakers

## Error Handling Best Practices

### Go Services
```go
import (
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"
)

// Return gRPC status errors
return nil, status.Error(codes.NotFound, "workspace not found")
return nil, status.Errorf(codes.InvalidArgument, "invalid slug: %s", req.Slug)
```

### Frontend
```typescript
import { ConnectError } from '@connectrpc/connect';

try {
  const response = await client.createWorkspace(request);
} catch (error) {
  if (error instanceof ConnectError) {
    switch (error.code) {
      case Code.NotFound:
        // Handle not found
        break;
      case Code.InvalidArgument:
        // Handle validation error
        break;
      default:
        // Handle generic error
    }
  }
}
```

## Performance Considerations

### Streaming (Future)
```protobuf
// Server streaming for large result sets
rpc StreamRepositories(StreamRepositoriesRequest) returns (stream Repository);

// Bidirectional streaming for real-time sync
rpc SyncRealtime(stream SyncMessage) returns (stream SyncMessage);
```

### Connection Pooling
- Go services use connection pooling by default
- Frontend uses single persistent connection per service

### Timeouts
- Default request timeout: 30 seconds
- Long-running operations: Return immediately with workflow ID
- Client polls for status or uses WebSocket for updates

## Testing gRPC Services

### Unit Tests (Go)
```go
// Test service logic without gRPC
func TestCreateWorkspace(t *testing.T) {
    svc := service.NewWorkspaceService(mockDB)
    workspace, err := svc.CreateWorkspace(ctx, "test", "test-slug")
    assert.NoError(t, err)
}
```

### Integration Tests (Go)
```go
// Test full gRPC handler
import "google.golang.org/grpc/test/bufconn"

func TestGRPCCreateWorkspace(t *testing.T) {
    // Use bufconn for in-memory gRPC client/server
}
```

### E2E Tests (Frontend)
```typescript
// Test through real gRPC client
test('create workspace via gRPC', async () => {
  const client = createTestClient();
  const response = await client.createWorkspace({ name: 'Test' });
  expect(response.id).toBeDefined();
});
```

## Related Documentation
- See: [project-structure.md](project-structure.md) for service layout
- See: [../SOPs/adding-grpc-services.md](../SOPs/adding-grpc-services.md) for implementation steps
- See: [../tasks/feature-repository-service.md](../tasks/feature-repository-service.md) for example implementation
