# Repository Templates Design

**Date:** 2025-11-25
**Status:** Design Complete
**Priority:** High
**Dependencies:** GitHub App Installation (complete), Permissions System (new)

---

## Executive Summary

Enable users to import existing GitHub repositories as templates in Orbit, adding rich metadata for discoverability, so developers can browse a template catalog and create new repositories from these templates in their organization.

**Key Capabilities:**
- Import GitHub repos as templates with `orbit-template.yaml` manifest
- Rich metadata: language, framework, categories, tags, complexity
- Template catalog with filtering and search
- Create new repos from templates via GitHub App
- Visibility controls: workspace, shared, public
- Permission-based access control

---

## Design Decisions

### Template System

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Template origin | Import existing GitHub repos | Users have existing templates; don't reinvent the wheel |
| Variable source | Manifest file in repo (`orbit-template.yaml`) | Templates are self-describing, single source of truth |
| GitHub Template validation | Prefer but don't require | Flexibility - warn if not GitHub Template, allow fallback |
| Repo creation target | User's GitHub org | Use existing GitHub App installations |
| Metadata storage | Payload CMS Collection | Consistent with Orbit's data model, built-in admin UI |
| Manifest sync | On-demand + optional webhook | Simple baseline, power users can enable real-time sync |
| Provider support | GitHub first, ADO later | Design extensibly, implement incrementally |

### Permissions System

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Permission model | Granular permissions grouped into roles | Balance of flexibility and simplicity |
| Scope hierarchy | Platform-level + Workspace-scoped | Standard multi-tenant SaaS pattern |
| Storage | Payload CMS Collections | Leverage existing stack |
| Client caching | SessionStorage on login | Fast UI permission checks |
| Backend auth | JWT with permissions claim | Stateless, efficient Go service verification |

### Template Visibility

| Level | Description |
|-------|-------------|
| **Workspace** | Only the owning workspace can see/use |
| **Shared** | Explicit workspace allowlist |
| **Public** | All users in the Orbit tenant |

### Template Permissions

| Permission | Description |
|------------|-------------|
| `template:create` | Import/register new templates from GitHub repos |
| `template:publish` | Change visibility from Workspace to Shared/Public |
| `template:manage` | Edit metadata, update manifest sync, archive/delete |

**Template usage** (creating repos from templates) requires only:
1. Workspace membership (user belongs to a workspace)
2. Template visibility (template is visible to that workspace)

No separate `template:use` permission needed.

---

## Data Models

### Permissions Collection

```typescript
// Payload CMS Collection: Permissions
{
  slug: string           // e.g., "template:create", "repository:delete"
  name: string           // Human-readable: "Create Templates"
  description: string    // What this permission allows
  category: enum         // 'template' | 'repository' | 'workspace' | 'knowledge' | 'admin'
  scope: enum            // 'platform' | 'workspace' - where this permission applies
}
```

### Roles Collection

```typescript
// Payload CMS Collection: Roles
{
  slug: string           // e.g., "workspace-admin", "platform-super-admin"
  name: string           // "Workspace Admin"
  description: string
  scope: enum            // 'platform' | 'workspace'
  permissions: relation[]  // Many-to-many with Permissions
  isDefault: boolean     // Auto-assigned to new users?
  isSystem: boolean      // Built-in, non-deletable
}
```

### UserWorkspaceRoles Collection

```typescript
// Payload CMS Collection: UserWorkspaceRoles (junction table)
{
  user: relation         // -> Users
  workspace: relation    // -> Workspaces (null for platform roles)
  role: relation         // -> Roles
}
```

### Built-in Roles (Seeded)

**Platform-level:**
- `super-admin` - All permissions across all workspaces

**Workspace-level:**
- `workspace-owner` - Full workspace control
- `workspace-admin` - Manage workspace settings and members
- `workspace-member` - Standard access (create repos, use templates)
- `workspace-viewer` - Read-only access

### Built-in Permissions (Seeded)

```
# Template permissions
template:create
template:publish
template:manage

# Repository permissions
repository:create
repository:update
repository:delete
repository:admin

# Workspace permissions
workspace:manage
workspace:invite
workspace:settings

# Knowledge permissions
knowledge:create
knowledge:publish
knowledge:admin

# Platform permissions
admin:impersonate
admin:manage-tenants
```

### JWT Structure

```typescript
{
  sub: userId,
  workspaces: {
    [workspaceId]: {
      roles: ["workspace-admin"],
      permissions: ["template:create", "template:manage", "repository:create", ...]
    }
  },
  platformPermissions: ["admin:impersonate"] // if super-admin
}
```

### Templates Collection

