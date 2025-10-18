# Feature: Backstage Community Plugin Integration

**Status**: Planned
**Date**: 2025-10-17
**Estimated Complexity**: High
**Related Documentation**:
- See: [.agent/system/project-structure.md](.agent/system/project-structure.md)
- See: [.agent/system/api-architecture.md](.agent/system/api-architecture.md)
- See: [.agent/SOPs/adding-grpc-services.md](.agent/SOPs/adding-grpc-services.md)
- See: [.agent/SOPs/integrating-apis.md](.agent/SOPs/integrating-apis.md)

## Overview

Integrate Backstage community plugins as a third-party integration layer for Orbit IDP, enabling administrators to leverage 60+ pre-built plugins for external services (Jira, GitHub, Kubernetes, Jenkins, etc.) without building proprietary integrations. Backstage will run as a Node.js microservice alongside Orbit's Go services, with a new Go "plugins" service acting as a proxy layer for full data control and workspace isolation.

## Requirements (PRD)

### User Stories
- As an Orbit administrator, I want to enable/disable Backstage plugins from the Payload CMS admin UI so that I can quickly add integrations without code deployments
- As an Orbit administrator, I want to configure plugin API credentials (Jira URL, GitHub tokens, etc.) in Payload CMS so that plugins can connect to external services
- As an Orbit developer, I want plugin data to be isolated by workspace so that multi-tenant data security is maintained
- As an Orbit user, I want to view data from external tools (Jira issues, GitHub PRs, K8s deployments) within Orbit so that I have a unified developer portal experience

### Technical Requirements
- Run Backstage backend (Node.js 18+) as a microservice in Orbit's infrastructure
- Create new Go "plugins" gRPC service to proxy Backstage plugin APIs
- Implement workspace-based data filtering at the Go service layer
- Store plugin configuration and enable/disable state in Payload CMS
- Pre-install curated set of community plugins (5-10 initial plugins)
- Support plugin categories: API Catalog, CI/CD, Infrastructure, Project Management
- Maintain Orbit's authentication system (no separate Backstage auth)
- All plugin data must flow through Orbit's Go services (no direct frontend-to-Backstage calls)

### Business Rules
- Only pre-installed plugins can be enabled/disabled (no runtime plugin installation for MVP)
- Plugin configuration requires workspace admin permissions
- Plugin data is tagged with workspace_id and filtered accordingly
- External API credentials are encrypted at rest in PostgreSQL
- Backstage backend runs in isolated container with limited network access

## Current State Analysis

### What Exists Now
Orbit currently has:
- **Go microservices architecture**: `services/repository/`, `services/api-catalog/`, `services/knowledge/`
- **Multi-tenant workspace system**: Workspace isolation via `workspace_id` foreign keys
- **Payload CMS admin UI**: `orbit-www/src/collections/` for managing entities
- **gRPC communication**: Frontend uses Connect-ES TypeScript clients to call Go services
- **Infrastructure**: Docker Compose for local dev, PostgreSQL, Redis, Temporal

Relevant patterns:
- gRPC service structure: `services/*/internal/{domain,service,grpc}/`
- Workspace filtering: Implemented in repository service queries
- External API integration: GitHub API integration pattern exists (needs review)
- Payload collections: Users, Media, Workspaces, Repositories

### Key Discoveries
- Backstage plugins require Node.js runtime with Express.js framework
- Plugins use dependency injection to access core services (logger, database, httpRouter, config)
- Community plugins repository: https://github.com/backstage/community-plugins (60+ plugins)
- Backstage supports "standalone mode" for backend plugin development/testing
- Backstage has built-in proxy plugin for external API calls
- Node.js 18+ and 20+ are supported Backstage versions
- Plugins cannot run outside Backstage framework (tight coupling to core services)

### What's Missing
- Node.js Backstage backend service integration
- Go "plugins" gRPC service to proxy Backstage APIs
- Workspace-aware middleware for Backstage
- Payload CMS collections for plugin management (PluginRegistry, PluginConfig)
- Frontend components to display plugin data
- Security hardening for third-party plugin code execution
- Multi-tenant data isolation layer
- Deployment configuration for Backstage container

## Desired End State

### Success Indicators
- Administrators can enable/disable 5-10 pre-installed Backstage plugins from Payload CMS
- Plugin configuration (API keys, URLs) is managed via Payload admin UI
- Plugin data is isolated by workspace (Workspace A cannot see Workspace B's data)
- Orbit frontend displays plugin data fetched through Go gRPC APIs
- Backstage backend runs as containerized service in docker-compose
- All plugin API calls are proxied through Go "plugins" service
- Security audit passes with no critical vulnerabilities in plugin code

### How to Verify
- **Plugin Management**: Admin can toggle a plugin on/off, changes are reflected in API responses
- **Multi-tenancy**: Create two workspaces with same plugin enabled, verify data isolation via API calls
- **Configuration**: Update plugin API credentials in Payload, verify plugin makes authenticated calls
- **Data Flow**: Frontend calls Orbit gRPC API → Go service calls Backstage HTTP API → Backstage plugin calls external API (Jira, GitHub, etc.)
- **Security**: Run `npm audit` on Backstage dependencies, verify no HIGH/CRITICAL vulnerabilities
- **Performance**: Plugin API responses return within 2 seconds under normal load

## What We're NOT Doing

- NOT implementing Backstage frontend UI (backend/data only)
- NOT allowing runtime installation of arbitrary npm plugins (security risk)
- NOT using Backstage's catalog system (Orbit has its own)
- NOT replacing Orbit's authentication with Backstage auth
- NOT embedding Backstage React components in Orbit UI (custom components only)
- NOT supporting Backstage's user management or permissions (use Orbit's)
- NOT implementing dynamic plugin loading without application restart
- NOT building a plugin marketplace for MVP (curated pre-installed list only)

## Implementation Approach

### High-Level Strategy
Run Backstage backend as an integration layer microservice, deeply integrated with Orbit's architecture through a new Go "plugins" service. Backstage handles plugin lifecycle and external API communication, while Orbit maintains full control over authentication, authorization, data transformation, and workspace isolation.

