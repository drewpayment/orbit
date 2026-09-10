package activities

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

// MockTokenService for testing
type MockTokenService struct {
	mock.Mock
}

func (m *MockTokenService) GetInstallationToken(ctx context.Context, installationID string) (string, error) {
	args := m.Called(ctx, installationID)
	return args.String(0), args.Error(1)
}

// MockPayloadTemplateClient for testing
type MockPayloadTemplateClient struct {
	mock.Mock
}

func (m *MockPayloadTemplateClient) FinalizeInstantiation(ctx context.Context, templateID string, in services.FinalizeInstantiationInput) (*services.FinalizeInstantiationResult, error) {
	args := m.Called(ctx, templateID, in)
	var result *services.FinalizeInstantiationResult
	if v := args.Get(0); v != nil {
		result = v.(*services.FinalizeInstantiationResult)
	}
	return result, args.Error(1)
}

func TestValidateInstantiationInput_Success(t *testing.T) {
	activities := NewTemplateActivities(nil, nil, "/tmp/work", nil)

	input := TemplateInstantiationInput{
		TemplateID:       "template-123",
		WorkspaceID:      "workspace-456",
		TargetOrg:        "my-org",
		RepositoryName:   "new-service",
		IsGitHubTemplate: true,
		SourceRepoOwner:  "template-org",
		SourceRepoName:   "template-repo",
	}

	err := activities.ValidateInstantiationInput(context.Background(), input)
	assert.NoError(t, err)
}

func TestValidateInstantiationInput_MissingFields(t *testing.T) {
	activities := NewTemplateActivities(nil, nil, "/tmp/work", nil)

	input := TemplateInstantiationInput{
		TemplateID: "template-123",
		// Missing required fields
	}

	err := activities.ValidateInstantiationInput(context.Background(), input)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "required")
}

func TestValidateInstantiationInput_InvalidRepoName(t *testing.T) {
	activities := NewTemplateActivities(nil, nil, "/tmp/work", nil)

	input := TemplateInstantiationInput{
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
	// Note: This test now requires the services package and HTTP mocking
	// For now, we'll skip it as it requires integration testing
	// TODO: Add proper integration test with httptest
	t.Skip("Skipping - requires integration test with GitHub API mock")
}

func TestCreateEmptyRepo_Success(t *testing.T) {
	// Note: This test now requires the services package and HTTP mocking
	// For now, we'll skip it as it requires integration testing
	// TODO: Add proper integration test with httptest
	t.Skip("Skipping - requires integration test with GitHub API mock")
}

func TestApplyTemplateVariables_ContentSubstitution(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "main.go"), []byte("package {{SERVICE_NAME}}\n"), 0644))

	activities := NewTemplateActivities(nil, nil, "/tmp/work", nil)
	result, err := activities.ApplyTemplateVariables(context.Background(), ApplyTemplateVariablesActivityInput{
		WorkDir:   dir,
		Variables: map[string]string{"SERVICE_NAME": "orders"},
	})
	require.NoError(t, err)
	assert.Empty(t, result.SkippedFiles)

	content, err := os.ReadFile(filepath.Join(dir, "main.go"))
	require.NoError(t, err)
	assert.Equal(t, "package orders\n", string(content))
}

func TestApplyTemplateVariables_FileNameSubstitution(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "{{SERVICE_NAME}}.go"), []byte("package {{SERVICE_NAME}}\n"), 0644))

	activities := NewTemplateActivities(nil, nil, "/tmp/work", nil)
	result, err := activities.ApplyTemplateVariables(context.Background(), ApplyTemplateVariablesActivityInput{
		WorkDir:   dir,
		Variables: map[string]string{"SERVICE_NAME": "orders"},
	})
	require.NoError(t, err)
	assert.Empty(t, result.SkippedFiles)

	_, err = os.Stat(filepath.Join(dir, "orders.go"))
	assert.NoError(t, err, "renamed file should exist")
	_, err = os.Stat(filepath.Join(dir, "{{SERVICE_NAME}}.go"))
	assert.True(t, os.IsNotExist(err), "old name should no longer exist")

	content, err := os.ReadFile(filepath.Join(dir, "orders.go"))
	require.NoError(t, err)
	assert.Equal(t, "package orders\n", string(content))
}

func TestApplyTemplateVariables_DirNameSubstitution(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "src", "{{SERVICE_NAME}}"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "src", "{{SERVICE_NAME}}", "main.go"), []byte("package main\n"), 0644))

	activities := NewTemplateActivities(nil, nil, "/tmp/work", nil)
	result, err := activities.ApplyTemplateVariables(context.Background(), ApplyTemplateVariablesActivityInput{
		WorkDir:   dir,
		Variables: map[string]string{"SERVICE_NAME": "orders"},
	})
	require.NoError(t, err)
	assert.Empty(t, result.SkippedFiles)

	_, err = os.Stat(filepath.Join(dir, "src", "orders", "main.go"))
	assert.NoError(t, err, "renamed dir + file should exist")
	_, err = os.Stat(filepath.Join(dir, "src", "{{SERVICE_NAME}}"))
	assert.True(t, os.IsNotExist(err), "old dir name should no longer exist")
}

