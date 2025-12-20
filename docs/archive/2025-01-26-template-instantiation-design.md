# Template Instantiation Design

**Date:** 2025-01-26
**Status:** Approved
**Author:** Claude + Drew

## Overview

Enable users to create new GitHub repositories from imported templates, with variable substitution and real-time progress tracking.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| GitHub Template API | Use when available, fallback to clone | Faster, preserves GitHub template features |
| Target Organization | User selects from available orgs | Flexibility, works with multiple installations |
| Progress Tracking | Dedicated progress page | Clear UX, supports long-running operations |
| Architecture | gRPC service as intermediary | Matches existing patterns, clean separation |

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Next.js       │     │  Repository Service  │     │    Temporal     │
│   Frontend      │────▶│     (Go gRPC)        │────▶│    Worker       │
│                 │     │                      │     │                 │
│ • Use Template  │     │ • StartInstantiation │     │ • Clone/Create  │
│   Form          │     │ • GetProgress        │     │ • Apply Vars    │
│ • Progress Page │     │ • QueryWorkflow      │     │ • Push to GitHub│
└─────────────────┘     └──────────────────────┘     └─────────────────┘
         │                        │                          │
         ▼                        ▼                          ▼
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Payload DB    │     │  GitHub API          │     │ Local Filesystem│
│   (Templates)   │     │  (Create Repos)      │     │   (Work Dir)    │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
```

### Data Flow

1. User fills out form on `/templates/[slug]/use` → selects target org, enters repo name, fills variables
2. Form submits to Next.js server action → calls gRPC `StartTemplateInstantiation`
3. Repository service starts Temporal workflow → returns workflow ID
4. User redirected to `/templates/instantiate/[workflowId]`
5. Progress page polls gRPC `GetInstantiationProgress` → displays live step status
6. On completion, shows link to new repository

## Workflow Steps

```
Step 1: Validate Inputs
├── Check template exists in Payload DB
├── Verify user has access to target GitHub org
└── Validate required variables are provided

Step 2: Create Repository (GitHub API)
├── IF template.isGitHubTemplate = true:
│   └── Use "POST /repos/{owner}/{repo}/generate" (GitHub Template API)
│       • Faster, single API call
│       • Preserves template relationship in GitHub
├── ELSE:
│   └── Use "POST /orgs/{org}/repos" (Create empty repo)
│       • Then clone source → push to new repo

Step 3: Clone Template (only for non-GitHub templates)
├── Clone source repo to temp directory
├── Remove .git folder
└── Apply variable substitutions to all files

Step 4: Apply Variables
├── For GitHub Template repos: Use GitHub's "template variables" if available
├── For cloned repos: Replace {{variable}} patterns in files
└── Handle special files: package.json name, go.mod module path, etc.

Step 5: Push to Remote (only for non-GitHub templates)
├── Initialize git, commit changes
├── Push to newly created repo
└── Clean up temp directory

Step 6: Finalize
├── Update template usage count in Payload
├── Record instantiation in history
└── Return new repo URL
```

## gRPC API

### Proto Definitions

```protobuf
// proto/template.proto

service TemplateService {
  // Start a new template instantiation
  rpc StartInstantiation(StartInstantiationRequest) returns (StartInstantiationResponse);

  // Get current progress of an instantiation
  rpc GetInstantiationProgress(GetProgressRequest) returns (GetProgressResponse);

  // Cancel an in-progress instantiation
  rpc CancelInstantiation(CancelRequest) returns (CancelResponse);
}

message StartInstantiationRequest {
  string template_id = 1;
  string workspace_id = 2;
  string target_org = 3;           // GitHub org to create repo in
  string repository_name = 4;
  string description = 5;
  bool is_private = 6;
  map<string, string> variables = 7;
}

message StartInstantiationResponse {
  string workflow_id = 1;          // Temporal workflow ID for tracking
}

