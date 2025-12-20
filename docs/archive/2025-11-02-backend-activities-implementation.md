# Backend Activities Implementation Plan (C3)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

---

## ⚠️ IMPORTANT DEPENDENCY

**This plan depends on GitHub App Installation being implemented first.**

**See**: [`docs/plans/2025-11-13-github-app-installation.md`](./2025-11-13-github-app-installation.md)

**Why**: Tasks 4+ require GitHub App installation tokens for authentication. Before continuing with this plan:

1. ✅ Complete all tasks in GitHub App installation plan (12 tasks)
2. ✅ Verify GitHub App installed and token refresh working
3. ✅ Verify workspace access mapping configured
4. ✅ Then resume this plan at Task 4

**Current Status**: Tasks 1-3 complete (Git clone, variable substitution, git init). Task 4 (push to remote) blocked pending GitHub App implementation.

---

**Goal:** Replace stubbed Temporal activity implementations with real Git operations, code generation tools, and external API integrations.

**Architecture:** Activities use Go standard library exec for Git commands and external tools (protoc, openapi-generator), HTTP clients for external APIs (Confluence, Notion), and proper error handling with idempotency. All activities log operations and handle retries gracefully.

**🔒 AUTHENTICATION ARCHITECTURE (CONSTITUTIONAL REQUIREMENT):**
- **ALL external operations MUST use user-context authentication** (see `.agent/SOPs/user-driven-authentication.md`)
- Workflow inputs MUST include `UserID` and `WorkspaceID`
- Activity inputs MUST include `UserID` and `WorkspaceID`
- Activities MUST retrieve user OAuth tokens via `CredentialService`
- Service account credentials (env vars) are PROHIBITED
- OAuth tokens stored encrypted in `user_oauth_tokens` and `workspace_integrations` tables

**Tech Stack:**
- Git: `os/exec` with git CLI commands + user OAuth tokens
- Code Generation: protoc, openapi-generator, graphql-codegen via exec
- External APIs: net/http for Confluence/Notion REST APIs with user/workspace credentials
- Authentication: CredentialService interface for OAuth token management
- Storage: S3 client (aws-sdk-go-v2) for artifact uploads
- File Operations: os, io, filepath packages

**Current Status:**
- ✅ Workflow orchestration implemented and tested
- ✅ Activity stubs with idempotent structure
- ✅ Comprehensive test coverage (99+ tests passing)
- 🎯 Activities return mock data instead of performing real operations

---

## Prerequisites

**Before Starting:**
- All workflow tests passing (T050-T052)
- Activity test structure in place
- Go 1.21+ installed
- Git CLI available (`git version`)
- External tool installation:
  ```bash
  # Protoc (for protobuf code generation)
  brew install protobuf

  # OpenAPI Generator (optional - can use Docker)
  brew install openapi-generator

  # GraphQL Code Generator (npm global - optional)
  npm install -g @graphql-codegen/cli
  ```

**Environment Setup:**
```bash
cd /Users/drew.payment/dev/idp
go mod tidy  # Ensure all dependencies installed
```

**Reference Documentation:**
- Existing stubs: `temporal-workflows/internal/activities/`
- Test patterns: `temporal-workflows/internal/activities/*_test.go`
- Workflow integration: `temporal-workflows/internal/workflows/`

---

## Task 1: Implement Git Clone Activity

**Goal:** Replace stub with actual Git repository cloning.

**Files:**
- Modify: `temporal-workflows/internal/activities/git_activities.go` (CloneTemplateActivity method)
- Test: `temporal-workflows/internal/activities/git_activities_test.go` (existing tests should pass)

### Step 1: Review current implementation

**Current stub:**
```go
func (a *GitActivities) CloneTemplateActivity(ctx context.Context, input CloneTemplateInput) error {
    // Create directory structure (currently just mkdir)
    repoPath := filepath.Join(a.workDir, input.RepositoryID)
    if err := os.MkdirAll(repoPath, 0755); err != nil {
        return fmt.Errorf("failed to create repository directory: %w", err)
    }

    // TODO: Actually clone template from Git URL
    return nil
}
```

