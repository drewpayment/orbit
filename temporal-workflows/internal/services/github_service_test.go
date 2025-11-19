package services_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// Mock implementations
type MockPayloadClient struct {
	Installations []*services.Installation
	FindError     error
	FindCalled    bool
}

func (m *MockPayloadClient) FindDocuments(ctx context.Context, collection string, query map[string]interface{}) ([]map[string]interface{}, error) {
	m.FindCalled = true
	if m.FindError != nil {
		return nil, m.FindError
	}

	var results []map[string]interface{}
	for _, inst := range m.Installations {
		results = append(results, map[string]interface{}{
			"id":                inst.ID,
			"installationId":    inst.InstallationID,
			"accountLogin":      inst.AccountLogin,
			"installationToken": inst.EncryptedToken,
			"tokenExpiresAt":    inst.TokenExpiresAt,
		})
	}
	return results, nil
}

func (m *MockPayloadClient) GetDocument(ctx context.Context, collection string, id string) (map[string]interface{}, error) {
	return nil, nil
}

func (m *MockPayloadClient) UpdateDocument(ctx context.Context, collection string, id string, data map[string]interface{}) error {
	return nil
}

type MockEncryptionService struct {
	DecryptFunc func(string) (string, error)
}

func (m *MockEncryptionService) Encrypt(plaintext string) (string, error) {
	return "encrypted:" + plaintext, nil
}

func (m *MockEncryptionService) Decrypt(ciphertext string) (string, error) {
	if m.DecryptFunc != nil {
		return m.DecryptFunc(ciphertext)
	}
	return "decrypted_token", nil
}

type MockGitHubClient struct {
	CreateRepoFunc func(context.Context, string, string, string, bool) (string, error)
}

func (m *MockGitHubClient) CreateInstallationAccessToken(ctx context.Context, installationID int64) (string, time.Time, error) {
	return "", time.Time{}, nil
}

func (m *MockGitHubClient) CreateRepository(ctx context.Context, token string, orgName string, repoName string, private bool) (string, error) {
	if m.CreateRepoFunc != nil {
		return m.CreateRepoFunc(ctx, token, orgName, repoName, private)
	}
	return "https://github.com/" + orgName + "/" + repoName + ".git", nil
}

// Test: FindInstallationForWorkspace - Success (single installation)
func TestFindInstallationForWorkspace_Success(t *testing.T) {
	installation := &services.Installation{
		ID:             "install-123",
		InstallationID: 456,
		AccountLogin:   "mycompany",
		EncryptedToken: "encrypted_token",
		TokenExpiresAt: time.Now().Add(1 * time.Hour),
	}

	mockPayload := &MockPayloadClient{
		Installations: []*services.Installation{installation},
	}

	svc := services.NewGitHubService(mockPayload, &MockEncryptionService{}, &MockGitHubClient{})

	result, err := svc.FindInstallationForWorkspace(context.Background(), "workspace-1", nil)

	require.NoError(t, err)
	assert.True(t, mockPayload.FindCalled)
	assert.Equal(t, installation.ID, result.ID)
	assert.Equal(t, installation.InstallationID, result.InstallationID)
	assert.Equal(t, installation.AccountLogin, result.AccountLogin)
}

// Test: FindInstallationForWorkspace - Not Found
func TestFindInstallationForWorkspace_NotFound(t *testing.T) {
	mockPayload := &MockPayloadClient{
		Installations: []*services.Installation{},
	}

	svc := services.NewGitHubService(mockPayload, &MockEncryptionService{}, &MockGitHubClient{})

	result, err := svc.FindInstallationForWorkspace(context.Background(), "workspace-1", nil)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "No active GitHub App installation found")
	assert.Contains(t, err.Error(), "workspace-1")
}