message GetProgressRequest {
  string workflow_id = 1;
}

message GetProgressResponse {
  string workflow_id = 1;
  WorkflowStatus status = 2;       // PENDING, RUNNING, COMPLETED, FAILED
  string current_step = 3;         // "validating", "creating_repo", etc.
  int32 progress_percent = 4;      // 0-100
  string error_message = 5;        // Only set if FAILED
  string result_repo_url = 6;      // Only set if COMPLETED
}

enum WorkflowStatus {
  WORKFLOW_STATUS_UNSPECIFIED = 0;
  WORKFLOW_STATUS_PENDING = 1;
  WORKFLOW_STATUS_RUNNING = 2;
  WORKFLOW_STATUS_COMPLETED = 3;
  WORKFLOW_STATUS_FAILED = 4;
  WORKFLOW_STATUS_CANCELLED = 5;
}

message CancelRequest {
  string workflow_id = 1;
}

message CancelResponse {
  bool success = 1;
}
```

## Frontend Components

### Pages

```
/templates/[slug]/use                    # "Use Template" form page
├── OrgSelector                          # Dropdown of available GitHub orgs
├── RepoNameInput                        # Name for new repository
├── DescriptionInput                     # Optional description
├── VisibilityToggle                     # Public/Private
├── VariablesForm                        # Dynamic form based on template.variables
└── SubmitButton                         # Calls startInstantiation server action

/templates/instantiate/[workflowId]      # Progress tracking page
├── ProgressHeader                       # Template name, target repo name
├── StepsList                            # 6 steps with status icons
│   ├── ✓ Validating inputs
│   ├── ⏳ Creating repository...
│   ├── ○ Cloning template
│   ├── ○ Applying variables
│   ├── ○ Pushing to GitHub
│   └── ○ Finalizing
├── ErrorAlert                           # Shows if workflow fails
└── CompletionCard                       # Shows repo URL + "Open Repository" button
```

### Server Actions

```typescript
// orbit-www/src/app/actions/templates.ts

// Get available GitHub orgs for the user's workspace
async function getAvailableOrgs(workspaceId: string): Promise<GitHubOrg[]>

// Start instantiation - calls gRPC, returns workflow ID
async function startInstantiation(input: InstantiateInput): Promise<{ workflowId: string }>

// Get progress - calls gRPC query
async function getInstantiationProgress(workflowId: string): Promise<ProgressResponse>
```

## GitHub API Usage

### Template API (Preferred)

For repositories marked as GitHub Templates:

```
POST /repos/{template_owner}/{template_repo}/generate
Authorization: Bearer {installation_token}

{
  "owner": "target-org",
  "name": "new-repo-name",
  "description": "Created from template",
  "private": true,
  "include_all_branches": false
}
```

### Standard API (Fallback)

For non-template repositories:

1. Create empty repo: `POST /orgs/{org}/repos`
2. Clone template locally
3. Apply variable substitutions
4. Push to new repo

### Rate Limits

- 5000 requests/hour per installation
- Template generation counts as 1 request

## Implementation Notes

### Existing Code to Leverage

- `temporal-workflows/internal/workflows/repository_workflow.go` - Base workflow structure
- `temporal-workflows/internal/activities/git_activities.go` - Git operations
- `temporal-workflows/internal/services/github_service.go` - GitHub API client

### New Components Needed

1. **Proto definitions** - `proto/template.proto`
2. **gRPC server** - `services/repository/internal/grpc/template_server.go`
3. **Temporal workflow** - Extend or create `TemplateInstantiationWorkflow`
4. **GitHub Template activity** - New activity for GitHub Template API
5. **Frontend pages** - Use form, progress page
6. **Server actions** - gRPC client calls from Next.js

### Security Considerations

- Validate user has access to target org via GitHub installation
- Sanitize repository names (no path traversal)
- Rate limit instantiation requests per user
- Clean up temp directories on failure
