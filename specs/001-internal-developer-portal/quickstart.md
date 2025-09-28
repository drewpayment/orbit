# Quickstart Guide: Internal Developer Portal (IDP)

## Integration Scenarios

This guide demonstrates common integration patterns and usage scenarios for the Internal Developer Portal.

## Scenario 1: Creating a New Service Repository

**Use Case**: Development team wants to create a new microservice from a template

### Step 1: Setup Workspace
```typescript
// Create or join workspace
const workspace = await workspaceService.createWorkspace({
  name: "Platform Team",
  slug: "platform-team",
  description: "Core platform services and tools",
  settings: {
    default_visibility: "INTERNAL",
    enable_code_generation: true,
    allowed_template_types: ["service", "library"]
  }
});
```

### Step 2: Browse Available Templates
```typescript
// List available service templates
const templates = await repositoryService.listTemplates({
  pagination: { page: 1, size: 20 },
  filters: [
    { field: "type", operator: "EQUALS", values: ["service"] },
    { field: "language", operator: "IN", values: ["go", "typescript"] }
  ]
});

// Get specific template details
const goTemplate = await repositoryService.getTemplate({
  id: "go-microservice-template"
});
```

### Step 3: Create Repository from Template
```typescript
// Create new repository with template variables using Temporal workflow
const workflowRequest = await temporalService.startRepositoryGeneration({
  workspace_id: workspace.metadata.id,
  user_id: currentUser.id,
  repository_name: "user-service",
  template_type: "go-microservice",
  variables: {
    service_name: "user-service",
    database_type: "postgresql",
    enable_auth: "true",
    api_version: "v1"
  },
  config: {
    language: "go",
    framework: "gin",
    features: ["database", "auth", "monitoring"],
    git_config: {
      provider: "github",
      organization: "platform-team",
      private_repo: true,
      topics: ["microservice", "platform"]
    }
  }
});

console.log("Repository generation workflow started:", workflowRequest.workflow_id);
```

### Step 4: Monitor Workflow Progress
```typescript
// Monitor workflow execution
const pollWorkflowStatus = async (workflowId: string, runId: string) => {
  while (true) {
    const status = await temporalService.getWorkflowStatus({
      workflow_id: workflowId,
      run_id: runId
    });

    console.log(`Workflow status: ${status.status}`);
    
    if (status.steps) {
      status.steps.forEach(step => {
        console.log(`- ${step.step_name}: ${step.status}`);
      });
    }

    if (status.status === "COMPLETED") {
      console.log("Repository generated successfully!");
      break;
    } else if (status.status === "FAILED") {
      console.error("Generation failed:", status.error_message);
      break;
    }

    // Wait 2 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
};

await pollWorkflowStatus(workflowRequest.workflow_id, workflowRequest.run_id);
```

## Scenario 2: Publishing API Schema to Catalog

**Use Case**: Service team wants to publish their API schema for discovery and consumption

### Step 1: Upload OpenAPI Schema
```typescript
const apiSchema = await apiCatalogService.createSchema({
  workspace_id: workspace.metadata.id,
  repository_id: repository.metadata.id,
  name: "User Service API",
  slug: "user-service-api",
  version: "v1.0.0",
  description: "REST API for user management operations",
  schema_type: "OPENAPI",
  raw_content: `
openapi: 3.0.0
info:
  title: User Service API
  version: v1.0.0
  description: User management operations
paths:
  /users:
    get:
      summary: List users
      responses:
        '200':
          description: List of users
    post:
      summary: Create user
      responses:
        '201':
          description: User created
  `,
  tags: ["users", "authentication", "v1"],
  contact_info: {
    name: "Platform Team",
    email: "platform@company.com"
  }
});
```

### Step 2: Validate Schema
```typescript
// Validate before publishing
const validation = await apiCatalogService.validateSchema({
  schema_type: "OPENAPI",
  raw_content: schemaContent
});

if (validation.is_valid) {
  // Update schema status to published
  await apiCatalogService.updateSchema({
    id: apiSchema.metadata.id,
    status: "PUBLISHED"
  });
} else {
  console.error("Schema validation errors:", validation.validation_errors);
}
```

### Step 3: Generate Client Libraries with Temporal
```typescript
// Start code generation workflow for multiple languages
const codeGenRequest = await temporalService.startCodeGeneration({
  workspace_id: workspace.metadata.id,
  user_id: currentUser.id,
  schema_id: apiSchema.metadata.id,
  target_languages: ["typescript", "go", "python", "java"],
  options: {
    include_tests: true,
    include_docs: true,
    output_format: "zip",
    language_configs: {
      typescript: "package_name=user-service-client",
      go: "module_name=github.com/company/user-service-client",
      python: "package_name=user_service_client",
      java: "package_name=com.company.userservice.client"
    }
  }
});

// Monitor code generation progress
const codeGenStatus = await temporalService.getWorkflowStatus({
  workflow_id: codeGenRequest.workflow_id,
  run_id: codeGenRequest.run_id
});

console.log("Code generation workflow started:", codeGenRequest.workflow_id);
```

