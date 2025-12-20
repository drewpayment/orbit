# GitHub App Repository Integration Design

**Created**: 2025-11-18
**Status**: Design Complete - Ready for Implementation Planning

---

## Overview

Integrate GitHub App installation tokens with the repository creation workflow to enable end-to-end repository deployment from templates to GitHub. This design replaces the originally planned user OAuth approach with the GitHub App installation pattern.

**Goal**: Enable the complete workflow: Clone template → Apply variables → Initialize git → Create GitHub repo (optional) → Push to GitHub using GitHub App installation tokens.

---

## Requirements Summary

From brainstorming session:

1. **Primary Use Case**: Create new repositories from templates with full end-to-end flow
2. **Repository Creation**: Support both creating new GitHub repos via API and pushing to existing repos
3. **Organization Selection**: Smart default (first available) with optional override parameter
4. **Authentication Strategy**: Replace user OAuth entirely with GitHub App installation tokens
5. **Error Handling**: Fail fast with clear, actionable error messages directing users to admin configuration

---

## Architecture Decision

**Chosen Approach**: Hybrid - GitHub Service Dependency

Create a dedicated `GitHubService` that handles all GitHub App installation integration logic. Activities depend on this service for GitHub operations but remain focused on their core responsibilities (git CLI operations).

**Rationale**:
- **Separation of Concerns**: GitHub integration logic isolated from git operations
- **Reusability**: Service can be used by other activities/workflows in the future
- **Testability**: Easy to mock service for activity tests
- **Maintainability**: Clear boundary between GitHub API and git CLI operations

**Alternatives Considered**:
1. ❌ Minimal Changes - Inline installation lookup in activities (too coupled)
2. ❌ Dedicated GitHub Integration Activity - Creates workflow overhead with extra activity

---

## Component Architecture

### New Components

**`temporal-workflows/internal/services/github_service.go`**
- Core GitHub App installation integration service
- Handles installation lookup, token decryption, repo creation
- Interfaces with Payload, Encryption, and GitHub API

**`temporal-workflows/internal/services/github_service_test.go`**
- Comprehensive unit tests with mocked dependencies
- Test coverage target: 80%+

### Modified Components

**`temporal-workflows/internal/activities/git_activities.go`**
- Add `GitHubService` dependency to constructor
- Add new `PrepareGitHubRemoteActivity`
- Modify `PushToRemoteActivity` to accept explicit credentials
- Remove all user OAuth references

**`temporal-workflows/internal/workflows/repository_workflow.go`**
- Update `RepositoryWorkflowInput` struct
- Add new activity execution: `PrepareGitHubRemoteActivity`
- Pass credentials to `PushToRemoteActivity`

**`temporal-workflows/cmd/worker/main.go`**
- Register new `PrepareGitHubRemoteActivity`

### Dependencies

**Existing Interfaces** (already defined in GitHub App plan):
- `PayloadClient` - Query github-installations collection
- `EncryptionService` - Decrypt installation tokens

**New Dependency**:
- GitHub API client library (Go) - For repository creation via REST API v3

---

## Data Flow

### Workflow Input Structure

```go
type RepositoryWorkflowInput struct {
    RepositoryID          string
    WorkspaceID           string   // REQUIRED - for GitHub installation lookup
    GitHubInstallationID  string   // OPTIONAL - override default installation
    TemplateName          string
    Variables             map[string]string
    GitURL                string   // OPTIONAL - if empty, create repo in GitHub
    RepositoryName        string   // REQUIRED if creating repo (used for GitHub repo name)
}
```

### Activity Execution Sequence

1. **CloneTemplateActivity** (unchanged)
   - Clones template repository locally

2. **ApplyVariablesActivity** (unchanged)
   - Substitutes `{{variable}}` placeholders in template files

3. **InitializeGitActivity** (modified)
   - Initializes git repository with "Orbit IDP Bot" identity
   - Commits all files with attribution

