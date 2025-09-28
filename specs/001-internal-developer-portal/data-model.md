# Data Model: Internal Developer Portal (IDP)

## Core Entities

### 1. Workspace Entity

```typescript
interface Workspace {
  id: string;
  name: string;
  slug: string;
  description?: string;
  settings: WorkspaceSettings;
  created_at: Date;
  updated_at: Date;
  created_by: string; // User ID
  
  // Relations
  members: WorkspaceMember[];
  repositories: Repository[];
  api_schemas: APISchema[];
  knowledge_spaces: KnowledgeSpace[];
}

interface WorkspaceSettings {
  default_visibility: 'private' | 'internal' | 'public';
  require_approval_for_repos: boolean;
  enable_code_generation: boolean;
  allowed_template_types: string[];
  integration_settings: {
    git_providers: GitProviderConfig[];
    ci_cd_providers: CICDProviderConfig[];
  };
}

interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  permissions: Permission[];
  joined_at: Date;
}
```

### 2. Repository Entity

```typescript
interface Repository {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description?: string;
  git_url?: string;
  visibility: 'private' | 'internal' | 'public';
  template_type: 'service' | 'library' | 'frontend' | 'mobile' | 'documentation';
  
  // Template metadata
  template_config: TemplateConfig;
  variables: RepositoryVariable[];
  
  // Generated content
  last_generated_at?: Date;
  generation_status: 'pending' | 'generating' | 'completed' | 'failed';
  
  created_at: Date;
  updated_at: Date;
  created_by: string;
  
  // Relations
  workspace: Workspace;
  dependencies: Repository[];
  dependents: Repository[];
  api_schemas: APISchema[];
}

interface TemplateConfig {
  base_template: string;
  language: string;
  framework?: string;
  customizations: Record<string, any>;
  hooks: {
    pre_generation: string[];
    post_generation: string[];
  };
}

interface RepositoryVariable {
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  required: boolean;
  description?: string;
  validation_rules?: ValidationRule[];
}
```

### 3. API Schema Entity

```typescript
interface APISchema {
  id: string;
  workspace_id: string;
  repository_id?: string;
  name: string;
  slug: string;
  version: string;
  description?: string;
  
  // Schema definition
  schema_type: 'openapi' | 'graphql' | 'protobuf' | 'avro';
  schema_content: object; // JSON representation of schema
  raw_content: string; // Original schema file content
  
  // Metadata
  tags: string[];
  contact_info: ContactInfo;
  license: string;
  
  // Lifecycle
  status: 'draft' | 'published' | 'deprecated';
  published_at?: Date;
  deprecated_at?: Date;
  
  created_at: Date;
  updated_at: Date;
  created_by: string;
  
  // Relations
  workspace: Workspace;
  repository?: Repository;
  endpoints: APIEndpoint[];
  consumers: APIConsumer[];
}

interface APIEndpoint {
  id: string;
  schema_id: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  parameters: APIParameter[];
  request_body?: APIRequestBody;
  responses: APIResponse[];
  tags: string[];
}

interface APIParameter {
  name: string;
  location: 'query' | 'path' | 'header' | 'cookie';
  required: boolean;
  type: string;
  description?: string;
  example?: any;
}

interface APIConsumer {
  id: string;
  schema_id: string;
  repository_id?: string;
  consumer_type: 'repository' | 'external';
  name: string;
  contact_email?: string;
  registered_at: Date;
}
```

### 4. Knowledge Space Entity

```typescript
interface KnowledgeSpace {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  color?: string;
  
  // Organization
  parent_id?: string; // For hierarchical spaces
  sort_order: number;
  
  // Access control
  visibility: 'private' | 'internal' | 'public';
  access_level: 'read' | 'comment' | 'edit' | 'admin';
  
  created_at: Date;
  updated_at: Date;
  created_by: string;
  
  // Relations
  workspace: Workspace;
  parent?: KnowledgeSpace;
  children: KnowledgeSpace[];
  pages: KnowledgePage[];
  permissions: KnowledgeSpacePermission[];
}

interface KnowledgePage {
  id: string;
  knowledge_space_id: string;
  title: string;
  slug: string;
  content: object; // Rich text content (structured)
  content_type: 'markdown' | 'rich_text' | 'code' | 'diagram';
  
  // Organization
  parent_id?: string;
  sort_order: number;
  
  // Metadata
  tags: string[];
  author_id: string;
  last_edited_by: string;
  version: number;
  
  // Publishing
  status: 'draft' | 'review' | 'published' | 'archived';
  published_at?: Date;
  
  created_at: Date;
  updated_at: Date;
  
  // Relations
  knowledge_space: KnowledgeSpace;
  parent?: KnowledgePage;
  children: KnowledgePage[];
  comments: PageComment[];
  attachments: PageAttachment[];
}

interface KnowledgeSpacePermission {
  knowledge_space_id: string;
  user_id?: string;
  role?: string;
  permission_type: 'read' | 'comment' | 'edit' | 'admin';
  granted_at: Date;
  granted_by: string;
}
```

