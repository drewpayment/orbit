# GitHub Token API for Temporal Activities Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Temporal activities to authenticate with GitHub by fetching tokens from a Payload API endpoint.

**Architecture:** Activities call `POST /api/internal/github/token` with installation ID, Payload decrypts stored token and returns it. Activities use token to create GitHub clients on-demand.

**Tech Stack:** Go 1.21+, TypeScript/Next.js 15, Temporal, gRPC

---

## Task 1: Create Payload Token API Endpoint

**Files:**
- Create: `orbit-www/src/app/api/internal/github/token/route.ts`

**Step 1: Create the API endpoint**

Create `orbit-www/src/app/api/internal/github/token/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { decrypt } from '@/lib/encryption'

const INTERNAL_API_KEY = process.env.ORBIT_INTERNAL_API_KEY

export async function POST(request: NextRequest) {
  // Validate API key
  const apiKey = request.headers.get('X-API-Key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'UNAUTHORIZED' },
      { status: 401 }
    )
  }

  try {
    const { installationId } = await request.json()

    if (!installationId) {
      return NextResponse.json(
        { error: 'installationId required', code: 'BAD_REQUEST' },
        { status: 400 }
      )
    }

    const payload = await getPayload({ config: configPromise })

    // Find installation by GitHub installation ID (numeric)
    const installations = await payload.find({
      collection: 'github-installations',
      where: {
        installationId: { equals: Number(installationId) },
      },
      limit: 1,
    })

    if (installations.docs.length === 0) {
      return NextResponse.json(
        { error: 'Installation not found', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    const installation = installations.docs[0]

    // Check if token is expired
    const expiresAt = new Date(installation.tokenExpiresAt)
    if (expiresAt <= new Date()) {
      return NextResponse.json(
        { error: 'Token expired, refresh workflow may be stalled', code: 'EXPIRED' },
        { status: 410 }
      )
    }

    // Decrypt token
    const decryptedToken = decrypt(installation.installationToken)

    return NextResponse.json({
      token: decryptedToken,
      expiresAt: installation.tokenExpiresAt,
    })
  } catch (error) {
    console.error('[Internal API] Token fetch error:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
```

**Step 2: Add environment variable to .env.example**

Add to `orbit-www/.env.example`:

```bash
# Internal API authentication (shared with Temporal worker)
ORBIT_INTERNAL_API_KEY=your-secure-api-key-here
```

**Step 3: Verify API compiles**

Run:
```bash
cd orbit-www && pnpm build
```

Expected: Build succeeds

**Step 4: Commit**

```bash
git add orbit-www/src/app/api/internal/github/token/route.ts orbit-www/.env.example
git commit -m "feat: add internal API endpoint for GitHub token retrieval"
```

---

## Task 2: Create Token Service in Worker

**Files:**
- Create: `temporal-workflows/internal/services/token_service.go`
- Create: `temporal-workflows/internal/services/token_service_test.go`

**Step 1: Write the test file**

Create `temporal-workflows/internal/services/token_service_test.go`:

```go
package services

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPayloadTokenService_GetInstallationToken_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "/api/internal/github/token", r.URL.Path)
		assert.Equal(t, "test-api-key", r.Header.Get("X-API-Key"))

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"token": "ghs_test_token_12345", "expiresAt": "2025-01-28T12:00:00Z"}`))
	}))
	defer server.Close()

	svc := NewPayloadTokenService(server.URL, "test-api-key")

	token, err := svc.GetInstallationToken(context.Background(), "12345")

	require.NoError(t, err)
	assert.Equal(t, "ghs_test_token_12345", token)
}

func TestPayloadTokenService_GetInstallationToken_Unauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error": "Unauthorized", "code": "UNAUTHORIZED"}`))
	}))
	defer server.Close()

	svc := NewPayloadTokenService(server.URL, "wrong-key")

	_, err := svc.GetInstallationToken(context.Background(), "12345")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "unauthorized")
}

func TestPayloadTokenService_GetInstallationToken_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"error": "Installation not found", "code": "NOT_FOUND"}`))
	}))
	defer server.Close()

	svc := NewPayloadTokenService(server.URL, "test-api-key")

	_, err := svc.GetInstallationToken(context.Background(), "99999")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestPayloadTokenService_GetInstallationToken_Expired(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusGone)
		w.Write([]byte(`{"error": "Token expired", "code": "EXPIRED"}`))
	}))
	defer server.Close()

	svc := NewPayloadTokenService(server.URL, "test-api-key")

	_, err := svc.GetInstallationToken(context.Background(), "12345")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "expired")
}
```