4. **PrepareGitHubRemoteActivity** (NEW)
   - Input: `WorkspaceID`, optional `GitHubInstallationID`, optional `GitURL`, optional `RepositoryName`
   - Calls `GitHubService.PrepareRemote()`
   - Returns: `GitURL`, `AccessToken`, `InstallationInfo`
   - Creates GitHub repo if `GitURL` is empty

5. **PushToRemoteActivity** (modified)
   - Input: `RepositoryID`, `GitURL`, `AccessToken`
   - Uses provided token for git authentication
   - Pushes to remote using credential helper

### Data Flow Diagram

```
Workflow
  └─> PrepareGitHubRemoteActivity
      └─> GitHubService.PrepareRemote()
          ├─> PayloadClient.Find() → Query github-installations
          ├─> EncryptionService.Decrypt() → Decrypt token
          └─> (Optional) GitHubAPI.CreateRepo() → Create repo
      ← Returns: GitURL, AccessToken
  └─> PushToRemoteActivity
      └─> Git CLI with AccessToken → Push to GitHub
```

---

## GitHub Service Interface

### Service Interface Definition

```go
// GitHubService handles GitHub App installation integration
type GitHubService interface {
    // FindInstallationForWorkspace finds an active GitHub installation
    // allowed for the given workspace. If installationID provided, uses that.
    // If not, uses first available installation.
    FindInstallationForWorkspace(
        ctx context.Context,
        workspaceID string,
        installationID *string,
    ) (*Installation, error)

    // GetInstallationToken decrypts and returns the access token
    GetInstallationToken(
        ctx context.Context,
        installation *Installation,
    ) (string, error)

    // CreateRepository creates a new GitHub repository in the installation's org
    // Returns the git clone URL (https://github.com/org/repo.git)
    CreateRepository(
        ctx context.Context,
        token string,
        orgName string,
        repoName string,
        private bool,
    ) (string, error)

    // PrepareRemote is a convenience method that orchestrates the above:
    // 1. Find installation for workspace
    // 2. Get decrypted token
    // 3. Optionally create repo if gitURL is empty
    // Returns git URL and access token ready for push
    PrepareRemote(
        ctx context.Context,
        input PrepareRemoteInput,
    ) (*PrepareRemoteOutput, error)
}
```

### Data Structures

```go
type PrepareRemoteInput struct {
    WorkspaceID          string
    GitHubInstallationID *string  // Optional override
    GitURL               string   // If empty, create repo
    RepositoryName       string   // Required if creating repo
    Private              bool     // Default true for created repos
}

type PrepareRemoteOutput struct {
    GitURL              string   // HTTPS git clone URL
    AccessToken         string   // Decrypted installation token
    InstallationOrgName string   // GitHub org name (for logging)
    CreatedRepo         bool     // True if repo was created by this call
}

type Installation struct {
    ID                  string    // Payload document ID
    InstallationID      int64     // GitHub installation ID
    AccountLogin        string    // GitHub org name
    EncryptedToken      string    // Encrypted access token
    TokenExpiresAt      time.Time // Token expiration
}
```

### Implementation Details

**Installation Lookup Logic**:
1. Query Payload: `collection='github-installations'`, `where={allowedWorkspaces contains workspaceID, status='active'}`
2. If `installationID` provided: Filter to that specific ID, error if not found
3. If not provided: Use first result (smart default)
4. If no results: Return clear error directing user to admin

**Token Validation**:
- Check `TokenExpiresAt` against current time
- If expired: Return error (token refresh workflow handles this)
- Normal case: Token refresh workflow keeps tokens fresh

**Repository Creation**:
- Use GitHub REST API v3: `POST /orgs/{org}/repos`
- Request body: `{"name": repoName, "private": private, "auto_init": false}`
- Handle 422 error (name conflict) with clear error message
- Return HTTPS clone URL: `https://github.com/{org}/{repoName}.git`

---

## Activity Updates

### GitActivities Constructor

```go
type GitActivities struct {
    workDir       string
    githubService GitHubService  // NEW dependency
    logger        *slog.Logger
}

func NewGitActivities(
    workDir string,
    githubService GitHubService,
    logger *slog.Logger,
) *GitActivities {
    return &GitActivities{
        workDir:       workDir,
        githubService: githubService,
        logger:        logger,
    }
}
```