### Step 2: Run existing tests to establish baseline

```bash
cd temporal-workflows
go test -v -run TestGitActivities_CloneTemplateActivity ./internal/activities/
```

**Expected:** PASS (tests currently work with stub)

### Step 3: Implement actual Git clone

**Modify:** `temporal-workflows/internal/activities/git_activities.go`

```go
func (a *GitActivities) CloneTemplateActivity(ctx context.Context, input CloneTemplateInput) error {
    repoPath := filepath.Join(a.workDir, input.RepositoryID)

    // Check if repository already exists (idempotency)
    if _, err := os.Stat(repoPath); err == nil {
        a.logger.Info("Repository already cloned, skipping", "path", repoPath)
        return nil
    }

    // Get template URL from template name
    templateURL := a.getTemplateURL(input.TemplateName)
    if templateURL == "" {
        return fmt.Errorf("template not found: %s", input.TemplateName)
    }

    // Clone repository using git CLI
    cmd := exec.CommandContext(ctx, "git", "clone", templateURL, repoPath)
    cmd.Stdout = os.Stdout
    cmd.Stderr = os.Stderr

    if err := cmd.Run(); err != nil {
        // Clean up partial clone on failure
        os.RemoveAll(repoPath)
        return fmt.Errorf("failed to clone template: %w", err)
    }

    a.logger.Info("Successfully cloned template", "template", input.TemplateName, "path", repoPath)
    return nil
}

// Helper method to map template names to Git URLs
func (a *GitActivities) getTemplateURL(templateName string) string {
    // In production, this would query a database or config
    templates := map[string]string{
        "microservice": "https://github.com/your-org/template-microservice.git",
        "library":      "https://github.com/your-org/template-library.git",
        "frontend":     "https://github.com/your-org/template-frontend.git",
        "mobile":       "https://github.com/your-org/template-mobile.git",
        "documentation": "https://github.com/your-org/template-docs.git",
    }
    return templates[templateName]
}
```

### Step 4: Update tests to use temporary directories

**Modify:** `temporal-workflows/internal/activities/git_activities_test.go`

```go
func TestGitActivities_CloneTemplateActivity_Real(t *testing.T) {
    // Create temp directory for test
    tempDir := t.TempDir()

    activities := &activities.GitActivities{
        workDir: tempDir,
        logger:  slog.Default(),
    }

    input := activities.CloneTemplateInput{
        RepositoryID: "test-repo-123",
        TemplateName: "microservice",
    }

    // Note: This requires network access and GitHub credentials
    // Skip in CI environments without credentials
    if os.Getenv("SKIP_INTEGRATION_TESTS") != "" {
        t.Skip("Skipping integration test requiring Git access")
    }

    err := activities.CloneTemplateActivity(context.Background(), input)
    require.NoError(t, err)

    // Verify repository was cloned
    repoPath := filepath.Join(tempDir, input.RepositoryID)
    assert.DirExists(t, repoPath)
    assert.FileExists(t, filepath.Join(repoPath, ".git", "config"))

    // Test idempotency - second call should succeed without error
    err = activities.CloneTemplateActivity(context.Background(), input)
    require.NoError(t, err)
}
```

### Step 5: Run tests to verify implementation

```bash
cd temporal-workflows
go test -v -run TestGitActivities_CloneTemplateActivity ./internal/activities/
```

**Expected:** PASS (or SKIP if SKIP_INTEGRATION_TESTS is set)

### Step 6: Commit