**Step 2: Run tests to verify they fail**

Run:
```bash
cd temporal-workflows && go test -v ./internal/services/token_service_test.go
```

Expected: FAIL - `NewPayloadTokenService` not defined

**Step 3: Create the token service implementation**

Create `temporal-workflows/internal/services/token_service.go`:

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

// TokenService defines the interface for fetching GitHub installation tokens
type TokenService interface {
	// GetInstallationToken fetches a GitHub token for the given installation ID
	GetInstallationToken(ctx context.Context, installationID string) (string, error)
}

// PayloadTokenService fetches tokens from the Payload API
type PayloadTokenService struct {
	orbitAPIURL string
	apiKey      string
	httpClient  *http.Client
}

// NewPayloadTokenService creates a new token service
func NewPayloadTokenService(orbitAPIURL, apiKey string) *PayloadTokenService {
	return &PayloadTokenService{
		orbitAPIURL: orbitAPIURL,
		apiKey:      apiKey,
		httpClient:  &http.Client{},
	}
}

type tokenRequest struct {
	InstallationID string `json:"installationId"`
}

type tokenResponse struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expiresAt"`
}

type errorResponse struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

// GetInstallationToken fetches a GitHub token for the given installation ID
func (s *PayloadTokenService) GetInstallationToken(ctx context.Context, installationID string) (string, error) {
	url := fmt.Sprintf("%s/api/internal/github/token", s.orbitAPIURL)

	reqBody, err := json.Marshal(tokenRequest{InstallationID: installationID})
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(reqBody))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", s.apiKey)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	switch resp.StatusCode {
	case http.StatusOK:
		var tokenResp tokenResponse
		if err := json.Unmarshal(body, &tokenResp); err != nil {
			return "", fmt.Errorf("failed to parse response: %w", err)
		}
		return tokenResp.Token, nil

	case http.StatusUnauthorized:
		return "", fmt.Errorf("unauthorized: invalid API key")

	case http.StatusNotFound:
		return "", fmt.Errorf("installation not found: %s", installationID)

	case http.StatusGone:
		return "", fmt.Errorf("token expired for installation %s, refresh workflow may be stalled", installationID)

	default:
		var errResp errorResponse
		json.Unmarshal(body, &errResp)
		return "", fmt.Errorf("API error (status %d): %s", resp.StatusCode, errResp.Error)
	}
}
```

**Step 4: Run tests to verify they pass**

Run:
```bash
cd temporal-workflows && go test -v ./internal/services/token_service_test.go ./internal/services/token_service.go
```

Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add temporal-workflows/internal/services/token_service*.go
git commit -m "feat: add PayloadTokenService for fetching GitHub tokens"
```

---

## Task 3: Update Template Activities to Use Token Service

**Files:**
- Modify: `temporal-workflows/internal/activities/template_activities.go`
- Modify: `temporal-workflows/internal/activities/template_activities_test.go`

**Step 1: Update TemplateInstantiationInput to include InstallationID**

In `temporal-workflows/internal/activities/template_activities.go`, update the struct:

```go
// TemplateInstantiationInput contains all parameters needed for template instantiation
type TemplateInstantiationInput struct {
	TemplateID       string            // ID of the template being instantiated
	WorkspaceID      string            // Workspace where repo will be created
	TargetOrg        string            // GitHub org/user for the new repo
	RepositoryName   string            // Name for the new repository
	Description      string            // Description for the new repository
	IsPrivate        bool              // Whether the repo should be private
	IsGitHubTemplate bool              // True if template repo has GitHub template enabled
	SourceRepoOwner  string            // Owner of the source template repo
	SourceRepoName   string            // Name of the source template repo
	SourceRepoURL    string            // Full URL of source repo (for non-GitHub templates)
	Variables        map[string]string // Template variables to substitute
	UserID           string            // ID of user initiating instantiation
	InstallationID   string            // GitHub App installation ID for authentication
}
```

**Step 2: Update TemplateActivities struct to use TokenService**

Replace the struct and constructor:

