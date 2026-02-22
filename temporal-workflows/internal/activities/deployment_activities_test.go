package activities

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateDeploymentConfig_DockerCompose_Valid(t *testing.T) {
	activities := NewDeploymentActivities("/tmp/test", nil, slog.Default())

	config := map[string]interface{}{
		"serviceName": "my-app",
		"port":        3000,
	}
	configBytes, _ := json.Marshal(config)

	input := ValidateDeploymentConfigInput{
		GeneratorType: "docker-compose",
		Config:        configBytes,
	}

	err := activities.ValidateDeploymentConfig(context.Background(), input)
	require.NoError(t, err)
}

func TestValidateDeploymentConfig_DockerCompose_MissingRequired(t *testing.T) {
	activities := NewDeploymentActivities("/tmp/test", nil, slog.Default())

	config := map[string]interface{}{
		"port": 3000,
		// Missing serviceName
	}
	configBytes, _ := json.Marshal(config)

	input := ValidateDeploymentConfigInput{
		GeneratorType: "docker-compose",
		Config:        configBytes,
	}

	err := activities.ValidateDeploymentConfig(context.Background(), input)
	require.Error(t, err)
	require.Contains(t, err.Error(), "serviceName")
}

func TestValidateDeploymentConfig_DockerCompose_EmptyStrings(t *testing.T) {
	activities := NewDeploymentActivities("/tmp/test", nil, slog.Default())

	config := map[string]interface{}{
		"serviceName": "   ", // whitespace only
		"port":        3000,
	}
	configBytes, _ := json.Marshal(config)

	input := ValidateDeploymentConfigInput{
		GeneratorType: "docker-compose",
		Config:        configBytes,
	}

	err := activities.ValidateDeploymentConfig(context.Background(), input)
	require.Error(t, err)
	require.Contains(t, err.Error(), "serviceName")
}

func TestPrepareGeneratorContext_WithoutPayloadClient(t *testing.T) {
	activities := NewDeploymentActivities("/tmp/test", nil, slog.Default())

	config := map[string]interface{}{
		"serviceName":     "test-service",
		"port":            8080,
		"imageTag":        "v1.0.0",
		"imageRepository": "myrepo/myimage",
	}
	configBytes, _ := json.Marshal(config)

	input := PrepareGeneratorContextInput{
		DeploymentID:  "test-deployment-123",
		AppID:         "app-456",
		GeneratorSlug: "docker-compose",
		Config:        configBytes,
	}

	workDir, err := activities.PrepareGeneratorContext(context.Background(), input)
	require.NoError(t, err)
	require.NotEmpty(t, workDir)

	// Verify docker-compose.yml was created
	composeFile := workDir + "/docker-compose.yml"
	require.FileExists(t, composeFile)

	// Read and verify content contains expected values
	content, err := os.ReadFile(composeFile)
	require.NoError(t, err)
	require.Contains(t, string(content), "test-service")
	require.Contains(t, string(content), "8080:8080")
	require.Contains(t, string(content), "myrepo/myimage:v1.0.0")
}

func TestExecuteGenerator_UnsupportedType(t *testing.T) {
	activities := NewDeploymentActivities("/tmp/test", nil, slog.Default())

	input := ExecuteGeneratorInput{
		DeploymentID:  "test-deployment-123",
		GeneratorType: "kubernetes", // unsupported type
		WorkDir:       "/tmp/test-workdir",
		Target: DeploymentTargetInput{
			Type: "local",
		},
	}

	result, err := activities.ExecuteGenerator(context.Background(), input)
	require.Error(t, err)
	require.Nil(t, result)
	require.Contains(t, err.Error(), "not supported for generator type")
}

func TestUpdateDeploymentStatus_WithoutClient(t *testing.T) {
	activities := NewDeploymentActivities("/tmp/test", nil, slog.Default())

	input := UpdateDeploymentStatusInput{
		DeploymentID:  "test-deployment-123",
		Status:        "completed",
		DeploymentURL: "http://localhost:3000",
		ErrorMessage:  "",
	}

	// Should not error when client is nil
	err := activities.UpdateDeploymentStatus(context.Background(), input)
	require.NoError(t, err)
}

func TestExecuteGenerator_Helm_GenerateMode(t *testing.T) {
	workDir := t.TempDir()

	// Write some rendered Helm files
	require.NoError(t, os.MkdirAll(filepath.Join(workDir, "templates"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(workDir, "Chart.yaml"), []byte("apiVersion: v2\nname: test\n"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(workDir, "values.yaml"), []byte("replicaCount: 1\n"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(workDir, "templates/deployment.yaml"), []byte("kind: Deployment\n"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(workDir, "templates/service.yaml"), []byte("kind: Service\n"), 0644))

	activities := NewDeploymentActivities("/tmp/test", nil, slog.Default())
	input := ExecuteGeneratorInput{
		DeploymentID:  "test-123",
		GeneratorType: "helm",
		WorkDir:       workDir,
		Mode:          "generate",
	}

	result, err := activities.ExecuteGenerator(context.Background(), input)
	require.NoError(t, err)
	require.True(t, result.Success)
	require.GreaterOrEqual(t, len(result.GeneratedFiles), 4)

	// Verify file paths are relative
	for _, f := range result.GeneratedFiles {
		require.NotContains(t, f.Path, workDir, "paths should be relative")
	}
}

func TestValidateDeploymentConfig_Helm_Valid(t *testing.T) {
	activities := NewDeploymentActivities("/tmp/test", nil, slog.Default())
	config := map[string]interface{}{"releaseName": "my-release"}
	configBytes, _ := json.Marshal(config)

	err := activities.ValidateDeploymentConfig(context.Background(), ValidateDeploymentConfigInput{
		GeneratorType: "helm",
		Config:        configBytes,
	})
	require.NoError(t, err)
}

func TestValidateDeploymentConfig_Helm_MissingRequired(t *testing.T) {
	activities := NewDeploymentActivities("/tmp/test", nil, slog.Default())
	config := map[string]interface{}{"namespace": "prod"}
	configBytes, _ := json.Marshal(config)

	err := activities.ValidateDeploymentConfig(context.Background(), ValidateDeploymentConfigInput{
		GeneratorType: "helm",
		Config:        configBytes,
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "releaseName")
}