// Test: FindInstallationForWorkspace - With Override (specific installation ID)
func TestFindInstallationForWorkspace_WithOverride(t *testing.T) {
	installation1 := &services.Installation{
		ID:             "install-123",
		InstallationID: 456,
		AccountLogin:   "company1",
		EncryptedToken: "encrypted_token",
		TokenExpiresAt: time.Now().Add(1 * time.Hour),
	}
	installation2 := &services.Installation{
		ID:             "install-789",
		InstallationID: 999,
		AccountLogin:   "company2",
		EncryptedToken: "encrypted_token",
		TokenExpiresAt: time.Now().Add(1 * time.Hour),
	}

	mockPayload := &MockPayloadClient{
		Installations: []*services.Installation{installation1, installation2},
	}

	svc := services.NewGitHubService(mockPayload, &MockEncryptionService{}, &MockGitHubClient{})

	installationID := "install-789"
	result, err := svc.FindInstallationForWorkspace(context.Background(), "workspace-1", &installationID)

	require.NoError(t, err)
	assert.Equal(t, installation2.ID, result.ID)
	assert.Equal(t, installation2.InstallationID, result.InstallationID)
	assert.Equal(t, "company2", result.AccountLogin)
}

// Test: FindInstallationForWorkspace - Invalid Override
func TestFindInstallationForWorkspace_InvalidOverride(t *testing.T) {
	installation := &services.Installation{
		ID:             "install-123",
		InstallationID: 456,
		AccountLogin:   "mycompany",
		EncryptedToken: "encrypted_token",
		TokenExpiresAt: time.Now().Add(1 * time.Hour),
	}

	mockPayload := &MockPayloadClient{
		Installations: []*services.Installation{installation},
	}

	svc := services.NewGitHubService(mockPayload, &MockEncryptionService{}, &MockGitHubClient{})

	nonExistentID := "install-999"
	result, err := svc.FindInstallationForWorkspace(context.Background(), "workspace-1", &nonExistentID)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "install-999")
	assert.Contains(t, err.Error(), "not found or not allowed")
	assert.Contains(t, err.Error(), "Available installations")
}

// Test: FindInstallationForWorkspace - Multiple Installations (uses first)
func TestFindInstallationForWorkspace_MultipleInstallations(t *testing.T) {
	installation1 := &services.Installation{
		ID:             "install-123",
		InstallationID: 456,
		AccountLogin:   "company1",
		EncryptedToken: "encrypted_token",
		TokenExpiresAt: time.Now().Add(1 * time.Hour),
	}
	installation2 := &services.Installation{
		ID:             "install-789",
		InstallationID: 999,
		AccountLogin:   "company2",
		EncryptedToken: "encrypted_token",
		TokenExpiresAt: time.Now().Add(1 * time.Hour),
	}

	mockPayload := &MockPayloadClient{
		Installations: []*services.Installation{installation1, installation2},
	}

	svc := services.NewGitHubService(mockPayload, &MockEncryptionService{}, &MockGitHubClient{})

	result, err := svc.FindInstallationForWorkspace(context.Background(), "workspace-1", nil)

	require.NoError(t, err)
	assert.Equal(t, installation1.ID, result.ID) // Should use first installation
}

// Test: GetInstallationToken - Success
func TestGetInstallationToken_Success(t *testing.T) {
	installation := &services.Installation{
		ID:             "install-123",
		InstallationID: 456,
		AccountLogin:   "mycompany",
		EncryptedToken: "encrypted_token",
		TokenExpiresAt: time.Now().Add(1 * time.Hour),
	}

	mockEncryption := &MockEncryptionService{
		DecryptFunc: func(ciphertext string) (string, error) {
			return "ghs_decrypted_token_abc123", nil
		},
	}

	svc := services.NewGitHubService(&MockPayloadClient{}, mockEncryption, &MockGitHubClient{})

	token, err := svc.GetInstallationToken(context.Background(), installation)

	require.NoError(t, err)
	assert.Equal(t, "ghs_decrypted_token_abc123", token)
}

// Test: GetInstallationToken - Expired
func TestGetInstallationToken_Expired(t *testing.T) {
	installation := &services.Installation{
		ID:             "install-123",
		InstallationID: 456,
		AccountLogin:   "mycompany",
		EncryptedToken: "encrypted_token",
		TokenExpiresAt: time.Now().Add(-1 * time.Hour), // Expired 1 hour ago
	}

	svc := services.NewGitHubService(&MockPayloadClient{}, &MockEncryptionService{}, &MockGitHubClient{})

	token, err := svc.GetInstallationToken(context.Background(), installation)

	require.Error(t, err)
	assert.Empty(t, token)
	assert.Contains(t, err.Error(), "expired")
	assert.Contains(t, err.Error(), "token refresh workflow")
}