### Architecture Decisions
- **Decision 1**: Use full Backstage backend (not minimal fork) because maintaining compatibility with upstream updates is critical for security patches and new plugins
- **Decision 2**: Create dedicated Go "plugins" service (not add to existing services) because this is a distinct concern with different scaling/deployment needs
- **Decision 3**: Proxy all plugin data through Go layer (not direct frontend calls) because workspace filtering and data transformation must be centralized
- **Decision 4**: Store plugin config in Payload (not Backstage's app-config.yaml) because admin UI must be the source of truth and changes should not require deployments

### Patterns to Follow
- gRPC service structure from `.agent/SOPs/adding-grpc-services.md`
- External API integration patterns from `.agent/SOPs/integrating-apis.md`
- Workspace isolation patterns from `services/repository/internal/service/`
- Payload collection patterns from existing collections

## Phase 1: Backstage Backend Setup

### Overview
Bootstrap a minimal Backstage backend with dependency injection system, select and install 5-10 initial community plugins, configure for Orbit's environment (no Backstage catalog, custom auth).

### Prerequisites
- [ ] Node.js 18+ installed in development environment
- [ ] Docker and docker-compose available for containerization
- [ ] Network connectivity to npm registry for plugin installation

### Changes Required

#### 1. Backstage Backend Service

**Files to Create:**
- `services/backstage-backend/package.json` - Node.js dependencies
- `services/backstage-backend/app-config.yaml` - Backstage configuration
- `services/backstage-backend/src/index.ts` - Backend entry point
- `services/backstage-backend/src/plugins/` - Plugin registration
- `services/backstage-backend/Dockerfile` - Container image
- `services/backstage-backend/.dockerignore` - Build exclusions

**Changes Summary:**
Create a new Backstage backend application using `@backstage/create-app` as reference, but stripped down to only plugin execution. Remove Backstage catalog, auth, and frontend components.

**Code Examples:**
```typescript
// services/backstage-backend/src/index.ts
import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

// Core services (minimal set)
backend.add(import('@backstage/plugin-app-backend'));

// Initial plugin set - API Catalog category
backend.add(import('@backstage-community/plugin-api-docs-backend'));
backend.add(import('@backstage-community/plugin-graphql-backend'));

// Initial plugin set - CI/CD category
backend.add(import('@backstage-community/plugin-github-actions-backend'));
backend.add(import('@backstage-community/plugin-jenkins-backend'));

// Initial plugin set - Infrastructure category
backend.add(import('@backstage-community/plugin-kubernetes-backend'));

// Initial plugin set - Project Management category
backend.add(import('@backstage-community/plugin-jira-backend'));

// Custom workspace middleware
backend.add(import('./modules/workspace-isolation'));

backend.start();
```

```yaml
# services/backstage-backend/app-config.yaml
app:
  title: Orbit Backstage Integration
  baseUrl: http://localhost:7007

backend:
  baseUrl: http://localhost:7007
  listen:
    port: 7007
    host: 0.0.0.0
  cors:
    origin: http://localhost:3000
    credentials: true
  database:
    client: pg
    connection:
      host: ${POSTGRES_HOST}
      port: ${POSTGRES_PORT}
      user: ${POSTGRES_USER}
      password: ${POSTGRES_PASSWORD}
      database: backstage

# Plugin configurations (populated from Orbit Payload API)
# This will be dynamically loaded via custom config loader
integrations: {}
```

```dockerfile
# services/backstage-backend/Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

COPY . .

RUN yarn build

EXPOSE 7007
CMD ["node", "packages/backend", "--config", "app-config.yaml"]
```

#### 2. Docker Compose Integration

**Files to Modify:**
- `docker-compose.yml` - Add Backstage backend service

**Changes:**
```yaml
# docker-compose.yml - Add to services section
  backstage-backend:
    build:
      context: ./services/backstage-backend
      dockerfile: Dockerfile
    ports:
      - "7007:7007"
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_PORT: 5433
      POSTGRES_USER: orbit
      POSTGRES_PASSWORD: orbit
      POSTGRES_DATABASE: backstage
      NODE_ENV: development
      ORBIT_API_URL: http://localhost:3000
    depends_on:
      - postgres
      - redis
    volumes:
      - ./services/backstage-backend:/app
    networks:
      - orbit-network
```

#### 3. Workspace Isolation Middleware

**Files to Create:**
- `services/backstage-backend/src/modules/workspace-isolation/index.ts` - Custom backend module
- `services/backstage-backend/src/modules/workspace-isolation/WorkspaceService.ts` - Workspace context

**Changes Summary:**
Create custom Backstage backend module that intercepts all HTTP requests, validates workspace_id from headers, and injects workspace context into plugin requests.

**Code Examples:**
```typescript
// services/backstage-backend/src/modules/workspace-isolation/index.ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import { loggerToWinstonLogger } from '@backstage/backend-common';
import express from 'express';

export const workspaceIsolationModule = createBackendModule({
  pluginId: 'app',
  moduleId: 'workspace-isolation',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        httpRouter: coreServices.httpRouter,
      },
      async init({ logger, httpRouter }) {
        const middleware = async (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          const workspaceId = req.headers['x-orbit-workspace-id'];

          if (!workspaceId) {
            logger.warn('Request missing workspace ID header');
            return res.status(400).json({
              error: 'Missing x-orbit-workspace-id header'
            });
          }

          // Attach workspace context to request
          (req as any).workspaceContext = {
            workspaceId: workspaceId as string,
          };

          next();
        };

        httpRouter.use(middleware);
      },
    });
  },
});

export default workspaceIsolationModule;
```

### Dependencies
- Depends on: PostgreSQL running on port 5433
- Depends on: Node.js 18+ runtime

### Success Criteria

#### Automated Verification
- [ ] Backstage backend builds successfully: `cd services/backstage-backend && yarn build`
- [ ] Docker image builds: `docker build -t orbit-backstage services/backstage-backend`
- [ ] Backstage starts and listens on port 7007: `docker-compose up backstage-backend`
- [ ] Health check endpoint responds: `curl http://localhost:7007/api/health`
- [ ] Database migrations succeed (Backstage creates its schema)
- [ ] No HIGH/CRITICAL npm vulnerabilities: `npm audit`

#### Manual Verification
- [ ] Backstage backend starts without errors in docker-compose logs
- [ ] Can access Backstage API at http://localhost:7007
- [ ] PostgreSQL has `backstage` database with plugin tables
- [ ] Workspace isolation middleware rejects requests without workspace ID header
- [ ] Workspace isolation middleware accepts requests with valid workspace ID
- [ ] Installed plugins appear in Backstage's plugin registry

### Rollback Plan
Remove Backstage service from docker-compose, drop `backstage` database, delete `services/backstage-backend/` directory.

---

## Phase 2: Go Plugins gRPC Service

### Overview
Create new Go microservice that acts as a proxy between Orbit's frontend and Backstage backend, implementing workspace filtering, auth validation, and data transformation.

### Prerequisites
- [x] Phase 1 completed (Backstage backend running)
- [ ] Protobuf definitions created for plugin service

### Changes Required

#### 1. Protocol Buffer Definitions

**Files to Create:**
- `proto/plugins.proto` - gRPC service contract

**Code Examples:**
```protobuf
// proto/plugins.proto
syntax = "proto3";

package idp.plugins.v1;

option go_package = "github.com/drewpayment/orbit/proto/gen/go/idp/plugins/v1;pluginsv1";

// PluginsService provides access to Backstage community plugins
service PluginsService {
  // ListPlugins returns all available plugins for the workspace
  rpc ListPlugins(ListPluginsRequest) returns (ListPluginsResponse);

  // GetPluginData fetches data from a specific plugin
  rpc GetPluginData(GetPluginDataRequest) returns (GetPluginDataResponse);

  // ListJiraIssues fetches Jira issues (example plugin endpoint)
  rpc ListJiraIssues(ListJiraIssuesRequest) returns (ListJiraIssuesResponse);

  // ListGitHubPullRequests fetches GitHub PRs (example plugin endpoint)
  rpc ListGitHubPullRequests(ListGitHubPullRequestsRequest) returns (ListGitHubPullRequestsResponse);
}

message ListPluginsRequest {
  string workspace_id = 1;
}

message ListPluginsResponse {
  repeated Plugin plugins = 1;
}

message Plugin {
  string id = 1;
  string name = 2;
  string category = 3; // "api-catalog", "ci-cd", "infrastructure", "project-management"
  bool enabled = 4;
  map<string, string> config = 5;
}

message GetPluginDataRequest {
  string workspace_id = 1;
  string plugin_id = 2;
  map<string, string> params = 3;
}

message GetPluginDataResponse {
  bytes data = 1; // JSON-encoded plugin data
}

message ListJiraIssuesRequest {
  string workspace_id = 1;
  string project_key = 2;
  string status = 3;
}

message ListJiraIssuesResponse {
  repeated JiraIssue issues = 1;
}

message JiraIssue {
  string key = 1;
  string summary = 2;
  string status = 3;
  string assignee = 4;
  string created_at = 5;
}

message ListGitHubPullRequestsRequest {
  string workspace_id = 1;
  string repository = 2;
  string state = 3; // "open", "closed", "merged"
}

message ListGitHubPullRequestsResponse {
  repeated GitHubPullRequest pull_requests = 1;
}

message GitHubPullRequest {
  int64 number = 1;
  string title = 2;
  string state = 3;
  string author = 4;
  string created_at = 5;
  string url = 6;
}
```

#### 2. Go Service Structure

**Files to Create:**
- `services/plugins/go.mod` - Go module definition
- `services/plugins/cmd/server/main.go` - Entry point
- `services/plugins/internal/domain/plugin.go` - Domain entities
- `services/plugins/internal/service/plugins_service.go` - Business logic
- `services/plugins/internal/grpc/server.go` - gRPC server
- `services/plugins/internal/backstage/client.go` - HTTP client for Backstage
- `services/plugins/internal/config/config.go` - Configuration

**Changes Summary:**
Create new Go service following Orbit's standard layout pattern, implementing HTTP client to communicate with Backstage backend and gRPC server to expose data to frontend.

**Code Examples:**
```go
// services/plugins/internal/backstage/client.go
package backstage

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
)

type Client struct {
    baseURL    string
    httpClient *http.Client
}

func NewClient(baseURL string) *Client {
    return &Client{
        baseURL:    baseURL,
        httpClient: &http.Client{Timeout: 10 * time.Second},
    }
}

// FetchJiraIssues calls Backstage Jira plugin API
func (c *Client) FetchJiraIssues(ctx context.Context, workspaceID, projectKey string) ([]JiraIssue, error) {
    url := fmt.Sprintf("%s/api/jira/issues?project=%s", c.baseURL, projectKey)

    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return nil, fmt.Errorf("create request: %w", err)
    }

    // Inject workspace ID for Backstage's isolation middleware
    req.Header.Set("X-Orbit-Workspace-Id", workspaceID)

    resp, err := c.httpClient.Do(req)
    if err != nil {
        return nil, fmt.Errorf("http call: %w", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("backstage API error: status %d", resp.StatusCode)
    }

    var result struct {
        Issues []JiraIssue `json:"issues"`
    }

    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        return nil, fmt.Errorf("decode response: %w", err)
    }

    return result.Issues, nil
}

type JiraIssue struct {
    Key       string `json:"key"`
    Summary   string `json:"summary"`
    Status    string `json:"status"`
    Assignee  string `json:"assignee"`
    CreatedAt string `json:"created_at"`
}
```

```go
// services/plugins/internal/grpc/server.go
package grpc

import (
    "context"

    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"

    pluginsv1 "github.com/drewpayment/orbit/proto/gen/go/idp/plugins/v1"
    "github.com/drewpayment/orbit/services/plugins/internal/backstage"
    "github.com/drewpayment/orbit/services/plugins/internal/service"
)

type Server struct {
    pluginsv1.UnimplementedPluginsServiceServer
    pluginsService *service.PluginsService
}

func NewServer(pluginsService *service.PluginsService) *Server {
    return &Server{
        pluginsService: pluginsService,
    }
}

func (s *Server) ListJiraIssues(
    ctx context.Context,
    req *pluginsv1.ListJiraIssuesRequest,
) (*pluginsv1.ListJiraIssuesResponse, error) {
    // Validate workspace ID
    if req.WorkspaceId == "" {
        return nil, status.Error(codes.InvalidArgument, "workspace_id is required")
    }

    // Call service layer
    issues, err := s.pluginsService.FetchJiraIssues(ctx, req.WorkspaceId, req.ProjectKey, req.Status)
    if err != nil {
        return nil, status.Errorf(codes.Internal, "fetch jira issues: %v", err)
    }

    // Transform to proto messages
    protoIssues := make([]*pluginsv1.JiraIssue, len(issues))
    for i, issue := range issues {
        protoIssues[i] = &pluginsv1.JiraIssue{
            Key:       issue.Key,
            Summary:   issue.Summary,
            Status:    issue.Status,
            Assignee:  issue.Assignee,
            CreatedAt: issue.CreatedAt,
        }
    }

    return &pluginsv1.ListJiraIssuesResponse{
        Issues: protoIssues,
    }, nil
}
```

```go
// services/plugins/internal/service/plugins_service.go
package service

import (
    "context"
    "fmt"

    "github.com/drewpayment/orbit/services/plugins/internal/backstage"
)

type PluginsService struct {
    backstageClient *backstage.Client
}

func NewPluginsService(backstageClient *backstage.Client) *PluginsService {
    return &PluginsService{
        backstageClient: backstageClient,
    }
}

func (s *PluginsService) FetchJiraIssues(
    ctx context.Context,
    workspaceID, projectKey, statusFilter string,
) ([]backstage.JiraIssue, error) {
    // Fetch from Backstage
    issues, err := s.backstageClient.FetchJiraIssues(ctx, workspaceID, projectKey)
    if err != nil {
        return nil, fmt.Errorf("backstage client: %w", err)
    }

    // Apply additional filtering if needed
    if statusFilter != "" {
        filtered := make([]backstage.JiraIssue, 0)
        for _, issue := range issues {
            if issue.Status == statusFilter {
                filtered = append(filtered, issue)
            }
        }
        return filtered, nil
    }

    return issues, nil
}
```

#### 3. Service Registration

**Files to Modify:**
- `docker-compose.yml` - Add plugins service
- `Makefile` - Add build/test targets for plugins service

**Changes:**
```yaml
# docker-compose.yml - Add plugins service
  plugins-service:
    build:
      context: ./services/plugins
      dockerfile: Dockerfile
    ports:
      - "50053:50053"
    environment:
      BACKSTAGE_URL: http://backstage-backend:7007
      POSTGRES_HOST: postgres
      POSTGRES_PORT: 5433
      POSTGRES_USER: orbit
      POSTGRES_PASSWORD: orbit
    depends_on:
      - backstage-backend
      - postgres
    networks:
      - orbit-network
```

### Dependencies
- Depends on: Phase 1 (Backstage backend running)
- Depends on: `make proto-gen` to generate Go/TypeScript code

### Success Criteria

#### Automated Verification
- [ ] Proto generation succeeds: `make proto-gen`
- [ ] Go service builds: `cd services/plugins && go build ./cmd/server`
- [ ] Unit tests pass: `cd services/plugins && go test -v -race ./...`
- [ ] Linting passes: `cd services/plugins && golangci-lint run`
- [ ] Docker image builds: `docker build -t orbit-plugins services/plugins`
- [ ] gRPC server starts on port 50053

#### Manual Verification
- [ ] Can call ListPlugins gRPC endpoint with workspace_id
- [ ] Can call ListJiraIssues and receive data from Backstage Jira plugin
- [ ] Invalid workspace_id returns appropriate gRPC error
- [ ] Backstage HTTP client properly injects X-Orbit-Workspace-Id header
- [ ] Service logs show successful Backstage API calls
- [ ] Error handling works for Backstage API failures

### Rollback Plan
Remove plugins service from docker-compose, delete `services/plugins/` directory, revert `proto/plugins.proto` and regenerate protos.

---

## Phase 3: Payload CMS Plugin Management

### Overview
Create Payload CMS collections for managing plugin registry (available plugins), plugin configurations (API keys, URLs), and plugin enablement per workspace.

### Prerequisites
- [x] Phase 1 completed (Backstage backend)
- [x] Phase 2 completed (Go plugins service)
- [ ] Payload CMS running locally

### Changes Required

#### 1. Plugin Registry Collection

**Files to Create:**
- `orbit-www/src/collections/PluginRegistry.ts` - Available plugins metadata
- `orbit-www/src/collections/PluginConfig.ts` - Plugin configuration per workspace

**Code Examples:**
```typescript
// orbit-www/src/collections/PluginRegistry.ts
import { CollectionConfig } from 'payload'

export const PluginRegistry: CollectionConfig = {
  slug: 'plugin-registry',
  admin: {
    useAsTitle: 'name',
    description: 'Backstage community plugins available in Orbit',
  },
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      return true
    },
    create: ({ req: { user } }) => {
      return user?.role === 'admin'
    },
    update: ({ req: { user } }) => {
      return user?.role === 'admin'
    },
    delete: ({ req: { user } }) => {
      return user?.role === 'admin'
    },
  },
  fields: [
    {
      name: 'pluginId',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: 'Unique identifier (e.g., "jira", "github-actions")',
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'Display name (e.g., "Jira Integration")',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'What this plugin does',
      },
    },
    {
      name: 'category',
      type: 'select',
      required: true,
      options: [
        { label: 'API Catalog', value: 'api-catalog' },
        { label: 'CI/CD', value: 'ci-cd' },
        { label: 'Infrastructure', value: 'infrastructure' },
        { label: 'Project Management', value: 'project-management' },
      ],
    },
    {
      name: 'backstagePackage',
      type: 'text',
      required: true,
      admin: {
        description: 'NPM package name (e.g., "@backstage-community/plugin-jira-backend")',
      },
    },
    {
      name: 'configSchema',
      type: 'json',
      admin: {
        description: 'JSON schema for plugin configuration fields',
      },
    },
    {
      name: 'documentationUrl',
      type: 'text',
      admin: {
        description: 'Link to plugin documentation',
      },
    },
  ],
}
```

```typescript
// orbit-www/src/collections/PluginConfig.ts
import { CollectionConfig } from 'payload'

export const PluginConfig: CollectionConfig = {
  slug: 'plugin-configs',
  admin: {
    useAsTitle: 'plugin',
    description: 'Plugin configurations per workspace',
  },
  access: {
    read: ({ req: { user } }) => {
      // Users can only read their workspace's configs
      if (!user) return false
      return {
        workspace: {
          equals: user.workspace,
        },
      }
    },
    create: ({ req: { user } }) => {
      return user?.role === 'admin'
    },
    update: ({ req: { user } }) => {
      return user?.role === 'admin'
    },
  },
  fields: [
    {
      name: 'workspace',
      type: 'relationship',
      relationTo: 'workspaces',
      required: true,
      hasMany: false,
    },
    {
      name: 'plugin',
      type: 'relationship',
      relationTo: 'plugin-registry',
      required: true,
      hasMany: false,
    },
    {
      name: 'enabled',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Enable/disable this plugin for the workspace',
      },
    },
    {
      name: 'config',
      type: 'json',
      admin: {
        description: 'Plugin-specific configuration (API keys, URLs, etc.)',
      },
    },
    {
      name: 'secrets',
      type: 'json',
      admin: {
        description: 'Encrypted secrets (API tokens, passwords)',
        condition: (data, siblingData) => {
          // Only show to admins
          return true
        },
      },
    },
  ],
  hooks: {
    beforeChange: [
      async ({ data, req, operation }) => {
        // Encrypt secrets before saving
        if (data.secrets && operation === 'create') {
          // TODO: Implement encryption using crypto library
          // data.secrets = await encryptSecrets(data.secrets)
        }
        return data
      },
    ],
  },
}
```

#### 2. Payload Configuration

**Files to Modify:**
- `orbit-www/src/payload.config.ts` - Register new collections

**Changes:**
```typescript
// orbit-www/src/payload.config.ts - Add to collections array
import { PluginRegistry } from './collections/PluginRegistry'
import { PluginConfig } from './collections/PluginConfig'

export default buildConfig({
  collections: [
    Users,
    Media,
    Workspaces,
    Repositories,
    PluginRegistry,    // Add this
    PluginConfig,      // Add this
  ],
  // ... rest of config
})
```

#### 3. Admin UI Components

**Files to Create:**
- `orbit-www/src/app/(admin)/plugins/page.tsx` - Plugin management UI
- `orbit-www/src/components/PluginCard.tsx` - Plugin display component
- `orbit-www/src/components/PluginConfigForm.tsx` - Plugin configuration form

**Changes Summary:**
Create admin UI pages for browsing available plugins, enabling/disabling them, and configuring plugin settings.

**Code Examples:**
```tsx
// orbit-www/src/app/(admin)/plugins/page.tsx
import { getPayload } from 'payload'
import config from '@payload-config'

export default async function PluginsPage() {
  const payload = await getPayload({ config })

  const plugins = await payload.find({
    collection: 'plugin-registry',
    limit: 100,
  })

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Plugin Management</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {plugins.docs.map((plugin) => (
          <PluginCard key={plugin.id} plugin={plugin} />
        ))}
      </div>
    </div>
  )
}
```

### Dependencies
- Depends on: Phase 2 (Go plugins service providing gRPC APIs)

### Success Criteria

#### Automated Verification
- [ ] Payload migrations succeed: `cd orbit-www && pnpm payload migrate`
- [ ] TypeScript compiles: `cd orbit-www && pnpm typecheck`
- [ ] Collections appear in Payload admin: Access http://localhost:3000/admin

#### Manual Verification
- [ ] Can create plugin registry entry in Payload admin
- [ ] Can create plugin configuration for a workspace
- [ ] Enable/disable toggle updates database correctly
- [ ] Plugin secrets are stored (encryption validated in later phase)
- [ ] Access control prevents non-admins from creating plugins
- [ ] Workspace filtering works (users only see their workspace's configs)

### Rollback Plan
Remove collections from payload.config.ts, drop plugin_registry and plugin_configs tables from database, delete collection files.

---

## Phase 4: Frontend Integration & API Consumption

### Overview
Create React components in Orbit frontend to display plugin data, connect to Go plugins gRPC service using generated TypeScript clients, handle loading states and errors.

### Prerequisites
- [x] Phase 2 completed (Go plugins service)
- [x] Phase 3 completed (Payload collections)
- [ ] Proto code generated for frontend

### Changes Required

#### 1. TypeScript gRPC Client

**Files Created (Auto-generated):**
- `orbit-www/src/lib/proto/idp/plugins/v1/plugins_connect.ts` - Connect-ES client (generated by `make proto-gen`)

**Files to Create:**
- `orbit-www/src/lib/grpc/plugins-client.ts` - Client wrapper

**Code Examples:**
```typescript
// orbit-www/src/lib/grpc/plugins-client.ts
import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { PluginsService } from '@/lib/proto/idp/plugins/v1/plugins_connect'

const transport = createConnectTransport({
  baseUrl: process.env.NEXT_PUBLIC_PLUGINS_API_URL || 'http://localhost:50053',
})

export const pluginsClient = createClient(PluginsService, transport)
```

#### 2. React Components for Plugin Data

**Files to Create:**
- `orbit-www/src/components/plugins/JiraIssuesList.tsx` - Display Jira issues
- `orbit-www/src/components/plugins/GitHubPRsList.tsx` - Display GitHub PRs
- `orbit-www/src/components/plugins/PluginDataCard.tsx` - Generic plugin data container

**Code Examples:**
```tsx
// orbit-www/src/components/plugins/JiraIssuesList.tsx
'use client'

import { useEffect, useState } from 'react'
import { pluginsClient } from '@/lib/grpc/plugins-client'
import { ListJiraIssuesRequest } from '@/lib/proto/idp/plugins/v1/plugins_pb'

interface JiraIssue {
  key: string
  summary: string
  status: string
  assignee: string
  createdAt: string
}

export function JiraIssuesList({ workspaceId, projectKey }: {
  workspaceId: string
  projectKey: string
}) {
  const [issues, setIssues] = useState<JiraIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchIssues() {
      try {
        setLoading(true)
        const response = await pluginsClient.listJiraIssues({
          workspaceId,
          projectKey,
          status: '',
        })

        setIssues(response.issues.map(issue => ({
          key: issue.key,
          summary: issue.summary,
          status: issue.status,
          assignee: issue.assignee,
          createdAt: issue.createdAt,
        })))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch issues')
      } finally {
        setLoading(false)
      }
    }

    fetchIssues()
  }, [workspaceId, projectKey])

  if (loading) return <div>Loading Jira issues...</div>
  if (error) return <div className="text-red-500">Error: {error}</div>

  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">Jira Issues</h3>
      {issues.length === 0 ? (
        <p className="text-gray-500">No issues found</p>
      ) : (
        <ul className="divide-y">
          {issues.map((issue) => (
            <li key={issue.key} className="py-2">
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-mono text-sm text-blue-600">{issue.key}</span>
                  <p className="font-medium">{issue.summary}</p>
                  <p className="text-sm text-gray-500">
                    {issue.assignee} • {new Date(issue.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className="px-2 py-1 text-xs rounded bg-gray-100">
                  {issue.status}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

#### 3. Dashboard Integration

**Files to Create:**
- `orbit-www/src/app/(app)/workspace/[id]/integrations/page.tsx` - Integrations dashboard

**Code Examples:**
```tsx
// orbit-www/src/app/(app)/workspace/[id]/integrations/page.tsx
import { JiraIssuesList } from '@/components/plugins/JiraIssuesList'
import { GitHubPRsList } from '@/components/plugins/GitHubPRsList'
import { getPayload } from 'payload'
import config from '@payload-config'

export default async function WorkspaceIntegrationsPage({
  params,
}: {
  params: { id: string }
}) {
  const payload = await getPayload({ config })

  // Fetch enabled plugins for this workspace
  const pluginConfigs = await payload.find({
    collection: 'plugin-configs',
    where: {
      and: [
        { workspace: { equals: params.id } },
        { enabled: { equals: true } },
      ],
    },
  })

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Workspace Integrations</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {pluginConfigs.docs.map((config) => {
          const plugin = config.plugin

          // Render appropriate component based on plugin type
          if (plugin.pluginId === 'jira') {
            return (
              <JiraIssuesList
                key={config.id}
                workspaceId={params.id}
                projectKey={config.config.projectKey}
              />
            )
          }

          if (plugin.pluginId === 'github-actions') {
            return (
              <GitHubPRsList
                key={config.id}
                workspaceId={params.id}
                repository={config.config.repository}
              />
            )
          }

          return null
        })}
      </div>
    </div>
  )
}
```

### Dependencies
- Depends on: Phase 2 (gRPC service)
- Depends on: Phase 3 (Payload collections)
- Depends on: `make proto-gen` for TypeScript client code

### Success Criteria

#### Automated Verification
- [ ] TypeScript compiles: `cd orbit-www && pnpm typecheck`
- [ ] React components render without errors: `cd orbit-www && pnpm test`
- [ ] Proto client imports successfully

#### Manual Verification
- [ ] Integrations page loads without errors
- [ ] JiraIssuesList component displays real Jira data
- [ ] GitHubPRsList component displays real GitHub PR data
- [ ] Loading states appear during API calls
- [ ] Error messages display when API calls fail
- [ ] Components respect workspace isolation (only show workspace's data)
- [ ] Clicking on plugin items navigates to appropriate external links

### Rollback Plan
Delete integration components, remove integrations routes, remove gRPC client imports.

---

## Phase 5: Security Hardening & Production Readiness

### Overview
Implement secrets encryption, security scanning, rate limiting, monitoring, and production deployment configuration.

### Prerequisites
- [x] All previous phases completed
- [ ] Production environment configured

### Changes Required

#### 1. Secrets Encryption

**Files to Create:**
- `orbit-www/src/lib/crypto/secrets.ts` - Encryption utilities
- `services/plugins/internal/crypto/encryption.go` - Go encryption utilities

**Code Examples:**
```typescript
// orbit-www/src/lib/crypto/secrets.ts
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex')

export function encryptSecret(text: string): string {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

export function decryptSecret(encrypted: string): string {
  const [ivHex, authTagHex, encryptedText] = encrypted.split(':')

  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv)

  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encryptedText, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}
```

#### 2. Rate Limiting

**Files to Create:**
- `services/plugins/internal/middleware/rate_limiter.go` - Rate limiting middleware

**Code Examples:**
```go
// services/plugins/internal/middleware/rate_limiter.go
package middleware

import (
    "context"
    "time"

    "golang.org/x/time/rate"
    "google.golang.org/grpc"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/status"
)

type RateLimiter struct {
    limiters map[string]*rate.Limiter
    mu       sync.RWMutex
}

func NewRateLimiter() *RateLimiter {
    return &RateLimiter{
        limiters: make(map[string]*rate.Limiter),
    }
}

func (rl *RateLimiter) getLimiter(key string) *rate.Limiter {
    rl.mu.Lock()
    defer rl.mu.Unlock()

    limiter, exists := rl.limiters[key]
    if !exists {
        // 100 requests per minute per workspace
        limiter = rate.NewLimiter(rate.Every(time.Minute/100), 10)
        rl.limiters[key] = limiter
    }

    return limiter
}

func (rl *RateLimiter) UnaryInterceptor() grpc.UnaryServerInterceptor {
    return func(
        ctx context.Context,
        req interface{},
        info *grpc.UnaryServerInfo,
        handler grpc.UnaryHandler,
    ) (interface{}, error) {
        // Extract workspace ID from request
        workspaceID := extractWorkspaceID(req)

        limiter := rl.getLimiter(workspaceID)

        if !limiter.Allow() {
            return nil, status.Error(codes.ResourceExhausted, "rate limit exceeded")
        }

        return handler(ctx, req)
    }
}
```

#### 3. Security Scanning & Monitoring

**Files to Create:**
- `.github/workflows/security-scan.yml` - CI security scanning
- `services/backstage-backend/scripts/audit-plugins.sh` - Plugin security audit

**Code Examples:**
```yaml
# .github/workflows/security-scan.yml
name: Security Scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 0 * * 0' # Weekly

jobs:
  security-scan:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Run npm audit on Backstage
        working-directory: services/backstage-backend
        run: |
          npm audit --audit-level=high

      - name: Run Snyk security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --severity-threshold=high

      - name: Run gosec on Go services
        run: |
          make security
```

```bash
#!/bin/bash
# services/backstage-backend/scripts/audit-plugins.sh

echo "Auditing Backstage plugin security..."

# Check for high/critical vulnerabilities
npm audit --audit-level=high

# Check for outdated packages
npm outdated

# Verify plugin signatures (if available)
# TODO: Implement plugin signature verification

echo "Audit complete"
```

#### 4. Production Configuration

**Files to Create:**
- `services/backstage-backend/app-config.production.yaml` - Production config
- `infrastructure/kubernetes/backstage-deployment.yaml` - K8s deployment

**Code Examples:**
```yaml
# services/backstage-backend/app-config.production.yaml
app:
  baseUrl: https://plugins.orbit.example.com

backend:
  baseUrl: https://plugins.orbit.example.com
  listen:
    port: 7007
    host: 0.0.0.0
  cors:
    origin: https://orbit.example.com
    credentials: true
  database:
    client: pg
    connection:
      host: ${POSTGRES_HOST}
      port: 5432
      user: ${POSTGRES_USER}
      password: ${POSTGRES_PASSWORD}
      database: backstage
      ssl:
        rejectUnauthorized: true

# Rate limiting
rateLimit:
  enabled: true
  max: 100
  windowMs: 60000

# Monitoring
monitoring:
  enabled: true
  metricsPort: 9090
```

### Dependencies
- Depends on: All previous phases

### Success Criteria

#### Automated Verification
- [ ] Security scan passes: `npm audit --audit-level=high`
- [ ] Go security scan passes: `make security`
- [ ] Rate limiting tests pass: `go test ./internal/middleware/...`
- [ ] Encryption/decryption round-trip test passes
- [ ] Kubernetes manifests validate: `kubectl apply --dry-run -f infrastructure/kubernetes/`

#### Manual Verification
- [ ] Secrets are encrypted in database (verify via psql query)
- [ ] Rate limiting triggers when exceeding 100 req/min per workspace
- [ ] Monitoring metrics exposed at :9090/metrics
- [ ] Production deployment successful to staging environment
- [ ] Health checks pass in production configuration
- [ ] All plugin API calls succeed with production credentials
- [ ] Multi-workspace isolation verified in production

### Rollback Plan
Revert production configurations, disable rate limiting, remove encryption (decrypt existing secrets first), roll back Kubernetes deployments.

---

## Testing Strategy

### Unit Tests

**Location**:
- Go: `services/plugins/internal/*/\*_test.go`
- Frontend: `orbit-www/src/components/plugins/*.test.tsx`

**Approach**: Table-driven tests for Go, React Testing Library for frontend

**Test Cases**:
- **Backstage client**: Mock HTTP responses, test error handling
- **gRPC server**: Test request validation, workspace ID extraction
- **Plugin service**: Test data transformation, filtering logic
- **React components**: Test loading states, error display, data rendering
- **Encryption**: Round-trip encryption/decryption, invalid key handling
- **Rate limiting**: Test limit enforcement, key-based isolation

**Example**:
```go
// services/plugins/internal/backstage/client_test.go
func TestClient_FetchJiraIssues(t *testing.T) {
    tests := []struct {
        name           string
        workspaceID    string
        projectKey     string
        mockResponse   string
        mockStatusCode int
        wantErr        bool
        wantCount      int
    }{
        {
            name:           "success",
            workspaceID:    "ws-123",
            projectKey:     "PROJ",
            mockResponse:   `{"issues":[{"key":"PROJ-1","summary":"Test"}]}`,
            mockStatusCode: 200,
            wantErr:        false,
            wantCount:      1,
        },
        {
            name:           "backstage error",
            workspaceID:    "ws-123",
            projectKey:     "PROJ",
            mockResponse:   `{"error":"not found"}`,
            mockStatusCode: 404,
            wantErr:        true,
            wantCount:      0,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                // Verify workspace header
                assert.Equal(t, tt.workspaceID, r.Header.Get("X-Orbit-Workspace-Id"))

                w.WriteHeader(tt.mockStatusCode)
                w.Write([]byte(tt.mockResponse))
            }))
            defer server.Close()

            client := NewClient(server.URL)
            issues, err := client.FetchJiraIssues(context.Background(), tt.workspaceID, tt.projectKey)

            if tt.wantErr {
                assert.Error(t, err)
            } else {
                assert.NoError(t, err)
                assert.Len(t, issues, tt.wantCount)
            }
        })
    }
}
```

### Integration Tests

**Location**: `services/plugins/tests/integration/`

**Approach**: Test full request/response cycle with running Backstage backend

**Test Scenarios**:
- Full data flow: Frontend gRPC call → Go service → Backstage HTTP → External API (mocked)
- Multi-tenant isolation: Create two workspaces, verify data separation
- Plugin enablement: Toggle plugin in Payload, verify API returns/blocks data
- Configuration changes: Update plugin config, verify Backstage receives new settings
- Error propagation: Backstage error properly handled and returned to frontend

### E2E Tests

**Location**: `orbit-www/tests/e2e/plugins.spec.ts`

**Tool**: Playwright

**Test Flows**:
1. Admin enables Jira plugin for workspace
2. Admin configures Jira API credentials
3. User navigates to integrations page
4. Jira issues load and display correctly
5. Admin disables plugin
6. Jira section no longer appears on integrations page

**Example**:
```typescript
// orbit-www/tests/e2e/plugins.spec.ts
import { test, expect } from '@playwright/test'

test('admin can enable and configure Jira plugin', async ({ page }) => {
  // Login as admin
  await page.goto('/admin')
  await page.fill('[name="email"]', 'admin@example.com')
  await page.fill('[name="password"]', 'password')
  await page.click('button[type="submit"]')

  // Navigate to plugins
  await page.goto('/admin/collections/plugin-configs')

  // Create new plugin config
  await page.click('text=Create New')

  // Select workspace
  await page.selectOption('[name="workspace"]', 'workspace-id-123')

  // Select Jira plugin
  await page.selectOption('[name="plugin"]', 'jira')

  // Enable plugin
  await page.check('[name="enabled"]')

  // Configure
  await page.fill('[name="config.jiraUrl"]', 'https://company.atlassian.net')
  await page.fill('[name="secrets.apiToken"]', 'fake-api-token')

  // Save
  await page.click('button:has-text("Save")')

  // Verify success
  await expect(page.locator('.toast-success')).toBeVisible()
})

test('user sees Jira issues on integrations page', async ({ page }) => {
  // Login as user
  await page.goto('/workspace/workspace-id-123/integrations')

  // Wait for Jira issues to load
  await expect(page.locator('text=Jira Issues')).toBeVisible()

  // Verify issue displayed
  await expect(page.locator('text=PROJ-1')).toBeVisible()
})
```

### Manual Testing Steps

1. **Plugin Installation Verification**
   - Run `docker-compose up backstage-backend`
   - Verify logs show plugins loaded: `grep "Loaded plugin" logs/backstage.log`
   - Access http://localhost:7007/api/health
   - Verify response: `{"status":"ok","plugins":["jira","github-actions"...]}`

2. **Multi-Tenant Isolation**
   - Create Workspace A and Workspace B in Payload
   - Enable Jira plugin for both workspaces
   - Configure different Jira projects (PROJ-A for Workspace A, PROJ-B for Workspace B)
   - Call gRPC ListJiraIssues for Workspace A → Verify only PROJ-A issues returned
   - Call gRPC ListJiraIssues for Workspace B → Verify only PROJ-B issues returned

3. **Plugin Configuration Changes**
   - Disable Jira plugin for Workspace A in Payload
   - Call gRPC ListJiraIssues for Workspace A → Verify error or empty response
   - Re-enable plugin → Verify issues returned again

4. **Security Testing**
   - Attempt to access Backstage directly without X-Orbit-Workspace-Id header → Verify rejection
   - Attempt to call Go plugins service with invalid workspace ID → Verify gRPC error
   - Inspect database to verify secrets are encrypted
   - Attempt 101 requests in 1 minute → Verify rate limit error

## Database Changes

### Schema Modifications

**Migration Files**: Managed by Payload CMS (auto-generated)

**New Tables**:
- `plugin_registry` - Available Backstage plugins metadata
- `plugin_configs` - Plugin configurations per workspace
- `backstage.*` - Backstage backend tables (managed by Backstage migrations)

**Schema**:
```sql
-- Managed by Payload CMS migrations

CREATE TABLE plugin_registry (
  id VARCHAR(255) PRIMARY KEY,
  plugin_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL,
  backstage_package VARCHAR(255) NOT NULL,
  config_schema JSONB,
  documentation_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE plugin_configs (
  id VARCHAR(255) PRIMARY KEY,
  workspace_id VARCHAR(255) REFERENCES workspaces(id) ON DELETE CASCADE,
  plugin_id VARCHAR(255) REFERENCES plugin_registry(id) ON DELETE CASCADE,
  enabled BOOLEAN DEFAULT FALSE,
  config JSONB,
  secrets JSONB, -- Encrypted
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(workspace_id, plugin_id)
);

CREATE INDEX idx_plugin_configs_workspace ON plugin_configs(workspace_id);
CREATE INDEX idx_plugin_configs_enabled ON plugin_configs(enabled);
```

### Data Migration

**Initial Plugin Registry Seeding**:
```typescript
// Script to seed initial plugins
const initialPlugins = [
  {
    pluginId: 'jira',
    name: 'Jira Integration',
    category: 'project-management',
    backstagePackage: '@backstage-community/plugin-jira-backend',
  },
  {
    pluginId: 'github-actions',
    name: 'GitHub Actions',
    category: 'ci-cd',
    backstagePackage: '@backstage-community/plugin-github-actions-backend',
  },
  // ... more plugins
]

// Run: node scripts/seed-plugins.ts
```

### Rollback Migration

```sql
-- Rollback steps
DROP TABLE IF EXISTS plugin_configs;
DROP TABLE IF EXISTS plugin_registry;

-- Drop Backstage database
DROP DATABASE IF EXISTS backstage;
```

## API Changes

### New Endpoints (gRPC)

**Proto File**: `proto/plugins.proto`

**Services**:
- `PluginsService.ListPlugins` - Get available plugins for workspace
- `PluginsService.GetPluginData` - Generic plugin data fetch
- `PluginsService.ListJiraIssues` - Jira-specific endpoint
- `PluginsService.ListGitHubPullRequests` - GitHub-specific endpoint

**No Breaking Changes**: This is a new service, no existing APIs are modified.

### Versioning Strategy

- Proto package: `idp.plugins.v1`
- Future changes will use `v2` package for breaking changes
- Backward compatibility maintained within v1

## Performance Considerations

### Expected Impact

- **Backstage Backend**: Node.js service adds ~200-500MB memory footprint
- **Network Latency**: Additional hop (Frontend → Go → Backstage → External API) adds ~50-200ms
- **Database Load**: Plugin config queries are lightweight, indexed by workspace_id
- **Concurrent Requests**: Rate limited to 100 req/min per workspace

### Optimizations

- **Caching**: Implement Redis cache for plugin data with 5-minute TTL
- **Connection Pooling**: HTTP client reuses connections to Backstage
- **Parallel Fetching**: When displaying multiple plugins, fetch data in parallel
- **Lazy Loading**: Only fetch plugin data when user expands section

### Monitoring

**Metrics to Track**:
- `backstage_api_latency_seconds` - Histogram of Backstage API call durations
- `plugins_grpc_requests_total` - Counter of gRPC requests by method
- `plugins_rate_limit_exceeded_total` - Counter of rate limit rejections
- `backstage_plugin_errors_total` - Counter of plugin errors by type

**Alerts**:
- Alert if p95 latency > 2 seconds
- Alert if error rate > 5%
- Alert if Backstage backend is unreachable for > 1 minute

## Security Considerations

### Authentication/Authorization

- **Frontend → Go**: Orbit JWT token validated by Go service
- **Go → Backstage**: Workspace ID propagated via `X-Orbit-Workspace-Id` header
- **Backstage → External APIs**: Plugin-specific credentials from encrypted Payload config
- **Admin Actions**: Only users with `role === 'admin'` can enable/configure plugins

### Input Validation

- **Workspace ID**: Validated against database before forwarding to Backstage
- **Plugin ID**: Must exist in `plugin_registry` table
- **Configuration**: Validated against plugin's JSON schema
- **API Responses**: Sanitized before returning to frontend (no script injection)

### Data Protection

- **Secrets Encryption**: AES-256-GCM for API tokens, keys stored in environment variables
- **TLS in Transit**: All HTTP calls to Backstage use TLS in production
- **Database Encryption**: PostgreSQL encryption at rest enabled in production
- **Workspace Isolation**: Middleware enforces workspace_id on all queries

### Third-Party Plugin Risks

- **Code Review**: Manually audit top 10 most-used community plugins before installation
- **Dependency Scanning**: Weekly `npm audit` runs in CI/CD
- **Sandboxing**: Backstage runs in isolated container with limited network access (whitelist external domains)
- **Updates**: Monitor Backstage security advisories, patch within 48 hours of disclosure

## Deployment Strategy

### Deployment Steps

1. **Deploy Backstage Backend**:
   ```bash
   cd services/backstage-backend
   docker build -t orbit-backstage:latest .
   docker push registry.example.com/orbit-backstage:latest
   kubectl apply -f infrastructure/kubernetes/backstage-deployment.yaml
   ```

2. **Deploy Go Plugins Service**:
   ```bash
   cd services/plugins
   docker build -t orbit-plugins:latest .
   docker push registry.example.com/orbit-plugins:latest
   kubectl apply -f infrastructure/kubernetes/plugins-deployment.yaml
   ```

3. **Run Database Migrations**:
   ```bash
   cd orbit-www
   pnpm payload migrate
   ```

4. **Seed Plugin Registry**:
   ```bash
   node scripts/seed-plugins.ts
   ```

5. **Deploy Frontend**:
   ```bash
   cd orbit-www
   pnpm build
   # Deploy to Vercel/hosting platform
   ```

6. **Verify Health Checks**:
   ```bash
   curl https://plugins.orbit.example.com/api/health
   curl https://api.orbit.example.com/health
   ```

### Feature Flags (if applicable)

- **Flag**: `feature_backstage_plugins_enabled`
- **Rollout**: Gradual rollout to 10% → 50% → 100% of workspaces
- **Implementation**: Check flag in Go service before forwarding to Backstage

### Rollback Procedure

1. Set feature flag to 0% (disable for all workspaces)
2. Scale down Backstage backend pods to 0
3. Scale down plugins service pods to 0
4. Revert frontend deployment to previous version
5. Verify application works without plugin features

## Monitoring & Observability

### Metrics to Track

- **Request Volume**: `plugins_requests_total{method, status, workspace_id}`
- **Latency**: `plugins_request_duration_seconds{method, workspace_id}`
- **Error Rate**: `plugins_errors_total{type, plugin_id}`
- **Plugin Usage**: `plugins_enabled_total{plugin_id, workspace_id}`
- **Cache Hit Rate**: `plugins_cache_hits_total / plugins_cache_requests_total`

### Logging

**Log Structured JSON** (following Orbit's logging patterns):
```go
log.WithFields(log.Fields{
    "workspace_id": workspaceID,
    "plugin_id": pluginID,
    "method": "ListJiraIssues",
    "duration_ms": duration.Milliseconds(),
}).Info("Plugin API call completed")
```

**Log Levels**:
- INFO: Successful API calls, plugin enablement
- WARN: Rate limit exceeded, plugin configuration missing
- ERROR: Backstage API failures, encryption errors, database errors

### Alerts

**Critical Alerts** (PagerDuty):
- Backstage backend unreachable for > 5 minutes
- Plugins service error rate > 10% for > 5 minutes
- Database connection failures

**Warning Alerts** (Slack):
- p95 latency > 2 seconds for > 10 minutes
- Rate limit exceeded > 100 times in 1 hour
- Plugin API errors > 5% for > 10 minutes

## Documentation Updates

### Code Documentation

- [ ] Add godoc comments to all exported Go functions in `services/plugins/`
- [ ] Add JSDoc comments to TypeScript plugin client wrappers
- [ ] Document Backstage plugin selection criteria in `docs/plugins.md`

### User Documentation

- [ ] Create admin guide: "How to Enable and Configure Plugins"
- [ ] Create developer guide: "How to Add New Plugin Support"
- [ ] Update API documentation with new gRPC endpoints

### .agent System Updates

After implementation:
- [ ] Run `/update doc save task backstage-plugin-integration`
- [ ] Update `.agent/SOPs/integrating-apis.md` with Backstage patterns
- [ ] Create `.agent/SOPs/adding-backstage-plugins.md` for adding new plugins
- [ ] Update `.agent/system/api-architecture.md` with plugins service diagram

## Risks & Mitigation

### Technical Risks

**Risk**: Backstage plugin incompatibility or breaking changes
- **Impact**: High - Plugin functionality breaks after upstream update
- **Mitigation**: Pin plugin versions, test updates in staging, maintain compatibility matrix

**Risk**: Performance degradation from additional service hop
- **Impact**: Medium - Slower user experience, higher cloud costs
- **Mitigation**: Implement aggressive caching, connection pooling, monitor latencies

**Risk**: Multi-tenant data leakage via plugin bugs
- **Impact**: Critical - Workspace A sees Workspace B's data
- **Mitigation**: Thorough integration testing, middleware validation, security audits

**Risk**: Node.js service operational complexity
- **Impact**: Medium - Additional service to monitor, deploy, scale
- **Mitigation**: Containerization, health checks, auto-scaling, runbooks

### Business Risks

**Risk**: Limited plugin ecosystem adoption (users don't use plugins)
- **Impact**: Medium - Wasted development effort
- **Mitigation**: Start with high-value plugins (Jira, GitHub), gather user feedback, iterate

**Risk**: Security vulnerabilities in third-party plugin code
- **Impact**: High - Potential data breaches or service disruption
- **Mitigation**: Code audits, dependency scanning, sandbox execution, security monitoring

## Dependencies

### External Dependencies

- **Node.js**: v18+ (LTS) - Backstage runtime
- **@backstage/backend-defaults**: ^0.2.0 - Backstage core
- **@backstage-community/plugin-***: Various - Community plugins
- **PostgreSQL**: 14+ - Backstage database
- **http-proxy-middleware**: ^2.0.0 - Backstage proxy

### Internal Dependencies

- **Orbit Go services**: Repository, API Catalog, Knowledge services must be running
- **Payload CMS**: Required for plugin configuration UI
- **Temporal**: (Optional) Could be used for long-running plugin sync operations

### Blocking Issues

- None currently identified

## Future Enhancements

Items explicitly deferred for future implementation:

1. **Dynamic Plugin Installation** - Allow admins to install npm plugins at runtime without redeployment
   - **Why deferred**: Complex security implications, requires plugin sandboxing, hot module reloading

2. **Backstage Frontend UI Embedding** - Embed Backstage React components via iframe or module federation
   - **Why deferred**: Complex integration, most value is in backend data, frontend can be custom-built

3. **Plugin Marketplace** - Searchable catalog of all available Backstage plugins with ratings
   - **Why deferred**: MVP only needs 5-10 curated plugins, marketplace adds complexity

4. **Custom Plugin Development SDK** - Orbit-specific plugin SDK for partners
   - **Why deferred**: Backstage plugins already provide this, focus on integration first

5. **Advanced Plugin Orchestration** - Chain multiple plugins together (e.g., Jira issue → GitHub PR)
   - **Why deferred**: Requires workflow engine integration, complex use case for later

## References

### .agent Documentation

- [.agent/system/project-structure.md](.agent/system/project-structure.md) - Monorepo layout
- [.agent/system/api-architecture.md](.agent/system/api-architecture.md) - gRPC patterns
- [.agent/SOPs/adding-grpc-services.md](.agent/SOPs/adding-grpc-services.md) - gRPC service creation
- [.agent/SOPs/integrating-apis.md](.agent/SOPs/integrating-apis.md) - External API patterns
- [.agent/SOPs/error-handling.md](.agent/SOPs/error-handling.md) - Error handling conventions

### Similar Implementations

- [.agent/tasks/feature-repository-service.md](.agent/tasks/feature-repository-service.md) - Go gRPC service example
- [.agent/tasks/feature-workspace-management.md](.agent/tasks/feature-workspace-management.md) - Multi-tenancy patterns

### External Resources

- [Backstage Plugin Architecture](https://backstage.io/docs/plugins/structure-of-a-plugin)
- [Backstage Backend System](https://backstage.io/docs/backend-system/)
- [Community Plugins Repository](https://github.com/backstage/community-plugins)
- [Backstage Plugin Development](https://backstage.io/docs/plugins/backend-plugin/)

## Lessons Learned (To Be Filled Post-Implementation)

### What Worked Well
[To be completed after implementation]

### Challenges Encountered
[To be completed after implementation]

### Changes from Plan
[To be completed if plan changed during implementation]

### Recommendations for Similar Features
[To be completed after implementation]
