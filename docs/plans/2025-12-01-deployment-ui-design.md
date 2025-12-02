# Deployment UI Design

**Date**: 2025-12-01
**Status**: Design Complete
**Author**: Claude + Drew

## Overview

This document describes the UI implementation for Orbit's deployment generators feature, enabling users to create, configure, and execute deployments with progress tracking and generated file management.

## User Flow

```
1. CREATE DEPLOYMENT
   - User clicks "Add Deployment" on App detail page
   - Modal shows generator dropdown (fetched from DeploymentGenerators collection)
   - Form fields render dynamically based on generator's configSchema
   - Click "Create" saves record with status: "pending"

2. DEPLOYMENTS TABLE
   - Shows all deployments for the app
   - Each row has actions: Deploy, Edit, Delete
   - Status badges: pending (gray), deploying (blue), generated (purple), deployed (green), failed (red)

3. DEPLOY ACTION
   - User clicks "Deploy" button on a pending deployment
   - Workflow starts, row expands to show progress panel
   - Progress panel polls every 2-3 seconds showing step indicator

4. GENERATE MODE COMPLETE
   - When status = "generated", show generated files preview
   - Syntax-highlighted code with copy button
   - Commit form: branch selector + new branch option + commit message
   - User controls when/if to commit to repository

5. EXECUTE MODE COMPLETE
   - When status = "deployed", show success with endpoint URL
   - Health monitoring begins automatically

6. ERROR HANDLING
   - Toast notification on failure
   - Status badge updates to "failed"
   - Error details shown in expanded panel
   - Retry button to restart workflow
```

## Component Architecture

```
AppDetail.tsx (existing)
├── DeploymentsSection.tsx (new wrapper)
│   ├── DeploymentsTable.tsx (refactored)
│   │   └── DeploymentRow.tsx (new)
│   │       ├── DeploymentActions.tsx (Deploy, Edit, Delete buttons)
│   │       └── DeploymentProgressPanel.tsx (expandable)
│   │           ├── ProgressSteps.tsx (step indicator)
│   │           ├── GeneratedFilesView.tsx (code preview + copy)
│   │           └── CommitToRepoForm.tsx (branch select, message)
│   └── AddDeploymentModal.tsx (enhanced)
│       └── DynamicConfigForm.tsx (renders from JSON Schema)
```

### Component Responsibilities

| Component | Purpose |
|-----------|---------|
| `DeploymentsSection` | Wrapper managing deployments state and refresh |
| `DeploymentsTable` | Table layout with headers |
| `DeploymentRow` | Single row, manages expand/collapse state |
| `DeploymentActions` | Deploy, Edit, Delete buttons with loading states |
| `DeploymentProgressPanel` | Expandable panel, polls progress, shows content |
| `ProgressSteps` | Visual step indicator with progress bar |
| `GeneratedFilesView` | Syntax-highlighted code preview, copy button |
| `CommitToRepoForm` | Branch dropdown, new branch input, commit message, submit |
| `DynamicConfigForm` | Renders form fields from generator's JSON Schema |

### State Management

- **Row expansion**: Local component state in `DeploymentRow`
- **Progress polling**: `useEffect` with `setInterval` while expanded AND workflow running
- **Generated files**: Fetched from deployment record when status = "generated"
- **Branch list**: Fetched on-demand when commit form opens

## Server Actions

### Existing (Enhanced)

```typescript
// Creates deployment record, returns deploymentId
createDeployment(input: CreateDeploymentInput): Promise<{ success: boolean; deploymentId?: string; error?: string }>

// Starts workflow, returns workflowId
startDeployment(deploymentId: string): Promise<{ success: boolean; workflowId?: string; error?: string }>

// Polls workflow progress (already built)
getDeploymentWorkflowProgress(workflowId: string): Promise<ProgressResponse>
```

### New Actions Needed

