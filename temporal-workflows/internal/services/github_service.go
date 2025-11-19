package services

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// Installation represents a GitHub App installation
type Installation struct {
	ID             string
	InstallationID int64
	AccountLogin   string
	EncryptedToken string
	TokenExpiresAt time.Time
}

// PrepareRemoteInput contains the input for PrepareRemote
type PrepareRemoteInput struct {
	WorkspaceID          string
	GitHubInstallationID *string
	GitURL               string
	RepositoryName       string
	Private              bool
}

// PrepareRemoteOutput contains the output for PrepareRemote
type PrepareRemoteOutput struct {
	GitURL              string
	AccessToken         string
	InstallationOrgName string
	CreatedRepo         bool
}

// PayloadClient defines the interface for Payload CMS operations
type PayloadClient interface {
	FindDocuments(ctx context.Context, collection string, query map[string]interface{}) ([]map[string]interface{}, error)
	GetDocument(ctx context.Context, collection string, id string) (map[string]interface{}, error)
	UpdateDocument(ctx context.Context, collection string, id string, data map[string]interface{}) error
}

// EncryptionService defines the interface for encryption/decryption operations
type EncryptionService interface {
	Encrypt(plaintext string) (string, error)
	Decrypt(ciphertext string) (string, error)
}

// GitHubClient defines the interface for GitHub API operations
type GitHubClient interface {
	CreateInstallationAccessToken(ctx context.Context, installationID int64) (string, time.Time, error)
	CreateRepository(ctx context.Context, token string, orgName string, repoName string, private bool) (string, error)
}

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

// gitHubService is the implementation of GitHubService
type gitHubService struct {
	payloadClient     PayloadClient
	encryptionService EncryptionService
	githubClient      GitHubClient
}

// NewGitHubService creates a new GitHubService
func NewGitHubService(
	payloadClient PayloadClient,
	encryptionService EncryptionService,
	githubClient GitHubClient,
) GitHubService {
	return &gitHubService{
		payloadClient:     payloadClient,
		encryptionService: encryptionService,
		githubClient:      githubClient,
	}
}

// FindInstallationForWorkspace finds an active GitHub installation for a workspace
func (s *gitHubService) FindInstallationForWorkspace(
	ctx context.Context,
	workspaceID string,
	installationID *string,
) (*Installation, error) {
	// Query Payload for installations
	query := map[string]interface{}{
		"status": "active",
		// In a real implementation, this would filter by allowedWorkspaces
		// For now, we'll filter in memory after fetching
	}

	docs, err := s.payloadClient.FindDocuments(ctx, "github-installations", query)
	if err != nil {
		return nil, fmt.Errorf("failed to query installations: %w", err)
	}

	// Convert docs to Installation structs
	var installations []*Installation
	for _, doc := range docs {
		inst := &Installation{
			ID:             doc["id"].(string),
			InstallationID: doc["installationId"].(int64),
			AccountLogin:   doc["accountLogin"].(string),
			EncryptedToken: doc["installationToken"].(string),
			TokenExpiresAt: doc["tokenExpiresAt"].(time.Time),
		}
		installations = append(installations, inst)
	}

	// If no installations found
	if len(installations) == 0 {
		return nil, fmt.Errorf(`No active GitHub App installation found for workspace %s.

Please ask an admin to:
1. Navigate to Settings → GitHub
2. Install the Orbit IDP GitHub App
3. Grant access to this workspace`, workspaceID)
	}

	// If specific installation ID provided, find it
	if installationID != nil && *installationID != "" {
		for _, inst := range installations {
			if inst.ID == *installationID {
				return inst, nil
			}
		}

		// Installation ID provided but not found
		var availableList []string
		for _, inst := range installations {
			availableList = append(availableList, fmt.Sprintf("- %s: %s", inst.ID, inst.AccountLogin))
		}

		return nil, fmt.Errorf(`GitHub installation %s not found or not allowed for workspace %s.

Available installations for this workspace:
%s`, *installationID, workspaceID, strings.Join(availableList, "\n"))
	}

	// Use first available installation (smart default)
	return installations[0], nil
}

// GetInstallationToken decrypts and returns the access token
func (s *gitHubService) GetInstallationToken(
	ctx context.Context,
	installation *Installation,
) (string, error) {
	// Check if token is expired
	if installation.TokenExpiresAt.Before(time.Now()) {
		return "", fmt.Errorf(`GitHub installation token expired at %s.

The token refresh workflow should handle this automatically.

If this error persists:
1. Check Temporal UI for workflow: github-token-refresh:%d
2. Verify workflow status is "running"
3. Check workflow logs for refresh failures`, installation.TokenExpiresAt.Format(time.RFC3339), installation.InstallationID)
	}

	// Decrypt the token
	token, err := s.encryptionService.Decrypt(installation.EncryptedToken)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt installation token: %w", err)
	}

	return token, nil
}

// CreateRepository creates a new GitHub repository
func (s *gitHubService) CreateRepository(
	ctx context.Context,
	token string,
	orgName string,
	repoName string,
	private bool,
) (string, error) {
	gitURL, err := s.githubClient.CreateRepository(ctx, token, orgName, repoName, private)
	if err != nil {
		return "", fmt.Errorf("failed to create repository: %w", err)
	}

	return gitURL, nil
}

// PrepareRemote orchestrates finding installation, getting token, and optionally creating repo
func (s *gitHubService) PrepareRemote(
	ctx context.Context,
	input PrepareRemoteInput,
) (*PrepareRemoteOutput, error) {
	// Validate inputs
	if input.GitURL == "" && input.RepositoryName == "" {
		return nil, fmt.Errorf("repository_name required when creating new repo (no git_url provided)")
	}

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

	// Determine if we need to create a repo
	gitURL := input.GitURL
	createdRepo := false

	if gitURL == "" {
		// Create repository
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