```typescript
// Payload CMS Collection: Templates
{
  // Identity
  id: string
  name: string              // Display name in Orbit
  slug: string              // URL-friendly identifier
  description: string       // Rich description (supports markdown)

  // Ownership & Visibility
  workspace: relation       // Owning workspace
  visibility: enum          // 'workspace' | 'shared' | 'public'
  sharedWith: relation[]    // Workspaces (when visibility = 'shared')

  // GitHub Source
  gitProvider: enum         // 'github' (later: 'azure_devops', 'gitlab', 'bitbucket')
  repoUrl: string           // https://github.com/org/repo
  defaultBranch: string     // 'main'
  isGitHubTemplate: boolean // Is it marked as Template in GitHub?

  // Metadata (from manifest + admin overrides)
  language: string          // 'typescript', 'go', 'python', etc.
  framework: string         // 'nextjs', 'express', 'fastapi', etc.
  categories: enum[]        // ['api-service', 'frontend-app', ...]
  tags: string[]            // Freeform: ['graphql', 'kubernetes', 'serverless']
  complexity: enum          // 'starter' | 'intermediate' | 'production-ready'

  // Manifest Sync
  manifestPath: string      // Default: 'orbit-template.yaml'
  lastSyncedAt: timestamp
  syncStatus: enum          // 'synced' | 'error' | 'pending'
  syncError: string         // Error message if sync failed

  // Variables (synced from manifest)
  variables: json           // Array of variable definitions from manifest

  // Optional Webhook
  webhookId: string         // GitHub webhook ID if configured
  webhookSecret: string     // For verification (encrypted)

  // Stats & Audit
  usageCount: number        // How many repos created from this template
  createdBy: relation       // -> Users
  createdAt: timestamp
  updatedAt: timestamp
}
```

### Categories Enum

```typescript
type TemplateCategory =
  | 'api-service'
  | 'frontend-app'
  | 'backend-service'
  | 'cli-tool'
  | 'library'
  | 'mobile-app'
  | 'infrastructure'
  | 'documentation'
  | 'monorepo'
```

---

## Manifest File Format

Templates must contain an `orbit-template.yaml` file in the repository root.

### Schema

```yaml
# orbit-template.yaml
apiVersion: orbit/v1
kind: Template

metadata:
  name: string           # Required: Display name
  description: string    # Optional: Markdown description
  language: string       # Required: Programming language
  framework: string      # Optional: Framework name
  categories: string[]   # Required: At least one category
  tags: string[]         # Optional: Freeform tags
  complexity: string     # Optional: 'starter' | 'intermediate' | 'production-ready'

variables:               # Optional: Template variables
  - key: string          # Variable identifier (used in {{key}} placeholders)
    type: string         # 'string' | 'number' | 'boolean' | 'select' | 'multiselect'
    required: boolean    # Is this variable required?
    description: string  # Help text for the user
    default: any         # Default value
    validation:          # Optional validation rules
      pattern: string    # Regex pattern (for strings)
      minLength: number
      maxLength: number
      min: number        # For numbers
      max: number
    options:             # For select/multiselect types
      - label: string
        value: string

hooks:                   # Optional: Post-generation hooks
  postGeneration:
    - command: string    # Shell command to run
      description: string
      workingDir: string # Optional: relative path
```

### Example: Minimal Manifest

```yaml
apiVersion: orbit/v1
kind: Template

metadata:
  name: "Go API Starter"
  language: go
  categories:
    - api-service
```

### Example: Full-Featured Manifest

```yaml
apiVersion: orbit/v1
kind: Template

metadata:
  name: "Next.js API Starter"
  description: |
    Production-ready Next.js 15 API template with TypeScript,
    Prisma ORM, and comprehensive testing setup.
  language: typescript
  framework: nextjs
  categories:
    - api-service
    - frontend-app
  tags:
    - prisma
    - tailwind
    - vitest
  complexity: production-ready

variables:
  - key: projectName
    type: string
    required: true
    description: "Name of your project"
    validation:
      pattern: "^[a-z][a-z0-9-]*$"
      minLength: 3
      maxLength: 50

  - key: description
    type: string
    required: false
    default: "A new project"

  - key: database
    type: select
    required: true
    description: "Database provider"
    options:
      - label: "PostgreSQL"
        value: "postgresql"
      - label: "MySQL"
        value: "mysql"
      - label: "SQLite (dev only)"
        value: "sqlite"
    default: "postgresql"

  - key: includeAuth
    type: boolean
    required: false
    default: true
    description: "Include authentication boilerplate"

hooks:
  postGeneration:
    - command: "npm install"
      description: "Install dependencies"
    - command: "npm run db:generate"
      description: "Generate Prisma client"
```

