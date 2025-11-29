package activities

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	"log/slog"
)

func TestValidateDeploymentConfig_DockerCompose_Valid(t *testing.T) {
	activities := NewDeploymentActivities("/tmp/test", nil, slog.Default())

	config := map[string]interface{}{
		"hostUrl":     "unix:///var/run/docker.sock",
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
		// Missing hostUrl and serviceName
	}
	configBytes, _ := json.Marshal(config)

	input := ValidateDeploymentConfigInput{
		GeneratorType: "docker-compose",
		Config:        configBytes,
	}

	err := activities.ValidateDeploymentConfig(context.Background(), input)
	require.Error(t, err)
	require.Contains(t, err.Error(), "hostUrl")
}
