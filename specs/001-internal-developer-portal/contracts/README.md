# API Contracts

This directory contains the API contracts for the Internal Developer Portal services.

## Service Contracts

### Core Services
- `workspace.proto` - Workspace Management API
- `repository.proto` - Repository Management API  
- `api_catalog.proto` - API Schema Catalog API
- `knowledge.proto` - Knowledge Management API
- `temporal.proto` - Temporal Workflow Orchestration API

### Shared Definitions
- `common.proto` - Common types and enums
- `pagination.proto` - Pagination patterns
- `auth.proto` - Authentication types

### Usage

These protobuf definitions are used to:
1. Generate Go service implementations
2. Generate TypeScript client code for the frontend
3. Generate OpenAPI documentation
4. Ensure type safety across service boundaries

## Code Generation

```bash
# Generate Go code
buf generate --template buf.gen.go.yaml

# Generate TypeScript code  
buf generate --template buf.gen.ts.yaml

# Generate documentation
buf generate --template buf.gen.docs.yaml
```