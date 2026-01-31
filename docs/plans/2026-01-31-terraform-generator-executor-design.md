# Terraform Generator & Executor Design

**Date**: 2026-01-31  
**Status**: Design Complete  
**Authors**: Drew + Claude

---

## Overview

A provider-agnostic Terraform runner. Users bring their own `.tf` files and cloud credentials. Orbit handles execution, state coordination, and approval workflows.

This establishes the Generator/Executor pattern that maps cleanly to Terraform's plan/apply workflow.

## Key Concepts

| Orbit Layer | Terraform Action | Output |
|-------------|-----------------|--------|
| **Generator** | `terraform plan` | Plan file + diff preview |
| **Executor** | `terraform apply` | Deployed infrastructure + outputs |

### Orbit's Responsibilities
- Clone repo, navigate to Terraform directory
- Inject cloud credentials (encrypted, stored in Orbit)
- Run `terraform init`, `plan`, `apply`, `destroy`
- Display plan diff for approval
- Store outputs on deployment record

### User's Responsibilities
- Provide `.tf` files in their repo
- Configure backend for state (S3, GCS, Terraform Cloud, etc.)
- Provide cloud credentials to Orbit
- Review and approve plans before apply

## State Management

**Approach: User-provided backend**

Users configure their own Terraform backend in their `.tf` files. Orbit just runs the commands.

Example backend configurations:

```hcl
# AWS S3 backend
terraform {
  backend "s3" {
    bucket         = "my-company-terraform-state"
    key            = "apps/my-app/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}

# GCP GCS backend
terraform {
  backend "gcs" {
    bucket = "my-company-terraform-state"
    prefix = "apps/my-app"
  }
}

# Terraform Cloud
terraform {
  cloud {
    organization = "my-org"
    workspaces { name = "my-app-prod" }
  }
}
```

This keeps Orbit simple — we're a runner, not a state host. Users already know how to set up backends.

## Cloud Credentials

### Storage

New `CloudCredentials` collection stores encrypted credentials per workspace.

```typescript
// orbit-www/src/collections/CloudCredentials.ts
{
  slug: 'cloud-credentials',
  fields: [
    { name: 'name', type: 'text', required: true },  // "AWS Production"
    { 
      name: 'provider', 
      type: 'select',
      options: [
        { label: 'AWS', value: 'aws' },
        { label: 'GCP', value: 'gcp' },
        { label: 'Azure', value: 'azure' },
      ]
    },
    { name: 'workspace', type: 'relationship', relationTo: 'workspaces' },
    
    // AWS (encrypted)
    { name: 'awsAccessKeyId', type: 'text' },
    { name: 'awsSecretAccessKey', type: 'text' },
    { name: 'awsRegion', type: 'text' },
    
    // GCP (encrypted)
    { name: 'gcpServiceAccountJson', type: 'json' },
    { name: 'gcpProject', type: 'text' },
    
    // Azure (encrypted)
    { name: 'azureClientId', type: 'text' },
    { name: 'azureClientSecret', type: 'text' },
    { name: 'azureTenantId', type: 'text' },
    { name: 'azureSubscriptionId', type: 'text' },
  ]
}
```

### Encryption Requirements

**CRITICAL:** All credential fields use Orbit's existing AES-256-GCM encryption service (`orbit-www/src/lib/encryption/`). Same pattern as:
- `EnvironmentVariables` — encrypts `value` field via `beforeChange` hook
- `RegistryConfigs` — encrypts `ghcrPat` and `acrToken`
- `GitHubInstallations` — encrypts refresh tokens

```typescript
// CloudCredentials.ts - hooks
hooks: {
  beforeChange: [
    async ({ data, req }) => {
      if (data.awsSecretAccessKey) {
        data.awsSecretAccessKey = await encrypt(data.awsSecretAccessKey)
      }
      if (data.gcpServiceAccountJson) {
        data.gcpServiceAccountJson = await encrypt(JSON.stringify(data.gcpServiceAccountJson))
      }
      // ... same for Azure fields
      return data
    }
  ]
}
```

**Raw values are NEVER:**
- Stored unencrypted in database
- Logged in Temporal history
- Returned to frontend (API strips encrypted fields)
- Visible in Payload admin UI (shows `••••••••`)

### Environment Variable Injection

| Provider | Env Vars Set |
|----------|--------------|
| AWS | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| GCP | `GOOGLE_APPLICATION_CREDENTIALS` (write JSON to temp file) |
| Azure | `ARM_CLIENT_ID`, `ARM_CLIENT_SECRET`, `ARM_TENANT_ID`, `ARM_SUBSCRIPTION_ID` |

### Access Control
- Scoped to workspace
- Only workspace admins can create/edit
- Members can use (select in deployment) but not view raw values