### New Activity: PrepareGitHubRemoteActivity

```go
type PrepareGitHubRemoteInput struct {
    WorkspaceID          string
    GitHubInstallationID string  // Optional, empty string = use default
    GitURL               string  // Optional, empty string = create repo
    RepositoryName       string  // Required if GitURL empty
    Private              bool    // Default true
}

type PrepareGitHubRemoteOutput struct {
    GitURL              string
    AccessToken         string
    InstallationOrgName string
    CreatedRepo         bool
}

func (a *GitActivities) PrepareGitHubRemoteActivity(
    ctx context.Context,
    input PrepareGitHubRemoteInput,
) (*PrepareGitHubRemoteOutput, error) {
    // Validate inputs
    if input.WorkspaceID == "" {
        return nil, errors.New("workspace_id is required")
    }
    if input.GitURL == "" && input.RepositoryName == "" {
        return nil, errors.New("repository_name required when creating new repo (no git_url provided)")
    }

    // Call GitHub service
    serviceInput := services.PrepareRemoteInput{
        WorkspaceID:          input.WorkspaceID,
        GitHubInstallationID: nilIfEmpty(input.GitHubInstallationID),
        GitURL:               input.GitURL,
        RepositoryName:       input.RepositoryName,
        Private:              input.Private,
    }

    result, err := a.githubService.PrepareRemote(ctx, serviceInput)
    if err != nil {
        return nil, fmt.Errorf("failed to prepare GitHub remote: %w", err)
    }

    a.logger.Info("GitHub remote prepared",
        "gitURL", result.GitURL,
        "org", result.InstallationOrgName,
        "created", result.CreatedRepo,
    )

    return &PrepareGitHubRemoteOutput{
        GitURL:              result.GitURL,
        AccessToken:         result.AccessToken,
        InstallationOrgName: result.InstallationOrgName,
        CreatedRepo:         result.CreatedRepo,
    }, nil
}
```

### Modified Activity: PushToRemoteActivity

**OLD input struct** (from backend activities plan - NEVER IMPLEMENTED):
```go
// REMOVE THIS - user OAuth approach
type PushToRemoteInput struct {
    RepositoryID string
    UserID       string
    WorkspaceID  string
}
```

**NEW input struct**:
```go
type PushToRemoteInput struct {
    RepositoryID string
    GitURL       string      // Explicit remote URL
    AccessToken  string      // Explicit token (no lookup)
}
```

**Implementation changes**:
```go
func (a *GitActivities) PushToRemoteActivity(
    ctx context.Context,
    input PushToRemoteInput,
) error {
    // Validate inputs
    if input.RepositoryID == "" || input.GitURL == "" || input.AccessToken == "" {
        return errors.New("repository_id, git_url, and access_token are required")
    }

    repoPath := filepath.Join(a.workDir, input.RepositoryID)

    // Check if repository exists
    if _, err := os.Stat(repoPath); os.IsNotExist(err) {
        return errors.New("repository directory does not exist")
    }

    // Set or update remote URL
    cmd := exec.CommandContext(ctx, "git", "remote", "get-url", "origin")
    cmd.Dir = repoPath
    if err := cmd.Run(); err != nil {
        // Remote doesn't exist, add it
        cmd = exec.CommandContext(ctx, "git", "remote", "add", "origin", input.GitURL)
        cmd.Dir = repoPath
        if err := cmd.Run(); err != nil {
            return fmt.Errorf("failed to add remote: %w", err)
        }
    } else {
        // Remote exists, update URL
        cmd = exec.CommandContext(ctx, "git", "remote", "set-url", "origin", input.GitURL)
        cmd.Dir = repoPath
        if err := cmd.Run(); err != nil {
            return fmt.Errorf("failed to update remote URL: %w", err)
        }
    }

    // Create temporary credential helper script
    credHelper, err := a.createCredentialHelper(input.AccessToken)
    if err != nil {
        return fmt.Errorf("failed to create credential helper: %w", err)
    }
    defer os.Remove(credHelper)

    // Push to remote using installation token
    cmd = exec.CommandContext(ctx, "git", "push", "-u", "origin", "main")
    cmd.Dir = repoPath
    cmd.Env = append(os.Environ(), fmt.Sprintf("GIT_ASKPASS=%s", credHelper))

    output, err := cmd.CombinedOutput()
    if err != nil {
        // Check if already pushed (idempotency)
        if strings.Contains(string(output), "Everything up-to-date") {
            return nil
        }
        return fmt.Errorf("failed to push to remote: %w (output: %s)", err, string(output))
    }

    a.logger.Info("Successfully pushed to remote", "gitURL", input.GitURL)
    return nil
}

// createCredentialHelper creates a temporary script that provides the OAuth token
func (a *GitActivities) createCredentialHelper(token string) (string, error) {
    script := fmt.Sprintf("#!/bin/sh\necho %s", token)

    tmpFile, err := os.CreateTemp("", "git-cred-*.sh")
    if err != nil {
        return "", err
    }

    if err := os.WriteFile(tmpFile.Name(), []byte(script), 0700); err != nil {
        os.Remove(tmpFile.Name())
        return "", err
    }

    return tmpFile.Name(), nil
}
```

