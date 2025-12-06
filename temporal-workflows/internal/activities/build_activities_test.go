package activities

import (
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuildActivities_AnalyzeRepository_ValidatesInput(t *testing.T) {
	activities := NewBuildActivities(nil, slog.Default())

	tests := []struct {
		name          string
		input         AnalyzeRepositoryInput
		expectedError string
	}{
		{
			name: "missing repo_url",
			input: AnalyzeRepositoryInput{
				Ref:               "main",
				InstallationToken: "token",
			},
			expectedError: "repo_url",
		},
		{
			name: "missing ref",
			input: AnalyzeRepositoryInput{
				RepoURL:           "https://github.com/org/repo",
				InstallationToken: "token",
			},
			expectedError: "ref",
		},
		{
			name: "valid input returns grpc error when service unavailable",
			input: AnalyzeRepositoryInput{
				RepoURL:           "https://github.com/org/repo",
				Ref:               "main",
				InstallationToken: "token",
			},
			expectedError: "build service", // Will fail to connect since service isn't running
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := activities.AnalyzeRepository(context.Background(), tt.input)
			require.Error(t, err)
			require.Contains(t, err.Error(), tt.expectedError)
		})
	}
}

func TestBuildActivities_BuildAndPushImage_ValidatesInput(t *testing.T) {
	activities := NewBuildActivities(nil, slog.Default())

	tests := []struct {
		name          string
		input         BuildAndPushInput
		expectedError string
	}{
		{
			name: "missing request_id",
			input: BuildAndPushInput{
				AppID:   "app-123",
				RepoURL: "https://github.com/org/repo",
				Ref:     "main",
			},
			expectedError: "request_id",
		},
		{
			name: "missing app_id",
			input: BuildAndPushInput{
				RequestID: "req-123",
				RepoURL:   "https://github.com/org/repo",
				Ref:       "main",
			},
			expectedError: "app_id",
		},
		{
			name: "missing repo_url",
			input: BuildAndPushInput{
				RequestID: "req-123",
				AppID:     "app-123",
				Ref:       "main",
			},
			expectedError: "repo_url",
		},
		{
			name: "missing ref",
			input: BuildAndPushInput{
				RequestID: "req-123",
				AppID:     "app-123",
				RepoURL:   "https://github.com/org/repo",
			},
			expectedError: "ref",
		},
		{
			name: "missing registry URL",
			input: BuildAndPushInput{
				RequestID: "req-123",
				AppID:     "app-123",
				RepoURL:   "https://github.com/org/repo",
				Ref:       "main",
				Registry: BuildRegistryConfig{
					Repository: "org/app",
				},
			},
			expectedError: "registry URL",
		},
		{
			name: "missing registry repository",
			input: BuildAndPushInput{
				RequestID: "req-123",
				AppID:     "app-123",
				RepoURL:   "https://github.com/org/repo",
				Ref:       "main",
				Registry: BuildRegistryConfig{
					URL: "ghcr.io",
				},
			},
			expectedError: "registry repository",
		},
		{
			name: "unsupported registry type",
			input: BuildAndPushInput{
				RequestID: "req-123",
				AppID:     "app-123",
				RepoURL:   "https://github.com/org/repo",
				Ref:       "main",
				Registry: BuildRegistryConfig{
					Type:       "ecr", // unsupported
					URL:        "ghcr.io",
					Repository: "org/app",
				},
			},
			expectedError: "unsupported registry type",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := activities.BuildAndPushImage(context.Background(), tt.input)
			require.Error(t, err)
			require.Contains(t, err.Error(), tt.expectedError)
		})
	}
}

func TestBuildActivities_UpdateBuildStatus_ValidatesInput(t *testing.T) {
	activities := NewBuildActivities(nil, slog.Default())

	tests := []struct {
		name          string
		input         UpdateBuildStatusInput
		expectedError string
	}{
		{
			name: "missing app_id",
			input: UpdateBuildStatusInput{
				Status: "success",
			},
			expectedError: "app_id",
		},
		{
			name: "missing status",
			input: UpdateBuildStatusInput{
				AppID: "app-123",
			},
			expectedError: "status",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := activities.UpdateBuildStatus(context.Background(), tt.input)
			require.Error(t, err)
			require.Contains(t, err.Error(), tt.expectedError)
		})
	}
}

func TestBuildActivities_UpdateBuildStatus_WithoutClient(t *testing.T) {
	activities := NewBuildActivities(nil, slog.Default())

	input := UpdateBuildStatusInput{
		AppID:  "app-123",
		Status: "success",
	}

	// Should not error when client is nil
	err := activities.UpdateBuildStatus(context.Background(), input)
	require.NoError(t, err)
}