```go
// TokenService defines the interface for fetching GitHub tokens
type TokenService interface {
	GetInstallationToken(ctx context.Context, installationID string) (string, error)
}

// TemplateActivities holds the dependencies for template instantiation activities
type TemplateActivities struct {
	tokenService TokenService
	workDir      string
	logger       *slog.Logger
}

// NewTemplateActivities creates a new instance of TemplateActivities
func NewTemplateActivities(tokenService TokenService, workDir string, logger *slog.Logger) *TemplateActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &TemplateActivities{
		tokenService: tokenService,
		workDir:      workDir,
		logger:       logger,
	}
}
```

**Step 3: Update CreateRepoFromTemplate activity**

Replace the `CreateRepoFromTemplate` method:

```go
// CreateRepoFromTemplate creates a repository using GitHub's Template API
func (a *TemplateActivities) CreateRepoFromTemplate(ctx context.Context, input TemplateInstantiationInput) (*CreateRepoResult, error) {
	a.logger.Info("Creating repository from GitHub template",
		"sourceOwner", input.SourceRepoOwner,
		"sourceRepo", input.SourceRepoName,
		"targetOrg", input.TargetOrg,
		"targetName", input.RepositoryName)

	// Fetch token for this installation
	token, err := a.tokenService.GetInstallationToken(ctx, input.InstallationID)
	if err != nil {
		return nil, fmt.Errorf("failed to get GitHub token: %w", err)
	}

	// Create client with token
	client := NewGitHubTemplateClient("", token)

	repoURL, err := client.CreateRepoFromTemplate(
		ctx,
		input.SourceRepoOwner,
		input.SourceRepoName,
		input.TargetOrg,
		input.RepositoryName,
		input.Description,
		input.IsPrivate,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create repository from template: %w", err)
	}

	return &CreateRepoResult{
		RepoURL:  repoURL,
		RepoName: input.RepositoryName,
	}, nil
}
```

**Step 4: Update CreateEmptyRepo activity**

Replace the `CreateEmptyRepo` method:

```go
// CreateEmptyRepo creates an empty GitHub repository
func (a *TemplateActivities) CreateEmptyRepo(ctx context.Context, input TemplateInstantiationInput) (*CreateRepoResult, error) {
	a.logger.Info("Creating empty repository",
		"org", input.TargetOrg,
		"name", input.RepositoryName)

	// Fetch token for this installation
	token, err := a.tokenService.GetInstallationToken(ctx, input.InstallationID)
	if err != nil {
		return nil, fmt.Errorf("failed to get GitHub token: %w", err)
	}

	// Create client with token
	client := NewGitHubTemplateClient("", token)

	repoURL, err := client.CreateRepository(
		ctx,
		input.TargetOrg,
		input.RepositoryName,
		input.Description,
		input.IsPrivate,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create empty repository: %w", err)
	}

	return &CreateRepoResult{
		RepoURL:  repoURL,
		RepoName: input.RepositoryName,
	}, nil
}
```

**Step 5: Update CloneTemplateRepo to use authenticated clone**

Update the `CloneTemplateRepo` method to inject token into clone URL:

