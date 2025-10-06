# Protocol Buffer Code Generation

This document explains how to generate TypeScript and Go code from protobuf definitions without requiring global installations.

## Quick Start

```bash
# From project root
make proto-gen

# Or from orbit-www directory
bun run generate:proto
```

## How It Works

The proto generation is **100% portable** - no global installations required!

### What Happens

1. **Buf CLI** is installed as a dev dependency in `package.json`
2. Running `bun run generate:proto` executes the locally installed buf binary
3. Buf reads configuration from `proto/buf.yaml` and `proto/buf.gen.yaml`
4. Generated code is placed in:
   - **TypeScript**: `orbit-www/src/lib/proto/` (Connect-ES clients)
   - **Go**: `proto/gen/go/` (gRPC server implementations)

### Dependencies

All installed locally via npm/bun (no global tools needed):

```json
{
  "devDependencies": {
    "@bufbuild/buf": "^1.57.2",
    "@bufbuild/protoc-gen-es": "^2.9.0",
    "@connectrpc/protoc-gen-connect-es": "^1.7.0"
  }
}
```

## Using Generated Code

### TypeScript (Frontend)

After running `make proto-gen`, you can import generated clients:

```typescript
import { createPromiseClient } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-web"
import { WorkspaceService } from "@/lib/proto/workspace_connect"

// Create transport
const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080",
})

// Create client
const client = createPromiseClient(WorkspaceService, transport)

// Use client
const response = await client.listWorkspaces({
  pagination: { page: 1, pageSize: 10 },
})
```

### Go (Backend)

The Go services use the generated code from `proto/gen/go/`:

```go
import (
    workspacev1 "github.com/drewpayment/orbit/proto/gen/go/idp/workspace/v1"
)

// Implement the service interface
type workspaceServer struct {
    workspacev1.UnimplementedWorkspaceServiceServer
}

func (s *workspaceServer) ListWorkspaces(
    ctx context.Context,
    req *workspacev1.ListWorkspacesRequest,
) (*workspacev1.ListWorkspacesResponse, error) {
    // Implementation
}
```

## Configuration Files

### `proto/buf.yaml`

Defines the protobuf module configuration:
- Linting rules
- Breaking change detection
- Module organization

### `proto/buf.gen.yaml`

Defines code generation plugins and output paths:
- Go code generation (protoc-gen-go, protoc-gen-go-grpc)
- TypeScript code generation (Connect-ES)

## Troubleshooting

### "buf: command not found"

This means you haven't run `bun install` or `pnpm install` yet. The buf CLI is installed locally as a dev dependency.

```bash
cd orbit-www
bun install  # or pnpm install
```

### Generated Files Not Updated

Delete the generated directories and regenerate:

```bash
rm -rf orbit-www/src/lib/proto
rm -rf proto/gen
make proto-gen
```

### Import Errors in TypeScript

Make sure you've installed the Connect runtime dependencies:

```bash
bun add @connectrpc/connect @connectrpc/connect-web
```

## CI/CD Integration

In CI environments, the proto generation runs automatically:

```yaml
# Example GitHub Actions
- name: Install dependencies
  run: cd orbit-www && bun install

- name: Generate proto code
  run: make proto-gen

- name: Build frontend
  run: cd orbit-www && bun run build
```

## Benefits of This Approach

✅ **No global installations** - Everything in package.json
✅ **Version controlled** - Exact versions pinned
✅ **Team consistency** - Everyone uses the same tools
✅ **CI/CD friendly** - Works in any environment
✅ **Easy onboarding** - Just `bun install` and go

## Adding New Proto Files

1. Create your `.proto` file in the `proto/` directory
2. Run `make proto-gen` to generate code
3. Import and use the generated types in your code

Example:

```bash
# Create new proto file
cat > proto/notifications.proto << EOF
syntax = "proto3";
package idp.notifications.v1;
option go_package = "github.com/drewpayment/orbit/proto/gen/go/idp/notifications/v1;notificationsv1";

service NotificationService {
  rpc SendNotification(SendNotificationRequest) returns (SendNotificationResponse);
}
// ... rest of proto definition
EOF

# Generate code
make proto-gen

# Use in TypeScript
import { NotificationService } from "@/lib/proto/notifications_connect"
```

## Related Documentation

- [Buf Documentation](https://buf.build/docs/)
- [Connect-ES Documentation](https://connectrpc.com/docs/web/getting-started)
- [gRPC-Go Documentation](https://grpc.io/docs/languages/go/)
