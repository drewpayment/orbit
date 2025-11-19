package activities

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGitActivities_CloneTemplateActivity(t *testing.T) {
	// Create temporary work directory
	workDir, err := os.MkdirTemp("", "git-activities-test-*")
	require.NoError(t, err)
	defer os.RemoveAll(workDir)

	activities := NewGitActivities(workDir, nil, slog.Default())
	ctx := context.Background()

	t.Run("successful clone", func(t *testing.T) {
		input := CloneTemplateInput{
			TemplateName: "go-microservice",
			RepositoryID: "test-repo-1",
		}

		err := activities.CloneTemplateActivity(ctx, input)
		assert.NoError(t, err)

		// Verify directory was created
		repoPath := filepath.Join(workDir, input.RepositoryID)
		_, err = os.Stat(repoPath)
		assert.NoError(t, err)

		// Verify template marker was created
		markerPath := filepath.Join(repoPath, ".template")
		content, err := os.ReadFile(markerPath)
		assert.NoError(t, err)
		assert.Equal(t, "go-microservice", string(content))

		// Verify README was created
		readmePath := filepath.Join(repoPath, "README.md")
		_, err = os.Stat(readmePath)
		assert.NoError(t, err)
	})

	t.Run("idempotent - second clone succeeds", func(t *testing.T) {
		input := CloneTemplateInput{
			TemplateName: "go-microservice",
			RepositoryID: "test-repo-2",
		}

		// First clone
		err := activities.CloneTemplateActivity(ctx, input)
		require.NoError(t, err)

		// Second clone should succeed (idempotent)
		err = activities.CloneTemplateActivity(ctx, input)
		assert.NoError(t, err)
	})

	t.Run("empty template name fails", func(t *testing.T) {
		input := CloneTemplateInput{
			TemplateName: "",
			RepositoryID: "test-repo-3",
		}

		err := activities.CloneTemplateActivity(ctx, input)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "template name cannot be empty")
	})
}

func TestGitActivities_ApplyVariablesActivity(t *testing.T) {
	// Create temporary work directory
	workDir, err := os.MkdirTemp("", "git-activities-test-*")
	require.NoError(t, err)
	defer os.RemoveAll(workDir)

	activities := NewGitActivities(workDir, nil, slog.Default())
	ctx := context.Background()

	t.Run("successful variable replacement", func(t *testing.T) {
		// Setup: Create a repository with template variables
		repoID := "test-repo-4"
		repoPath := filepath.Join(workDir, repoID)
		err := os.MkdirAll(repoPath, 0755)
		require.NoError(t, err)

		// Create a file with template variables
		testContent := "# {{service_name}}\n\n{{description}}\n"
		testFile := filepath.Join(repoPath, "README.md")
		err = os.WriteFile(testFile, []byte(testContent), 0644)
		require.NoError(t, err)

		// Apply variables
		input := ApplyVariablesInput{
			RepositoryID: repoID,
			Variables: map[string]string{
				"service_name": "my-service",
				"description":  "My awesome service",
			},
		}

		err = activities.ApplyVariablesActivity(ctx, input)
		assert.NoError(t, err)

		// Verify variables were replaced
		content, err := os.ReadFile(testFile)
		require.NoError(t, err)
		assert.Equal(t, "# my-service\n\nMy awesome service\n", string(content))
	})

	t.Run("no variables to apply - succeeds", func(t *testing.T) {
		repoID := "test-repo-5"
		repoPath := filepath.Join(workDir, repoID)
		err := os.MkdirAll(repoPath, 0755)
		require.NoError(t, err)

		input := ApplyVariablesInput{
			RepositoryID: repoID,
			Variables:    map[string]string{},
		}

		err = activities.ApplyVariablesActivity(ctx, input)
		assert.NoError(t, err)
	})

	t.Run("repository does not exist - fails", func(t *testing.T) {
		input := ApplyVariablesInput{
			RepositoryID: "non-existent-repo",
			Variables: map[string]string{
				"key": "value",
			},
		}

		err = activities.ApplyVariablesActivity(ctx, input)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "repository directory does not exist")
	})

	t.Run("skips hidden files", func(t *testing.T) {
		repoID := "test-repo-6"
		repoPath := filepath.Join(workDir, repoID)
		err := os.MkdirAll(repoPath, 0755)
		require.NoError(t, err)

		// Create a hidden file
		hiddenFile := filepath.Join(repoPath, ".hidden")
		hiddenContent := "{{should_not_replace}}"
		err = os.WriteFile(hiddenFile, []byte(hiddenContent), 0644)
		require.NoError(t, err)

		input := ApplyVariablesInput{
			RepositoryID: repoID,
			Variables: map[string]string{
				"should_not_replace": "replaced",
			},
		}

		err = activities.ApplyVariablesActivity(ctx, input)
		assert.NoError(t, err)

		// Verify hidden file was not modified
		content, err := os.ReadFile(hiddenFile)
		require.NoError(t, err)
		assert.Equal(t, hiddenContent, string(content))
	})
}