```bash
git add temporal-workflows/internal/activities/git_activities.go
git add temporal-workflows/internal/activities/git_activities_test.go
git commit -m "feat: implement real Git clone in CloneTemplateActivity

- Use git CLI via os/exec for actual repository cloning
- Add template URL mapping for 5 template types
- Implement idempotency check (skip if already cloned)
- Add cleanup on clone failure
- Add integration test with temp directory
- Tests can be skipped in CI with SKIP_INTEGRATION_TESTS env var

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Implement Apply Variables Activity

**Goal:** Replace stub with actual template variable substitution in files.

**Files:**
- Modify: `temporal-workflows/internal/activities/git_activities.go` (ApplyVariablesActivity method)
- Test: `temporal-workflows/internal/activities/git_activities_test.go`

### Step 1: Implement file traversal and variable replacement

**Modify:** `temporal-workflows/internal/activities/git_activities.go`

```go
func (a *GitActivities) ApplyVariablesActivity(ctx context.Context, input ApplyVariablesInput) error {
    // Walk directory tree
    err := filepath.Walk(input.Path, func(path string, info os.FileInfo, err error) error {
        if err != nil {
            return err
        }

        // Skip directories and hidden files
        if info.IsDir() || strings.HasPrefix(info.Name(), ".") {
            return nil
        }

        // Skip binary files (simple heuristic: check extension)
        if isBinaryFile(path) {
            return nil
        }

        // Read file content
        content, err := os.ReadFile(path)
        if err != nil {
            return fmt.Errorf("failed to read file %s: %w", path, err)
        }

        // Replace variables
        modified := string(content)
        for key, value := range input.Variables {
            placeholder := "{{" + key + "}}"
            modified = strings.ReplaceAll(modified, placeholder, value)
        }

        // Write back if changed
        if modified != string(content) {
            if err := os.WriteFile(path, []byte(modified), info.Mode()); err != nil {
                return fmt.Errorf("failed to write file %s: %w", path, err)
            }
            a.logger.Info("Applied variables to file", "file", path)
        }

        return nil
    })

    if err != nil {
        return fmt.Errorf("failed to apply variables: %w", err)
    }

    return nil
}

