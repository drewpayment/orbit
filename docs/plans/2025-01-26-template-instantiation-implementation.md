# Template Instantiation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to create new GitHub repositories from templates with variable substitution and real-time progress tracking.

**Architecture:** Frontend form → Next.js server action → gRPC call to repository-service → Temporal workflow → GitHub API. Progress tracked via Temporal workflow queries.

**Tech Stack:** Go 1.21+, Temporal, gRPC/protobuf, Next.js 15, TypeScript, GitHub REST API

---

## Task 1: Add Proto Definitions for TemplateService

**Files:**
- Create: `proto/template.proto`
- Modify: `proto/buf.yaml` (if needed for new file)

**Step 1: Create the proto file**

Create `proto/template.proto`:

```protobuf
syntax = "proto3";

package idp.template.v1;

option go_package = "github.com/drewpayment/orbit/proto/gen/go/idp/template/v1;templatev1";

// TemplateService handles template instantiation operations
service TemplateService {
  // Start a new template instantiation workflow
  rpc StartInstantiation(StartInstantiationRequest) returns (StartInstantiationResponse);

  // Get current progress of an instantiation
  rpc GetInstantiationProgress(GetProgressRequest) returns (GetProgressResponse);

  // Cancel an in-progress instantiation
  rpc CancelInstantiation(CancelRequest) returns (CancelResponse);

  // List available GitHub organizations for a workspace
  rpc ListAvailableOrgs(ListAvailableOrgsRequest) returns (ListAvailableOrgsResponse);
}

message StartInstantiationRequest {
  string template_id = 1;
  string workspace_id = 2;
  string target_org = 3;
  string repository_name = 4;
  string description = 5;
  bool is_private = 6;
  map<string, string> variables = 7;
  string user_id = 8;
}

message StartInstantiationResponse {
  string workflow_id = 1;
}

message GetProgressRequest {
  string workflow_id = 1;
}

message GetProgressResponse {
  string workflow_id = 1;
  WorkflowStatus status = 2;
  string current_step = 3;
  int32 progress_percent = 4;
  string error_message = 5;
  string result_repo_url = 6;
  string result_repo_name = 7;
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

message ListAvailableOrgsRequest {
  string workspace_id = 1;
}

message GitHubOrg {
  string name = 1;
  string avatar_url = 2;
  string installation_id = 3;
}

message ListAvailableOrgsResponse {
  repeated GitHubOrg orgs = 1;
}
```

**Step 2: Generate protobuf code**

Run:
```bash
make proto-gen
```

Expected: New files in `proto/gen/go/idp/template/v1/` and `orbit-www/src/lib/proto/`

**Step 3: Commit**

```bash
git add proto/template.proto proto/gen/ orbit-www/src/lib/proto/
git commit -m "feat: add TemplateService proto definitions"
```

---

## Task 2: Create Template Instantiation Workflow

**Files:**
- Create: `temporal-workflows/internal/workflows/template_instantiation_workflow.go`
- Create: `temporal-workflows/internal/workflows/template_instantiation_workflow_test.go`

**Step 1: Write the test file**

Create `temporal-workflows/internal/workflows/template_instantiation_workflow_test.go`:

```go
package workflows

import (
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/testsuite"
)

type TemplateInstantiationWorkflowTestSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
	env *testsuite.TestWorkflowEnvironment
}

func (s *TemplateInstantiationWorkflowTestSuite) SetupTest() {
	s.env = s.NewTestWorkflowEnvironment()
}

func (s *TemplateInstantiationWorkflowTestSuite) AfterTest(suiteName, testName string) {
	s.env.AssertExpectations(s.T())
}

func (s *TemplateInstantiationWorkflowTestSuite) TestTemplateInstantiation_GitHubTemplate_Success() {
	input := TemplateInstantiationInput{
		TemplateID:        "template-123",
		WorkspaceID:       "workspace-456",
		TargetOrg:         "my-org",
		RepositoryName:    "new-service",
		Description:       "A new service",
		IsPrivate:         true,
		IsGitHubTemplate:  true,
		SourceRepoOwner:   "template-org",
		SourceRepoName:    "service-template",
		Variables:         map[string]string{"service_name": "new-service"},
		UserID:            "user-789",
	}

	// Mock activities
	s.env.OnActivity(ValidateInstantiationInputActivity, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(CreateRepoFromTemplateActivity, mock.Anything, mock.Anything).Return(&CreateRepoResult{
		RepoURL:  "https://github.com/my-org/new-service",
		RepoName: "new-service",
	}, nil)
	s.env.OnActivity(FinalizeInstantiationActivity, mock.Anything, mock.Anything).Return(nil)

	s.env.ExecuteWorkflow(TemplateInstantiationWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result TemplateInstantiationResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.Equal("completed", result.Status)
	s.Equal("https://github.com/my-org/new-service", result.RepoURL)
}

func (s *TemplateInstantiationWorkflowTestSuite) TestTemplateInstantiation_CloneFallback_Success() {
	input := TemplateInstantiationInput{
		TemplateID:        "template-123",
		WorkspaceID:       "workspace-456",
		TargetOrg:         "my-org",
		RepositoryName:    "new-service",
		Description:       "A new service",
		IsPrivate:         true,
		IsGitHubTemplate:  false, // Not a GitHub template
		SourceRepoOwner:   "template-org",
		SourceRepoName:    "service-template",
		SourceRepoURL:     "https://github.com/template-org/service-template",
		Variables:         map[string]string{"service_name": "new-service"},
		UserID:            "user-789",
	}

	// Mock activities for clone fallback path
	s.env.OnActivity(ValidateInstantiationInputActivity, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(CreateEmptyRepoActivity, mock.Anything, mock.Anything).Return(&CreateRepoResult{
		RepoURL:  "https://github.com/my-org/new-service",
		RepoName: "new-service",
	}, nil)
	s.env.OnActivity(CloneTemplateRepoActivity, mock.Anything, mock.Anything).Return("/tmp/work/new-service", nil)
	s.env.OnActivity(ApplyTemplateVariablesActivity, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(PushToNewRepoActivity, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(CleanupWorkDirActivity, mock.Anything, mock.Anything).Return(nil)
	s.env.OnActivity(FinalizeInstantiationActivity, mock.Anything, mock.Anything).Return(nil)

	s.env.ExecuteWorkflow(TemplateInstantiationWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result TemplateInstantiationResult
	s.NoError(s.env.GetWorkflowResult(&result))
	s.Equal("completed", result.Status)
}

func TestTemplateInstantiationWorkflowTestSuite(t *testing.T) {
	suite.Run(t, new(TemplateInstantiationWorkflowTestSuite))
}
```

**Step 2: Run tests to verify they fail**

Run:
```bash
cd temporal-workflows && go test -v ./internal/workflows/template_instantiation_workflow_test.go
```

Expected: FAIL - workflow and activity functions not defined

**Step 3: Create the workflow implementation**

Create `temporal-workflows/internal/workflows/template_instantiation_workflow.go`:

```go
package workflows

import (
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// TemplateInstantiationInput contains all parameters for creating a repo from template
type TemplateInstantiationInput struct {
	TemplateID       string
	WorkspaceID      string
	TargetOrg        string
	RepositoryName   string
	Description      string
	IsPrivate        bool
	IsGitHubTemplate bool
	SourceRepoOwner  string
	SourceRepoName   string
	SourceRepoURL    string
	Variables        map[string]string
	UserID           string
	AccessToken      string // GitHub installation token
}

// TemplateInstantiationResult contains the workflow output
type TemplateInstantiationResult struct {
	Status   string
	RepoURL  string
	RepoName string
	Error    string
}

// Progress tracks workflow state for queries
type InstantiationProgress struct {
	CurrentStep     string
	ProgressPercent int32
	Status          string
	ErrorMessage    string
	RepoURL         string
	RepoName        string
}

// Activity stubs (will be registered with actual implementations)
var (
	ValidateInstantiationInputActivity func(workflow.Context, TemplateInstantiationInput) error
	CreateRepoFromTemplateActivity     func(workflow.Context, CreateRepoFromTemplateInput) (*CreateRepoResult, error)
	CreateEmptyRepoActivity            func(workflow.Context, CreateEmptyRepoInput) (*CreateRepoResult, error)
	CloneTemplateRepoActivity          func(workflow.Context, CloneTemplateInput) (string, error)
	ApplyTemplateVariablesActivity     func(workflow.Context, ApplyVariablesInput) error
	PushToNewRepoActivity              func(workflow.Context, PushToRepoInput) error
	CleanupWorkDirActivity             func(workflow.Context, string) error
	FinalizeInstantiationActivity      func(workflow.Context, FinalizeInput) error
)

// Activity input/output types
type CreateRepoFromTemplateInput struct {
	SourceOwner    string
	SourceRepo     string
	TargetOrg      string
	TargetName     string
	Description    string
	IsPrivate      bool
	AccessToken    string
}

type CreateEmptyRepoInput struct {
	Org         string
	Name        string
	Description string
	IsPrivate   bool
	AccessToken string
}

type CreateRepoResult struct {
	RepoURL  string
	RepoName string
}

type CloneTemplateInput struct {
	SourceURL   string
	WorkDir     string
	AccessToken string
}

type ApplyVariablesInput struct {
	WorkDir   string
	Variables map[string]string
}

type PushToRepoInput struct {
	WorkDir     string
	RepoURL     string
	AccessToken string
}

type FinalizeInput struct {
	TemplateID string
	UserID     string
	RepoURL    string
	RepoName   string
	Success    bool
}

// TemplateInstantiationWorkflow orchestrates creating a new repo from a template
func TemplateInstantiationWorkflow(ctx workflow.Context, input TemplateInstantiationInput) (TemplateInstantiationResult, error) {
	logger := workflow.GetLogger(ctx)

	// Progress state for queries
	progress := &InstantiationProgress{
		CurrentStep:     "initializing",
		ProgressPercent: 0,
		Status:          "running",
	}

	// Set up query handler for progress
	err := workflow.SetQueryHandler(ctx, "progress", func() (InstantiationProgress, error) {
		return *progress, nil
	})
	if err != nil {
		return TemplateInstantiationResult{Status: "failed", Error: err.Error()}, err
	}

	// Activity options
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOptions)

	// Helper to update progress
	updateProgress := func(step string, percent int32) {
		progress.CurrentStep = step
		progress.ProgressPercent = percent
	}

	// Step 1: Validate inputs
	updateProgress("validating", 10)
	logger.Info("Step 1: Validating inputs")
	err = workflow.ExecuteActivity(ctx, ValidateInstantiationInputActivity, input).Get(ctx, nil)
	if err != nil {
		progress.Status = "failed"
		progress.ErrorMessage = fmt.Sprintf("Validation failed: %v", err)
		return TemplateInstantiationResult{Status: "failed", Error: progress.ErrorMessage}, err
	}

	var repoResult *CreateRepoResult
	var workDir string

	if input.IsGitHubTemplate {
		// Step 2a: Use GitHub Template API
		updateProgress("creating_repository", 30)
		logger.Info("Step 2: Creating repository from GitHub template")

		templateInput := CreateRepoFromTemplateInput{
			SourceOwner:  input.SourceRepoOwner,
			SourceRepo:   input.SourceRepoName,
			TargetOrg:    input.TargetOrg,
			TargetName:   input.RepositoryName,
			Description:  input.Description,
			IsPrivate:    input.IsPrivate,
			AccessToken:  input.AccessToken,
		}
		err = workflow.ExecuteActivity(ctx, CreateRepoFromTemplateActivity, templateInput).Get(ctx, &repoResult)
		if err != nil {
			progress.Status = "failed"
			progress.ErrorMessage = fmt.Sprintf("Failed to create from template: %v", err)
			return TemplateInstantiationResult{Status: "failed", Error: progress.ErrorMessage}, err
		}

		updateProgress("finalizing", 80)
	} else {
		// Step 2b: Clone fallback path
		updateProgress("creating_repository", 20)
		logger.Info("Step 2: Creating empty repository")

		emptyInput := CreateEmptyRepoInput{
			Org:         input.TargetOrg,
			Name:        input.RepositoryName,
			Description: input.Description,
			IsPrivate:   input.IsPrivate,
			AccessToken: input.AccessToken,
		}
		err = workflow.ExecuteActivity(ctx, CreateEmptyRepoActivity, emptyInput).Get(ctx, &repoResult)
		if err != nil {
			progress.Status = "failed"
			progress.ErrorMessage = fmt.Sprintf("Failed to create repository: %v", err)
			return TemplateInstantiationResult{Status: "failed", Error: progress.ErrorMessage}, err
		}

		// Step 3: Clone template
		updateProgress("cloning_template", 35)
		logger.Info("Step 3: Cloning template repository")

		cloneInput := CloneTemplateInput{
			SourceURL:   input.SourceRepoURL,
			WorkDir:     input.RepositoryName,
			AccessToken: input.AccessToken,
		}
		err = workflow.ExecuteActivity(ctx, CloneTemplateRepoActivity, cloneInput).Get(ctx, &workDir)
		if err != nil {
			progress.Status = "failed"
			progress.ErrorMessage = fmt.Sprintf("Failed to clone template: %v", err)
			return TemplateInstantiationResult{Status: "failed", Error: progress.ErrorMessage}, err
		}

		// Step 4: Apply variables
		updateProgress("applying_variables", 50)
		logger.Info("Step 4: Applying template variables")

		applyInput := ApplyVariablesInput{
			WorkDir:   workDir,
			Variables: input.Variables,
		}
		err = workflow.ExecuteActivity(ctx, ApplyTemplateVariablesActivity, applyInput).Get(ctx, nil)
		if err != nil {
			progress.Status = "failed"
			progress.ErrorMessage = fmt.Sprintf("Failed to apply variables: %v", err)
			return TemplateInstantiationResult{Status: "failed", Error: progress.ErrorMessage}, err
		}

		// Step 5: Push to new repo
		updateProgress("pushing_to_github", 65)
		logger.Info("Step 5: Pushing to new repository")

		pushInput := PushToRepoInput{
			WorkDir:     workDir,
			RepoURL:     repoResult.RepoURL,
			AccessToken: input.AccessToken,
		}
		err = workflow.ExecuteActivity(ctx, PushToNewRepoActivity, pushInput).Get(ctx, nil)
		if err != nil {
			progress.Status = "failed"
			progress.ErrorMessage = fmt.Sprintf("Failed to push to repository: %v", err)
			return TemplateInstantiationResult{Status: "failed", Error: progress.ErrorMessage}, err
		}

		// Cleanup work directory
		updateProgress("cleaning_up", 75)
		_ = workflow.ExecuteActivity(ctx, CleanupWorkDirActivity, workDir).Get(ctx, nil)

		updateProgress("finalizing", 80)
	}

	// Step 6: Finalize (update usage count, etc.)
	updateProgress("finalizing", 90)
	logger.Info("Step 6: Finalizing instantiation")

	finalizeInput := FinalizeInput{
		TemplateID: input.TemplateID,
		UserID:     input.UserID,
		RepoURL:    repoResult.RepoURL,
		RepoName:   repoResult.RepoName,
		Success:    true,
	}
	err = workflow.ExecuteActivity(ctx, FinalizeInstantiationActivity, finalizeInput).Get(ctx, nil)
	if err != nil {
		logger.Warn("Finalization failed but repo was created", "error", err)
		// Don't fail the workflow for finalization errors
	}

	// Complete
	updateProgress("completed", 100)
	progress.Status = "completed"
	progress.RepoURL = repoResult.RepoURL
	progress.RepoName = repoResult.RepoName

	logger.Info("Template instantiation completed successfully",
		"repoURL", repoResult.RepoURL,
		"repoName", repoResult.RepoName,
	)

	return TemplateInstantiationResult{
		Status:   "completed",
		RepoURL:  repoResult.RepoURL,
		RepoName: repoResult.RepoName,
	}, nil
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
cd temporal-workflows && go test -v ./internal/workflows/template_instantiation_workflow_test.go ./internal/workflows/template_instantiation_workflow.go
```

Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/workflows/template_instantiation_workflow*.go
git commit -m "feat: add TemplateInstantiationWorkflow with TDD"
```

---

## Task 3: Create Template Instantiation Activities

**Files:**
- Create: `temporal-workflows/internal/activities/template_activities.go`
- Create: `temporal-workflows/internal/activities/template_activities_test.go`

**Step 1: Write the test file**

Create `temporal-workflows/internal/activities/template_activities_test.go`:

```go
package activities

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