```go
// CloneTemplateRepo clones the template repository, removes .git directory, and returns the work directory path
func (a *TemplateActivities) CloneTemplateRepo(ctx context.Context, input TemplateInstantiationInput) (string, error) {
	a.logger.Info("Cloning template repository", "sourceURL", input.SourceRepoURL)

	// Create unique work directory
	workDir := filepath.Join(a.workDir, fmt.Sprintf("template-%s-%s", input.TemplateID, input.RepositoryName))
	if err := os.MkdirAll(workDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create work directory: %w", err)
	}

	// Build clone URL with authentication if we have an installation ID
	cloneURL := input.SourceRepoURL
	if input.InstallationID != "" {
		token, err := a.tokenService.GetInstallationToken(ctx, input.InstallationID)
		if err != nil {
			a.logger.Warn("Failed to get token for clone, attempting unauthenticated", "error", err)
		} else {
			// Insert token into URL for authenticated clone
			cloneURL = strings.Replace(cloneURL, "https://", fmt.Sprintf("https://x-access-token:%s@", token), 1)
		}
	}

	// Clone the repository
	cmd := exec.CommandContext(ctx, "git", "clone", cloneURL, workDir)
	output, err := cmd.CombinedOutput()
	if err != nil {
		// Clean up on failure
		_ = os.RemoveAll(workDir)
		// Sanitize output to remove any tokens
		sanitizedOutput := sanitizeGitOutput(string(output))
		return "", fmt.Errorf("failed to clone repository: %w (output: %s)", err, sanitizedOutput)
	}

	// Remove .git directory to start fresh
	gitDir := filepath.Join(workDir, ".git")
	if err := os.RemoveAll(gitDir); err != nil {
		// Clean up on failure
		_ = os.RemoveAll(workDir)
		return "", fmt.Errorf("failed to remove .git directory: %w", err)
	}

	a.logger.Info("Template repository cloned successfully", "workDir", workDir)
	return workDir, nil
}

// sanitizeGitOutput removes potential tokens from git output
func sanitizeGitOutput(output string) string {
	// Remove anything that looks like a token in URLs
	re := regexp.MustCompile(`https://[^:]+:[^@]+@`)
	return re.ReplaceAllString(output, "https://***@")
}
```

**Step 6: Update PushToNewRepo to use authenticated push**

Update the `PushToNewRepo` method:

```go
// PushToNewRepo initializes git, adds all files, commits, and pushes to the new repository
func (a *TemplateActivities) PushToNewRepo(ctx context.Context, input PushToNewRepoActivityInput) error {
	a.logger.Info("Pushing to new repository", "workDir", input.WorkDir, "repoURL", input.RepoURL)

	// Initialize git repository
	if err := a.runGitCommand(ctx, input.WorkDir, "init"); err != nil {
		return fmt.Errorf("failed to initialize git: %w", err)
	}

	// Configure git
	_ = a.runGitCommand(ctx, input.WorkDir, "config", "user.name", "Orbit IDP")
	_ = a.runGitCommand(ctx, input.WorkDir, "config", "user.email", "bot@orbit.dev")

	// Add all files
	if err := a.runGitCommand(ctx, input.WorkDir, "add", "."); err != nil {
		return fmt.Errorf("failed to add files: %w", err)
	}

	// Commit
	if err := a.runGitCommand(ctx, input.WorkDir, "commit", "-m", "Initial commit from template"); err != nil {
		return fmt.Errorf("failed to commit: %w", err)
	}

	// Build remote URL with authentication if we have installation ID
	remoteURL := input.RepoURL
	if input.InstallationID != "" {
		token, err := a.tokenService.GetInstallationToken(ctx, input.InstallationID)
		if err != nil {
			return fmt.Errorf("failed to get GitHub token for push: %w", err)
		}
		remoteURL = strings.Replace(remoteURL, "https://", fmt.Sprintf("https://x-access-token:%s@", token), 1)
	}

	// Add remote
	if err := a.runGitCommand(ctx, input.WorkDir, "remote", "add", "origin", remoteURL); err != nil {
		// Remote might already exist, try setting URL instead
		_ = a.runGitCommand(ctx, input.WorkDir, "remote", "set-url", "origin", remoteURL)
	}

	// Push to main branch
	if err := a.runGitCommand(ctx, input.WorkDir, "push", "-u", "origin", "main"); err != nil {
		return fmt.Errorf("failed to push: %w", err)
	}

	a.logger.Info("Successfully pushed to new repository")
	return nil
}
```

**Step 7: Update PushToNewRepoActivityInput to include InstallationID**

```go
// PushToNewRepoActivityInput contains parameters for pushing to new repository
type PushToNewRepoActivityInput struct {
	WorkDir        string
	RepoURL        string
	InstallationID string // GitHub App installation ID for authentication
}
```

**Step 8: Add import for strings and regexp**

Add to imports:

```go
import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)
```

**Step 9: Run tests**

Run:
```bash
cd temporal-workflows && go test -v ./internal/activities/...
```

Expected: Tests may need updates for new interface - fix mock if needed

**Step 10: Commit**

```bash
git add temporal-workflows/internal/activities/template_activities.go
git commit -m "feat: update template activities to use TokenService for authentication"
```

---

## Task 4: Update Workflow Types Package

**Files:**
- Modify: `temporal-workflows/pkg/types/types.go`

**Step 1: Add InstallationID to TemplateInstantiationInput**

Update `temporal-workflows/pkg/types/types.go`:

```go
// TemplateInstantiationInput contains parameters for creating a repo from template
type TemplateInstantiationInput struct {
	TemplateID       string            `json:"templateId"`
	WorkspaceID      string            `json:"workspaceId"`
	TargetOrg        string            `json:"targetOrg"`
	RepositoryName   string            `json:"repositoryName"`
	Description      string            `json:"description"`
	IsPrivate        bool              `json:"isPrivate"`
	IsGitHubTemplate bool              `json:"isGitHubTemplate"`
	SourceRepoOwner  string            `json:"sourceRepoOwner"`
	SourceRepoName   string            `json:"sourceRepoName"`
	SourceRepoURL    string            `json:"sourceRepoUrl"`
	Variables        map[string]string `json:"variables"`
	UserID           string            `json:"userId"`
	InstallationID   string            `json:"installationId"` // NEW: GitHub App installation ID
}
```

**Step 2: Commit**

```bash
git add temporal-workflows/pkg/types/types.go
git commit -m "feat: add InstallationID to TemplateInstantiationInput"
```

---

## Task 5: Update Worker Main to Wire Up Token Service

**Files:**
- Modify: `temporal-workflows/cmd/worker/main.go`

**Step 1: Add environment variable reading**

Add near the top of `main()`:

```go
	orbitInternalAPIKey := os.Getenv("ORBIT_INTERNAL_API_KEY")
	if orbitInternalAPIKey == "" {
		log.Println("Warning: ORBIT_INTERNAL_API_KEY not set, GitHub operations will fail")
	}