```typescript
// Fetches available generators from DeploymentGenerators collection
getDeploymentGenerators(): Promise<{ success: boolean; generators: Generator[] }>

// Fetches generated files from deployment record
getGeneratedFiles(deploymentId: string): Promise<{ success: boolean; files: GeneratedFile[] }>

// Commits files to repo with user-specified branch and message
commitGeneratedFiles(input: {
  deploymentId: string
  branch: string
  newBranch?: string  // If creating new branch
  message: string
}): Promise<{ success: boolean; commitSha?: string; error?: string }>

// Fetches branches for branch selector
getRepoBranches(appId: string): Promise<{ success: boolean; branches: string[] }>
```

## Data Flow

### Deploy Action Flow

```
User clicks [Deploy]
       ↓
startDeployment(deploymentId)
       ↓
Returns { workflowId, success }
       ↓
UI expands row, starts polling getDeploymentWorkflowProgress(workflowId)
       ↓
Poll response: { currentStep, stepsTotal, stepsCurrent, message, status }
       ↓
Display progress in ProgressSteps component
       ↓
When status = "generated":
  - Stop polling
  - Fetch generated files
  - Show GeneratedFilesView + CommitToRepoForm
       ↓
When status = "deployed":
  - Stop polling
  - Show success with endpoint URL
       ↓
When status = "failed":
  - Stop polling
  - Show toast error
  - Display error details in panel
```

### Commit Flow

```
User fills CommitToRepoForm
       ↓
Click "Commit to Repository"
       ↓
commitGeneratedFiles({ deploymentId, branch, message })
       ↓
Success: Show toast, update UI to show commit SHA
Failure: Show toast error, form stays visible for retry
```

## Backend Changes Required

### Workflow Modification

Current behavior: `CommitToRepo` activity auto-commits in generate mode.

New behavior:
1. Generate mode returns files WITHOUT committing
2. Files stored in deployment record (new `generatedFiles` field)
3. Commit happens separately via `commitGeneratedFiles` action

### Deployment Collection Update

Add field to store generated files:

```typescript
{
  name: 'generatedFiles',
  type: 'json',
  admin: {
    description: 'Generated deployment files awaiting commit'
  }
}
```

### New gRPC Endpoint

Add `CommitDeploymentFiles` RPC to DeploymentService:

```protobuf
rpc CommitDeploymentFiles(CommitDeploymentFilesRequest) returns (CommitDeploymentFilesResponse);

message CommitDeploymentFilesRequest {
  string deployment_id = 1;
  string app_id = 2;
  string branch = 3;
  string new_branch = 4;  // Optional - if creating new branch
  string commit_message = 5;
  repeated GeneratedFile files = 6;
}

message CommitDeploymentFilesResponse {
  bool success = 1;
  string commit_sha = 2;
  string error = 3;
}
```

## Error Handling

| Scenario | Detection | UI Response |
|----------|-----------|-------------|
| Workflow fails to start | `startDeployment` returns `success: false` | Toast error, status stays "pending" |
| Workflow step fails | Progress poll returns `status: "failed"` | Toast error, panel shows error message |
| Network error during poll | Fetch throws exception | Retry 3x with backoff, then show "Connection lost" |
| Commit to repo fails | `commitGeneratedFiles` returns error | Toast error, keep files visible for retry |
| Invalid generator config | Zod validation fails | Inline form errors |

### Retry Behavior

- Failed deployments show "Retry" button to restart workflow
- Generated files persist until new deploy overwrites them
- Commit can be retried without re-running workflow

## Status Badge Colors

```typescript
const deploymentStatusColors = {
  pending: 'bg-gray-100 text-gray-800',
  deploying: 'bg-blue-100 text-blue-800',
  generated: 'bg-purple-100 text-purple-800',  // NEW
  deployed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}
```

## Polling Strategy

**Initial implementation**: Client-side polling
- Poll interval: 2 seconds while workflow running
- Stop conditions: status is "generated", "deployed", or "failed"
- Only poll when row is expanded