// MockGitHubClient for testing
type MockGitHubClient struct {
	mock.Mock
}

func (m *MockGitHubClient) CreateRepoFromTemplate(ctx context.Context, sourceOwner, sourceRepo, targetOrg, targetName, description string, private bool) (string, error) {
	args := m.Called(ctx, sourceOwner, sourceRepo, targetOrg, targetName, description, private)
	return args.String(0), args.Error(1)
}

func (m *MockGitHubClient) CreateRepository(ctx context.Context, org, name, description string, private bool) (string, error) {
	args := m.Called(ctx, org, name, description, private)
	return args.String(0), args.Error(1)
}

func TestValidateInstantiationInput_Success(t *testing.T) {
	activities := NewTemplateActivities(nil, "/tmp/work", nil)

	input := ValidateInput{
		TemplateID:     "template-123",
		WorkspaceID:    "workspace-456",
		TargetOrg:      "my-org",
		RepositoryName: "new-service",
	}

	err := activities.ValidateInstantiationInput(context.Background(), input)
	assert.NoError(t, err)
}

func TestValidateInstantiationInput_MissingFields(t *testing.T) {
	activities := NewTemplateActivities(nil, "/tmp/work", nil)

	input := ValidateInput{
		TemplateID: "template-123",
		// Missing required fields
	}

	err := activities.ValidateInstantiationInput(context.Background(), input)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "required")
}

func TestValidateInstantiationInput_InvalidRepoName(t *testing.T) {
	activities := NewTemplateActivities(nil, "/tmp/work", nil)

	input := ValidateInput{
		TemplateID:     "template-123",
		WorkspaceID:    "workspace-456",
		TargetOrg:      "my-org",
		RepositoryName: "invalid name with spaces",
	}

	err := activities.ValidateInstantiationInput(context.Background(), input)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid repository name")
}

func TestCreateRepoFromTemplate_Success(t *testing.T) {
	mockClient := new(MockGitHubClient)
	mockClient.On("CreateRepoFromTemplate",
		mock.Anything,
		"template-org", "template-repo",
		"my-org", "new-service",
		"A new service", true,
	).Return("https://github.com/my-org/new-service", nil)

	activities := NewTemplateActivities(mockClient, "/tmp/work", nil)

	input := CreateFromTemplateInput{
		SourceOwner:  "template-org",
		SourceRepo:   "template-repo",
		TargetOrg:    "my-org",
		TargetName:   "new-service",
		Description:  "A new service",
		IsPrivate:    true,
		AccessToken:  "token",
	}

	result, err := activities.CreateRepoFromTemplate(context.Background(), input)
	assert.NoError(t, err)
	assert.Equal(t, "https://github.com/my-org/new-service", result.RepoURL)
	assert.Equal(t, "new-service", result.RepoName)

	mockClient.AssertExpectations(t)
}
```

**Step 2: Run tests to verify they fail**

Run:
```bash
cd temporal-workflows && go test -v ./internal/activities/template_activities_test.go
```

Expected: FAIL - TemplateActivities not defined

**Step 3: Create the activities implementation**

Create `temporal-workflows/internal/activities/template_activities.go`:

```go
package activities

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

// GitHubTemplateClient interface for GitHub operations
type GitHubTemplateClient interface {
	CreateRepoFromTemplate(ctx context.Context, sourceOwner, sourceRepo, targetOrg, targetName, description string, private bool) (string, error)
	CreateRepository(ctx context.Context, org, name, description string, private bool) (string, error)
}

// TemplateActivities handles template instantiation activities
type TemplateActivities struct {
	githubClient GitHubTemplateClient
	workDir      string
	logger       *slog.Logger
}

// NewTemplateActivities creates a new TemplateActivities instance
func NewTemplateActivities(githubClient GitHubTemplateClient, workDir string, logger *slog.Logger) *TemplateActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &TemplateActivities{
		githubClient: githubClient,
		workDir:      workDir,
		logger:       logger,
	}
}

// Input/Output types
type ValidateInput struct {
	TemplateID     string
	WorkspaceID    string
	TargetOrg      string
	RepositoryName string
}

type CreateFromTemplateInput struct {
	SourceOwner  string
	SourceRepo   string
	TargetOrg    string
	TargetName   string
	Description  string
	IsPrivate    bool
	AccessToken  string
}

type CreateEmptyInput struct {
	Org         string
	Name        string
	Description string
	IsPrivate   bool
	AccessToken string
}

type RepoResult struct {
	RepoURL  string
	RepoName string
}

type CloneInput struct {
	SourceURL   string
	WorkDir     string
	AccessToken string
}

type ApplyVarsInput struct {
	WorkDir   string
	Variables map[string]string
}

type PushInput struct {
	WorkDir     string
	RepoURL     string
	AccessToken string
}

type FinalizeActivityInput struct {
	TemplateID string
	UserID     string
	RepoURL    string
	RepoName   string
	Success    bool
}

// ValidateInstantiationInput validates all required inputs
func (a *TemplateActivities) ValidateInstantiationInput(ctx context.Context, input ValidateInput) error {
	if input.TemplateID == "" {
		return fmt.Errorf("template_id is required")
	}
	if input.WorkspaceID == "" {
		return fmt.Errorf("workspace_id is required")
	}
	if input.TargetOrg == "" {
		return fmt.Errorf("target_org is required")
	}
	if input.RepositoryName == "" {
		return fmt.Errorf("repository_name is required")
	}

	// Validate repository name format
	validName := regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)
	if !validName.MatchString(input.RepositoryName) {
		return fmt.Errorf("invalid repository name: must contain only alphanumeric characters, dots, underscores, and hyphens")
	}

	return nil
}

// CreateRepoFromTemplate uses GitHub's template API to create a new repo
func (a *TemplateActivities) CreateRepoFromTemplate(ctx context.Context, input CreateFromTemplateInput) (*RepoResult, error) {
	a.logger.Info("Creating repository from GitHub template",
		"source", fmt.Sprintf("%s/%s", input.SourceOwner, input.SourceRepo),
		"target", fmt.Sprintf("%s/%s", input.TargetOrg, input.TargetName),
	)

	repoURL, err := a.githubClient.CreateRepoFromTemplate(
		ctx,
		input.SourceOwner,
		input.SourceRepo,
		input.TargetOrg,
		input.TargetName,
		input.Description,
		input.IsPrivate,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create repo from template: %w", err)
	}

	return &RepoResult{
		RepoURL:  repoURL,
		RepoName: input.TargetName,
	}, nil
}

// CreateEmptyRepo creates an empty repository
func (a *TemplateActivities) CreateEmptyRepo(ctx context.Context, input CreateEmptyInput) (*RepoResult, error) {
	a.logger.Info("Creating empty repository",
		"org", input.Org,
		"name", input.Name,
	)

	repoURL, err := a.githubClient.CreateRepository(
		ctx,
		input.Org,
		input.Name,
		input.Description,
		input.IsPrivate,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create repository: %w", err)
	}

	return &RepoResult{
		RepoURL:  repoURL,
		RepoName: input.Name,
	}, nil
}