```

**Step 2: Create TokenService and update TemplateActivities initialization**

Replace the template activities section:

```go
	// Create token service for GitHub authentication
	tokenService := services.NewPayloadTokenService(orbitAPIURL, orbitInternalAPIKey)

	// Create and register template activities
	templateActivities := activities.NewTemplateActivities(
		tokenService,
		templateWorkDir,
		logger,
	)
```

**Step 3: Remove the old GitHubTemplateClient creation**

Remove these lines:
```go
	// Create GitHub template client (token will be passed per-workflow)
	githubTemplateClient := services.NewGitHubTemplateClient("", "")
```

**Step 4: Verify build**

Run:
```bash
cd temporal-workflows && go build ./cmd/worker
```

Expected: Build succeeds

**Step 5: Commit**

```bash
git add temporal-workflows/cmd/worker/main.go
git commit -m "feat: wire up TokenService in Temporal worker"
```

---

## Task 6: Update Repository Service to Pass Installation ID

**Files:**
- Modify: `services/repository/cmd/server/main.go`

**Step 1: Update StartTemplateWorkflow to include InstallationID**

In `services/repository/cmd/server/main.go`, update the `StartTemplateWorkflow` method:

```go
// StartTemplateWorkflow starts a template instantiation workflow
func (tc *TemporalClient) StartTemplateWorkflow(ctx context.Context, input interface{}) (string, error) {
	req, ok := input.(*templatev1.StartInstantiationRequest)
	if !ok {
		return "", fmt.Errorf("invalid input type")
	}

	workflowInput := types.TemplateInstantiationInput{
		TemplateID:       req.TemplateId,
		WorkspaceID:      req.WorkspaceId,
		TargetOrg:        req.TargetOrg,
		RepositoryName:   req.RepositoryName,
		Description:      req.Description,
		IsPrivate:        req.IsPrivate,
		Variables:        req.Variables,
		UserID:           req.UserId,
		// Template source info from request
		IsGitHubTemplate: req.IsGithubTemplate,
		SourceRepoOwner:  req.SourceRepoOwner,
		SourceRepoName:   req.SourceRepoName,
		SourceRepoURL:    req.SourceRepoUrl,
		// GitHub authentication
		InstallationID:   req.GithubInstallationId,
	}

	workflowID := fmt.Sprintf("template-instantiation-%s-%d", req.RepositoryName, time.Now().Unix())

	we, err := tc.client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: "orbit-workflows",
	}, "TemplateInstantiationWorkflow", workflowInput)

	if err != nil {
		return "", fmt.Errorf("failed to start workflow: %w", err)
	}

	return we.GetID(), nil
}
```

**Step 2: Verify build**

Run:
```bash
cd services/repository && go build ./cmd/server
```

Expected: Build succeeds

**Step 3: Commit**

```bash
git add services/repository/cmd/server/main.go
git commit -m "feat: pass InstallationID to template instantiation workflow"
```

---

## Task 7: Update Frontend to Pass Installation ID

**Files:**
- Modify: `orbit-www/src/app/actions/templates.ts`

**Step 1: Look up installation ID from org name**

In `orbit-www/src/app/actions/templates.ts`, update `startInstantiation`:

Find the section where we call the gRPC service and update it:

```typescript
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

  // Look up installation ID for the target org
  const installations = await payload.find({
    collection: 'github-installations',
    where: {
      accountLogin: { equals: input.targetOrg },
      status: { equals: 'active' },
    },
    limit: 1,
    overrideAccess: true,
  })

  if (installations.docs.length === 0) {
    return { success: false, error: `No active GitHub installation found for org: ${input.targetOrg}` }
  }

  const installation = installations.docs[0]
  const installationId = String(installation.installationId)

  // ... rest of validation ...

  try {
    // Parse template source repo owner and name from URL
    const repoUrl = template.repoUrl || ''
    const urlMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/)
    const sourceRepoOwner = urlMatch ? urlMatch[1] : ''
    const sourceRepoName = urlMatch ? urlMatch[2] : ''

    const response = await templateClient.startInstantiation({
      templateId: input.templateId,
      workspaceId: input.workspaceId,
      targetOrg: input.targetOrg,
      repositoryName: input.repositoryName,
      description: input.description || '',
      isPrivate: input.isPrivate,
      variables: input.variables,
      userId: session.user.id,
      sourceRepoUrl: repoUrl,
      isGithubTemplate: template.isGitHubTemplate || false,
      sourceRepoOwner,
      sourceRepoName,
      githubInstallationId: installationId,  // NEW: Pass installation ID
    })

    return {
      success: true,
      workflowId: response.workflowId,
    }
  } catch (error) {
    console.error('gRPC startInstantiation failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start instantiation',
    }
  }
}
```

**Step 2: Verify build**

Run:
```bash
cd orbit-www && pnpm build
```

Expected: Build succeeds

**Step 3: Commit**

```bash
git add orbit-www/src/app/actions/templates.ts
git commit -m "feat: pass GitHub installation ID to gRPC startInstantiation"
```

---

## Task 8: Add Environment Variables to Docker Compose

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add ORBIT_INTERNAL_API_KEY to orbit-www service**

Add to the `orbit-www` service environment:

```yaml
  orbit-www:
    environment:
      # ... existing env vars ...
      - ORBIT_INTERNAL_API_KEY=${ORBIT_INTERNAL_API_KEY:-orbit-internal-dev-key}