## User Flow

### Prerequisites Check
- App must have linked GitHub repository
- Workspace must have at least one cloud credential configured
- If either missing, show guidance instead of form

### Create Deployment

**Step 1: Configure**
```
┌────────────────────────────────────────────────────┐
│ Repository: drewpayment/my-app ✓                   │
│                                                    │
│ Name:                [prod-infra               ]   │
│ Terraform Directory: [infrastructure/          ]   │
│ Cloud Credential:    [AWS Production          ▾]   │
│ Terraform Workspace: [default                  ]   │
│                                                    │
│ [▸ Variable Overrides]                            │
│   image_tag    = v1.2.3                           │
│   environment  = production                        │
│   + Add variable                                   │
│                                                    │
│ [Cancel]                         [Generate Plan]   │
└────────────────────────────────────────────────────┘
```

**Step 2: Review Plan**
```
┌─────────────────────────────────────────────────────┐
│ Plan Summary                                        │
│  +3 Add  |  ~1 Change  |  -0 Destroy               │
│                                                     │
│ Resources:                                          │
│  + aws_ecs_service.app                             │
│  + aws_ecs_task_definition.app                     │
│  ~ aws_security_group.app                          │
│                                                     │
│ [▾ Show full output]                               │
│                                                     │
│ [Cancel]                        [Approve & Apply]   │
└─────────────────────────────────────────────────────┘
```

**Step 3: Complete**
```
┌─────────────────────────────────────────────────────┐
│ ✓ Deployment Complete                               │
│                                                     │
│ Outputs:                                            │
│  url         = https://my-app.elb.amazonaws.com    │
│  cluster_arn = arn:aws:ecs:...                     │
│                                                     │
│ [View Details]                          [Done]      │
└─────────────────────────────────────────────────────┘
```

## Variable Handling

**Hybrid approach:**
- Base config lives in repo (`terraform.tfvars`, version controlled)
- Orbit injects deployment-specific vars via `-var` flags
- Keeps sensitive values out of repo

```
Advanced Settings:
┌────────────────────────────────────────────────────┐
│ Variable Overrides:                                │
│ ┌────────────────┬───────────────────────────────┐│
│ │ image_tag      │ v1.2.3                        ││
│ │ environment    │ production                    ││
│ │ + Add variable                                 ││
│ └────────────────┴───────────────────────────────┘│
└────────────────────────────────────────────────────┘
```

Orbit passes: `terraform apply -var="image_tag=v1.2.3" -var="environment=production"`

## Plan/Apply Output Display

**Combined approach:** Summary at top, expandable raw logs below.

```
┌─────────────────────────────────────────────────────────┐
│ Plan Summary                                            │
│ ┌─────────┬──────────┬───────────┐                     │
│ │ +3 Add  │ ~1 Change│ -0 Destroy│                     │
│ └─────────┴──────────┴───────────┘                     │
│                                                         │
│ Resources:                                              │
│  + aws_ecs_service.app                                 │
│  + aws_ecs_task_definition.app                         │
│  + aws_lb_target_group.app                             │
│  ~ aws_security_group.app (ingress rules)              │
│                                                         │
│ [▾ Show full plan output]                              │
│ ┌─────────────────────────────────────────────────────┐│
│ │ Terraform will perform the following actions:       ││
│ │ ...                                                 ││
│ └─────────────────────────────────────────────────────┘│
│                                                         │
│ [Cancel]                              [Approve & Apply] │
└─────────────────────────────────────────────────────────┘
```

## Terraform Outputs

After successful apply:
- Display outputs in success panel
- Store outputs on deployment record in Payload
- Queryable via API for automation

```
Deployment Complete ✓
┌─────────────────────────────────────────────────────────┐
│ Outputs:                                                │
│ ┌────────────────┬────────────────────────────────────┐│
│ │ url            │ https://my-app.us-east-1.elb.aws   ││
│ │ db_endpoint    │ my-db.xxxxx.us-east-1.rds.aws      ││
│ │ cluster_arn    │ arn:aws:ecs:us-east-1:123:cluster  ││
│ └────────────────┴────────────────────────────────────┘│
│                                                         │
│ Stored on deployment record for API access.            │
└─────────────────────────────────────────────────────────┘
```

## Destroy Flow

Explicit "Destroy" action on deployment detail page. Same plan → approve → execute flow.

```
Deployment Actions:
┌─────────────────────────┐
│ [Re-plan]  [Destroy ⚠️] │
└─────────────────────────┘
```

Destroy runs:
1. `terraform plan -destroy` → shows resources to be destroyed
2. User reviews and confirms
3. `terraform destroy` executes