func isBinaryFile(path string) bool {
    binaryExtensions := []string{".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".tar", ".gz", ".exe", ".so", ".dylib"}
    ext := strings.ToLower(filepath.Ext(path))
    for _, binExt := range binaryExtensions {
        if ext == binExt {
            return true
        }
    }
    return false
}
```

### Step 2: Add test with actual file operations

**Modify:** `temporal-workflows/internal/activities/git_activities_test.go`

```go
func TestGitActivities_ApplyVariablesActivity_Real(t *testing.T) {
    tempDir := t.TempDir()

    // Create test file with placeholders
    testFile := filepath.Join(tempDir, "README.md")
    content := "# {{service_name}}\n\n{{description}}\n\nAuthor: {{author}}"
    err := os.WriteFile(testFile, []byte(content), 0644)
    require.NoError(t, err)

    activities := &activities.GitActivities{
        workDir: tempDir,
        logger:  slog.Default(),
    }

    input := activities.ApplyVariablesInput{
        Path: tempDir,
        Variables: map[string]string{
            "service_name": "my-awesome-service",
            "description":  "This is a test service",
            "author":       "Test User",
        },
    }

    err = activities.ApplyVariablesActivity(context.Background(), input)
    require.NoError(t, err)

    // Verify variables were replaced
    result, err := os.ReadFile(testFile)
    require.NoError(t, err)

    assert.Contains(t, string(result), "# my-awesome-service")
    assert.Contains(t, string(result), "This is a test service")
    assert.Contains(t, string(result), "Author: Test User")
    assert.NotContains(t, string(result), "{{")
}
```

### Step 3: Run tests

```bash
cd temporal-workflows
go test -v -run TestGitActivities_ApplyVariablesActivity ./internal/activities/
```

**Expected:** PASS

### Step 4: Commit

```bash
git add temporal-workflows/internal/activities/git_activities.go
git add temporal-workflows/internal/activities/git_activities_test.go
git commit -m "feat: implement template variable substitution

- Walk directory tree and replace {{variable}} placeholders
- Skip binary files and hidden files
- Preserve file permissions
- Add comprehensive test with actual file operations

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Implement Initialize Git Activity

**Goal:** Initialize Git repository with initial commit.

**Files:**
- Modify: `temporal-workflows/internal/activities/git_activities.go` (InitializeGitActivity method)

### Step 1: Implement Git initialization

```go
func (a *GitActivities) InitializeGitActivity(ctx context.Context, input InitializeGitInput) error {
    // Check if already initialized (idempotency)
    gitDir := filepath.Join(input.Path, ".git")
    if _, err := os.Stat(gitDir); err == nil {
        a.logger.Info("Git repository already initialized", "path", input.Path)
        return nil
    }

    // Git init
    cmd := exec.CommandContext(ctx, "git", "init")
    cmd.Dir = input.Path
    if err := cmd.Run(); err != nil {
        return fmt.Errorf("failed to init git: %w", err)
    }

    // Configure user (required for commit)
    configCmds := []struct {
        key   string
        value string
    }{
        {"user.name", "Orbit IDP"},
        {"user.email", "noreply@orbit-idp.com"},
    }

    for _, cfg := range configCmds {
        cmd := exec.CommandContext(ctx, "git", "config", cfg.key, cfg.value)
        cmd.Dir = input.Path
        if err := cmd.Run(); err != nil {
            return fmt.Errorf("failed to configure git: %w", err)
        }
    }

    // Add all files
    cmd = exec.CommandContext(ctx, "git", "add", ".")
    cmd.Dir = input.Path
    if err := cmd.Run(); err != nil {
        return fmt.Errorf("failed to add files: %w", err)
    }

    // Initial commit
    cmd = exec.CommandContext(ctx, "git", "commit", "-m", "Initial commit from Orbit IDP")
    cmd.Dir = input.Path
    if err := cmd.Run(); err != nil {
        return fmt.Errorf("failed to create initial commit: %w", err)
    }

    // Add remote if GitURL provided
    if input.GitURL != "" {
        cmd = exec.CommandContext(ctx, "git", "remote", "add", "origin", input.GitURL)
        cmd.Dir = input.Path
        if err := cmd.Run(); err != nil {
            // Ignore error if remote already exists
            if !strings.Contains(err.Error(), "already exists") {
                return fmt.Errorf("failed to add remote: %w", err)
            }
        }
    }

    a.logger.Info("Initialized Git repository", "path", input.Path)
    return nil
}
```

### Step 2: Add test

```go
func TestGitActivities_InitializeGitActivity_Real(t *testing.T) {
    tempDir := t.TempDir()

    // Create a test file
    testFile := filepath.Join(tempDir, "README.md")
    err := os.WriteFile(testFile, []byte("# Test Repo"), 0644)
    require.NoError(t, err)

    activities := &activities.GitActivities{
        logger: slog.Default(),
    }

    input := activities.InitializeGitInput{
        Path:   tempDir,
        GitURL: "https://github.com/test/repo.git",
    }

    err = activities.InitializeGitActivity(context.Background(), input)
    require.NoError(t, err)

    // Verify git was initialized
    assert.DirExists(t, filepath.Join(tempDir, ".git"))

    // Verify commit was created
    cmd := exec.Command("git", "log", "--oneline")
    cmd.Dir = tempDir
    output, err := cmd.Output()
    require.NoError(t, err)
    assert.Contains(t, string(output), "Initial commit")

    // Test idempotency
    err = activities.InitializeGitActivity(context.Background(), input)
    require.NoError(t, err)
}
```

### Step 3: Run tests and commit

```bash
go test -v -run TestGitActivities_InitializeGitActivity ./internal/activities/
git add temporal-workflows/internal/activities/
git commit -m "feat: implement Git repository initialization

- Initialize Git repository with git init
- Configure user identity for commits
- Create initial commit with all files
- Add remote origin if GitURL provided
- Implement idempotency check

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Implement Push to Remote Activity ✅ COMPLETE

**Goal:** Push repository to remote Git provider using GitHub App installation token.

**Status:** ✅ Completed (2025-11-18)
**Implementation:** See `docs/plans/2025-11-18-github-app-repository-integration-implementation.md`

**Changes from original plan:**
- Replaced user OAuth approach with GitHub App installation tokens
- Added PrepareGitHubRemoteActivity to handle installation lookup and token decryption
- PushToRemoteActivity now accepts explicit credentials (no user context needed)
- InitializeGitActivity updated to use bot identity ("Orbit IDP <bot@orbit.dev>")

**🔒 AUTHENTICATION REQUIREMENT:**
- MUST use GitHub App installation token (from `CredentialService`)
- MUST NOT use service account or environment variable credentials
- Repository is created in user's GitHub org, commits show user's identity
- See: `.agent/SOPs/user-driven-authentication.md`

**Files:**
- Modify: `temporal-workflows/internal/activities/git_activities.go` (PushToRemoteActivity method)
- Modify input struct to include `UserID` and `WorkspaceID`
- Add `CredentialService` dependency to `GitActivities`

### Step 1: Update input struct and activity dependencies

```go
// Update PushToRemoteInput to include user context
type PushToRemoteInput struct {
    RepositoryID string
    UserID       string  // REQUIRED for user-context auth
    WorkspaceID  string  // REQUIRED for multi-tenancy
}

// Add CredentialService dependency
type GitActivities struct {
    workDir           string
    credentialService CredentialService  // NEW: Required for OAuth
}

func NewGitActivities(workDir string, credService CredentialService) *GitActivities {
    return &GitActivities{
        workDir:           workDir,
        credentialService: credService,
    }
}
```

### Step 2: Implement Git push with user OAuth token

```go
func (a *GitActivities) PushToRemoteActivity(ctx context.Context, input PushToRemoteInput) error {
    if input.UserID == "" || input.WorkspaceID == "" {
        return errors.New("user_id and workspace_id are required")
    }

    repoPath := filepath.Join(a.workDir, input.RepositoryID)

    // Check if repository exists
    if _, err := os.Stat(repoPath); os.IsNotExist(err) {
        return errors.New("repository directory does not exist")
    }

    // Verify remote exists
    cmd := exec.CommandContext(ctx, "git", "remote", "get-url", "origin")
    cmd.Dir = repoPath
    if err := cmd.Run(); err != nil {
        return fmt.Errorf("no remote configured: %w", err)
    }

    // REQUIRED: Retrieve user's GitHub OAuth token
    creds, err := a.credentialService.GetUserCredentials(ctx, input.UserID, "github")
    if err != nil {
        return fmt.Errorf("user has not connected GitHub account: %w", err)
    }

    // Check if token expired, refresh if needed
    if creds.IsExpired() {
        creds, err = a.credentialService.RefreshToken(ctx, input.UserID, "github")
        if err != nil {
            return fmt.Errorf("failed to refresh GitHub token (user must reconnect): %w", err)
        }
    }

    // Create temporary credential helper script
    // Git will call this script to get the OAuth token
    credHelper, err := a.createCredentialHelper(creds.AccessToken)
    if err != nil {
        return fmt.Errorf("failed to create credential helper: %w", err)
    }
    defer os.Remove(credHelper)

    // Push to remote using user's OAuth token
    cmd = exec.CommandContext(ctx, "git", "push", "-u", "origin", "main")
    cmd.Dir = repoPath
    cmd.Env = append(os.Environ(),
        fmt.Sprintf("GIT_ASKPASS=%s", credHelper),
        // Optional: Override commit author if not already set
        "GIT_AUTHOR_NAME="+creds.UserName,
        "GIT_AUTHOR_EMAIL="+creds.UserEmail,
    )

    output, err := cmd.CombinedOutput()
    if err != nil {
        // Check if already pushed (idempotency)
        if strings.Contains(string(output), "Everything up-to-date") {
            return nil
        }
        return fmt.Errorf("failed to push to remote: %w (output: %s)", err, string(output))
    }

    return nil
}

// createCredentialHelper creates a temporary script that provides the OAuth token
func (a *GitActivities) createCredentialHelper(token string) (string, error) {
    // Create script that echoes the token when Git asks for password
    // Git will call this with "Password for 'https://...'"
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

### Step 3: Add test with mocked credential service

```go
// Mock credential service for testing
type MockCredentialService struct {
    Credentials map[string]*OAuthCredentials
    GetUserCredentialsCalled bool
    RefreshTokenCalled bool
}

func (m *MockCredentialService) GetUserCredentials(ctx context.Context, userID, provider string) (*OAuthCredentials, error) {
    m.GetUserCredentialsCalled = true
    key := fmt.Sprintf("%s:%s", userID, provider)
    if creds, ok := m.Credentials[key]; ok {
        return creds, nil
    }
    return nil, errors.New("credentials not found")
}

func (m *MockCredentialService) RefreshToken(ctx context.Context, userID, provider string) (*OAuthCredentials, error) {
    m.RefreshTokenCalled = true
    // Return refreshed credentials
    return m.GetUserCredentials(ctx, userID, provider)
}

func TestGitActivities_PushToRemoteActivity(t *testing.T) {
    tempDir := t.TempDir()

    // Initialize git repo
    exec.Command("git", "init", tempDir).Run()
    exec.Command("git", "-C", tempDir, "remote", "add", "origin", "https://github.com/test/repo.git").Run()

    // Create mock credential service
    mockCredService := &MockCredentialService{
        Credentials: map[string]*OAuthCredentials{
            "user-123:github": {
                AccessToken:  "ghp_test_token_12345",
                RefreshToken: "refresh_token",
                ExpiresAt:    time.Now().Add(24 * time.Hour),
                UserName:     "testuser",
                UserEmail:    "test@example.com",
            },
        },
    }

    activities := NewGitActivities(tempDir, mockCredService)

    input := PushToRemoteInput{
        RepositoryID: "test-repo",
        UserID:       "user-123",
        WorkspaceID:  "workspace-123",
    }

    // This will fail because there's no real GitHub remote,
    // but we can verify the credential service was called
    err := activities.PushToRemoteActivity(context.Background(), input)

    // Verify credential service was used
    assert.True(t, mockCredService.GetUserCredentialsCalled)

    // In test environment without real remote, push will fail
    // but that's expected - we're testing the auth flow
    if err != nil {
        assert.Contains(t, err.Error(), "failed to push")
    }
}

func TestGitActivities_PushToRemoteActivity_MissingCredentials(t *testing.T) {
    tempDir := t.TempDir()

    // Empty credential service (user hasn't connected GitHub)
    mockCredService := &MockCredentialService{
        Credentials: map[string]*OAuthCredentials{},
    }

    activities := NewGitActivities(tempDir, mockCredService)

    input := PushToRemoteInput{
        RepositoryID: "test-repo",
        UserID:       "user-999",  // User without GitHub credentials
        WorkspaceID:  "workspace-123",
    }

    err := activities.PushToRemoteActivity(context.Background(), input)

    // Should fail with user-friendly error
    require.Error(t, err)
    assert.Contains(t, err.Error(), "user has not connected GitHub account")
}
```

### Step 4: Run tests and commit

```bash
go test -v -run TestGitActivities_PushToRemoteActivity ./internal/activities/
git add temporal-workflows/internal/activities/
git commit -m "feat: implement Git push with user OAuth authentication

- Use user's GitHub OAuth token from CredentialService
- Add UserID and WorkspaceID to PushToRemoteInput
- Create temporary credential helper for Git authentication
- Refresh expired tokens automatically
- User-friendly errors when credentials missing/expired
- Idempotent (skip if already pushed)

🔒 Constitutional requirement: User-context authentication
See: .agent/SOPs/user-driven-authentication.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Implement Schema Validation Activity

**Goal:** Add proper schema validation using external tools.

**Files:**
- Modify: `temporal-workflows/internal/activities/codegen_activities.go` (ValidateSchemaActivity method)

### Step 1: Implement protobuf validation with protoc

```go
func (a *CodeGenActivities) ValidateSchemaActivity(ctx context.Context, input ValidateSchemaInput) error {
    switch input.SchemaType {
    case "protobuf":
        return a.validateProtobuf(ctx, input.SchemaContent)
    case "openapi":
        return a.validateOpenAPI(ctx, input.SchemaContent)
    case "graphql":
        return a.validateGraphQL(ctx, input.SchemaContent)
    default:
        return fmt.Errorf("unsupported schema type: %s", input.SchemaType)
    }
}

func (a *CodeGenActivities) validateProtobuf(ctx context.Context, content string) error {
    // Write schema to temp file
    tempFile, err := os.CreateTemp("", "schema-*.proto")
    if err != nil {
        return fmt.Errorf("failed to create temp file: %w", err)
    }
    defer os.Remove(tempFile.Name())

    if _, err := tempFile.WriteString(content); err != nil {
        return fmt.Errorf("failed to write schema: %w", err)
    }
    tempFile.Close()

    // Validate with protoc
    cmd := exec.CommandContext(ctx, "protoc", "--proto_path=.", "--descriptor_set_out=/dev/null", tempFile.Name())
    output, err := cmd.CombinedOutput()
    if err != nil {
        return fmt.Errorf("protobuf validation failed: %s", string(output))
    }

    return nil
}

func (a *CodeGenActivities) validateOpenAPI(ctx context.Context, content string) error {
    // Parse as JSON or YAML
    var spec map[string]interface{}

    // Try JSON first
    if err := json.Unmarshal([]byte(content), &spec); err != nil {
        // Try YAML
        if err := yaml.Unmarshal([]byte(content), &spec); err != nil {
            return fmt.Errorf("invalid JSON/YAML: %w", err)
        }
    }

    // Check for required OpenAPI 3.x fields
    version, ok := spec["openapi"].(string)
    if !ok {
        return fmt.Errorf("missing or invalid 'openapi' version field")
    }

    if !strings.HasPrefix(version, "3.") {
        return fmt.Errorf("unsupported OpenAPI version: %s (only 3.x supported)", version)
    }

    // Check for required fields
    requiredFields := []string{"info", "paths"}
    for _, field := range requiredFields {
        if _, ok := spec[field]; !ok {
            return fmt.Errorf("missing required field: %s", field)
        }
    }

    return nil
}

func (a *CodeGenActivities) validateGraphQL(ctx context.Context, content string) error {
    // Basic GraphQL validation - check for type definitions
    if !strings.Contains(content, "type ") && !strings.Contains(content, "schema {") {
        return fmt.Errorf("invalid GraphQL schema: no type definitions found")
    }

    // For production, use graphql-go parser or shell out to graphql CLI
    return nil
}
```

### Step 2: Add imports

```go
import (
    "encoding/json"
    "gopkg.in/yaml.v3"
)
```

### Step 3: Update tests

```go
func TestCodeGenActivities_ValidateProtobuf_Real(t *testing.T) {
    if _, err := exec.LookPath("protoc"); err != nil {
        t.Skip("protoc not installed, skipping real validation test")
    }

    activities := &activities.CodeGenActivities{
        logger: slog.Default(),
    }

    validProto := `syntax = "proto3";
package test;

message User {
  string id = 1;
  string name = 2;
}`

    err := activities.ValidateSchemaActivity(context.Background(), activities.ValidateSchemaInput{
        SchemaType:    "protobuf",
        SchemaContent: validProto,
    })

    assert.NoError(t, err)

    // Test invalid proto
    invalidProto := `syntax = "invalid";`
    err = activities.ValidateSchemaActivity(context.Background(), activities.ValidateSchemaInput{
        SchemaType:    "protobuf",
        SchemaContent: invalidProto,
    })

    assert.Error(t, err)
    assert.Contains(t, err.Error(), "validation failed")
}
```

### Step 4: Run tests and commit

```bash
go mod tidy  # Add yaml dependency
go test -v -run TestCodeGenActivities_ValidateProtobuf ./internal/activities/
git add temporal-workflows/
git commit -m "feat: implement real schema validation

- Protobuf: Use protoc for syntax validation
- OpenAPI: Parse JSON/YAML and validate required fields
- GraphQL: Basic structure validation
- Add gopkg.in/yaml.v3 dependency
- Skip tests if tools not installed

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6-12: Additional Activities

**Following the same pattern for:**

- Task 6: Generate Code Activity (use protoc, openapi-generator, graphql-codegen)
- Task 7: Package Artifacts Activity (tar.gz compression)
- Task 8: Upload Artifacts Activity (S3 client integration)
- Task 9: Fetch Knowledge Pages Activity (PostgreSQL query with workspace scoping)
- Task 10: Transform Content Activity (markdown parsers)
- Task 11: Sync to External System Activity (HTTP clients for APIs) **🔒 AUTH REQUIRED**
- Task 12: Update Sync Status Activity (database write with workspace scoping)

**🔒 Authentication Requirements for Tasks 9-12:**
- **Task 9**: Database queries MUST include `WHERE workspace_id = ?` for multi-tenancy
- **Task 11**: MUST use workspace integration credentials from `workspace_integrations` table
  - Confluence: Workspace's Confluence API key
  - Notion: Workspace's Notion integration token
  - GitHub Pages: User's GitHub OAuth token (same as Task 4)
- **Task 12**: Database writes MUST be scoped to workspace

**Each task follows same structure:**
1. Update input structs to include `UserID` and `WorkspaceID` (if auth required)
2. Add `CredentialService` dependency (if auth required)
3. Write/enhance tests with mocked credentials
4. Run tests (baseline)
5. Implement real logic with user-context auth
6. Run tests (verify pass)
7. Commit

---

## Summary of Implementation

**Total Tasks:** 12 activities across 3 workflows
**Estimated Time:** 6-8 hours (30-40 minutes per activity)
**Dependencies:** Git, protoc, openapi-generator, S3 credentials, API keys

**Order of Implementation:**
1. Git Activities (Tasks 1-4) - ~2 hours
2. CodeGen Activities (Tasks 5-8) - ~3 hours
3. Sync Activities (Tasks 9-12) - ~3 hours

**Testing Strategy:**
- Integration tests with SKIP_INTEGRATION_TESTS env var
- Use temp directories and cleanup
- Mock external APIs in unit tests
- Document required credentials in README

---

## Execution Options

Plan complete and saved to `docs/plans/2025-11-02-backend-activities-implementation.md`.

**Recommended Approach:**
Given the scope (12 tasks, 6-8 hours), this is best implemented as:

1. **Separate Session** - Dedicated time for deep implementation work
2. **Incremental Commits** - One task at a time with tests
3. **Skip External Dependencies** - Use mocks/stubs for services requiring credentials
4. **Focus on Git First** - Tasks 1-4 are most valuable and self-contained

**Alternative:**
- **Phase 1 (Now)**: Implement Git activities only (Tasks 1-4, ~2 hours)
- **Phase 2 (Later)**: CodeGen activities when needed
- **Phase 3 (Later)**: Sync activities when external integrations planned