### 5. User Entity

```typescript
interface User {
  id: string;
  email: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  
  // Authentication
  auth_provider: 'local' | 'github' | 'google' | 'azure_ad';
  external_id?: string;
  
  // Profile
  title?: string;
  bio?: string;
  location?: string;
  timezone: string;
  
  // Status
  status: 'active' | 'inactive' | 'suspended';
  last_active_at?: Date;
  
  created_at: Date;
  updated_at: Date;
  
  // Relations
  workspace_memberships: WorkspaceMember[];
  created_repositories: Repository[];
  created_schemas: APISchema[];
}
```

### 6. Temporal Workflow Entity

```typescript
interface WorkflowExecution {
  id: string;
  workflow_id: string;
  run_id: string;
  workspace_id: string;
  workflow_type: 'repository_generation' | 'code_generation' | 'knowledge_sync';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
  
  // Request data
  request_data: object; // JSON representation of workflow request
  
  // Execution metadata
  started_at: Date;
  completed_at?: Date;
  initiated_by: string; // User ID
  
  // Progress tracking
  steps: WorkflowStep[];
  progress_percentage?: number;
  
  // Results
  result_data?: object; // JSON representation of workflow response
  error_message?: string;
  
  created_at: Date;
  updated_at: Date;
  
  // Relations
  workspace: Workspace;
  steps: WorkflowStep[];
}

interface WorkflowStep {
  id: string;
  workflow_execution_id: string;
  step_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  sort_order: number;
  
  // Execution details
  started_at?: Date;
  completed_at?: Date;
  duration_ms?: number;
  
  // Step metadata
  step_type: 'activity' | 'child_workflow' | 'signal' | 'timer';
  activity_name?: string;
  input_data?: object;
  output_data?: object;
  error_message?: string;
  retry_count: number;
  
  created_at: Date;
  updated_at: Date;
  
  // Relations
  workflow_execution: WorkflowExecution;
}

interface GeneratedArtifact {
  id: string;
  workflow_execution_id: string;
  artifact_type: 'client_library' | 'server_stub' | 'documentation' | 'manifest';
  language?: string;
  
  // Storage details
  file_path: string;
  file_size_bytes: number;
  checksum: string;
  download_url?: string;
  
  // Metadata
  version: string;
  description?: string;
  tags: string[];
  
  // Lifecycle
  expires_at?: Date;
  downloaded_count: number;
  
  created_at: Date;
  updated_at: Date;
  
  // Relations
  workflow_execution: WorkflowExecution;
}

interface WorkflowSchedule {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  
  // Schedule configuration
  workflow_type: 'repository_generation' | 'code_generation' | 'knowledge_sync';
  cron_expression: string;
  timezone: string;
  
  // Workflow parameters
  workflow_input: object; // JSON representation of workflow request template
  
  // Status
  enabled: boolean;
  last_execution_time?: Date;
  next_execution_time?: Date;
  
  created_at: Date;
  updated_at: Date;
  created_by: string;
  
  // Relations
  workspace: Workspace;
  executions: WorkflowExecution[];
}
```

## Relationships

### Primary Relationships

1. **Workspace ↔ Repository** (1:N)
   - One workspace contains multiple repositories
   - Each repository belongs to exactly one workspace

2. **Workspace ↔ API Schema** (1:N)
   - One workspace contains multiple API schemas
   - Each schema belongs to exactly one workspace

3. **Workspace ↔ Knowledge Space** (1:N)
   - One workspace contains multiple knowledge spaces
   - Each space belongs to exactly one workspace

4. **Repository ↔ API Schema** (1:N optional)
   - One repository can define multiple API schemas
   - API schemas can exist independently of repositories

5. **User ↔ Workspace** (N:N via WorkspaceMember)
   - Users can be members of multiple workspaces
   - Workspaces can have multiple users with different roles

6. **Workspace ↔ Workflow Execution** (1:N)
   - One workspace can have multiple workflow executions
   - Each workflow execution belongs to exactly one workspace

7. **Workflow Execution ↔ Workflow Step** (1:N)
   - One workflow execution contains multiple steps
   - Each step belongs to exactly one workflow execution

### Secondary Relationships

1. **Repository ↔ Repository** (N:N self-referencing)
   - Dependencies and dependents relationships
   - Used for dependency tracking and impact analysis