**Future enhancement**: Server-Sent Events (SSE)
- More efficient for real-time updates
- Reduces server load from polling
- Better UX with instant updates

## UI Mockups

### Deployments Table with Expanded Row

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Deployments                                          [+ Add Deployment] │
├─────────────────────────────────────────────────────────────────────────┤
│ Name       │ Generator      │ Status     │ Actions                      │
├────────────┼────────────────┼────────────┼──────────────────────────────┤
│ production │ docker-compose │ ● pending  │ [▶ Deploy] [Edit] [Delete]   │
├────────────┼────────────────┼────────────┼──────────────────────────────┤
│ staging    │ docker-compose │ ● deploying│ [Deploying...]               │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Step 3 of 5: Generating deployment files                           │ │
│ │ [████████████████░░░░░░░░░░░░░░] 60%                                │ │
│ │                                                                     │ │
│ │ ✓ Validating configuration                                         │ │
│ │ ✓ Preparing workspace                                              │ │
│ │ ◉ Generating files...                                              │ │
│ │ ○ Finalizing                                                       │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
├────────────┼────────────────┼────────────┼──────────────────────────────┤
│ dev        │ docker-compose │ ● generated│ [View Files] [Edit] [Delete] │
└─────────────────────────────────────────────────────────────────────────┘
```

### Generated Files Panel

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Generated Files                                              [Collapse] │
├─────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ docker-compose.yml                                          [Copy] │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │ version: '3.8'                                                     │ │
│ │                                                                     │ │
│ │ services:                                                          │ │
│ │   my-app:                                                          │ │
│ │     image: ghcr.io/org/app:latest                                  │ │
│ │     ports:                                                         │ │
│ │       - "3000:3000"                                                │ │
│ │     restart: unless-stopped                                        │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ Commit to Repository                                                    │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Branch: [main                    ▼] ☐ Create new branch            │ │
│ │ Message: [chore: add docker-compose deployment config            ] │ │
│ │                                                                     │ │
│ │                                              [Commit to Repository] │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Core Table Refactor
- [ ] Create DeploymentRow component with expand/collapse
- [ ] Add DeploymentActions component (Deploy, Edit, Delete)
- [ ] Update status badge colors (add 'generated')
- [ ] Wire Deploy button to startDeployment action

### Phase 2: Progress Panel
- [ ] Create DeploymentProgressPanel component
- [ ] Create ProgressSteps component
- [ ] Implement polling logic with useEffect
- [ ] Handle completion states (generated, deployed, failed)

### Phase 3: Generated Files View
- [ ] Create GeneratedFilesView component
- [ ] Add syntax highlighting (use existing code component or add prism/shiki)
- [ ] Implement copy to clipboard
- [ ] Add getGeneratedFiles server action

### Phase 4: Commit Form
- [ ] Create CommitToRepoForm component
- [ ] Add getRepoBranches server action
- [ ] Add commitGeneratedFiles server action
- [ ] Implement new branch creation option

### Phase 5: Dynamic Generator Form
- [ ] Add getDeploymentGenerators server action
- [ ] Create DynamicConfigForm component
- [ ] Update AddDeploymentModal to fetch generators
- [ ] Render form fields from JSON Schema

### Phase 6: Backend Adjustments
- [ ] Modify workflow to not auto-commit in generate mode
- [ ] Add generatedFiles field to Deployments collection
- [ ] Add CommitDeploymentFiles gRPC endpoint
- [ ] Implement file commit activity

### Phase 7: Error Handling & Polish
- [ ] Add toast notifications
- [ ] Implement retry logic for polling
- [ ] Add loading states throughout
- [ ] Handle edge cases (empty states, network errors)

## Dependencies

- shadcn/ui components (already installed)
- react-syntax-highlighter or similar for code preview
- Existing toast system for notifications

## Future Enhancements

- Server-Sent Events for real-time progress updates
- Diff view for re-generated files
- Deployment history timeline
- Rollback to previous deployment
- Multi-file preview with tabs