### Step 4: Download Generated Artifacts
```typescript
// Wait for completion and download artifacts
const pollCodeGeneration = async (workflowId: string, runId: string) => {
  let status;
  do {
    status = await temporalService.getWorkflowStatus({
      workflow_id: workflowId,
      run_id: runId
    });
    
    if (status.status === "RUNNING") {
      console.log("Generating client libraries...");
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } while (status.status === "RUNNING");

  if (status.status === "COMPLETED") {
    // Get workflow result with artifacts
    const result = await temporalService.getWorkflowResult({
      workflow_id: workflowId,
      run_id: runId
    });

    result.artifacts.forEach(artifact => {
      console.log(`Generated ${artifact.language} ${artifact.artifact_type}:`);
      console.log(`- Download: ${artifact.download_url}`);
      console.log(`- Size: ${artifact.size_bytes} bytes`);
      console.log(`- Version: ${artifact.version}`);
    });
  } else {
    console.error("Code generation failed:", status.error_message);
  }
};

await pollCodeGeneration(codeGenRequest.workflow_id, codeGenRequest.run_id);
```

## Scenario 3: Creating Knowledge Documentation

**Use Case**: Technical writer wants to create comprehensive documentation for the platform

### Step 1: Create Knowledge Space
```typescript
const knowledgeSpace = await knowledgeService.createKnowledgeSpace({
  workspace_id: workspace.metadata.id,
  name: "Platform Documentation",
  slug: "platform-docs",
  description: "Comprehensive platform documentation and guides",
  icon: "📚",
  color: "#3B82F6",
  visibility: "INTERNAL",
  access_level: "READ"
});
```

### Step 2: Create Documentation Structure
```typescript
// Create main sections
const gettingStarted = await knowledgeService.createPage({
  knowledge_space_id: knowledgeSpace.metadata.id,
  title: "Getting Started",
  slug: "getting-started",
  content_type: "MARKDOWN",
  content: {
    markdown: `
# Getting Started with Platform Services

This guide helps you get started with our internal developer platform.

## Prerequisites

- Access to the platform workspace
- Basic knowledge of microservices
- Development environment setup

## Quick Start

1. Join your team workspace
2. Browse available templates
3. Create your first service
4. Deploy to development environment
    `
  },
  tags: ["onboarding", "tutorial"],
  status: "PUBLISHED"
});

// Create API documentation section
const apiDocs = await knowledgeService.createPage({
  knowledge_space_id: knowledgeSpace.metadata.id,
  title: "API Guidelines",
  slug: "api-guidelines",
  content_type: "MARKDOWN",
  content: {
    markdown: `
# API Design Guidelines

## REST API Standards

### Resource Naming
- Use plural nouns for collections: \`/users\`, \`/orders\`
- Use kebab-case for multi-word resources: \`/user-profiles\`

### HTTP Methods
- GET: Retrieve resources
- POST: Create new resources
- PUT: Update entire resources
- PATCH: Partial resource updates
- DELETE: Remove resources

### Response Formats
All APIs should return consistent response formats:

\`\`\`json
{
  "data": {},
  "meta": {
    "timestamp": "2025-09-26T10:00:00Z",
    "version": "v1"
  }
}
\`\`\`
    `
  },
  tags: ["api", "guidelines", "standards"],
  status: "PUBLISHED"
});
```

### Step 3: Add Comments and Reviews
```typescript
// Add review comment
await knowledgeService.addComment({
  page_id: apiDocs.metadata.id,
  content: "Should we include examples for error responses?",
});

// Add inline feedback
await knowledgeService.addComment({
  page_id: gettingStarted.metadata.id,
  content: "The prerequisites section could use more specific version requirements",
});
```

## Scenario 4: Dependency Management and Discovery

**Use Case**: Development team needs to understand service dependencies and find reusable components

### Step 1: Add Repository Dependencies
```typescript
// Add database dependency
await repositoryService.addDependency({
  repository_id: userService.metadata.id,
  dependency_id: databaseRepo.metadata.id,
  relationship_type: "depends_on"
});

// Add shared library dependency  
await repositoryService.addDependency({
  repository_id: userService.metadata.id,
  dependency_id: authLibrary.metadata.id,
  relationship_type: "implements"
});
```

### Step 2: Discover Related Services
```typescript
// Find all dependencies
const dependencies = await repositoryService.listDependencies({
  repository_id: userService.metadata.id,
  direction: "dependencies"
});