---

## Flows

### Template Import Flow

```
1. User enters GitHub repo URL
   └─> Orbit validates URL format

2. Orbit fetches repo metadata via GitHub API
   ├─> Checks if repo exists and user has access (via GitHub App)
   ├─> Checks if repo is marked as "Template" in GitHub
   └─> Warns if not a GitHub Template (but allows proceeding)

3. Orbit fetches orbit-template.yaml from default branch
   ├─> If found: Parse and validate against schema
   ├─> If not found: Error - "Manifest required"
   └─> If invalid: Error with validation details

4. Create Template record in Payload
   ├─> Store parsed metadata and variables
   ├─> Set syncStatus = 'synced', lastSyncedAt = now
   └─> Set visibility = 'workspace' (default)

5. (Optional) User enables webhook sync
   └─> Orbit creates GitHub webhook via API
```

### Manifest Sync Strategies

**On-Demand Refresh:**
```
When template is accessed:
  If lastSyncedAt > 1 hour ago:
    └─> Background fetch of manifest
    └─> Update Template record if changed
```

**Webhook Sync (optional):**
```
GitHub push event received:
  └─> Verify webhook signature
  └─> Fetch updated manifest
  └─> Update Template record
  └─> Set syncStatus = 'synced'
```

**Sync Error Handling:**
- If manifest deleted/invalid after import: `syncStatus = 'error'`
- Template remains usable with last-known-good config
- Admin notified to fix or re-sync

### Template Instantiation Flow

```
1. User browses Template Catalog
   └─> Filtered by: visibility rules, language, category, tags, search

2. User selects template, clicks "Use Template"
   └─> Permission check: user has workspace access (implicit)
   └─> Permission check: user can create repos in target workspace

3. User fills out form
   ├─> Target workspace (from their memberships)
   ├─> Target GitHub org (from workspace's GitHub App installations)
   ├─> New repo name
   └─> Template variables (rendered from manifest)

4. Frontend validates inputs
   └─> Variable validation rules from manifest

5. Submit to Repository Service (gRPC)
   └─> JWT contains user permissions
   └─> Request includes: templateId, workspaceId, githubOrg, repoName, variables

6. Repository Service orchestrates:
   ├─> Verify permissions from JWT
   ├─> Fetch Template details from Payload
   ├─> Start Temporal workflow: TemplateInstantiationWorkflow

7. Temporal Workflow executes:
   ├─> Activity: Create GitHub repo from template
   │   └─> If GitHub Template: Use "Use this template" API
   │   └─> If not: Clone, apply variables, push to new repo
   ├─> Activity: Apply variable substitutions ({{variable}} replacement)
   ├─> Activity: Run post-generation hooks (if defined)
   └─> Activity: Register new repo in Orbit's Repository collection

8. User sees progress via workflow status polling
   └─> On completion: Redirect to new repository page
```

**GitHub Template API vs Manual Clone:**

| Method | When Used | Behavior |
|--------|-----------|----------|
| GitHub Template API | `isGitHubTemplate = true` | `POST /repos/{template}/generate` - clean history |
| Manual Clone | `isGitHubTemplate = false` | Clone → substitute → push - works for any repo |

---

## UI Design

### Template Catalog Page (`/templates`)

```
┌─────────────────────────────────────────────────────────────┐
│  Template Catalog                        [+ Import Template]│
├─────────────────────────────────────────────────────────────┤
│  Search: [________________________]  🔍                     │
│                                                             │
│  Filters:                                                   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ Language ▼  │ │ Category ▼  │ │ Complexity ▼│           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
│  Tags: [graphql] [kubernetes] [x clear all]                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │ 📦 Next.js Starter  │  │ 🔧 Go API Service   │          │
│  │ typescript • nextjs │  │ go • gin            │          │
│  │ ⭐ production-ready │  │ ⭐ starter          │          │
│  │ 🏷️ prisma, tailwind │  │ 🏷️ grpc, temporal   │          │
│  │ Used 47 times       │  │ Used 23 times       │          │
│  │ [Use Template]      │  │ [Use Template]      │          │
│  └─────────────────────┘  └─────────────────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Template Detail Page (`/templates/[slug]`)

- Full description (markdown rendered)
- Variable preview (what user will fill out)
- Source repo link (GitHub)
- Sync status indicator
- "Use Template" CTA
- Usage statistics
- Visibility badge

### Import Template Modal

- GitHub URL input
- Preview of parsed manifest
- Visibility selector (workspace/shared/public)
- Shared workspace selector (if shared)
- Confirm import button

### Use Template Modal/Page

- Template info header
- Target workspace selector
- Target GitHub org selector
- Repository name input
- Dynamic variable form (from manifest)
- Progress indicator during creation

---

## Azure DevOps Extensibility

### Design for Future ADO Support

The data model is already extensible:
```typescript
gitProvider: enum  // 'github' | 'azure_devops' | 'gitlab' | 'bitbucket'
```

### Provider Differences

| Aspect | GitHub | Azure DevOps |
|--------|--------|--------------|
| Template API | `POST /repos/{template}/generate` | No native template API - must clone/push |
| Auth | GitHub App installation token | PAT or Azure AD service principal |
| Repo URL format | `github.com/org/repo` | `dev.azure.com/org/project/_git/repo` |
| Webhooks | GitHub webhooks | Azure Service Hooks |

### Abstraction Strategy

```go
// GitProviderInterface - implement per provider
type GitProviderInterface interface {
    // Validate and fetch repo metadata
    ValidateRepo(url string) (*RepoMetadata, error)

    // Fetch manifest file content
    FetchManifest(url, branch, path string) ([]byte, error)

    // Create repo from template
    CreateFromTemplate(template *Template, opts CreateOpts) (*Repo, error)

    // Setup webhook for sync
    SetupWebhook(repoUrl string, secret string) (webhookId string, error)

    // Check if repo is marked as template
    IsTemplateRepo(url string) (bool, error)
}