2. **Knowledge Space ↔ Knowledge Space** (1:N self-referencing)
   - Parent-child hierarchy for organizing spaces
   - Enables nested organization structures

3. **Knowledge Page ↔ Knowledge Page** (1:N self-referencing)
   - Parent-child hierarchy for page organization
   - Enables documentation tree structures

## Data Access Patterns

### 1. Multi-Tenant Access Control

All queries must include workspace context:

```sql
-- Example: Get all repositories for a workspace
SELECT r.* FROM repositories r
WHERE r.workspace_id = $1
AND EXISTS (
  SELECT 1 FROM workspace_members wm
  WHERE wm.workspace_id = $1
  AND wm.user_id = $2
  AND wm.role IN ('owner', 'admin', 'member')
);
```

### 2. Permission Checking

Role-based access with workspace isolation:

```sql
-- Check user permissions for repository
WITH user_role AS (
  SELECT role FROM workspace_members
  WHERE workspace_id = $1 AND user_id = $2
)
SELECT r.*, ur.role as user_role FROM repositories r
CROSS JOIN user_role ur
WHERE r.workspace_id = $1 AND r.id = $3;
```

### 3. Search Optimization

Full-text search across entities:

```sql
-- Search repositories and knowledge pages
SELECT 'repository' as type, id, name, description
FROM repositories
WHERE workspace_id = $1
AND (name ILIKE $2 OR description ILIKE $2)

UNION ALL

SELECT 'knowledge_page' as type, id, title, content::text
FROM knowledge_pages kp
JOIN knowledge_spaces ks ON kp.knowledge_space_id = ks.id
WHERE ks.workspace_id = $1
AND (title ILIKE $2 OR content::text ILIKE $2);
```

## Database Schema Considerations

### Indexing Strategy

```sql
-- Workspace isolation indexes
CREATE INDEX idx_repositories_workspace_id ON repositories(workspace_id);
CREATE INDEX idx_api_schemas_workspace_id ON api_schemas(workspace_id);
CREATE INDEX idx_knowledge_spaces_workspace_id ON knowledge_spaces(workspace_id);
CREATE INDEX idx_workflow_executions_workspace_id ON workflow_executions(workspace_id);

-- Workflow execution indexes
CREATE INDEX idx_workflow_executions_status ON workflow_executions(status);
CREATE INDEX idx_workflow_executions_type_status ON workflow_executions(workflow_type, status);
CREATE INDEX idx_workflow_executions_started_at ON workflow_executions(started_at DESC);
CREATE INDEX idx_workflow_steps_execution_id ON workflow_steps(workflow_execution_id);
CREATE INDEX idx_workflow_steps_status ON workflow_steps(status);

-- Search indexes
CREATE INDEX idx_repositories_name_gin ON repositories USING gin(name gin_trgm_ops);
CREATE INDEX idx_repositories_description_gin ON repositories USING gin(description gin_trgm_ops);

-- Relationship indexes
CREATE INDEX idx_workspace_members_user_workspace ON workspace_members(user_id, workspace_id);
CREATE INDEX idx_repository_dependencies ON repository_dependencies(repository_id, dependency_id);

-- Performance indexes
CREATE INDEX idx_repositories_created_at ON repositories(created_at DESC);
CREATE INDEX idx_knowledge_pages_updated_at ON knowledge_pages(updated_at DESC);
```

### Constraints

```sql
-- Ensure unique slugs per workspace
ALTER TABLE repositories ADD CONSTRAINT unique_repo_slug_per_workspace 
UNIQUE (workspace_id, slug);

ALTER TABLE knowledge_spaces ADD CONSTRAINT unique_space_slug_per_workspace 
UNIQUE (workspace_id, slug);

-- Prevent circular dependencies
-- (Implemented via application logic and/or triggers)

-- Role validation
ALTER TABLE workspace_members ADD CONSTRAINT valid_member_roles
CHECK (role IN ('owner', 'admin', 'member', 'viewer'));

-- Workflow status validation
ALTER TABLE workflow_executions ADD CONSTRAINT valid_workflow_status
CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'timed_out'));

ALTER TABLE workflow_executions ADD CONSTRAINT valid_workflow_type
CHECK (workflow_type IN ('repository_generation', 'code_generation', 'knowledge_sync'));

-- Workflow step constraints
ALTER TABLE workflow_steps ADD CONSTRAINT valid_step_status
CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped'));

-- Ensure completed workflows have completion timestamp
ALTER TABLE workflow_executions ADD CONSTRAINT completed_workflows_have_timestamp
CHECK ((status != 'completed') OR (completed_at IS NOT NULL));
```