// Find services that depend on this one
const dependents = await repositoryService.listDependencies({
  repository_id: userService.metadata.id,
  direction: "dependents"
});
```

### Step 3: Search for Reusable Components
```typescript
// Search for authentication-related repositories
const authRepos = await repositoryService.listRepositories({
  workspace_id: workspace.metadata.id,
  pagination: { page: 1, size: 10 },
  filters: [
    { field: "tags", operator: "CONTAINS", values: ["auth"] },
    { field: "type", operator: "EQUALS", values: ["library"] }
  ]
});

// Search API schemas by functionality
const authApis = await apiCatalogService.searchSchemas({
  workspace_id: workspace.metadata.id,
  query: "authentication authorization",
  tags: ["auth", "security"],
  pagination: { page: 1, size: 10 }
});
```

## Scenario 5: Multi-Service Code Generation

**Use Case**: Generate multiple related services following consistent patterns

### Step 1: Create Service Suite
```typescript
const services = [
  { name: "user-service", database: "postgresql" },
  { name: "order-service", database: "postgresql" },
  { name: "notification-service", database: "redis" }
];

// Generate all services in parallel
const repositories = await Promise.all(
  services.map(service => 
    repositoryService.createRepository({
      workspace_id: workspace.metadata.id,
      name: service.name,
      slug: service.name,
      template_id: "go-microservice-template",
      variables: [
        { key: "service_name", value: service.name, type: "STRING" },
        { key: "database_type", value: service.database, type: "SELECT" },
        { key: "enable_monitoring", value: "true", type: "BOOLEAN" }
      ],
      generate_immediately: true
    })
  )
);
```

### Step 2: Setup Cross-Service Dependencies
```typescript
// Set up service dependencies
await repositoryService.addDependency({
  repository_id: repositories[1].metadata.id, // order-service
  dependency_id: repositories[0].metadata.id, // user-service
  relationship_type: "depends_on"
});

await repositoryService.addDependency({
  repository_id: repositories[2].metadata.id, // notification-service
  dependency_id: repositories[1].metadata.id, // order-service
  relationship_type: "depends_on"
});
```

## Scenario 6: Scheduled Knowledge Synchronization

**Use Case**: Automatically synchronize knowledge documentation with external systems

### Step 1: Create Knowledge Sync Schedule
```typescript
// Schedule daily backup of knowledge space
const schedule = await temporalService.createSchedule({
  workspace_id: workspace.metadata.id,
  name: "Daily Documentation Backup",
  description: "Backup all knowledge spaces daily at 2 AM UTC",
  workflow_type: "knowledge_sync",
  cron_expression: "0 2 * * *", // Daily at 2 AM UTC
  timezone: "UTC",
  workflow_input: {
    workspace_id: workspace.metadata.id,
    user_id: "system",
    knowledge_space_id: "", // Empty means all spaces
    operation: "BACKUP",
    options: {
      include_attachments: true,
      preserve_permissions: true,
      backup_location: "s3://company-backups/knowledge/"
    }
  },
  enabled: true
});

console.log("Knowledge sync schedule created:", schedule.id);
```

### Step 2: Monitor Scheduled Executions
```typescript
// List recent executions for the schedule
const recentExecutions = await temporalService.listWorkflows({
  workspace_id: workspace.metadata.id,
  schedule_id: schedule.id,
  start_time: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
  page_size: 10
});

recentExecutions.workflows.forEach(execution => {
  console.log(`Execution ${execution.run_id}:`);
  console.log(`- Status: ${execution.status}`);
  console.log(`- Duration: ${execution.duration}ms`);
  console.log(`- Started: ${execution.started_at}`);
});
```

### Step 3: Manual Knowledge Sync
```typescript
// Trigger immediate knowledge sync for specific space
const syncRequest = await temporalService.startKnowledgeSync({
  workspace_id: workspace.metadata.id,
  user_id: currentUser.id,
  knowledge_space_id: knowledgeSpace.metadata.id,
  operation: "FULL_SYNC",
  options: {
    include_attachments: true,
    preserve_permissions: true,
    page_filters: ["published", "review"]
  }
});

// Monitor sync progress
let syncStatus;
do {
  syncStatus = await temporalService.getWorkflowStatus({
    workflow_id: syncRequest.workflow_id,
    run_id: syncRequest.run_id
  });
  
  console.log(`Sync progress: ${syncStatus.status}`);
  if (syncStatus.steps) {
    const completedSteps = syncStatus.steps.filter(s => s.status === "completed").length;
    console.log(`Steps completed: ${completedSteps}/${syncStatus.steps.length}`);
  }
  
  await new Promise(resolve => setTimeout(resolve, 2000));
} while (syncStatus.status === "RUNNING");