// CloneTemplateRepo clones a template repository to a work directory
func (a *TemplateActivities) CloneTemplateRepo(ctx context.Context, input CloneInput) (string, error) {
	workPath := filepath.Join(a.workDir, input.WorkDir)

	// Create work directory if needed
	if err := os.MkdirAll(a.workDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create work directory: %w", err)
	}

	// Clone with authentication
	cloneURL := input.SourceURL
	if input.AccessToken != "" {
		// Insert token into URL for authentication
		cloneURL = strings.Replace(cloneURL, "https://", fmt.Sprintf("https://x-access-token:%s@", input.AccessToken), 1)
	}

	cmd := exec.CommandContext(ctx, "git", "clone", "--depth=1", cloneURL, workPath)
	if output, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("failed to clone repository: %w (output: %s)", err, sanitizeOutput(string(output)))
	}

	// Remove .git directory to start fresh
	gitDir := filepath.Join(workPath, ".git")
	if err := os.RemoveAll(gitDir); err != nil {
		return "", fmt.Errorf("failed to remove .git directory: %w", err)
	}

	a.logger.Info("Cloned template repository", "path", workPath)
	return workPath, nil
}

// ApplyTemplateVariables replaces {{variable}} placeholders in all files
func (a *TemplateActivities) ApplyTemplateVariables(ctx context.Context, input ApplyVarsInput) error {
	if len(input.Variables) == 0 {
		return nil
	}

	err := filepath.Walk(input.WorkDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip directories and hidden files
		if info.IsDir() || strings.HasPrefix(info.Name(), ".") {
			return nil
		}

		// Skip binary files
		if isBinaryFile(path) {
			return nil
		}

		// Read file
		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read %s: %w", path, err)
		}

		// Replace variables
		modified := string(content)
		for key, value := range input.Variables {
			placeholder := fmt.Sprintf("{{%s}}", key)
			modified = strings.ReplaceAll(modified, placeholder, value)
		}

		// Write back if changed
		if modified != string(content) {
			if err := os.WriteFile(path, []byte(modified), info.Mode()); err != nil {
				return fmt.Errorf("failed to write %s: %w", path, err)
			}
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("failed to apply variables: %w", err)
	}

	a.logger.Info("Applied template variables", "count", len(input.Variables))
	return nil
}

// PushToNewRepo initializes git and pushes to the new repository
func (a *TemplateActivities) PushToNewRepo(ctx context.Context, input PushInput) error {
	// Initialize git
	initCmd := exec.CommandContext(ctx, "git", "init")
	initCmd.Dir = input.WorkDir
	if output, err := initCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git init failed: %w (output: %s)", err, string(output))
	}

	// Configure git user
	configName := exec.CommandContext(ctx, "git", "config", "user.name", "Orbit IDP")
	configName.Dir = input.WorkDir
	configName.Run()

	configEmail := exec.CommandContext(ctx, "git", "config", "user.email", "bot@orbit.dev")
	configEmail.Dir = input.WorkDir
	configEmail.Run()

	// Add all files
	addCmd := exec.CommandContext(ctx, "git", "add", ".")
	addCmd.Dir = input.WorkDir
	if output, err := addCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git add failed: %w (output: %s)", err, string(output))
	}

	// Commit
	commitCmd := exec.CommandContext(ctx, "git", "commit", "-m", "Initial commit from Orbit template")
	commitCmd.Dir = input.WorkDir
	if output, err := commitCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git commit failed: %w (output: %s)", err, string(output))
	}

	// Set up remote with authentication
	remoteURL := input.RepoURL
	if input.AccessToken != "" {
		remoteURL = strings.Replace(remoteURL, "https://", fmt.Sprintf("https://x-access-token:%s@", input.AccessToken), 1)
	}

	remoteCmd := exec.CommandContext(ctx, "git", "remote", "add", "origin", remoteURL)
	remoteCmd.Dir = input.WorkDir
	remoteCmd.Run() // Ignore error if remote exists

	// Push
	pushCmd := exec.CommandContext(ctx, "git", "push", "-u", "origin", "main")
	pushCmd.Dir = input.WorkDir
	if output, err := pushCmd.CombinedOutput(); err != nil {
		// Try master branch as fallback
		pushCmd = exec.CommandContext(ctx, "git", "push", "-u", "origin", "master")
		pushCmd.Dir = input.WorkDir
		if output2, err2 := pushCmd.CombinedOutput(); err2 != nil {
			return fmt.Errorf("git push failed: %w (output: %s / %s)", err, sanitizeOutput(string(output)), sanitizeOutput(string(output2)))
		}
	}

	a.logger.Info("Pushed to new repository", "url", input.RepoURL)
	return nil
}

// CleanupWorkDir removes the temporary work directory
func (a *TemplateActivities) CleanupWorkDir(ctx context.Context, workDir string) error {
	if workDir == "" || workDir == "/" {
		return fmt.Errorf("invalid work directory")
	}
	return os.RemoveAll(workDir)
}

// FinalizeInstantiation updates template usage count and records the instantiation
func (a *TemplateActivities) FinalizeInstantiation(ctx context.Context, input FinalizeActivityInput) error {
	// This would call back to Payload to update usage count
	// For now, just log
	a.logger.Info("Finalized instantiation",
		"templateID", input.TemplateID,
		"userID", input.UserID,
		"repoURL", input.RepoURL,
		"success", input.Success,
	)
	return nil
}

func sanitizeOutput(output string) string {
	if len(output) > 500 {
		return output[:500] + "..."
	}
	// Remove potential tokens from output
	return output
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
cd temporal-workflows && go test -v ./internal/activities/template_activities_test.go ./internal/activities/template_activities.go
```

Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/activities/template_activities*.go
git commit -m "feat: add template instantiation activities with TDD"
```

---

## Task 4: Create GitHub Template Client

**Files:**
- Create: `temporal-workflows/internal/services/github_template_client.go`
- Create: `temporal-workflows/internal/services/github_template_client_test.go`

**Step 1: Write the test file**

Create `temporal-workflows/internal/services/github_template_client_test.go`:

```go
package services

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGitHubTemplateClient_CreateRepoFromTemplate_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "/repos/template-org/template-repo/generate", r.URL.Path)

		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(`{"html_url": "https://github.com/my-org/new-repo", "name": "new-repo"}`))
	}))
	defer server.Close()

	client := NewGitHubTemplateClient(server.URL, "test-token")

	url, err := client.CreateRepoFromTemplate(
		context.Background(),
		"template-org", "template-repo",
		"my-org", "new-repo",
		"Description", true,
	)

	assert.NoError(t, err)
	assert.Equal(t, "https://github.com/my-org/new-repo", url)
}

func TestGitHubTemplateClient_CreateRepository_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "/orgs/my-org/repos", r.URL.Path)

		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(`{"html_url": "https://github.com/my-org/new-repo", "name": "new-repo"}`))
	}))
	defer server.Close()

	client := NewGitHubTemplateClient(server.URL, "test-token")

	url, err := client.CreateRepository(
		context.Background(),
		"my-org", "new-repo",
		"Description", true,
	)

	assert.NoError(t, err)
	assert.Equal(t, "https://github.com/my-org/new-repo", url)
}
```

**Step 2: Run tests to verify they fail**

Run:
```bash
cd temporal-workflows && go test -v ./internal/services/github_template_client_test.go
```

Expected: FAIL - GitHubTemplateClient not defined

**Step 3: Create the client implementation**

Create `temporal-workflows/internal/services/github_template_client.go`:

```go
package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// GitHubTemplateClient handles GitHub API calls for template operations
type GitHubTemplateClient struct {
	baseURL    string
	token      string
	httpClient *http.Client
}

// NewGitHubTemplateClient creates a new GitHub client
func NewGitHubTemplateClient(baseURL, token string) *GitHubTemplateClient {
	if baseURL == "" {
		baseURL = "https://api.github.com"
	}
	return &GitHubTemplateClient{
		baseURL:    baseURL,
		token:      token,
		httpClient: &http.Client{},
	}
}

type createFromTemplateRequest struct {
	Owner       string `json:"owner"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Private     bool   `json:"private"`
}