Deployment record is preserved for history even after infrastructure is destroyed.

## Technical Architecture

### Execution Environment

Terraform runs **directly on Temporal Worker** (no Docker container).

- Worker has Terraform CLI installed
- Worker has cloud provider CLIs (aws, gcloud, az) for auth helpers
- Activities spawn `terraform` as subprocess

```go
func (a *TerraformActivities) RunPlan(ctx context.Context, input PlanInput) (*PlanResult, error) {
    cmd := exec.CommandContext(ctx, "terraform", "plan", "-out=plan.tfplan", "-no-color")
    cmd.Dir = input.WorkDir
    cmd.Env = input.Credentials  // AWS_ACCESS_KEY_ID, etc.
    
    output, err := cmd.CombinedOutput()
    // Parse output, return summary + plan file location
}
```

### Temporal Workflow

```
TerraformDeploymentWorkflow
│
├─ 1. ValidatePrerequisites
│     └─ Check repo linked, credentials exist
│
├─ 2. CloneRepository
│     └─ Clone app's repo to temp working directory
│
├─ 3. InjectCredentials
│     └─ Decrypt cloud creds, set as env vars
│
├─ 4. RunTerraformInit
│     └─ exec: terraform init
│
├─ 5. RunTerraformPlan
│     └─ exec: terraform plan -out=plan.tfplan
│     └─ Parse output for summary (add/change/destroy counts)
│     └─ Store plan file path, update status to "awaiting_approval"
│
├─ ⏸️  WAIT FOR SIGNAL (ApproveApply or Cancel)
│
├─ 6. RunTerraformApply
│     └─ exec: terraform apply plan.tfplan
│     └─ Capture outputs
│
└─ 7. UpdateDeploymentRecord
      └─ Store outputs, set status to "deployed"
```

**Destroy workflow:** Same pattern with `terraform plan -destroy` → approval signal → `terraform destroy`

### Components

| Layer | Component | Responsibility |
|-------|-----------|----------------|
| UI | `AddDeploymentModal` | Collect user input |
| UI | `TerraformPlanView` | Display plan diff + approval |
| UI | `DeploymentDetailPage` | Show status, outputs, actions |
| Server Action | `deployments.ts` | Validate input, trigger workflow |
| Temporal Workflow | `TerraformDeploymentWorkflow` | Orchestrate plan/apply |
| Temporal Activities | `TerraformActivities` | Run terraform commands |
| Collection | `CloudCredentials` | Store encrypted cloud creds |

## Implementation Tasks

### Phase 1: Foundation — 3-4 days

1. **Create `CloudCredentials` collection**
   - Fields for AWS, GCP, Azure
   - Encryption hooks (same pattern as EnvironmentVariables)
   - Access control (workspace-scoped, admin-only edit)

2. **Create credentials management UI**
   - Workspace Settings → Cloud Credentials page
   - Add/edit/delete credentials
   - Provider-specific field visibility

3. **Update Temporal worker**
   - Install Terraform CLI in worker image
   - Install cloud provider CLIs

### Phase 2: Terraform Activities — 3-4 days

1. **Implement `TerraformActivities`**
   - `CloneRepository` — reuse existing git clone logic
   - `RunTerraformInit` — exec terraform init
   - `RunTerraformPlan` — exec plan, parse output
   - `RunTerraformApply` — exec apply, capture outputs
   - `RunTerraformDestroy` — exec destroy

2. **Implement `TerraformDeploymentWorkflow`**
   - Orchestrate activities
   - Wait for approval signal between plan and apply
   - Handle cancellation

### Phase 3: Frontend — 3-4 days

1. **Update `AddDeploymentModal`**
   - Terraform-specific fields (directory, credential selector, workspace)
   - Variable overrides section
   - Prerequisite checks (repo linked, creds exist)

2. **Create `TerraformPlanView` component**
   - Parse and display plan summary
   - Expandable raw output
   - Approve/Cancel buttons that send workflow signals

3. **Update `DeploymentDetailPage`**
   - Show Terraform outputs
   - Re-plan and Destroy actions

### Phase 4: Polish — 2-3 days

1. **Error handling** — surface Terraform errors clearly
2. **Plan parsing** — extract add/change/destroy counts reliably
3. **Tests** — unit tests for activities, integration test for workflow
4. **Docs** — user guide for connecting credentials and configuring backends

## Estimated Effort

~2 weeks total

## Future Considerations

- **Assume Role / Workload Identity** — more secure credential option for enterprise
- **Orbit-managed state backend** — convenience feature, Orbit provisions backend per workspace
- **Drift detection** — scheduled plans to detect infrastructure drift
- **Cost estimation** — integrate with Infracost for plan cost preview
