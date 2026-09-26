---
name: orbit-scaffolding
description: Step-by-step procedures for scaffolding new pieces of the Orbit monorepo — adding a Go microservice under services/, adding a protobuf/gRPC service in proto/, and writing Temporal workflows. Use when creating a new service, adding or changing a .proto file, or authoring workflows and activities.
---

# Orbit scaffolding procedures

### Adding a New Go Service

1. Create service directory under `services/`
2. Initialize Go module: `go mod init github.com/drewpayment/orbit/services/[name]`
3. Add proto module replace: `replace github.com/drewpayment/orbit/proto => ../../proto`
4. Follow standard layout: `cmd/server/`, `internal/`, `pkg/`, `tests/`
5. Update `Makefile` to include new service in build/test/lint targets
6. Update `docker-compose.yml` if service needs containerization

### Adding a New Protobuf Service

1. Create or update `.proto` file in `proto/`
2. Run `make proto-gen` to generate code
3. Implement the service in the relevant Go service's `internal/grpc/` directory
4. Update frontend to use generated TypeScript client from `orbit-www/src/lib/proto/`

### Working with Temporal Workflows

- Workflow definitions live in `temporal-workflows/internal/`
- Activities should be idempotent and handle retries gracefully
- Use workflow queries for progress tracking
- Test workflows using Temporal's test framework