func TestGitActivities_InitializeGitActivity(t *testing.T) {
	// Skip if git is not available
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not available in PATH")
	}

	// Create temporary work directory
	workDir, err := os.MkdirTemp("", "git-activities-test-*")
	require.NoError(t, err)
	defer os.RemoveAll(workDir)

	activities := NewGitActivities(workDir, nil, slog.Default())
	ctx := context.Background()

	t.Run("successful git initialization", func(t *testing.T) {
		repoID := "test-repo-7"
		repoPath := filepath.Join(workDir, repoID)
		err := os.MkdirAll(repoPath, 0755)
		require.NoError(t, err)

		// Create a test file
		testFile := filepath.Join(repoPath, "README.md")
		err = os.WriteFile(testFile, []byte("# Test"), 0644)
		require.NoError(t, err)

		input := InitializeGitInput{
			RepositoryID: repoID,
			GitURL:       "https://github.com/test/repo.git",
		}

		err = activities.InitializeGitActivity(ctx, input)
		assert.NoError(t, err)

		// Verify .git directory was created
		gitDir := filepath.Join(repoPath, ".git")
		_, err = os.Stat(gitDir)
		assert.NoError(t, err)
	})

	t.Run("empty git URL fails", func(t *testing.T) {
		repoID := "test-repo-8"
		repoPath := filepath.Join(workDir, repoID)
		err := os.MkdirAll(repoPath, 0755)
		require.NoError(t, err)

		input := InitializeGitInput{
			RepositoryID: repoID,
			GitURL:       "",
		}

		err = activities.InitializeGitActivity(ctx, input)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "git URL cannot be empty")
	})

	t.Run("repository does not exist - fails", func(t *testing.T) {
		input := InitializeGitInput{
			RepositoryID: "non-existent-repo",
			GitURL:       "https://github.com/test/repo.git",
		}

		err = activities.InitializeGitActivity(ctx, input)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "repository directory does not exist")
	})

	t.Run("idempotent - second initialization succeeds", func(t *testing.T) {
		repoID := "test-repo-9"
		repoPath := filepath.Join(workDir, repoID)
		err := os.MkdirAll(repoPath, 0755)
		require.NoError(t, err)

		// Create a test file
		testFile := filepath.Join(repoPath, "README.md")
		err = os.WriteFile(testFile, []byte("# Test"), 0644)
		require.NoError(t, err)

		input := InitializeGitInput{
			RepositoryID: repoID,
			GitURL:       "https://github.com/test/repo.git",
		}

		// First initialization
		err = activities.InitializeGitActivity(ctx, input)
		require.NoError(t, err)

		// Second initialization should succeed (idempotent)
		err = activities.InitializeGitActivity(ctx, input)
		assert.NoError(t, err)
	})
}

func TestGitActivities_PushToRemoteActivity(t *testing.T) {
	// Skip if git is not available
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not available in PATH")
	}

	// Create temporary work directory
	workDir, err := os.MkdirTemp("", "git-activities-test-*")
	require.NoError(t, err)
	defer os.RemoveAll(workDir)

	activities := NewGitActivities(workDir, nil, slog.Default())
	ctx := context.Background()

	t.Run("repository does not exist - fails", func(t *testing.T) {
		input := PushToRemoteInput{
			RepositoryID: "non-existent-repo",
			GitURL:       "https://github.com/test/repo.git",
			AccessToken:  "test-token",
		}

		err := activities.PushToRemoteActivity(ctx, input)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "repository directory does not exist")
	})

	t.Run("validation - missing fields", func(t *testing.T) {
		// Test missing GitURL and AccessToken
		input := PushToRemoteInput{
			RepositoryID: "test-repo",
		}

		err := activities.PushToRemoteActivity(ctx, input)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "repository_id, git_url, and access_token are required")
	})
}

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

// Mock GitHubService for testing PrepareGitHubRemoteActivity
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