// Test: GetInstallationToken - Decryption Failed
func TestGetInstallationToken_DecryptionFailed(t *testing.T) {
	installation := &services.Installation{
		ID:             "install-123",
		InstallationID: 456,
		AccountLogin:   "mycompany",
		EncryptedToken: "encrypted_token",
		TokenExpiresAt: time.Now().Add(1 * time.Hour),
	}

	mockEncryption := &MockEncryptionService{
		DecryptFunc: func(ciphertext string) (string, error) {
			return "", errors.New("decryption failed")
		},
	}

	svc := services.NewGitHubService(&MockPayloadClient{}, mockEncryption, &MockGitHubClient{})

	token, err := svc.GetInstallationToken(context.Background(), installation)

	require.Error(t, err)
	assert.Empty(t, token)
	assert.Contains(t, err.Error(), "failed to decrypt")
}

// Test: CreateRepository - Success
func TestCreateRepository_Success(t *testing.T) {
	mockGitHub := &MockGitHubClient{
		CreateRepoFunc: func(ctx context.Context, token, orgName, repoName string, private bool) (string, error) {
			assert.Equal(t, "ghs_token", token)
			assert.Equal(t, "mycompany", orgName)
			assert.Equal(t, "my-new-repo", repoName)
			assert.True(t, private)
			return "https://github.com/mycompany/my-new-repo.git", nil
		},
	}

	svc := services.NewGitHubService(&MockPayloadClient{}, &MockEncryptionService{}, mockGitHub)

	gitURL, err := svc.CreateRepository(context.Background(), "ghs_token", "mycompany", "my-new-repo", true)

	require.NoError(t, err)
	assert.Equal(t, "https://github.com/mycompany/my-new-repo.git", gitURL)
}

// Test: CreateRepository - Name Conflict (422 error)
func TestCreateRepository_NameConflict(t *testing.T) {
	mockGitHub := &MockGitHubClient{
		CreateRepoFunc: func(ctx context.Context, token, orgName, repoName string, private bool) (string, error) {
			return "", errors.New("repository name already exists (HTTP 422)")
		},
	}

	svc := services.NewGitHubService(&MockPayloadClient{}, &MockEncryptionService{}, mockGitHub)

	gitURL, err := svc.CreateRepository(context.Background(), "ghs_token", "mycompany", "existing-repo", true)

	require.Error(t, err)
	assert.Empty(t, gitURL)
	assert.Contains(t, err.Error(), "failed to create repository")
}

// Test: CreateRepository - Rate Limit (429 error)
func TestCreateRepository_RateLimit(t *testing.T) {
	mockGitHub := &MockGitHubClient{
		CreateRepoFunc: func(ctx context.Context, token, orgName, repoName string, private bool) (string, error) {
			return "", errors.New("rate limit exceeded (HTTP 429)")
		},
	}

	svc := services.NewGitHubService(&MockPayloadClient{}, &MockEncryptionService{}, mockGitHub)

	gitURL, err := svc.CreateRepository(context.Background(), "ghs_token", "mycompany", "my-repo", true)

	require.Error(t, err)
	assert.Empty(t, gitURL)
}

// Test: PrepareRemote - With GitURL (no repo creation)
func TestPrepareRemote_WithGitURL(t *testing.T) {
	installation := &services.Installation{
		ID:             "install-123",
		InstallationID: 456,
		AccountLogin:   "mycompany",
		EncryptedToken: "encrypted_token",
		TokenExpiresAt: time.Now().Add(1 * time.Hour),
	}

	mockPayload := &MockPayloadClient{
		Installations: []*services.Installation{installation},
	}

	mockEncryption := &MockEncryptionService{
		DecryptFunc: func(ciphertext string) (string, error) {
			return "ghs_token_xyz", nil
		},
	}

	mockGitHub := &MockGitHubClient{
		CreateRepoFunc: func(ctx context.Context, token, orgName, repoName string, private bool) (string, error) {
			t.Fatal("CreateRepository should not be called when GitURL is provided")
			return "", nil
		},
	}

	svc := services.NewGitHubService(mockPayload, mockEncryption, mockGitHub)

	input := services.PrepareRemoteInput{
		WorkspaceID:          "workspace-1",
		GitHubInstallationID: nil,
		GitURL:               "https://github.com/mycompany/existing-repo.git",
		RepositoryName:       "",
		Private:              true,
	}

	result, err := svc.PrepareRemote(context.Background(), input)

	require.NoError(t, err)
	assert.Equal(t, "https://github.com/mycompany/existing-repo.git", result.GitURL)
	assert.Equal(t, "ghs_token_xyz", result.AccessToken)
	assert.Equal(t, "mycompany", result.InstallationOrgName)
	assert.False(t, result.CreatedRepo)
}

