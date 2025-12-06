// services/build-service/internal/grpc/build/server_test.go
package build

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	buildv1 "github.com/drewpayment/orbit/proto/gen/go/idp/build/v1"
)

func TestNewBuildServer_WiresAnalyzerAndBuilder(t *testing.T) {
	logger := slog.Default()
	workDir := filepath.Join(os.TempDir(), "test-builds")
	defer os.RemoveAll(workDir)

	server := NewBuildServerWithWorkDir(logger, workDir)

	require.NotNil(t, server)
	require.NotNil(t, server.logger)
	require.NotNil(t, server.analyzer)
	require.NotNil(t, server.builder)
	require.Equal(t, workDir, server.workDir)
}

func TestNewBuildServer_UsesDefaultWorkDir(t *testing.T) {
	logger := slog.Default()

	// Clear env var to test default
	oldEnv := os.Getenv("BUILD_WORK_DIR")
	os.Unsetenv("BUILD_WORK_DIR")
	defer func() {
		if oldEnv != "" {
			os.Setenv("BUILD_WORK_DIR", oldEnv)
		}
	}()

	server := NewBuildServer(logger)

	require.NotNil(t, server)
	assert.Equal(t, "/tmp/orbit-builds", server.workDir)
}

func TestNewBuildServer_UsesEnvVarWorkDir(t *testing.T) {
	logger := slog.Default()
	customWorkDir := "/custom/work/dir"

	// Set env var
	oldEnv := os.Getenv("BUILD_WORK_DIR")
	os.Setenv("BUILD_WORK_DIR", customWorkDir)
	defer func() {
		if oldEnv != "" {
			os.Setenv("BUILD_WORK_DIR", oldEnv)
		} else {
			os.Unsetenv("BUILD_WORK_DIR")
		}
	}()

	server := NewBuildServer(logger)

	require.NotNil(t, server)
	assert.Equal(t, customWorkDir, server.workDir)
}

func TestGenerateRequestID_ReturnsUUID(t *testing.T) {
	id := generateRequestID()

	require.NotEmpty(t, id)
	// UUID format check (basic)
	assert.Len(t, id, 36) // UUID v4 is 36 chars with hyphens
}

func TestBuildImage_HandlesUnsupportedRegistryType(t *testing.T) {
	logger := slog.Default()
	server := NewBuildServerWithWorkDir(logger, os.TempDir())

	req := &buildv1.BuildImageRequest{
		RequestId:         "test-123",
		AppId:             "app-456",
		RepoUrl:           "https://github.com/test/app",
		Ref:               "main",
		InstallationToken: "token",
		Registry: &buildv1.RegistryConfig{
			Type:       buildv1.RegistryType_REGISTRY_TYPE_UNSPECIFIED,
			Url:        "registry.example.com",
			Repository: "org/app",
			Token:      "token",
		},
		ImageTag: "latest",
	}

	resp, err := server.BuildImage(context.Background(), req)

	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.False(t, resp.Success)
	assert.Equal(t, "unsupported registry type", resp.Error)
}