// Implementations
type GitHubProvider struct { ... }      // Implemented now
type AzureDevOpsProvider struct { ... } // Future
type GitLabProvider struct { ... }      // Future
```

### What We Build Now (GitHub)

- Provider-agnostic Template collection (`gitProvider` field)
- `GitProviderInterface` abstraction in Go service
- `GitHubProvider` implementation
- Template import, sync, and instantiation

### What ADO Adds Later

- `AzureDevOpsProvider` implementation
- ADO authentication configuration UI (PAT/Service Principal)
- Service Hooks integration for webhook sync
- ADO-specific URL parsing and validation

---

## Implementation Phases

### Phase 1: Permissions Foundation

1. Create Permissions collection in Payload
2. Create Roles collection in Payload
3. Create UserWorkspaceRoles collection in Payload
4. Seed built-in roles and permissions
5. Update JWT generation to include permissions claim
6. Add permission loading on login (sessionStorage)
7. Create permission checking utilities (frontend + backend)

### Phase 2: Template Data Model

1. Create Templates collection in Payload
2. Define manifest schema and validation
3. Create GitHub manifest fetcher service
4. Implement template import API endpoint
5. Add template CRUD operations

### Phase 3: Template Catalog UI

1. Build Template Catalog page with filters
2. Build Template Detail page
3. Build Import Template modal
4. Add permission-based UI controls

### Phase 4: Template Instantiation

1. Extend Repository Service for template instantiation
2. Create TemplateInstantiationWorkflow in Temporal
3. Implement GitHub Template API integration
4. Implement manual clone/substitute fallback
5. Build "Use Template" UI flow
6. Add progress tracking

### Phase 5: Advanced Features

1. Implement optional webhook sync
2. Add sync status monitoring
3. Build template management UI (edit, archive, delete)
4. Add usage analytics

### Future: Azure DevOps

1. Implement AzureDevOpsProvider
2. Add ADO authentication configuration
3. Add Service Hooks integration
4. Test and document ADO workflow

---

## Success Criteria

- [ ] Users can import a GitHub repo as a template by providing the URL
- [ ] Orbit reads and validates `orbit-template.yaml` manifest from the repo
- [ ] Templates are browsable/searchable by language, category, tags, complexity
- [ ] Visibility controls work correctly (workspace, shared, public)
- [ ] Permission checks prevent unauthorized template management
- [ ] Developers can create new repos from templates in their GitHub org
- [ ] When available, uses GitHub's native "Use this template" mechanism
- [ ] Variable substitution works correctly in generated repos
- [ ] Post-generation hooks execute successfully
- [ ] Template sync (on-demand and webhook) keeps metadata current

---

## Open Questions

1. **Template versioning**: Should we track template versions or always use latest?
2. **Template deprecation**: How to handle deprecated/archived templates?
3. **Fork vs template**: Should users be able to fork templates for customization?
4. **Approval workflow**: Should template publishing require approval in some workspaces?

---

## References

- GitHub Template Repositories: https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-template-repository
- GitHub "Use this template" API: https://docs.github.com/en/rest/repos/repos#create-a-repository-using-a-template
- Backstage Software Templates: https://backstage.io/docs/features/software-templates/
- Azure DevOps REST API: https://docs.microsoft.com/en-us/rest/api/azure/devops/
