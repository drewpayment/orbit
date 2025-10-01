# API Contracts

This directory contains the Protocol Buffer definitions for the Internal Developer Portal services.

## Hybrid Communication Architecture

The IDP uses Protocol Buffers to define contracts for **two communication patterns**:

### 1. HTTP REST APIs (Synchronous CRUD)
- **Purpose**: Quick read/write operations with immediate responses (<200ms)
- **Implementation**: Connect-RPC (gRPC-compatible HTTP/JSON API)
- **Use Cases**: Browse repositories, search schemas, CRUD knowledge pages, authentication

### 2. Temporal Workflows (Asynchronous IDP Operations)
- **Purpose**: Long-running, durable operations requiring orchestration
- **Implementation**: Temporal SDK with protobuf-defined request/response messages
- **Use Cases**: Repository generation, code generation, infrastructure provisioning (Pulumi)

## Service Contracts

### Core Services (HTTP + Temporal)

#### Repository Service
- `repository_service.proto` - HTTP API for browsing/searching repositories
- `repository_workflows.proto` - Temporal workflow definitions for repository generation
- **HTTP Operations**: ListRepositories, GetRepository, SearchRepositories
- **Workflow Operations**: GenerateRepositoryWorkflow, SyncRepositoryWorkflow

#### API Catalog Service
- `catalog_service.proto` - HTTP API for schema management
- `catalog_workflows.proto` - Temporal workflow definitions for code generation
- **HTTP Operations**: CreateSchema, ValidateSchema, ListSchemas, SearchSchemas
- **Workflow Operations**: GenerateCodeWorkflow, PublishSchemaWorkflow

#### Knowledge Service
- `knowledge_service.proto` - HTTP API for documentation CRUD
- `knowledge_workflows.proto` - Temporal workflow definitions for knowledge sync
- **HTTP Operations**: CreatePage, UpdatePage, DeletePage, SearchPages
- **Workflow Operations**: SyncKnowledgeSpaceWorkflow, ExportDocumentationWorkflow

#### Infrastructure Service
- `infrastructure_workflows.proto` - Temporal workflow definitions for Pulumi-based provisioning
- **Workflow Operations**: ProvisionInfrastructureWorkflow, DeployServiceWorkflow

### Shared Definitions
- `common.proto` - Common types and enums (used by both HTTP and Temporal)
- `pagination.proto` - Pagination patterns for HTTP list operations
- `auth.proto` - Authentication and authorization types
- `workflow_status.proto` - Workflow execution status for polling

## Code Generation

Protocol Buffers generate code for both communication patterns:

### Generate All Code
```bash
# From repository root
make proto-gen
```

### Manual Generation

```bash
# Generate Go code (HTTP handlers + Temporal messages)
buf generate --template buf.gen.go.yaml

# Generate TypeScript code (HTTP clients + Temporal SDK types)
buf generate --template buf.gen.ts.yaml

# Generate OpenAPI documentation
buf generate --template buf.gen.docs.yaml
```

## Generated Artifacts

### Go (Backend)
- **Location**: `proto/gen/go/`
- **HTTP**: Connect-RPC service implementations
- **Temporal**: Workflow and activity message types
- **Usage**: Imported by Go services in `services/*/internal/`

### TypeScript (Frontend)
- **Location**: `orbit-www/src/lib/proto/`
- **HTTP**: Connect-ES client libraries
- **Temporal**: Request/response types for workflow triggers
- **Usage**: Imported by Next.js frontend components and API routes

## Example: Dual Pattern Usage

### HTTP REST Example (Synchronous)
```protobuf
// repository_service.proto
service RepositoryService {
  // List repositories in a workspace
  rpc ListRepositories(ListRepositoriesRequest) returns (ListRepositoriesResponse);

  // Search repositories by query
  rpc SearchRepositories(SearchRepositoriesRequest) returns (SearchRepositoriesResponse);
}
```

**Frontend (TypeScript)**:
```typescript
import { createPromiseClient } from "@connectrpc/connect";
import { RepositoryService } from "@/lib/proto/repository_service_connect";

const client = createPromiseClient(RepositoryService, transport);
const repos = await client.listRepositories({ workspaceId: "ws-123" });
```

**Backend (Go)**:
```go
import repositoryv1 "github.com/drewpayment/orbit/proto/gen/go/repository/v1"

func (s *Server) ListRepositories(
    ctx context.Context,
    req *connect.Request[repositoryv1.ListRepositoriesRequest],
) (*connect.Response[repositoryv1.ListRepositoriesResponse], error) {
    // Implementation
}
```

### Temporal Workflow Example (Asynchronous)
```protobuf
// repository_workflows.proto
message GenerateRepositoryRequest {
  string workspace_id = 1;
  string user_id = 2;
  string template_type = 3;
  map<string, string> variables = 4;
}

message GenerateRepositoryResponse {
  string repository_id = 1;
  string git_url = 2;
  repeated GeneratedFile files = 3;
}
```

**Frontend (TypeScript)**:
```typescript
import { Client } from "@temporalio/client";
import { GenerateRepositoryRequest } from "@/lib/proto/repository_workflows";

const client = new Client();
const handle = await client.workflow.start("GenerateRepository", {
  taskQueue: "repository-tasks",
  args: [request],
});

// Poll for status
const status = await handle.query("getStatus");
```

**Backend (Go)**:
```go
import repositoryv1 "github.com/drewpayment/orbit/proto/gen/go/repository/v1"

func GenerateRepositoryWorkflow(
    ctx workflow.Context,
    req *repositoryv1.GenerateRepositoryRequest,
) (*repositoryv1.GenerateRepositoryResponse, error) {
    // Workflow implementation with activities
}
```

## Benefits of Unified Protobuf Definitions

1. **Single Source of Truth**: One `.proto` file defines contracts for both HTTP and Temporal
2. **Type Safety**: Compile-time validation across TypeScript frontend and Go backend
3. **Automatic Documentation**: OpenAPI specs generated from the same definitions
4. **Versioning**: Protobuf versioning (v1, v2) applies to both patterns
5. **Contract Testing**: Same contract tests validate both HTTP endpoints and workflow messages
6. **Developer Experience**: IntelliSense/autocomplete in both frontend and backend