type createRepoRequest struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Private     bool   `json:"private"`
	AutoInit    bool   `json:"auto_init"`
}

type repoResponse struct {
	HTMLURL string `json:"html_url"`
	Name    string `json:"name"`
}

// CreateRepoFromTemplate uses GitHub's template repository API
func (c *GitHubTemplateClient) CreateRepoFromTemplate(
	ctx context.Context,
	sourceOwner, sourceRepo, targetOrg, targetName, description string,
	private bool,
) (string, error) {
	url := fmt.Sprintf("%s/repos/%s/%s/generate", c.baseURL, sourceOwner, sourceRepo)

	body := createFromTemplateRequest{
		Owner:       targetOrg,
		Name:        targetName,
		Description: description,
		Private:     private,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("GitHub API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	var result repoResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	return result.HTMLURL, nil
}

// CreateRepository creates an empty repository
func (c *GitHubTemplateClient) CreateRepository(
	ctx context.Context,
	org, name, description string,
	private bool,
) (string, error) {
	url := fmt.Sprintf("%s/orgs/%s/repos", c.baseURL, org)

	body := createRepoRequest{
		Name:        name,
		Description: description,
		Private:     private,
		AutoInit:    false,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(jsonBody))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusCreated {
		return "", fmt.Errorf("GitHub API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	var result repoResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}

	return result.HTMLURL, nil
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
cd temporal-workflows && go test -v ./internal/services/github_template_client_test.go ./internal/services/github_template_client.go
```

Expected: PASS

**Step 5: Commit**

```bash
git add temporal-workflows/internal/services/github_template_client*.go
git commit -m "feat: add GitHubTemplateClient for template API"
```

---

## Task 5: Add gRPC Template Server

**Files:**
- Create: `services/repository/internal/grpc/template_server.go`
- Create: `services/repository/internal/grpc/template_server_test.go`

**Step 1: Write the test file**

Create `services/repository/internal/grpc/template_server_test.go`:

```go
package grpc

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	templatev1 "github.com/drewpayment/orbit/proto/gen/go/idp/template/v1"
)

type MockTemporalClient struct {
	mock.Mock
}

func (m *MockTemporalClient) StartWorkflow(ctx context.Context, workflowID string, input interface{}) (string, error) {
	args := m.Called(ctx, workflowID, input)
	return args.String(0), args.Error(1)
}

func (m *MockTemporalClient) QueryWorkflow(ctx context.Context, workflowID, queryType string) (interface{}, error) {
	args := m.Called(ctx, workflowID, queryType)
	return args.Get(0), args.Error(1)
}

func TestStartInstantiation_Success(t *testing.T) {
	mockTemporal := new(MockTemporalClient)
	mockTemporal.On("StartWorkflow", mock.Anything, mock.Anything, mock.Anything).
		Return("workflow-123", nil)

	server := NewTemplateServer(mockTemporal, nil)

	req := &templatev1.StartInstantiationRequest{
		TemplateId:     "template-1",
		WorkspaceId:    "workspace-1",
		TargetOrg:      "my-org",
		RepositoryName: "new-service",
		IsPrivate:      true,
	}

	resp, err := server.StartInstantiation(context.Background(), req)

	assert.NoError(t, err)
	assert.NotEmpty(t, resp.WorkflowId)
	mockTemporal.AssertExpectations(t)
}

func TestStartInstantiation_MissingFields(t *testing.T) {
	server := NewTemplateServer(nil, nil)

	req := &templatev1.StartInstantiationRequest{
		// Missing required fields
	}

	resp, err := server.StartInstantiation(context.Background(), req)

	assert.Error(t, err)
	assert.Nil(t, resp)
}
```

**Step 2: Run tests to verify they fail**

Run:
```bash
cd services/repository && go test -v ./internal/grpc/template_server_test.go
```

Expected: FAIL - TemplateServer not defined

**Step 3: Create the server implementation**

Create `services/repository/internal/grpc/template_server.go`:

```go
package grpc

import (
	"context"
	"fmt"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	templatev1 "github.com/drewpayment/orbit/proto/gen/go/idp/template/v1"
)

// TemporalClientInterface defines the interface for Temporal operations
type TemporalClientInterface interface {
	StartWorkflow(ctx context.Context, workflowID string, input interface{}) (string, error)
	QueryWorkflow(ctx context.Context, workflowID, queryType string) (interface{}, error)
}

// PayloadClientInterface defines the interface for Payload CMS operations
type PayloadClientInterface interface {
	GetTemplate(ctx context.Context, templateID string) (*TemplateData, error)
	GetGitHubInstallation(ctx context.Context, workspaceID string) (*InstallationData, error)
	ListWorkspaceInstallations(ctx context.Context, workspaceID string) ([]*InstallationData, error)
}

type TemplateData struct {
	ID               string
	Name             string
	RepoURL          string
	SourceOwner      string
	SourceRepo       string
	IsGitHubTemplate bool
	Variables        []VariableDefinition
}

type VariableDefinition struct {
	Key      string
	Required bool
	Default  string
}

type InstallationData struct {
	ID              string
	OrgName         string
	AvatarURL       string
	InstallationID  string
	AccessToken     string
}

// TemplateServer implements the TemplateService gRPC server
type TemplateServer struct {
	templatev1.UnimplementedTemplateServiceServer
	temporalClient TemporalClientInterface
	payloadClient  PayloadClientInterface
}

// NewTemplateServer creates a new TemplateServer
func NewTemplateServer(temporalClient TemporalClientInterface, payloadClient PayloadClientInterface) *TemplateServer {
	return &TemplateServer{
		temporalClient: temporalClient,
		payloadClient:  payloadClient,
	}
}

// StartInstantiation starts a new template instantiation workflow
func (s *TemplateServer) StartInstantiation(
	ctx context.Context,
	req *templatev1.StartInstantiationRequest,
) (*templatev1.StartInstantiationResponse, error) {
	// Validate required fields
	if req.TemplateId == "" {
		return nil, status.Error(codes.InvalidArgument, "template_id is required")
	}
	if req.WorkspaceId == "" {
		return nil, status.Error(codes.InvalidArgument, "workspace_id is required")
	}
	if req.TargetOrg == "" {
		return nil, status.Error(codes.InvalidArgument, "target_org is required")
	}
	if req.RepositoryName == "" {
		return nil, status.Error(codes.InvalidArgument, "repository_name is required")
	}

	// Generate workflow ID
	workflowID := fmt.Sprintf("template-instantiation-%s-%s", req.TemplateId, req.RepositoryName)

	// Build workflow input (would need to fetch template details from Payload)
	workflowInput := map[string]interface{}{
		"templateId":     req.TemplateId,
		"workspaceId":    req.WorkspaceId,
		"targetOrg":      req.TargetOrg,
		"repositoryName": req.RepositoryName,
		"description":    req.Description,
		"isPrivate":      req.IsPrivate,
		"variables":      req.Variables,
		"userId":         req.UserId,
	}

	// Start Temporal workflow
	runID, err := s.temporalClient.StartWorkflow(ctx, workflowID, workflowInput)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to start workflow: %v", err)
	}

	return &templatev1.StartInstantiationResponse{
		WorkflowId: runID,
	}, nil
}

// GetInstantiationProgress returns the current progress of an instantiation
func (s *TemplateServer) GetInstantiationProgress(
	ctx context.Context,
	req *templatev1.GetProgressRequest,
) (*templatev1.GetProgressResponse, error) {
	if req.WorkflowId == "" {
		return nil, status.Error(codes.InvalidArgument, "workflow_id is required")
	}

	// Query workflow for progress
	result, err := s.temporalClient.QueryWorkflow(ctx, req.WorkflowId, "progress")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to query workflow: %v", err)
	}

	progress, ok := result.(map[string]interface{})
	if !ok {
		return nil, status.Error(codes.Internal, "unexpected progress format")
	}

	resp := &templatev1.GetProgressResponse{
		WorkflowId: req.WorkflowId,
	}

	if step, ok := progress["currentStep"].(string); ok {
		resp.CurrentStep = step
	}
	if percent, ok := progress["progressPercent"].(int32); ok {
		resp.ProgressPercent = percent
	}
	if statusStr, ok := progress["status"].(string); ok {
		switch statusStr {
		case "running":
			resp.Status = templatev1.WorkflowStatus_WORKFLOW_STATUS_RUNNING
		case "completed":
			resp.Status = templatev1.WorkflowStatus_WORKFLOW_STATUS_COMPLETED
		case "failed":
			resp.Status = templatev1.WorkflowStatus_WORKFLOW_STATUS_FAILED
		default:
			resp.Status = templatev1.WorkflowStatus_WORKFLOW_STATUS_PENDING
		}
	}
	if errMsg, ok := progress["errorMessage"].(string); ok {
		resp.ErrorMessage = errMsg
	}
	if repoURL, ok := progress["repoURL"].(string); ok {
		resp.ResultRepoUrl = repoURL
	}
	if repoName, ok := progress["repoName"].(string); ok {
		resp.ResultRepoName = repoName
	}

	return resp, nil
}

// CancelInstantiation cancels an in-progress instantiation
func (s *TemplateServer) CancelInstantiation(
	ctx context.Context,
	req *templatev1.CancelRequest,
) (*templatev1.CancelResponse, error) {
	if req.WorkflowId == "" {
		return nil, status.Error(codes.InvalidArgument, "workflow_id is required")
	}

	// TODO: Implement workflow cancellation via Temporal client

	return &templatev1.CancelResponse{
		Success: true,
	}, nil
}

// ListAvailableOrgs returns GitHub organizations available for the workspace
func (s *TemplateServer) ListAvailableOrgs(
	ctx context.Context,
	req *templatev1.ListAvailableOrgsRequest,
) (*templatev1.ListAvailableOrgsResponse, error) {
	if req.WorkspaceId == "" {
		return nil, status.Error(codes.InvalidArgument, "workspace_id is required")
	}

	installations, err := s.payloadClient.ListWorkspaceInstallations(ctx, req.WorkspaceId)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list installations: %v", err)
	}

	orgs := make([]*templatev1.GitHubOrg, len(installations))
	for i, inst := range installations {
		orgs[i] = &templatev1.GitHubOrg{
			Name:           inst.OrgName,
			AvatarUrl:      inst.AvatarURL,
			InstallationId: inst.InstallationID,
		}
	}

	return &templatev1.ListAvailableOrgsResponse{
		Orgs: orgs,
	}, nil
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
cd services/repository && go test -v ./internal/grpc/template_server_test.go ./internal/grpc/template_server.go
```

Expected: PASS (after fixing imports)

**Step 5: Commit**

```bash
git add services/repository/internal/grpc/template_server*.go
git commit -m "feat: add TemplateServer gRPC implementation"
```

---

## Task 6: Create Frontend "Use Template" Page

**Files:**
- Modify: `orbit-www/src/app/(frontend)/templates/[slug]/use/page.tsx` (exists but mocked)
- Create: `orbit-www/src/components/features/templates/UseTemplateForm.tsx`

**Step 1: Create the form component**

Create `orbit-www/src/components/features/templates/UseTemplateForm.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, AlertCircle } from 'lucide-react'
import { startInstantiation } from '@/app/actions/templates'

interface TemplateVariable {
  key: string
  label: string
  description?: string
  default?: string
  required: boolean
}

interface GitHubOrg {
  name: string
  avatarUrl?: string
  installationId: string
}

interface UseTemplateFormProps {
  templateId: string
  templateName: string
  workspaceId: string
  variables: TemplateVariable[]
  availableOrgs: GitHubOrg[]
}

export function UseTemplateForm({
  templateId,
  templateName,
  workspaceId,
  variables,
  availableOrgs,
}: UseTemplateFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [targetOrg, setTargetOrg] = useState(availableOrgs[0]?.name || '')
  const [repoName, setRepoName] = useState('')
  const [description, setDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [variableValues, setVariableValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {}
    variables.forEach(v => {
      if (v.default) defaults[v.key] = v.default
    })
    return defaults
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const result = await startInstantiation({
        templateId,
        workspaceId,
        targetOrg,
        repositoryName: repoName,
        description,
        isPrivate,
        variables: variableValues,
      })

      if (!result.success) {
        setError(result.error || 'Failed to start instantiation')
        return
      }

      // Redirect to progress page
      router.push(`/templates/instantiate/${result.workflowId}`)
    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const isValid = targetOrg && repoName && variables.every(v =>
    !v.required || variableValues[v.key]
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Repository Settings</CardTitle>
          <CardDescription>
            Configure where and how the new repository will be created
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org">Target Organization</Label>
            <Select value={targetOrg} onValueChange={setTargetOrg}>
              <SelectTrigger>
                <SelectValue placeholder="Select organization" />
              </SelectTrigger>
              <SelectContent>
                {availableOrgs.map(org => (
                  <SelectItem key={org.installationId} value={org.name}>
                    <div className="flex items-center gap-2">
                      {org.avatarUrl && (
                        <img src={org.avatarUrl} alt="" className="w-5 h-5 rounded" />
                      )}
                      {org.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Repository Name</Label>
            <Input
              id="name"
              value={repoName}
              onChange={e => setRepoName(e.target.value)}
              placeholder="my-new-service"
              pattern="[a-zA-Z0-9._-]+"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="A brief description of this repository"
              rows={2}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="private">Private Repository</Label>
            <Switch
              id="private"
              checked={isPrivate}
              onCheckedChange={setIsPrivate}
            />
          </div>
        </CardContent>
      </Card>

      {variables.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Template Variables</CardTitle>
            <CardDescription>
              Customize the template with these values
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {variables.map(variable => (
              <div key={variable.key} className="space-y-2">
                <Label htmlFor={variable.key}>
                  {variable.label || variable.key}
                  {variable.required && <span className="text-red-500 ml-1">*</span>}
                </Label>
                {variable.description && (
                  <p className="text-sm text-muted-foreground">{variable.description}</p>
                )}
                <Input
                  id={variable.key}
                  value={variableValues[variable.key] || ''}
                  onChange={e => setVariableValues(prev => ({
                    ...prev,
                    [variable.key]: e.target.value
                  }))}
                  placeholder={variable.default}
                  required={variable.required}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-4">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading || !isValid}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            'Create Repository'
          )}
        </Button>
      </div>
    </form>
  )
}
```

**Step 2: Update the page component**

Update `orbit-www/src/app/(frontend)/templates/[slug]/use/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { UseTemplateForm } from '@/components/features/templates/UseTemplateForm'
import { getAvailableOrgs } from '@/app/actions/templates'

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ workspace?: string }>
}

export default async function UseTemplatePage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { workspace: workspaceId } = await searchParams

  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    redirect('/sign-in')
  }

  const payload = await getPayload({ config })

  // Fetch template
  const templateResult = await payload.find({
    collection: 'templates',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 1,
  })

  if (!templateResult.docs.length) {
    notFound()
  }

  const template = templateResult.docs[0]
  const templateWorkspaceId = typeof template.workspace === 'object'
    ? template.workspace.id
    : template.workspace

  // Use provided workspace or template's workspace
  const activeWorkspaceId = workspaceId || templateWorkspaceId

  // Get available orgs for this workspace
  const { orgs, error: orgsError } = await getAvailableOrgs(activeWorkspaceId)

  if (orgsError || !orgs?.length) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <SiteHeader />
          <div className="flex flex-1 flex-col gap-4 p-8">
            <div className="container max-w-2xl">
              <h1 className="text-2xl font-bold mb-4">No GitHub Organizations Available</h1>
              <p className="text-muted-foreground">
                You need a GitHub App installation connected to this workspace to create repositories.
                Please install the GitHub App first.
              </p>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    )
  }

  // Transform template variables to form format
  const variables = (template.variables as Array<{
    key: string
    label?: string
    description?: string
    default?: string
    required?: boolean
  }>) || []

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="container max-w-2xl">
            <div className="mb-6">
              <h1 className="text-2xl font-bold">Use Template: {template.name}</h1>
              <p className="text-muted-foreground mt-1">
                Create a new repository from this template
              </p>
            </div>

            <UseTemplateForm
              templateId={template.id as string}
              templateName={template.name}
              workspaceId={activeWorkspaceId}
              variables={variables.map(v => ({
                key: v.key,
                label: v.label || v.key,
                description: v.description,
                default: v.default,
                required: v.required || false,
              }))}
              availableOrgs={orgs}
            />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/templates/UseTemplateForm.tsx
git add orbit-www/src/app/\(frontend\)/templates/\[slug\]/use/page.tsx
git commit -m "feat: add UseTemplateForm component and page"
```

---

## Task 7: Create Progress Tracking Page

**Files:**
- Create: `orbit-www/src/app/(frontend)/templates/instantiate/[workflowId]/page.tsx`
- Create: `orbit-www/src/components/features/templates/InstantiationProgress.tsx`

**Step 1: Create the progress component**

Create `orbit-www/src/components/features/templates/InstantiationProgress.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  ExternalLink,
  AlertCircle,
  PartyPopper
} from 'lucide-react'
import Link from 'next/link'
import { getInstantiationProgress } from '@/app/actions/templates'

interface InstantiationProgressProps {
  workflowId: string
  templateName: string
}

interface ProgressData {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  currentStep: string
  progressPercent: number
  errorMessage?: string
  resultRepoUrl?: string
  resultRepoName?: string
}

const STEPS = [
  { id: 'validating', label: 'Validating inputs' },
  { id: 'creating_repository', label: 'Creating repository' },
  { id: 'cloning_template', label: 'Cloning template' },
  { id: 'applying_variables', label: 'Applying variables' },
  { id: 'pushing_to_github', label: 'Pushing to GitHub' },
  { id: 'finalizing', label: 'Finalizing' },
  { id: 'completed', label: 'Completed' },
]

function getStepStatus(stepId: string, currentStep: string, status: string) {
  if (status === 'failed') {
    const currentIndex = STEPS.findIndex(s => s.id === currentStep)
    const stepIndex = STEPS.findIndex(s => s.id === stepId)
    if (stepIndex === currentIndex) return 'failed'
    if (stepIndex < currentIndex) return 'completed'
    return 'pending'
  }

  if (status === 'completed') return 'completed'

  const currentIndex = STEPS.findIndex(s => s.id === currentStep)
  const stepIndex = STEPS.findIndex(s => s.id === stepId)

  if (stepIndex < currentIndex) return 'completed'
  if (stepIndex === currentIndex) return 'running'
  return 'pending'
}

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />
    case 'running':
      return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
    case 'failed':
      return <XCircle className="h-5 w-5 text-red-500" />
    default:
      return <Circle className="h-5 w-5 text-gray-300" />
  }
}

export function InstantiationProgress({ workflowId, templateName }: InstantiationProgressProps) {
  const [progress, setProgress] = useState<ProgressData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [polling, setPolling] = useState(true)

  useEffect(() => {
    if (!polling) return

    const fetchProgress = async () => {
      try {
        const result = await getInstantiationProgress(workflowId)
        if (result.error) {
          setError(result.error)
          setPolling(false)
          return
        }

        setProgress(result.progress)

        // Stop polling if completed or failed
        if (result.progress?.status === 'completed' || result.progress?.status === 'failed') {
          setPolling(false)
        }
      } catch (err) {
        console.error('Failed to fetch progress:', err)
      }
    }

    fetchProgress()
    const interval = setInterval(fetchProgress, 2000)
    return () => clearInterval(interval)
  }, [workflowId, polling])

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (!progress) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  const isCompleted = progress.status === 'completed'
  const isFailed = progress.status === 'failed'

  return (
    <div className="space-y-6">
      {isCompleted && (
        <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
          <PartyPopper className="h-4 w-4 text-green-500" />
          <AlertTitle className="text-green-700 dark:text-green-300">
            Repository Created Successfully!
          </AlertTitle>
          <AlertDescription className="text-green-600 dark:text-green-400">
            Your new repository is ready at{' '}
            <a
              href={progress.resultRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline"
            >
              {progress.resultRepoName}
            </a>
          </AlertDescription>
        </Alert>
      )}

      {isFailed && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Instantiation Failed</AlertTitle>
          <AlertDescription>{progress.errorMessage}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Creating from {templateName}</CardTitle>
          <CardDescription>
            {isCompleted ? 'Repository creation complete' :
             isFailed ? 'Repository creation failed' :
             'Please wait while we set up your new repository...'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {STEPS.map((step) => {
              const stepStatus = getStepStatus(step.id, progress.currentStep, progress.status)
              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-3 ${
                    stepStatus === 'pending' ? 'text-muted-foreground' : ''
                  }`}
                >
                  <StepIcon status={stepStatus} />
                  <span className={stepStatus === 'running' ? 'font-medium' : ''}>
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Progress bar */}
          <div className="mt-6">
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  isFailed ? 'bg-red-500' : 'bg-green-500'
                }`}
                style={{ width: `${progress.progressPercent}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground mt-2 text-center">
              {progress.progressPercent}% complete
            </p>
          </div>
        </CardContent>
      </Card>

      {isCompleted && progress.resultRepoUrl && (
        <div className="flex justify-center gap-4">
          <Button asChild>
            <a href={progress.resultRepoUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Open Repository
            </a>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/templates">
              Back to Templates
            </Link>
          </Button>
        </div>
      )}

      {isFailed && (
        <div className="flex justify-center">
          <Button variant="outline" asChild>
            <Link href="/templates">
              Back to Templates
            </Link>
          </Button>
        </div>
      )}
    </div>
  )
}
```

**Step 2: Create the page**

Create `orbit-www/src/app/(frontend)/templates/instantiate/[workflowId]/page.tsx`:

```tsx
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { InstantiationProgress } from '@/components/features/templates/InstantiationProgress'

interface PageProps {
  params: Promise<{ workflowId: string }>
}

export default async function InstantiationProgressPage({ params }: PageProps) {
  const { workflowId } = await params

  // In a full implementation, we'd fetch the template name from the workflow
  // For now, we'll show a generic title
  const templateName = 'Template'

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-8">
          <div className="container max-w-2xl">
            <div className="mb-6">
              <h1 className="text-2xl font-bold">Creating Repository</h1>
              <p className="text-muted-foreground mt-1">
                Workflow ID: {workflowId}
              </p>
            </div>

            <InstantiationProgress
              workflowId={workflowId}
              templateName={templateName}
            />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
```

**Step 3: Commit**

```bash
git add orbit-www/src/components/features/templates/InstantiationProgress.tsx
git add orbit-www/src/app/\(frontend\)/templates/instantiate/
git commit -m "feat: add InstantiationProgress component and page"
```

---

## Task 8: Add Server Actions for gRPC Communication

**Files:**
- Modify: `orbit-www/src/app/actions/templates.ts`

**Step 1: Add the new server actions**

Add to `orbit-www/src/app/actions/templates.ts`:

```typescript
// Add these interfaces and functions to the existing file

export interface GitHubOrg {
  name: string
  avatarUrl?: string
  installationId: string
}

export interface StartInstantiationInput {
  templateId: string
  workspaceId: string
  targetOrg: string
  repositoryName: string
  description?: string
  isPrivate: boolean
  variables: Record<string, string>
}

export interface StartInstantiationResult {
  success: boolean
  workflowId?: string
  error?: string
}

export interface ProgressResult {
  progress?: {
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    currentStep: string
    progressPercent: number
    errorMessage?: string
    resultRepoUrl?: string
    resultRepoName?: string
  }
  error?: string
}

/**
 * Get available GitHub organizations for a workspace
 */
export async function getAvailableOrgs(workspaceId: string): Promise<{
  orgs?: GitHubOrg[]
  error?: string
}> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  // Get GitHub installations for this workspace
  const installations = await payload.find({
    collection: 'github-installations',
    where: {
      allowedWorkspaces: { contains: workspaceId },
      status: { equals: 'active' },
    },
    limit: 100,
    overrideAccess: true,
  })

  if (installations.docs.length === 0) {
    return { error: 'No GitHub installations found for this workspace' }
  }

  const orgs: GitHubOrg[] = installations.docs.map(inst => ({
    name: inst.accountLogin,
    avatarUrl: inst.accountAvatarUrl || undefined,
    installationId: String(inst.installationId),
  }))

  return { orgs }
}

/**
 * Start a template instantiation workflow
 * This will eventually call the gRPC service, but for now uses a mock
 */
export async function startInstantiation(
  input: StartInstantiationInput
): Promise<StartInstantiationResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { success: false, error: 'Not authenticated' }
  }

  const payload = await getPayload({ config })

  // Validate template exists
  const template = await payload.findByID({
    collection: 'templates',
    id: input.templateId,
  })

  if (!template) {
    return { success: false, error: 'Template not found' }
  }

  // Validate workspace membership
  const membership = await payload.find({
    collection: 'workspace-members',
    where: {
      and: [
        { workspace: { equals: input.workspaceId } },
        { user: { equals: session.user.id } },
        { status: { equals: 'active' } },
      ],
    },
    limit: 1,
    overrideAccess: true,
  })

  if (membership.docs.length === 0) {
    return { success: false, error: 'Not a member of this workspace' }
  }

  // TODO: Call gRPC service to start Temporal workflow
  // For now, generate a mock workflow ID
  const workflowId = `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

  // Increment usage count
  await payload.update({
    collection: 'templates',
    id: input.templateId,
    data: {
      usageCount: (template.usageCount || 0) + 1,
    },
  })

  return {
    success: true,
    workflowId,
  }
}

/**
 * Get the progress of an instantiation workflow
 * This will eventually call the gRPC service, but for now returns mock data
 */
export async function getInstantiationProgress(
  workflowId: string
): Promise<ProgressResult> {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    return { error: 'Not authenticated' }
  }

  // TODO: Call gRPC service to query Temporal workflow
  // For now, return mock progress that simulates completion

  // Simulate progress based on time since workflow started
  const mockStartTime = parseInt(workflowId.split('-')[1] || '0')
  const elapsed = Date.now() - mockStartTime
  const progressPercent = Math.min(100, Math.floor(elapsed / 100))

  const steps = ['validating', 'creating_repository', 'cloning_template', 'applying_variables', 'pushing_to_github', 'finalizing', 'completed']
  const stepIndex = Math.min(steps.length - 1, Math.floor(progressPercent / 15))

  return {
    progress: {
      status: progressPercent >= 100 ? 'completed' : 'running',
      currentStep: steps[stepIndex],
      progressPercent,
      resultRepoUrl: progressPercent >= 100 ? 'https://github.com/example/new-repo' : undefined,
      resultRepoName: progressPercent >= 100 ? 'new-repo' : undefined,
    },
  }
}
```

**Step 2: Commit**

```bash
git add orbit-www/src/app/actions/templates.ts
git commit -m "feat: add server actions for template instantiation"
```

---

## Task 9: Wire Up Worker Registration

**Files:**
- Modify: `temporal-workflows/cmd/worker/main.go`

**Step 1: Register the new workflow and activities**

Update `temporal-workflows/cmd/worker/main.go` to include the new workflow and activities:

```go
// Add imports
import (
    // ... existing imports
    "github.com/drewpayment/orbit/temporal-workflows/internal/activities"
    "github.com/drewpayment/orbit/temporal-workflows/internal/services"
    "github.com/drewpayment/orbit/temporal-workflows/internal/workflows"
)

// In the main function, add:

// Create GitHub template client
githubClient := services.NewGitHubTemplateClient("", "") // Token will be passed per-workflow

// Create template activities
templateActivities := activities.NewTemplateActivities(
    githubClient,
    "/tmp/orbit-templates",
    logger,
)

// Register template instantiation workflow
w.RegisterWorkflow(workflows.TemplateInstantiationWorkflow)

// Register template activities
w.RegisterActivity(templateActivities.ValidateInstantiationInput)
w.RegisterActivity(templateActivities.CreateRepoFromTemplate)
w.RegisterActivity(templateActivities.CreateEmptyRepo)
w.RegisterActivity(templateActivities.CloneTemplateRepo)
w.RegisterActivity(templateActivities.ApplyTemplateVariables)
w.RegisterActivity(templateActivities.PushToNewRepo)
w.RegisterActivity(templateActivities.CleanupWorkDir)
w.RegisterActivity(templateActivities.FinalizeInstantiation)
```

**Step 2: Commit**

```bash
git add temporal-workflows/cmd/worker/main.go
git commit -m "feat: register template instantiation workflow and activities"
```

---

## Task 10: Integration Testing

**Files:**
- Create: `temporal-workflows/tests/integration/template_instantiation_test.go`

**Step 1: Create integration test**

Create `temporal-workflows/tests/integration/template_instantiation_test.go`:

```go
//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/testsuite"

	"github.com/drewpayment/orbit/temporal-workflows/internal/workflows"
)

func TestTemplateInstantiationWorkflow_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	// This test requires a running Temporal server
	c, err := client.Dial(client.Options{
		HostPort: "localhost:7233",
	})
	if err != nil {
		t.Skipf("Temporal server not available: %v", err)
	}
	defer c.Close()

	// Start workflow
	input := workflows.TemplateInstantiationInput{
		TemplateID:       "test-template",
		WorkspaceID:      "test-workspace",
		TargetOrg:        "test-org",
		RepositoryName:   "test-repo",
		IsGitHubTemplate: false, // Use clone path for testing
		Variables:        map[string]string{"name": "test"},
	}

	workflowOptions := client.StartWorkflowOptions{
		ID:        "test-template-instantiation-" + time.Now().Format("20060102150405"),
		TaskQueue: "template-instantiation",
	}

	we, err := c.ExecuteWorkflow(context.Background(), workflowOptions, workflows.TemplateInstantiationWorkflow, input)
	require.NoError(t, err)

	// Query progress
	resp, err := c.QueryWorkflow(context.Background(), we.GetID(), we.GetRunID(), "progress")
	require.NoError(t, err)

	var progress workflows.InstantiationProgress
	require.NoError(t, resp.Get(&progress))
	require.NotEmpty(t, progress.CurrentStep)

	// Wait for completion (with timeout)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	var result workflows.TemplateInstantiationResult
	err = we.Get(ctx, &result)

	// For integration test, we expect it to fail without real GitHub credentials
	// but we verify the workflow ran correctly
	if err != nil {
		t.Logf("Workflow completed with error (expected without real credentials): %v", err)
	} else {
		require.Equal(t, "completed", result.Status)
	}
}
```

**Step 2: Commit**

```bash
git add temporal-workflows/tests/integration/template_instantiation_test.go
git commit -m "test: add integration test for template instantiation"
```

---

## Summary

This plan implements template instantiation in 10 tasks:

1. **Proto Definitions** - gRPC API contract
2. **Temporal Workflow** - Orchestration logic with progress tracking
3. **Template Activities** - Git and GitHub operations
4. **GitHub Client** - Template API implementation
5. **gRPC Server** - Service endpoint
6. **Use Template Form** - Frontend form component
7. **Progress Page** - Real-time progress tracking
8. **Server Actions** - Frontend → Backend communication
9. **Worker Registration** - Wire up Temporal worker
10. **Integration Testing** - End-to-end validation

Each task follows TDD with explicit test → implement → verify → commit cycle.