```

**Step 2: Add ORBIT_INTERNAL_API_KEY to temporal-worker service**

Add to the `temporal-worker` service environment:

```yaml
  temporal-worker:
    environment:
      # ... existing env vars ...
      - ORBIT_INTERNAL_API_KEY=${ORBIT_INTERNAL_API_KEY:-orbit-internal-dev-key}
      - ORBIT_API_URL=http://orbit-www:3000
```

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add ORBIT_INTERNAL_API_KEY to docker-compose"
```

---

## Task 9: Integration Testing

**Files:**
- Create: `temporal-workflows/tests/integration/token_service_integration_test.go`

**Step 1: Create integration test**

Create `temporal-workflows/tests/integration/token_service_integration_test.go`:

```go
//go:build integration

package integration

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

func TestTokenService_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	orbitAPIURL := os.Getenv("ORBIT_API_URL")
	if orbitAPIURL == "" {
		orbitAPIURL = "http://localhost:3000"
	}

	apiKey := os.Getenv("ORBIT_INTERNAL_API_KEY")
	if apiKey == "" {
		t.Skip("ORBIT_INTERNAL_API_KEY not set")
	}

	installationID := os.Getenv("TEST_INSTALLATION_ID")
	if installationID == "" {
		t.Skip("TEST_INSTALLATION_ID not set")
	}

	svc := services.NewPayloadTokenService(orbitAPIURL, apiKey)

	token, err := svc.GetInstallationToken(context.Background(), installationID)
	require.NoError(t, err)
	require.NotEmpty(t, token)
	require.True(t, len(token) > 20, "Token should be a reasonable length")

	t.Logf("Successfully retrieved token (first 10 chars): %s...", token[:10])
}
```

**Step 2: Commit**

```bash
git add temporal-workflows/tests/integration/token_service_integration_test.go
git commit -m "test: add integration test for token service"
```

---

## Summary

This plan implements GitHub token authentication for Temporal activities in 9 tasks:

1. **Payload API Endpoint** - Internal API for token retrieval
2. **Token Service** - Go client to call the API
3. **Activity Updates** - Use TokenService instead of static client
4. **Types Package** - Add InstallationID field
5. **Worker Wiring** - Create and inject TokenService
6. **Repository Service** - Pass InstallationID to workflow
7. **Frontend** - Look up and pass installation ID
8. **Docker Compose** - Add environment variables
9. **Integration Testing** - Verify end-to-end flow

Each task follows TDD with test → implement → verify → commit cycle.