### Modified Activity: InitializeGitActivity

**Change git identity** (was already in plan, confirming):
```go
func (a *GitActivities) InitializeGitActivity(ctx context.Context, input InitializeGitInput) error {
    // ... existing init logic ...

    // Configure Git user as bot (NOT user identity)
    configName := exec.CommandContext(ctx, "git", "config", "user.name", "Orbit IDP")
    configName.Dir = repoPath
    if err := configName.Run(); err != nil {
        return fmt.Errorf("failed to configure git user.name: %w", err)
    }

    configEmail := exec.CommandContext(ctx, "git", "config", "user.email", "bot@orbit.dev")
    configEmail.Dir = repoPath
    if err := configEmail.Run(); err != nil {
        return fmt.Errorf("failed to configure git user.email: %w", err)
    }

    // ... rest of activity ...
}
```

---

## Error Handling

### Error Scenarios and Messages

**Scenario 1: No GitHub Installation Configured**
- **Where**: `GitHubService.FindInstallationForWorkspace()`
- **Error Message**:
  ```
  No active GitHub App installation found for workspace {workspaceID}.

  Please ask an admin to:
  1. Navigate to Settings → GitHub
  2. Install the Orbit IDP GitHub App
  3. Grant access to this workspace ({workspaceName})
  ```
- **HTTP Status** (if exposed via API): 424 Failed Dependency
- **Workflow Result**: Activity fails, workflow fails

**Scenario 2: Invalid Installation ID Override**
- **Where**: `GitHubService.FindInstallationForWorkspace()`
- **Error Message**:
  ```
  GitHub installation {installationID} not found or not allowed for workspace {workspaceID}.

  Available installations for this workspace:
  - {installationId1}: {orgName1}
  - {installationId2}: {orgName2}
  ```
- **Workflow Result**: Activity fails, workflow fails

**Scenario 3: Token Expired**
- **Where**: `GitHubService.GetInstallationToken()`
- **Check**: `if installation.TokenExpiresAt.Before(time.Now())`
- **Error Message**:
  ```
  GitHub installation token expired at {expiresAt}.

  The token refresh workflow should handle this automatically.

  If this error persists:
  1. Check Temporal UI for workflow: github-token-refresh:{installationId}
  2. Verify workflow status is "running"
  3. Check workflow logs for refresh failures
  ```
- **Workflow Result**: Activity fails, retries may help if refresh completes

**Scenario 4: Repository Name Conflict**
- **Where**: `GitHubService.CreateRepository()`
- **GitHub API Response**: 422 Unprocessable Entity
- **Error Message**:
  ```
  Repository '{orgName}/{repoName}' already exists in GitHub.

  Choose one:
  1. Use a different repository name
  2. Provide the existing repo's git URL: https://github.com/{orgName}/{repoName}.git
  ```
