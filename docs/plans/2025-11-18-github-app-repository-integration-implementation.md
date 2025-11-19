# GitHub App Repository Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate GitHub App installation tokens with repository creation workflow to enable end-to-end deployment from templates to GitHub.

**Architecture:** Create dedicated GitHubService layer for GitHub App integration, update GitActivities to use service for credentials, modify workflow to orchestrate new PrepareGitHubRemoteActivity before push.

**Tech Stack:** Go 1.21+, Temporal workflows, GitHub REST API v3, Payload CMS (MongoDB), AES-256-GCM encryption

**Design Document:** `docs/plans/2025-11-18-github-app-repository-integration-design.md`

---

## Prerequisites

Before starting:
- ✅ Worktree created at `.worktrees/github-app-repo-integration`
- ✅ Branch: `feat/github-app-repo-integration`
- ✅ Dependencies installed
- ✅ Design document reviewed and approved

**Working Directory:** All commands assume you're in the worktree root: `/Users/drew.payment/dev/orbit/.worktrees/github-app-repo-integration`

---

## Task 1: Create GitHubService Interface

**Goal:** Define service interface for GitHub App installation integration with comprehensive tests.

**Files:**
- Create: `temporal-workflows/internal/services/github_service.go`
- Create: `temporal-workflows/internal/services/github_service_test.go`

### Step 1.1: Write interface definition test (TDD)

**File:** `temporal-workflows/internal/services/github_service_test.go`

```go
package services_test

import (
	"context"
	"testing"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestGitHubServiceInterface verifies the interface is properly defined
func TestGitHubServiceInterface(t *testing.T) {
	var _ services.GitHubService = (*services.GitHubServiceImpl)(nil)
}

func TestFindInstallationForWorkspace_Success(t *testing.T) {
	mockPayload := &MockPayloadClient{
		Installations: []*services.Installation{
			{
				ID:             "install-123",
				InstallationID: 456,
				AccountLogin:   "test-org",
				EncryptedToken: "encrypted:token123",
				TokenExpiresAt: time.Now().Add(1 * time.Hour),
			},
		},
	}

	service := services.NewGitHubService(mockPayload, &MockEncryptionService{}, &MockGitHubClient{})

	installation, err := service.FindInstallationForWorkspace(context.Background(), "workspace-123", nil)

	require.NoError(t, err)
	assert.Equal(t, "test-org", installation.AccountLogin)
	assert.Equal(t, int64(456), installation.InstallationID)
}

// Mock implementations
type MockPayloadClient struct {
	Installations []*services.Installation
	FindCalled    bool
}

func (m *MockPayloadClient) Find(ctx context.Context, collection string, query map[string]interface{}) ([]*services.Installation, error) {
	m.FindCalled = true
	return m.Installations, nil
}

type MockEncryptionService struct{}

func (m *MockEncryptionService) Decrypt(ciphertext string) (string, error) {
	// Remove "encrypted:" prefix
	return ciphertext[10:], nil
}

type MockGitHubClient struct{}

func (m *MockGitHubClient) CreateRepository(ctx context.Context, token, orgName, repoName string, private bool) (string, error) {
	return "https://github.com/" + orgName + "/" + repoName + ".git", nil
}
```

### Step 1.2: Run test to verify it fails

```bash
cd temporal-workflows
go test -v -run TestGitHubServiceInterface ./internal/services/
```

**Expected:** FAIL with "undefined: services.GitHubService" or similar compilation error

### Step 1.3: Write minimal interface definition

**File:** `temporal-workflows/internal/services/github_service.go`

```go
package services

import (
	"context"
	"time"
)

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

	// PrepareRemote orchestrates: find installation, get token, optionally create repo
	PrepareRemote(
		ctx context.Context,
		input PrepareRemoteInput,
	) (*PrepareRemoteOutput, error)
}

// Installation represents a GitHub App installation record from Payload
type Installation struct {
	ID             string    // Payload document ID
	InstallationID int64     // GitHub installation ID
	AccountLogin   string    // GitHub org name
	EncryptedToken string    // Encrypted access token
	TokenExpiresAt time.Time // Token expiration
}

// PrepareRemoteInput contains parameters for PrepareRemote
type PrepareRemoteInput struct {
	WorkspaceID          string
	GitHubInstallationID *string // Optional override
	GitURL               string  // If empty, create repo
	RepositoryName       string  // Required if creating repo
	Private              bool    // Default true for created repos
}

// PrepareRemoteOutput contains git URL and credentials
type PrepareRemoteOutput struct {
	GitURL              string
	AccessToken         string
	InstallationOrgName string
	CreatedRepo         bool // True if repo was created by this call
}

// GitHubServiceImpl implements GitHubService
type GitHubServiceImpl struct {
	payloadClient PayloadClient
	encryption    EncryptionService
	githubClient  GitHubClient
}

// NewGitHubService creates a new GitHubService instance
func NewGitHubService(
	payloadClient PayloadClient,
	encryption EncryptionService,
	githubClient GitHubClient,
) GitHubService {
	return &GitHubServiceImpl{
		payloadClient: payloadClient,
		encryption:    encryption,
		githubClient:  githubClient,
	}
}

// Dependency interfaces
type PayloadClient interface {
	Find(ctx context.Context, collection string, query map[string]interface{}) ([]*Installation, error)
}

type EncryptionService interface {
	Decrypt(ciphertext string) (string, error)
}

type GitHubClient interface {
	CreateRepository(ctx context.Context, token, orgName, repoName string, private bool) (string, error)
}
```

### Step 1.4: Run test to verify compilation passes

```bash
cd temporal-workflows
go test -v -run TestGitHubServiceInterface ./internal/services/
```

**Expected:** PASS (interface compiles, implementation stub exists)

### Step 1.5: Write test for FindInstallationForWorkspace - NotFound case

**Add to:** `temporal-workflows/internal/services/github_service_test.go`

```go
func TestFindInstallationForWorkspace_NotFound(t *testing.T) {
	mockPayload := &MockPayloadClient{
		Installations: []*Installation{}, // No installations
	}

	service := NewGitHubService(mockPayload, &MockEncryptionService{}, &MockGitHubClient{})

	_, err := service.FindInstallationForWorkspace(context.Background(), "workspace-999", nil)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "no active GitHub App installation found")
	assert.Contains(t, err.Error(), "workspace-999")
	assert.Contains(t, err.Error(), "Please ask an admin")
}
```