func TestApplyTemplateVariables_BinaryFileSkipsContentNotName(t *testing.T) {
	dir := t.TempDir()
	binaryContent := []byte("PNG\x00fake-binary-data")
	require.NoError(t, os.WriteFile(filepath.Join(dir, "{{SERVICE_NAME}}.png"), binaryContent, 0644))

	activities := NewTemplateActivities(nil, nil, "/tmp/work", nil)
	result, err := activities.ApplyTemplateVariables(context.Background(), ApplyTemplateVariablesActivityInput{
		WorkDir:   dir,
		Variables: map[string]string{"SERVICE_NAME": "orders"},
	})
	require.NoError(t, err)
	assert.Empty(t, result.SkippedFiles)

	content, err := os.ReadFile(filepath.Join(dir, "orders.png"))
	require.NoError(t, err)
	assert.Equal(t, binaryContent, content, "binary content must be untouched")

	_, err = os.Stat(filepath.Join(dir, "{{SERVICE_NAME}}.png"))
	assert.True(t, os.IsNotExist(err), "old name should no longer exist")
}

func TestApplyTemplateVariables_RawFilesOptOut(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "orbit-template.yaml"), []byte("rawFiles:\n  - \"charts/*.yaml\"\n"), 0644))
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "charts"), 0755))
	rawContent := "release: {{ .Release.Name }}\n"
	require.NoError(t, os.WriteFile(filepath.Join(dir, "charts", "values.yaml"), []byte(rawContent), 0644))

	activities := NewTemplateActivities(nil, nil, "/tmp/work", nil)
	result, err := activities.ApplyTemplateVariables(context.Background(), ApplyTemplateVariablesActivityInput{
		WorkDir:   dir,
		Variables: map[string]string{"SERVICE_NAME": "orders"},
	})
	require.NoError(t, err)
	assert.Empty(t, result.SkippedFiles, "raw-file-matched files should not even attempt parsing")

	content, err := os.ReadFile(filepath.Join(dir, "charts", "values.yaml"))
	require.NoError(t, err)
	assert.Equal(t, rawContent, string(content), "raw file content must be untouched")
}

func TestApplyTemplateVariables_ParseFailureIsNonFatal(t *testing.T) {
	dir := t.TempDir()
	unresolvable := "release: {{ .Values.foo }}\n"
	require.NoError(t, os.WriteFile(filepath.Join(dir, "chart.yaml"), []byte(unresolvable), 0644))

	activities := NewTemplateActivities(nil, nil, "/tmp/work", nil)
	result, err := activities.ApplyTemplateVariables(context.Background(), ApplyTemplateVariablesActivityInput{
		WorkDir:   dir,
		Variables: map[string]string{"SERVICE_NAME": "orders"},
	})
	require.NoError(t, err, "per-file parse failure must not fail the activity")
	require.Len(t, result.SkippedFiles, 1)
	assert.Equal(t, filepath.Join(dir, "chart.yaml"), result.SkippedFiles[0])

	content, err := os.ReadFile(filepath.Join(dir, "chart.yaml"))
	require.NoError(t, err)
	assert.Equal(t, unresolvable, string(content), "content must be left unchanged on parse failure")
}

func TestApplyTemplateVariables_NoVariables(t *testing.T) {
	dir := t.TempDir()
	original := "package {{SERVICE_NAME}}\n"
	require.NoError(t, os.WriteFile(filepath.Join(dir, "main.go"), []byte(original), 0644))

	activities := NewTemplateActivities(nil, nil, "/tmp/work", nil)
	result, err := activities.ApplyTemplateVariables(context.Background(), ApplyTemplateVariablesActivityInput{
		WorkDir:   dir,
		Variables: map[string]string{},
	})
	require.NoError(t, err)
	assert.Empty(t, result.SkippedFiles)

	content, err := os.ReadFile(filepath.Join(dir, "main.go"))
	require.NoError(t, err)
	assert.Equal(t, original, string(content))
}

func TestFinalizeInstantiation_Success(t *testing.T) {
	mockClient := new(MockPayloadTemplateClient)
	input := FinalizeInstantiationActivityInput{
		TemplateID:  "template-123",
		WorkspaceID: "workspace-456",
		RepoURL:     "https://github.com/my-org/new-service",
		RepoName:    "new-service",
		UserID:      "user-789",
	}
	expectedClientInput := services.FinalizeInstantiationInput{
		WorkspaceID: input.WorkspaceID,
		RepoURL:     input.RepoURL,
		RepoName:    input.RepoName,
		UserID:      input.UserID,
	}
	mockClient.On("FinalizeInstantiation", mock.Anything, input.TemplateID, expectedClientInput).
		Return(&services.FinalizeInstantiationResult{CatalogEntityID: "entity-1", UsageCount: 4}, nil)

	activities := NewTemplateActivities(nil, mockClient, "/tmp/work", nil)
	err := activities.FinalizeInstantiation(context.Background(), input)

	require.NoError(t, err)
	mockClient.AssertExpectations(t)
}

func TestFinalizeInstantiation_ClientError(t *testing.T) {
	mockClient := new(MockPayloadTemplateClient)
	input := FinalizeInstantiationActivityInput{
		TemplateID:  "template-123",
		WorkspaceID: "workspace-456",
		RepoURL:     "https://github.com/my-org/new-service",
		RepoName:    "new-service",
	}
	mockClient.On("FinalizeInstantiation", mock.Anything, input.TemplateID, mock.Anything).
		Return(nil, services.ErrTemplateNotFound)

	activities := NewTemplateActivities(nil, mockClient, "/tmp/work", nil)
	err := activities.FinalizeInstantiation(context.Background(), input)

	require.Error(t, err)
	assert.ErrorIs(t, err, services.ErrTemplateNotFound)
	assert.Contains(t, err.Error(), "failed to finalize instantiation")
	mockClient.AssertExpectations(t)
}