if (syncStatus.status === "COMPLETED") {
  console.log("Knowledge sync completed successfully");
} else {
  console.error("Knowledge sync failed:", syncStatus.error_message);
}
```

## Temporal Workflow Management Patterns

### Workflow Cancellation
```typescript
// Cancel a running workflow
const cancelResult = await temporalService.cancelWorkflow({
  workflow_id: workflowId,
  run_id: runId,
  reason: "User requested cancellation"
});

if (cancelResult.success) {
  console.log("Workflow cancelled successfully");
} else {
  console.error("Failed to cancel workflow:", cancelResult.message);
}
```

### Workflow History and Debugging
```typescript
// Get detailed workflow history for debugging
const workflowHistory = await temporalService.getWorkflowHistory({
  workflow_id: workflowId,
  run_id: runId
});

workflowHistory.events.forEach(event => {
  console.log(`${event.timestamp}: ${event.event_type}`);
  if (event.details) {
    console.log(`  Details: ${JSON.stringify(event.details)}`);
  }
});
```

### Bulk Workflow Operations
```typescript
// Start multiple workflows in parallel
const workflowRequests = repositories.map(repo => ({
  workspace_id: workspace.metadata.id,
  user_id: currentUser.id,
  schema_id: repo.primary_schema_id,
  target_languages: ["typescript", "go"],
  options: {
    include_tests: true,
    output_format: "git_branch"
  }
}));

const workflows = await Promise.all(
  workflowRequests.map(request => 
    temporalService.startCodeGeneration(request)
  )
);

console.log(`Started ${workflows.length} code generation workflows`);

// Monitor all workflows
const monitorAllWorkflows = async (workflows: any[]) => {
  const workflowStatuses = new Map();
  
  while (workflowStatuses.size < workflows.length) {
    for (const workflow of workflows) {
      if (workflowStatuses.has(workflow.workflow_id)) continue;
      
      const status = await temporalService.getWorkflowStatus({
        workflow_id: workflow.workflow_id,
        run_id: workflow.run_id
      });
      
      if (status.status === "COMPLETED" || status.status === "FAILED") {
        workflowStatuses.set(workflow.workflow_id, status);
        console.log(`Workflow ${workflow.workflow_id}: ${status.status}`);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  console.log("All workflows completed");
};

await monitorAllWorkflows(workflows);
```

## Common Patterns and Best Practices

### Error Handling
```typescript
try {
  const result = await repositoryService.createRepository(request);
  return result;
} catch (error) {
  if (error.code === 'VALIDATION_FAILED') {
    console.error('Validation errors:', error.details);
  } else if (error.code === 'TEMPLATE_NOT_FOUND') {
    console.error('Template does not exist:', request.template_id);
  }
  throw error;
}
```

### Pagination
```typescript
// Handle paginated results
let page = 1;
const allRepos = [];

while (true) {
  const response = await repositoryService.listRepositories({
    workspace_id: workspace.metadata.id,
    pagination: { page, size: 50 }
  });
  
  allRepos.push(...response.repositories);
  
  if (!response.pagination.has_next) {
    break;
  }
  
  page++;
}
```

### Search and Filtering
```typescript
// Complex search with multiple filters
const searchResults = await apiCatalogService.searchSchemas({
  workspace_id: workspace.metadata.id,
  query: "user authentication",
  schema_types: ["OPENAPI", "GRAPHQL"],
  tags: ["v1", "stable"],
  pagination: { page: 1, size: 20 }
});

// Filter by multiple criteria
const filteredRepos = await repositoryService.listRepositories({
  workspace_id: workspace.metadata.id,
  filters: [
    { field: "type", operator: "IN", values: ["service", "library"] },
    { field: "visibility", operator: "EQUALS", values: ["internal"] },
    { field: "created_at", operator: "GREATER_THAN", values: ["2025-01-01"] }
  ],
  sort: [
    { field: "updated_at", order: "DESC" }
  ]
});
```

## Integration Checklist

### Before Going to Production

- [ ] All repositories have proper documentation
- [ ] API schemas are published and validated
- [ ] Dependencies are properly mapped
- [ ] Knowledge base is populated with runbooks
- [ ] Access controls are configured
- [ ] Monitoring and alerting is set up
- [ ] Backup and disaster recovery plans are documented
- [ ] Temporal workflows are tested and monitored
- [ ] Workflow schedules are configured for automated tasks
- [ ] Workflow failure and retry policies are defined

### Ongoing Maintenance

- [ ] Regular dependency updates
- [ ] API schema versioning strategy
- [ ] Documentation reviews and updates
- [ ] Template improvements and new template creation
- [ ] User feedback collection and implementation
- [ ] Performance monitoring and optimization
- [ ] Temporal workflow performance optimization
- [ ] Workflow schedule adjustments based on usage patterns
- [ ] Workflow history cleanup and archival