- **Workflow Result**: Activity fails, user must change input

**Scenario 5: GitHub API Rate Limit**
- **Where**: Any GitHub API call
- **GitHub API Response**: 429 Too Many Requests
- **Error Handling**: Extract rate limit reset time from headers
- **Error Message**:
  ```
  GitHub API rate limit exceeded.
  Limit resets at {resetTime}.

  Temporal will retry this activity automatically after the reset.
  ```
- **Workflow Result**: Activity fails, Temporal retries with backoff

**Scenario 6: GitHub API Unavailable**
- **Where**: Any GitHub API call
- **Error Type**: Network timeout, 5xx errors
- **Error Message**:
  ```
  GitHub API unavailable: {error}

  Temporal will retry this activity automatically.
  ```
- **Workflow Result**: Activity fails, Temporal retries with exponential backoff

### Error Context

All errors include contextual information for debugging:
- `workspaceID` - Which workspace triggered the workflow
- `installationID` - Which GitHub installation (if known)
- `repositoryName` - Requested repository name
- `orgName` - Target GitHub organization
- Timestamp and activity attempt number (from Temporal)

---

## Testing Strategy

### Unit Tests: GitHubService

**Mock Dependencies**:
```go
type MockPayloadClient struct {
    Installations []*Installation
    FindCalled    bool
    FindError     error
}

type MockEncryptionService struct {
    DecryptFunc func(string) (string, error)
}

type MockGitHubClient struct {
    CreateRepoFunc func(context.Context, string, string, bool) (string, error)
}
```

**Test Cases**:
1. `TestFindInstallationForWorkspace_Success` - Happy path, single installation
2. `TestFindInstallationForWorkspace_NotFound` - No installation for workspace
3. `TestFindInstallationForWorkspace_WithOverride` - Explicit installation ID provided
4. `TestFindInstallationForWorkspace_InvalidOverride` - Override ID not found
5. `TestFindInstallationForWorkspace_MultipleInstallations` - Multiple available, uses first
6. `TestGetInstallationToken_Success` - Decrypt token successfully
7. `TestGetInstallationToken_Expired` - Token expiration check
8. `TestGetInstallationToken_DecryptionFailed` - Decryption error handling
9. `TestCreateRepository_Success` - Create repo via API
10. `TestCreateRepository_NameConflict` - 422 error handling
11. `TestCreateRepository_RateLimit` - 429 error handling
12. `TestPrepareRemote_WithGitURL` - No repo creation path
13. `TestPrepareRemote_CreateRepo` - Full creation flow
14. `TestPrepareRemote_NoInstallation` - Error propagation

**Coverage Target**: 80%+ for `github_service.go`

### Integration Tests: Activities

**Setup**:
- Real `GitHubService` implementation
- Mocked `PayloadClient`, `EncryptionService`, `GitHubClient`
- Temporary directories for git operations

**Test Cases**:
1. `TestPrepareGitHubRemoteActivity_CreateRepo` - Full creation flow
2. `TestPrepareGitHubRemoteActivity_UseExistingURL` - Skip creation
3. `TestPrepareGitHubRemoteActivity_ValidationErrors` - Input validation
4. `TestPushToRemoteActivity_WithToken` - Push with explicit token
5. `TestPushToRemoteActivity_SetRemote` - Add remote if missing
6. `TestPushToRemoteActivity_UpdateRemote` - Update existing remote URL
7. `TestPushToRemoteActivity_Idempotency` - Second push succeeds

**Coverage Target**: 70%+ for activity implementations

### End-to-End Tests: Workflow

**Setup**:
- Temporal test environment
- Mocked external dependencies
- Real workflow execution

**Test Case**:
```go
func TestRepositoryWorkflow_E2E_CreateAndPush(t *testing.T) {
    // Setup test environment
    // Register activities with mocks
    // Execute workflow
    // Verify:
    //   - CloneTemplateActivity called
    //   - ApplyVariablesActivity called
    //   - InitializeGitActivity called
    //   - PrepareGitHubRemoteActivity called with correct inputs
    //   - GitHub repo creation called (mocked)
    //   - PushToRemoteActivity called with returned credentials
}
```