### Step 1.6: Run test to verify it fails

```bash
cd temporal-workflows
go test -v -run TestFindInstallationForWorkspace_NotFound ./internal/services/
```

**Expected:** FAIL (method not implemented or doesn't return error)

### Step 1.7: Implement FindInstallationForWorkspace

**Add to:** `temporal-workflows/internal/services/github_service.go`

```go
import (
	"fmt"
)

func (s *GitHubServiceImpl) FindInstallationForWorkspace(
	ctx context.Context,
	workspaceID string,
	installationID *string,
) (*Installation, error) {
	// Build query: active installations allowed for workspace
	query := map[string]interface{}{
		"allowedWorkspaces": map[string]interface{}{
			"$in": []string{workspaceID},
		},
		"status": "active",
	}

	// If specific installation requested, filter to it
	if installationID != nil && *installationID != "" {
		query["id"] = *installationID
	}

	installations, err := s.payloadClient.Find(ctx, "github-installations", query)
	if err != nil {
		return nil, fmt.Errorf("failed to query installations: %w", err)
	}

	if len(installations) == 0 {
		if installationID != nil && *installationID != "" {
			return nil, fmt.Errorf("GitHub installation %s not found or not allowed for workspace %s", *installationID, workspaceID)
		}
		return nil, fmt.Errorf("no active GitHub App installation found for workspace %s. Please ask an admin to install the GitHub App and grant access to this workspace in Settings → GitHub", workspaceID)
	}

	// Use first installation (smart default)
	return installations[0], nil
}
```

### Step 1.8: Run tests to verify they pass

```bash
cd temporal-workflows
go test -v -run TestFindInstallationForWorkspace ./internal/services/
```

**Expected:** PASS (both Success and NotFound tests)

### Step 1.9: Write test for GetInstallationToken

**Add to:** `temporal-workflows/internal/services/github_service_test.go`

```go
func TestGetInstallationToken_Success(t *testing.T) {
	installation := &Installation{
		EncryptedToken: "encrypted:my-secret-token",
		TokenExpiresAt: time.Now().Add(1 * time.Hour),
	}

	service := NewGitHubService(&MockPayloadClient{}, &MockEncryptionService{}, &MockGitHubClient{})

	token, err := service.GetInstallationToken(context.Background(), installation)

	require.NoError(t, err)
	assert.Equal(t, "my-secret-token", token)
}

func TestGetInstallationToken_Expired(t *testing.T) {
	installation := &Installation{
		EncryptedToken: "encrypted:my-secret-token",
		TokenExpiresAt: time.Now().Add(-1 * time.Hour), // Expired 1 hour ago
	}

	service := NewGitHubService(&MockPayloadClient{}, &MockEncryptionService{}, &MockGitHubClient{})

	_, err := service.GetInstallationToken(context.Background(), installation)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "expired")
}
```

### Step 1.10: Run test to verify it fails

```bash
cd temporal-workflows
go test -v -run TestGetInstallationToken ./internal/services/
```

**Expected:** FAIL (method not implemented)

### Step 1.11: Implement GetInstallationToken

**Add to:** `temporal-workflows/internal/services/github_service.go`

```go
func (s *GitHubServiceImpl) GetInstallationToken(
	ctx context.Context,
	installation *Installation,
) (string, error) {
	// Check if token expired
	if installation.TokenExpiresAt.Before(time.Now()) {
		return "", fmt.Errorf("GitHub installation token expired at %s. The token refresh workflow should handle this automatically. If this persists, check Temporal workflow status", installation.TokenExpiresAt.Format(time.RFC3339))
	}

	// Decrypt token
	token, err := s.encryption.Decrypt(installation.EncryptedToken)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt GitHub token: %w", err)
	}

	return token, nil
}
```

### Step 1.12: Run tests to verify they pass

```bash
cd temporal-workflows
go test -v -run TestGetInstallationToken ./internal/services/
```

**Expected:** PASS (both Success and Expired tests)

### Step 1.13: Write test for CreateRepository

**Add to:** `temporal-workflows/internal/services/github_service_test.go`

```go
func TestCreateRepository_Success(t *testing.T) {
	service := NewGitHubService(&MockPayloadClient{}, &MockEncryptionService{}, &MockGitHubClient{})

	gitURL, err := service.CreateRepository(context.Background(), "token123", "test-org", "test-repo", true)

	require.NoError(t, err)
	assert.Equal(t, "https://github.com/test-org/test-repo.git", gitURL)
}
```

### Step 1.14: Run test to verify it fails

```bash
cd temporal-workflows
go test -v -run TestCreateRepository ./internal/services/
```

**Expected:** FAIL (method not implemented)

### Step 1.15: Implement CreateRepository

**Add to:** `temporal-workflows/internal/services/github_service.go`

```go
func (s *GitHubServiceImpl) CreateRepository(
	ctx context.Context,
	token string,
	orgName string,
	repoName string,
	private bool,
) (string, error) {
	gitURL, err := s.githubClient.CreateRepository(ctx, token, orgName, repoName, private)
	if err != nil {
		return "", fmt.Errorf("failed to create repository '%s/%s': %w", orgName, repoName, err)
	}

	return gitURL, nil
}
```

### Step 1.16: Run test to verify it passes

```bash
cd temporal-workflows
go test -v -run TestCreateRepository ./internal/services/
```

**Expected:** PASS

### Step 1.17: Write test for PrepareRemote - with existing git URL

**Add to:** `temporal-workflows/internal/services/github_service_test.go`

```go
func TestPrepareRemote_WithGitURL(t *testing.T) {
	mockPayload := &MockPayloadClient{
		Installations: []*Installation{
			{
				ID:             "install-123",
				InstallationID: 456,
				AccountLogin:   "test-org",
				EncryptedToken: "encrypted:token123",
				TokenExpiresAt: time.Now().Add(1 * time.Hour),
			},
		},
	}

	service := NewGitHubService(mockPayload, &MockEncryptionService{}, &MockGitHubClient{})

	input := PrepareRemoteInput{
		WorkspaceID: "workspace-123",
		GitURL:      "https://github.com/test-org/existing-repo.git",
	}

	output, err := service.PrepareRemote(context.Background(), input)

	require.NoError(t, err)
	assert.Equal(t, "https://github.com/test-org/existing-repo.git", output.GitURL)
	assert.Equal(t, "token123", output.AccessToken)
	assert.Equal(t, "test-org", output.InstallationOrgName)
	assert.False(t, output.CreatedRepo) // Should not create repo
}
```

### Step 1.18: Run test to verify it fails

```bash
cd temporal-workflows
go test -v -run TestPrepareRemote_WithGitURL ./internal/services/
```

**Expected:** FAIL (method not implemented)

### Step 1.19: Implement PrepareRemote

**Add to:** `temporal-workflows/internal/services/github_service.go`

```go
func (s *GitHubServiceImpl) PrepareRemote(
	ctx context.Context,
	input PrepareRemoteInput,
) (*PrepareRemoteOutput, error) {
	// Find installation for workspace
	installation, err := s.FindInstallationForWorkspace(ctx, input.WorkspaceID, input.GitHubInstallationID)
	if err != nil {
		return nil, err
	}

	// Get decrypted token
	token, err := s.GetInstallationToken(ctx, installation)
	if err != nil {
		return nil, err
	}

	gitURL := input.GitURL
	createdRepo := false

	// Create repo if no git URL provided
	if gitURL == "" {
		if input.RepositoryName == "" {
			return nil, fmt.Errorf("repository_name required when creating new repo (no git_url provided)")
		}

		gitURL, err = s.CreateRepository(ctx, token, installation.AccountLogin, input.RepositoryName, input.Private)
		if err != nil {
			return nil, err
		}
		createdRepo = true
	}

	return &PrepareRemoteOutput{
		GitURL:              gitURL,
		AccessToken:         token,
		InstallationOrgName: installation.AccountLogin,
		CreatedRepo:         createdRepo,
	}, nil
}
```

### Step 1.20: Run test to verify it passes

```bash
cd temporal-workflows
go test -v -run TestPrepareRemote_WithGitURL ./internal/services/
```

**Expected:** PASS

### Step 1.21: Write test for PrepareRemote - create repo flow

**Add to:** `temporal-workflows/internal/services/github_service_test.go`

```go
func TestPrepareRemote_CreateRepo(t *testing.T) {
	mockPayload := &MockPayloadClient{
		Installations: []*Installation{
			{
				ID:             "install-123",
				InstallationID: 456,
				AccountLogin:   "test-org",
				EncryptedToken: "encrypted:token123",
				TokenExpiresAt: time.Now().Add(1 * time.Hour),
			},
		},
	}

	service := NewGitHubService(mockPayload, &MockEncryptionService{}, &MockGitHubClient{})

	input := PrepareRemoteInput{
		WorkspaceID:    "workspace-123",
		GitURL:         "", // Empty - should create repo
		RepositoryName: "new-repo",
		Private:        true,
	}

	output, err := service.PrepareRemote(context.Background(), input)

	require.NoError(t, err)
	assert.Equal(t, "https://github.com/test-org/new-repo.git", output.GitURL)
	assert.Equal(t, "token123", output.AccessToken)
	assert.Equal(t, "test-org", output.InstallationOrgName)
	assert.True(t, output.CreatedRepo) // Should have created repo
}
```

### Step 1.22: Run test to verify it passes

```bash
cd temporal-workflows
go test -v -run TestPrepareRemote_CreateRepo ./internal/services/
```

**Expected:** PASS

### Step 1.23: Run all service tests

```bash
cd temporal-workflows
go test -v ./internal/services/
```

**Expected:** All tests PASS

### Step 1.24: Commit GitHubService

```bash
cd /Users/drew.payment/dev/orbit/.worktrees/github-app-repo-integration
git add temporal-workflows/internal/services/
git commit -m "feat: implement GitHubService for GitHub App integration

- Create GitHubService interface with 4 methods
- Implement FindInstallationForWorkspace (smart default + override)
- Implement GetInstallationToken (with expiration check)
- Implement CreateRepository (delegates to GitHubClient)
- Implement PrepareRemote (orchestrator method)
- Comprehensive unit tests with mocks (9 test cases)
- All tests passing

Enables activities to find installations and get credentials.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Update GitActivities Constructor

**Goal:** Add GitHubService dependency to GitActivities struct.

**Files:**
- Modify: `temporal-workflows/internal/activities/git_activities.go`
- Modify: `temporal-workflows/cmd/worker/main.go`

### Step 2.1: Update GitActivities struct

**Modify:** `temporal-workflows/internal/activities/git_activities.go`

Find the `GitActivities` struct definition and update it:

```go
// Before
type GitActivities struct {
	workDir string
	logger  *slog.Logger
}

// After
type GitActivities struct {
	workDir       string
	githubService services.GitHubService  // NEW
	logger        *slog.Logger
}
```

Add import:
```go
import (
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)
```

### Step 2.2: Update NewGitActivities constructor

**Modify:** `temporal-workflows/internal/activities/git_activities.go`

Find the `NewGitActivities` function and update it:

```go
// Before
func NewGitActivities(workDir string, logger *slog.Logger) *GitActivities {
	return &GitActivities{
		workDir: workDir,
		logger:  logger,
	}
}

// After
func NewGitActivities(
	workDir string,
	githubService services.GitHubService,
	logger *slog.Logger,
) *GitActivities {
	return &GitActivities{
		workDir:       workDir,
		githubService: githubService,
		logger:        logger,
	}
}
```

### Step 2.3: Verify compilation

```bash
cd temporal-workflows
go build ./internal/activities/
```

**Expected:** Compilation error in `cmd/worker/main.go` (NewGitActivities signature changed)

### Step 2.4: Update worker initialization

**Modify:** `temporal-workflows/cmd/worker/main.go`

Find where `GitActivities` is created and update it:

```go
// You'll need to create the GitHub service dependencies first
// This is a placeholder - actual implementation depends on worker setup

// Add imports
import (
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// In main() or worker setup function, create GitHub service
payloadClient := NewPayloadClient() // TODO: Implement
encryptionService := NewEncryptionService() // TODO: Implement
githubClient := NewGitHubClient() // TODO: Implement

githubService := services.NewGitHubService(payloadClient, encryptionService, githubClient)

// Update GitActivities creation
gitActivities := activities.NewGitActivities(workDir, githubService, logger)
```

**Note:** The actual PayloadClient, EncryptionService, and GitHubClient implementations will be created in later tasks. For now, create stub implementations or use nil with a TODO comment.

### Step 2.5: Verify compilation

```bash
cd temporal-workflows
go build ./cmd/worker/
```

**Expected:** Successful compilation (or clear TODOs for service implementations)

### Step 2.6: Commit constructor updates

```bash
git add temporal-workflows/internal/activities/git_activities.go
git add temporal-workflows/cmd/worker/main.go
git commit -m "feat: add GitHubService dependency to GitActivities

- Update GitActivities struct with githubService field
- Update NewGitActivities constructor signature
- Update worker initialization (with TODOs for service impls)

Prepares activities to use GitHub App installation tokens.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Implement PrepareGitHubRemoteActivity

**Goal:** Create new activity that finds GitHub installation and prepares credentials for push.

**Files:**
- Modify: `temporal-workflows/internal/activities/git_activities.go`
- Create tests in existing: `temporal-workflows/internal/activities/git_activities_test.go`

### Step 3.1: Write test for PrepareGitHubRemoteActivity - with git URL

**Add to:** `temporal-workflows/internal/activities/git_activities_test.go`

```go
func TestGitActivities_PrepareGitHubRemoteActivity_WithGitURL(t *testing.T) {
	mockGitHubService := &MockGitHubService{
		PrepareRemoteFunc: func(ctx context.Context, input services.PrepareRemoteInput) (*services.PrepareRemoteOutput, error) {
			return &services.PrepareRemoteOutput{
				GitURL:              "https://github.com/test-org/existing-repo.git",
				AccessToken:         "token123",
				InstallationOrgName: "test-org",
				CreatedRepo:         false,
			}, nil
		},
	}

	activities := &GitActivities{
		githubService: mockGitHubService,
		logger:        slog.Default(),
	}

	input := PrepareGitHubRemoteInput{
		WorkspaceID: "workspace-123",
		GitURL:      "https://github.com/test-org/existing-repo.git",
	}

	output, err := activities.PrepareGitHubRemoteActivity(context.Background(), input)

	require.NoError(t, err)
	assert.Equal(t, "https://github.com/test-org/existing-repo.git", output.GitURL)
	assert.Equal(t, "token123", output.AccessToken)
	assert.False(t, output.CreatedRepo)
}

// Mock GitHubService
type MockGitHubService struct {
	PrepareRemoteFunc func(context.Context, services.PrepareRemoteInput) (*services.PrepareRemoteOutput, error)
}

func (m *MockGitHubService) PrepareRemote(ctx context.Context, input services.PrepareRemoteInput) (*services.PrepareRemoteOutput, error) {
	if m.PrepareRemoteFunc != nil {
		return m.PrepareRemoteFunc(ctx, input)
	}
	return nil, fmt.Errorf("PrepareRemoteFunc not set")
}

func (m *MockGitHubService) FindInstallationForWorkspace(ctx context.Context, workspaceID string, installationID *string) (*services.Installation, error) {
	return nil, fmt.Errorf("not implemented")
}

func (m *MockGitHubService) GetInstallationToken(ctx context.Context, installation *services.Installation) (string, error) {
	return "", fmt.Errorf("not implemented")
}

func (m *MockGitHubService) CreateRepository(ctx context.Context, token, orgName, repoName string, private bool) (string, error) {
	return "", fmt.Errorf("not implemented")
}
```

### Step 3.2: Run test to verify it fails

```bash
cd temporal-workflows
go test -v -run TestGitActivities_PrepareGitHubRemoteActivity_WithGitURL ./internal/activities/
```

**Expected:** FAIL (PrepareGitHubRemoteActivity not defined, input/output types not defined)

### Step 3.3: Define input/output structs

**Add to:** `temporal-workflows/internal/activities/git_activities.go`

```go
// PrepareGitHubRemoteInput contains parameters for preparing GitHub remote
type PrepareGitHubRemoteInput struct {
	WorkspaceID          string
	GitHubInstallationID string // Optional, empty string = use default
	GitURL               string // Optional, empty string = create repo
	RepositoryName       string // Required if GitURL empty
	Private              bool   // Default true
}

// PrepareGitHubRemoteOutput contains git URL and credentials
type PrepareGitHubRemoteOutput struct {
	GitURL              string
	AccessToken         string
	InstallationOrgName string
	CreatedRepo         bool
}
```

### Step 3.4: Implement PrepareGitHubRemoteActivity

**Add to:** `temporal-workflows/internal/activities/git_activities.go`

```go
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

	// Convert empty string to nil for optional installationID
	var installationID *string
	if input.GitHubInstallationID != "" {
		installationID = &input.GitHubInstallationID
	}

	// Call GitHub service
	serviceInput := services.PrepareRemoteInput{
		WorkspaceID:          input.WorkspaceID,
		GitHubInstallationID: installationID,
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

### Step 3.5: Run test to verify it passes

```bash
cd temporal-workflows
go test -v -run TestGitActivities_PrepareGitHubRemoteActivity_WithGitURL ./internal/activities/
```

**Expected:** PASS

### Step 3.6: Write test for PrepareGitHubRemoteActivity - create repo

**Add to:** `temporal-workflows/internal/activities/git_activities_test.go`

```go
func TestGitActivities_PrepareGitHubRemoteActivity_CreateRepo(t *testing.T) {
	mockGitHubService := &MockGitHubService{
		PrepareRemoteFunc: func(ctx context.Context, input services.PrepareRemoteInput) (*services.PrepareRemoteOutput, error) {
			assert.Equal(t, "", input.GitURL)
			assert.Equal(t, "new-repo", input.RepositoryName)
			return &services.PrepareRemoteOutput{
				GitURL:              "https://github.com/test-org/new-repo.git",
				AccessToken:         "token123",
				InstallationOrgName: "test-org",
				CreatedRepo:         true,
			}, nil
		},
	}

	activities := &GitActivities{
		githubService: mockGitHubService,
		logger:        slog.Default(),
	}

	input := PrepareGitHubRemoteInput{
		WorkspaceID:    "workspace-123",
		GitURL:         "", // Empty - should create repo
		RepositoryName: "new-repo",
		Private:        true,
	}

	output, err := activities.PrepareGitHubRemoteActivity(context.Background(), input)

	require.NoError(t, err)
	assert.Equal(t, "https://github.com/test-org/new-repo.git", output.GitURL)
	assert.True(t, output.CreatedRepo)
}
```

### Step 3.7: Run test to verify it passes

```bash
cd temporal-workflows
go test -v -run TestGitActivities_PrepareGitHubRemoteActivity_CreateRepo ./internal/activities/
```

**Expected:** PASS

### Step 3.8: Write test for validation errors

**Add to:** `temporal-workflows/internal/activities/git_activities_test.go`

```go
func TestGitActivities_PrepareGitHubRemoteActivity_ValidationErrors(t *testing.T) {
	activities := &GitActivities{
		githubService: &MockGitHubService{},
		logger:        slog.Default(),
	}

	// Missing workspace ID
	_, err := activities.PrepareGitHubRemoteActivity(context.Background(), PrepareGitHubRemoteInput{})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "workspace_id is required")

	// Missing repository name when creating repo
	_, err = activities.PrepareGitHubRemoteActivity(context.Background(), PrepareGitHubRemoteInput{
		WorkspaceID: "workspace-123",
		GitURL:      "", // Creating repo
		// RepositoryName missing
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "repository_name required")
}
```

### Step 3.9: Run all tests

```bash
cd temporal-workflows
go test -v -run TestGitActivities_PrepareGitHubRemoteActivity ./internal/activities/
```

**Expected:** All 3 tests PASS

### Step 3.10: Commit PrepareGitHubRemoteActivity

```bash
git add temporal-workflows/internal/activities/
git commit -m "feat: implement PrepareGitHubRemoteActivity

- Define input/output structs for activity
- Implement activity logic with GitHub service
- Add validation for required inputs
- Comprehensive tests (3 test cases: with URL, create repo, validation)
- All tests passing

Enables workflow to prepare GitHub credentials before push.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Modify PushToRemoteActivity

**Goal:** Update PushToRemoteActivity to accept explicit credentials instead of user OAuth lookup.

**Files:**
- Modify: `temporal-workflows/internal/activities/git_activities.go`
- Update tests in: `temporal-workflows/internal/activities/git_activities_test.go`

### Step 4.1: Review current PushToRemoteInput

Check the current implementation (it may be stubbed):

```bash
cd temporal-workflows
grep -A 5 "type PushToRemoteInput struct" internal/activities/git_activities.go
```

### Step 4.2: Write test for new PushToRemoteActivity signature

**Add to:** `temporal-workflows/internal/activities/git_activities_test.go`

```go
func TestGitActivities_PushToRemoteActivity_WithToken(t *testing.T) {
	tempDir := t.TempDir()
	repoPath := filepath.Join(tempDir, "test-repo")

	// Initialize git repo
	exec.Command("git", "init", repoPath).Run()
	exec.Command("git", "-C", repoPath, "config", "user.name", "Test").Run()
	exec.Command("git", "-C", repoPath, "config", "user.email", "test@example.com").Run()

	// Create test file and commit
	os.WriteFile(filepath.Join(repoPath, "README.md"), []byte("# Test"), 0644)
	exec.Command("git", "-C", repoPath, "add", ".").Run()
	exec.Command("git", "-C", repoPath, "commit", "-m", "Initial commit").Run()

	activities := &GitActivities{
		workDir: tempDir,
		logger:  slog.Default(),
	}

	input := PushToRemoteInput{
		RepositoryID: "test-repo",
		GitURL:       "https://github.com/test/repo.git",
		AccessToken:  "test-token",
	}

	err := activities.PushToRemoteActivity(context.Background(), input)

	// Will fail because no real remote, but should not error on missing credentials
	if err != nil {
		assert.NotContains(t, err.Error(), "user has not connected")
		assert.NotContains(t, err.Error(), "OAuth")
	}
}
```

### Step 4.3: Run test to verify current behavior

```bash
cd temporal-workflows
go test -v -run TestGitActivities_PushToRemoteActivity_WithToken ./internal/activities/
```

**Expected:** FAIL or SKIP (input struct may not match)

### Step 4.4: Update PushToRemoteInput struct

**Modify:** `temporal-workflows/internal/activities/git_activities.go`

Find and replace the `PushToRemoteInput` struct:

```go
// OLD (if exists)
type PushToRemoteInput struct {
	RepositoryID string
	UserID       string
	WorkspaceID  string
}

// NEW
type PushToRemoteInput struct {
	RepositoryID string
	GitURL       string // Explicit remote URL
	AccessToken  string // Explicit token (no lookup)
}
```

### Step 4.5: Update PushToRemoteActivity implementation

**Modify:** `temporal-workflows/internal/activities/git_activities.go`

Replace the entire `PushToRemoteActivity` method:

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

Add necessary imports if missing:
```go
import (
	"os/exec"
	"strings"
)
```

### Step 4.6: Run test to verify it passes

```bash
cd temporal-workflows
go test -v -run TestGitActivities_PushToRemoteActivity_WithToken ./internal/activities/
```

**Expected:** PASS (or fail on git push which is expected without real remote)

### Step 4.7: Write test for remote set/update behavior

**Add to:** `temporal-workflows/internal/activities/git_activities_test.go`

```go
func TestGitActivities_PushToRemoteActivity_SetRemote(t *testing.T) {
	tempDir := t.TempDir()
	repoPath := filepath.Join(tempDir, "test-repo")

	// Initialize git repo without remote
	exec.Command("git", "init", repoPath).Run()
	exec.Command("git", "-C", repoPath, "config", "user.name", "Test").Run()
	exec.Command("git", "-C", repoPath, "config", "user.email", "test@example.com").Run()
	os.WriteFile(filepath.Join(repoPath, "README.md"), []byte("# Test"), 0644)
	exec.Command("git", "-C", repoPath, "add", ".").Run()
	exec.Command("git", "-C", repoPath, "commit", "-m", "Initial commit").Run()

	activities := &GitActivities{
		workDir: tempDir,
		logger:  slog.Default(),
	}

	input := PushToRemoteInput{
		RepositoryID: "test-repo",
		GitURL:       "https://github.com/test/repo.git",
		AccessToken:  "test-token",
	}

	// First call - should add remote
	activities.PushToRemoteActivity(context.Background(), input)

	// Verify remote was added
	cmd := exec.Command("git", "-C", repoPath, "remote", "get-url", "origin")
	output, _ := cmd.Output()
	assert.Contains(t, string(output), "github.com/test/repo.git")
}
```

### Step 4.8: Run tests

```bash
cd temporal-workflows
go test -v -run TestGitActivities_PushToRemoteActivity ./internal/activities/
```

**Expected:** Tests PASS

### Step 4.9: Commit PushToRemoteActivity updates

```bash
git add temporal-workflows/internal/activities/
git commit -m "feat: update PushToRemoteActivity to use explicit credentials

- Remove user OAuth lookup (UserID, CredentialService)
- Add explicit GitURL and AccessToken parameters
- Add remote set/update logic
- Create credential helper for git authentication
- Comprehensive tests for new signature
- All tests passing

Completes GitHub App installation token integration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Update InitializeGitActivity

**Goal:** Change git identity to "Orbit IDP Bot" instead of user identity.

**Files:**
- Modify: `temporal-workflows/internal/activities/git_activities.go`

### Step 5.1: Find InitializeGitActivity implementation

```bash
cd temporal-workflows
grep -n "func.*InitializeGitActivity" internal/activities/git_activities.go
```

### Step 5.2: Update git config to use bot identity

**Modify:** `temporal-workflows/internal/activities/git_activities.go`

Find the git config section and update:

```go
// OLD (may vary)
configCmds := []struct {
	key   string
	value string
}{
	{"user.name", "Orbit IDP"}, // or user name
	{"user.email", "noreply@orbit-idp.com"}, // or user email
}

// NEW - ensure it's the bot identity
configCmds := []struct {
	key   string
	value string
}{
	{"user.name", "Orbit IDP"},
	{"user.email", "bot@orbit.dev"},
}
```

### Step 5.3: Verify tests still pass

```bash
cd temporal-workflows
go test -v -run TestGitActivities_InitializeGitActivity ./internal/activities/
```

**Expected:** Tests PASS (if they exist)

### Step 5.4: Commit InitializeGitActivity update

```bash
git add temporal-workflows/internal/activities/git_activities.go
git commit -m "feat: update InitializeGitActivity to use bot identity

- Set git user.name to 'Orbit IDP'
- Set git user.email to 'bot@orbit.dev'
- Commits attributed to bot, not individual users

Part of GitHub App installation integration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Update RepositoryWorkflow

**Goal:** Add PrepareGitHubRemoteActivity to workflow and pass credentials to PushToRemoteActivity.

**Files:**
- Modify: `temporal-workflows/internal/workflows/repository_workflow.go`
- Create/update tests: `temporal-workflows/internal/workflows/repository_workflow_test.go`

### Step 6.1: Update RepositoryWorkflowInput struct

**Modify:** `temporal-workflows/internal/workflows/repository_workflow.go`

Find the `RepositoryWorkflowInput` struct and update:

```go
// Add new fields
type RepositoryWorkflowInput struct {
	RepositoryID          string
	WorkspaceID           string            // REQUIRED - for GitHub installation lookup
	GitHubInstallationID  string            // OPTIONAL - override default installation
	TemplateName          string
	Variables             map[string]string
	GitURL                string            // OPTIONAL - if empty, create repo in GitHub
	RepositoryName        string            // REQUIRED if creating repo
}
```

### Step 6.2: Write test for updated workflow

**Add to:** `temporal-workflows/internal/workflows/repository_workflow_test.go`

```go
func TestRepositoryWorkflow_WithGitHubAppIntegration(t *testing.T) {
	testSuite := &testsuite.WorkflowTestSuite{}
	env := testSuite.NewTestWorkflowEnvironment()

	// Mock activities
	env.OnActivity(activities.CloneTemplateActivity, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(activities.ApplyVariablesActivity, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(activities.InitializeGitActivity, mock.Anything, mock.Anything).Return(nil)

	// Mock PrepareGitHubRemoteActivity
	env.OnActivity(activities.PrepareGitHubRemoteActivity, mock.Anything, mock.Anything).Return(
		&activities.PrepareGitHubRemoteOutput{
			GitURL:              "https://github.com/test-org/new-repo.git",
			AccessToken:         "token123",
			InstallationOrgName: "test-org",
			CreatedRepo:         true,
		}, nil,
	)

	env.OnActivity(activities.PushToRemoteActivity, mock.Anything, mock.Anything).Return(nil)

	input := RepositoryWorkflowInput{
		RepositoryID:   "repo-123",
		WorkspaceID:    "workspace-123",
		TemplateName:   "microservice",
		RepositoryName: "new-repo",
		Variables:      map[string]string{"service_name": "test"},
	}

	env.ExecuteWorkflow(RepositoryWorkflow, input)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())
}
```

### Step 6.3: Run test to verify it fails

```bash
cd temporal-workflows
go test -v -run TestRepositoryWorkflow_WithGitHubAppIntegration ./internal/workflows/
```

**Expected:** FAIL (workflow doesn't call PrepareGitHubRemoteActivity yet)

### Step 6.4: Update workflow to add PrepareGitHubRemoteActivity

**Modify:** `temporal-workflows/internal/workflows/repository_workflow.go`

Find the workflow function and add the new activity execution:

```go
func RepositoryWorkflow(ctx workflow.Context, input RepositoryWorkflowInput) error {
	// ... existing setup code ...

	// Task 1: Clone template (existing)
	err := workflow.ExecuteActivity(ctx, "CloneTemplateActivity", activities.CloneTemplateInput{
		RepositoryID: input.RepositoryID,
		TemplateName: input.TemplateName,
	}).Get(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to clone template: %w", err)
	}

	// Task 2: Apply variables (existing)
	err = workflow.ExecuteActivity(ctx, "ApplyVariablesActivity", activities.ApplyVariablesInput{
		RepositoryID: input.RepositoryID,
		Variables:    input.Variables,
	}).Get(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to apply variables: %w", err)
	}

	// Task 3: Initialize git (existing)
	err = workflow.ExecuteActivity(ctx, "InitializeGitActivity", activities.InitializeGitInput{
		RepositoryID: input.RepositoryID,
	}).Get(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to initialize git: %w", err)
	}

	// Task 4: Prepare GitHub remote (NEW)
	var remoteOutput *activities.PrepareGitHubRemoteOutput
	err = workflow.ExecuteActivity(ctx, "PrepareGitHubRemoteActivity", activities.PrepareGitHubRemoteInput{
		WorkspaceID:          input.WorkspaceID,
		GitHubInstallationID: input.GitHubInstallationID,
		GitURL:               input.GitURL,
		RepositoryName:       input.RepositoryName,
		Private:              true, // Default to private repos
	}).Get(ctx, &remoteOutput)
	if err != nil {
		return fmt.Errorf("failed to prepare GitHub remote: %w", err)
	}

	// Task 5: Push to remote (UPDATED - use credentials from PrepareGitHubRemoteActivity)
	err = workflow.ExecuteActivity(ctx, "PushToRemoteActivity", activities.PushToRemoteInput{
		RepositoryID: input.RepositoryID,
		GitURL:       remoteOutput.GitURL,
		AccessToken:  remoteOutput.AccessToken,
	}).Get(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to push to remote: %w", err)
	}

	logger.Info("Repository workflow completed successfully",
		"repositoryId", input.RepositoryID,
		"gitURL", remoteOutput.GitURL,
		"createdRepo", remoteOutput.CreatedRepo,
	)

	return nil
}
```

### Step 6.5: Run test to verify it passes

```bash
cd temporal-workflows
go test -v -run TestRepositoryWorkflow_WithGitHubAppIntegration ./internal/workflows/
```

**Expected:** PASS

### Step 6.6: Commit workflow updates

```bash
git add temporal-workflows/internal/workflows/
git commit -m "feat: integrate PrepareGitHubRemoteActivity into RepositoryWorkflow

- Update RepositoryWorkflowInput with workspace and GitHub fields
- Add PrepareGitHubRemoteActivity execution before push
- Pass credentials from PrepareGitHubRemoteActivity to PushToRemoteActivity
- Add workflow test with GitHub App integration
- Test passing

Completes end-to-end GitHub App integration in workflow.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Update Documentation

**Goal:** Mark relevant tasks complete in existing implementation plans.

**Files:**
- Modify: `docs/plans/2025-11-02-backend-activities-implementation.md`
- Modify: `docs/plans/2025-11-13-github-app-installation.md`

### Step 7.1: Update backend activities plan

**Modify:** `docs/plans/2025-11-02-backend-activities-implementation.md`

Find Task 4 section and update the status:

```markdown
## Task 4: Implement Push to Remote Activity ✅ COMPLETE

**Goal:** Push repository to remote Git provider using GitHub App installation token.

**Status:** ✅ Completed (2025-11-18)
**Implementation:** See `docs/plans/2025-11-18-github-app-repository-integration-implementation.md`

**Changes from original plan:**
- Replaced user OAuth approach with GitHub App installation tokens
- Added PrepareGitHubRemoteActivity to handle installation lookup and token decryption
- PushToRemoteActivity now accepts explicit credentials (no user context needed)

[Keep rest of existing content for reference]
```

### Step 7.2: Update GitHub App installation plan

**Modify:** `docs/plans/2025-11-13-github-app-installation.md`

Find Task 9 section and update:

```markdown
### Task 9: Update Git Activities to Use Installation Tokens ✅ COMPLETE

**Status:** ✅ Complete (2025-11-18)
**Implementation:** See `docs/plans/2025-11-18-github-app-repository-integration-implementation.md`

**Completed:**
- ✅ Created GitHubService with installation lookup, token decryption, repo creation
- ✅ Updated GitActivities to depend on GitHubService
- ✅ Implemented PrepareGitHubRemoteActivity
- ✅ Modified PushToRemoteActivity to use explicit credentials
- ✅ Updated InitializeGitActivity with bot identity
- ✅ Integrated into RepositoryWorkflow

[Keep rest of existing content for reference]
```

### Step 7.3: Commit documentation updates

```bash
git add docs/plans/2025-11-02-backend-activities-implementation.md
git add docs/plans/2025-11-13-github-app-installation.md
git commit -m "docs: mark GitHub App integration tasks complete

- Update backend activities plan Task 4 status
- Update GitHub App installation plan Task 9 status
- Reference implementation plan for details

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Manual Testing

**Goal:** Verify the integration works end-to-end with a real GitHub installation.

**Prerequisites:**
- Temporal server running (localhost:7233)
- Payload CMS accessible
- At least one GitHub installation configured for a test workspace
- Temporal worker running with new code

### Step 8.1: Rebuild and restart Temporal worker

```bash
cd temporal-workflows
go build -o bin/worker ./cmd/worker
./bin/worker
```

**Expected:** Worker starts without errors, registers all activities including PrepareGitHubRemoteActivity

### Step 8.2: Verify GitHub installation exists

Navigate to Payload admin:
```
http://localhost:3000/admin/collections/github-installations
```

**Expected:** At least one installation with:
- Status: "active"
- Allowed workspaces: Includes your test workspace
- Token refresh workflow: "running"

### Step 8.3: Trigger test workflow without git URL (create repo)

Using Temporal CLI or web UI:

```bash
temporal workflow start \
  --task-queue orbit-workflows \
  --type RepositoryWorkflow \
  --workflow-id test-repo-creation-$(date +%s) \
  --input '{
    "RepositoryID": "test-repo-123",
    "WorkspaceID": "YOUR_WORKSPACE_ID",
    "TemplateName": "microservice",
    "RepositoryName": "test-orbit-repo",
    "Variables": {
      "service_name": "test-service",
      "description": "Test repository from Orbit"
    }
  }'
```

**Expected:**
- Workflow completes successfully
- Check GitHub: New repository created in installation's org
- Check Temporal UI: All activities show as completed
- Repository contains template files with variables applied

### Step 8.4: Trigger test workflow with git URL (existing repo)

First, manually create a test repo in GitHub, then:

```bash
temporal workflow start \
  --task-queue orbit-workflows \
  --type RepositoryWorkflow \
  --workflow-id test-repo-push-$(date +%s) \
  --input '{
    "RepositoryID": "test-repo-456",
    "WorkspaceID": "YOUR_WORKSPACE_ID",
    "TemplateName": "microservice",
    "GitURL": "https://github.com/YOUR_ORG/existing-test-repo.git",
    "Variables": {
      "service_name": "test-service"
    }
  }'
```

**Expected:**
- Workflow completes successfully
- Check GitHub: Existing repository updated with new commits
- PrepareGitHubRemoteActivity skipped repo creation (CreatedRepo: false)

### Step 8.5: Test error scenarios

**Test 1: No GitHub installation**

Use a workspace ID that has no GitHub installation configured:

```bash
temporal workflow start \
  --task-queue orbit-workflows \
  --type RepositoryWorkflow \
  --workflow-id test-no-installation-$(date +%s) \
  --input '{
    "RepositoryID": "test-repo-999",
    "WorkspaceID": "WORKSPACE_WITHOUT_GITHUB",
    "TemplateName": "microservice",
    "RepositoryName": "should-fail"
  }'
```

**Expected:**
- Workflow fails at PrepareGitHubRemoteActivity
- Error message: "no active GitHub App installation found for workspace..."
- Error message includes: "Please ask an admin..."

**Test 2: Invalid installation ID override**

```bash
temporal workflow start \
  --task-queue orbit-workflows \
  --type RepositoryWorkflow \
  --workflow-id test-invalid-installation-$(date +%s) \
  --input '{
    "RepositoryID": "test-repo-999",
    "WorkspaceID": "YOUR_WORKSPACE_ID",
    "GitHubInstallationID": "invalid-install-id",
    "TemplateName": "microservice",
    "RepositoryName": "should-fail"
  }'
```

**Expected:**
- Workflow fails at PrepareGitHubRemoteActivity
- Error message: "GitHub installation invalid-install-id not found..."

### Step 8.6: Verify commit attribution

Check one of the created repositories in GitHub:

```bash
git clone https://github.com/YOUR_ORG/test-orbit-repo.git
cd test-orbit-repo
git log --format="%an <%ae>" | head -1
```

**Expected:** `Orbit IDP <bot@orbit.dev>`

### Step 8.7: Document test results

**Add to this plan:**

```markdown
## Manual Testing Results (2025-11-18)

✅ Worker starts and registers activities successfully
✅ Create new repo: Repository created in GitHub with template content
✅ Push to existing repo: Existing repository updated successfully
✅ Error handling: No installation - clear error message
✅ Error handling: Invalid installation ID - clear error message
✅ Commit attribution: All commits show "Orbit IDP <bot@orbit.dev>"

**Issues Found:** [None] or [List any issues]

**Test Environment:**
- Temporal: localhost:7233
- Payload: localhost:3000
- GitHub Org: [ORG_NAME]
- Test Workspace: [WORKSPACE_ID]
```

### Step 8.8: Commit test results documentation

```bash
git add docs/plans/2025-11-18-github-app-repository-integration-implementation.md
git commit -m "docs: add manual testing results

- Document successful end-to-end tests
- Verify error handling works as designed
- Confirm commit attribution to bot identity

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Implementation Complete Checklist

Before considering this implementation complete, verify:

- [ ] **Task 1:** GitHubService implemented with all 4 methods and comprehensive tests (80%+ coverage)
- [ ] **Task 2:** GitActivities constructor updated with GitHubService dependency
- [ ] **Task 3:** PrepareGitHubRemoteActivity implemented with tests (3+ test cases)
- [ ] **Task 4:** PushToRemoteActivity updated to use explicit credentials (no user OAuth)
- [ ] **Task 5:** InitializeGitActivity uses bot identity ("Orbit IDP <bot@orbit.dev>")
- [ ] **Task 6:** RepositoryWorkflow orchestrates PrepareGitHubRemoteActivity → PushToRemoteActivity
- [ ] **Task 7:** Documentation updated (backend activities plan + GitHub App plan)
- [ ] **Task 8:** Manual testing complete with successful workflows and error handling verified
- [ ] **All tests passing:** `go test ./...` in temporal-workflows
- [ ] **Worker compiles:** `go build ./cmd/worker`
- [ ] **No lint errors:** `golangci-lint run` (if configured)

---

## Next Steps After Implementation

1. **Merge to main branch:**
   - Run `superpowers:finishing-a-development-branch` skill
   - Create pull request
   - Code review
   - Merge

2. **Deploy to staging:**
   - Update Temporal worker deployment
   - Verify GitHub App installation in staging environment
   - Run integration tests

3. **Frontend integration:**
   - Update repository creation UI to pass `WorkspaceID` and `GitHubInstallationID`
   - Add UI for selecting which GitHub org to use (if multiple)
   - Display clear errors when GitHub App not configured

4. **Production deployment:**
   - Document GitHub App installation process for admins
   - Update user documentation
   - Monitor token refresh workflow

---

## Troubleshooting Common Issues

### Issue: "Worker fails to start"

**Cause:** Missing service implementations (PayloadClient, EncryptionService, GitHubClient)

**Fix:** Implement the interface stubs in `cmd/worker/main.go` or create placeholder implementations

### Issue: "Tests fail with 'nil pointer dereference'"

**Cause:** Mock not properly configured

**Fix:** Ensure all mock methods are implemented, even if they just return errors

### Issue: "Cannot find installation for workspace"

**Cause:** Workspace not added to installation's `allowedWorkspaces` array

**Fix:** Update installation in Payload admin to include the workspace

### Issue: "Push fails with authentication error"

**Cause:** Token expired or invalid

**Fix:**
1. Check token expiration in Payload
2. Verify token refresh workflow is running
3. Manually trigger token refresh if needed

---

**Plan Status:** Ready for execution
**Estimated Time:** 3-4 hours (8 tasks, ~20-30 minutes each)
**Complexity:** Medium (new service layer + activity modifications + workflow updates)
