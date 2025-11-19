package activities

import (
	"context"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

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
		}

		err := activities.PushToRemoteActivity(ctx, input)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "repository directory does not exist")
	})

	t.Run("push without remote setup fails", func(t *testing.T) {
		// This test verifies the activity fails gracefully when push fails
		// In real scenarios, this would fail due to authentication or network issues
		repoID := "test-repo-10"
		repoPath := filepath.Join(workDir, repoID)
		err := os.MkdirAll(repoPath, 0755)
		require.NoError(t, err)

		input := PushToRemoteInput{
			RepositoryID: repoID,
		}

		err = activities.PushToRemoteActivity(ctx, input)
		// This should fail because git is not initialized
		assert.Error(t, err)
	})
}