### Manual Testing Checklist

Before marking implementation complete, manually verify:

- [ ] Create test workspace with GitHub installation configured
- [ ] Run workflow without `gitURL` parameter
  - [ ] Verify repo created in GitHub org
  - [ ] Verify repo contains template files with variables applied
  - [ ] Verify commits authored by "Orbit IDP Bot"
- [ ] Run workflow with explicit `gitURL` parameter
  - [ ] Verify uses existing repo (no creation)
  - [ ] Verify successful push
- [ ] Run workflow with invalid `workspaceID`
  - [ ] Verify clear error message displayed
  - [ ] Verify error message directs to admin settings
- [ ] Run workflow with `githubInstallationID` override
  - [ ] Verify uses correct GitHub org
  - [ ] Verify fails if installation not allowed for workspace
- [ ] Check Temporal UI for workflow execution
  - [ ] Verify all activities show correct status
  - [ ] Verify error messages visible in activity logs
  - [ ] Verify workflow completes successfully

---

## Implementation Checklist

High-level tasks for implementation plan:

- [ ] **Task 1**: Create `GitHubService` interface and implementation
  - [ ] Define interface in `services/github_service.go`
  - [ ] Implement `FindInstallationForWorkspace()`
  - [ ] Implement `GetInstallationToken()`
  - [ ] Implement `CreateRepository()`
  - [ ] Implement `PrepareRemote()` orchestrator
  - [ ] Write comprehensive unit tests (80%+ coverage)

- [ ] **Task 2**: Update `GitActivities` constructor
  - [ ] Add `GitHubService` dependency
  - [ ] Update `NewGitActivities()` signature
  - [ ] Update worker initialization in `cmd/worker/main.go`

- [ ] **Task 3**: Implement `PrepareGitHubRemoteActivity`
  - [ ] Define input/output structs
  - [ ] Implement activity logic
  - [ ] Write integration tests

- [ ] **Task 4**: Modify `PushToRemoteActivity`
  - [ ] Update input struct (remove user OAuth)
  - [ ] Remove `CredentialService` dependency
  - [ ] Update to accept explicit credentials
  - [ ] Add remote set/update logic
  - [ ] Write integration tests

- [ ] **Task 5**: Update `InitializeGitActivity`
  - [ ] Change git user.name to "Orbit IDP"
  - [ ] Change git user.email to "bot@orbit.dev"
  - [ ] Verify existing tests still pass

- [ ] **Task 6**: Update `RepositoryWorkflow`
  - [ ] Update `RepositoryWorkflowInput` struct
  - [ ] Add `PrepareGitHubRemoteActivity` execution
  - [ ] Pass credentials to `PushToRemoteActivity`
  - [ ] Write end-to-end workflow test

- [ ] **Task 7**: Update documentation
  - [ ] Update backend activities plan (mark Task 4 complete)
  - [ ] Update GitHub App installation plan (mark Task 9 complete)
  - [ ] Document new workflow parameters for frontend integration

- [ ] **Task 8**: Manual testing
  - [ ] Follow manual testing checklist
  - [ ] Document test results
  - [ ] Fix any discovered issues

---

## Dependencies and Prerequisites

**Must be complete before starting**:
- ✅ GitHub App installation (Tasks 1-8, 10-12 from GitHub App plan)
- ✅ Token refresh workflow operational
- ✅ At least one test installation configured

**Must be available**:
- Temporal server running (localhost:7233)
- Payload CMS accessible
- Test GitHub organization with Orbit IDP app installed

---

## Next Steps

1. **Commit this design document** to git
2. **Set up worktree** for isolated development (using `superpowers:using-git-worktrees`)
3. **Create implementation plan** with detailed, bite-sized tasks (using `superpowers:writing-plans`)
4. **Begin implementation** following TDD practices (using `superpowers:test-driven-development`)

---

**Design Status**: ✅ Complete and validated
**Ready for**: Implementation planning