// Test: PrepareRemote - Create Repo (GitURL empty)
func TestPrepareRemote_CreateRepo(t *testing.T) {
	installation := &services.Installation{
		ID:             "install-123",
		InstallationID: 456,
		AccountLogin:   "mycompany",
		EncryptedToken: "encrypted_token",
		TokenExpiresAt: time.Now().Add(1 * time.Hour),
	}

	mockPayload := &MockPayloadClient{
		Installations: []*services.Installation{installation},
	}

	mockEncryption := &MockEncryptionService{
		DecryptFunc: func(ciphertext string) (string, error) {
			return "ghs_token_xyz", nil
		},
	}

	createRepoCalled := false
	mockGitHub := &MockGitHubClient{
		CreateRepoFunc: func(ctx context.Context, token, orgName, repoName string, private bool) (string, error) {
			createRepoCalled = true
			assert.Equal(t, "ghs_token_xyz", token)
			assert.Equal(t, "mycompany", orgName)
			assert.Equal(t, "new-repo", repoName)
			assert.True(t, private)
			return "https://github.com/mycompany/new-repo.git", nil
		},
	}

	svc := services.NewGitHubService(mockPayload, mockEncryption, mockGitHub)

	input := services.PrepareRemoteInput{
		WorkspaceID:          "workspace-1",
		GitHubInstallationID: nil,
		GitURL:               "",
		RepositoryName:       "new-repo",
		Private:              true,
	}

	result, err := svc.PrepareRemote(context.Background(), input)

	require.NoError(t, err)
	assert.True(t, createRepoCalled)
	assert.Equal(t, "https://github.com/mycompany/new-repo.git", result.GitURL)
	assert.Equal(t, "ghs_token_xyz", result.AccessToken)
	assert.Equal(t, "mycompany", result.InstallationOrgName)
	assert.True(t, result.CreatedRepo)
}

// Test: PrepareRemote - No Installation (error propagation)
func TestPrepareRemote_NoInstallation(t *testing.T) {
	mockPayload := &MockPayloadClient{
		Installations: []*services.Installation{},
	}

	svc := services.NewGitHubService(mockPayload, &MockEncryptionService{}, &MockGitHubClient{})

	input := services.PrepareRemoteInput{
		WorkspaceID:          "workspace-1",
		GitHubInstallationID: nil,
		GitURL:               "",
		RepositoryName:       "new-repo",
		Private:              true,
	}

	result, err := svc.PrepareRemote(context.Background(), input)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "No active GitHub App installation found")
}

// Test: PrepareRemote - Validation: Missing RepositoryName when creating repo
func TestPrepareRemote_ValidationMissingRepoName(t *testing.T) {
	installation := &services.Installation{
		ID:             "install-123",
		InstallationID: 456,
		AccountLogin:   "mycompany",
		EncryptedToken: "encrypted_token",
		TokenExpiresAt: time.Now().Add(1 * time.Hour),
	}

	mockPayload := &MockPayloadClient{
		Installations: []*services.Installation{installation},
	}

	svc := services.NewGitHubService(mockPayload, &MockEncryptionService{}, &MockGitHubClient{})

	input := services.PrepareRemoteInput{
		WorkspaceID:          "workspace-1",
		GitHubInstallationID: nil,
		GitURL:               "", // Empty, should create repo
		RepositoryName:       "", // Missing!
		Private:              true,
	}

	result, err := svc.PrepareRemote(context.Background(), input)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "repository_name required")
}
