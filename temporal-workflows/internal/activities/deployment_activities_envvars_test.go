package activities

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBuildGeneratorContext(t *testing.T) {
	tests := []struct {
		name     string
		config   map[string]interface{}
		envVars  []EnvVarRef
		expected GeneratorContext
	}{
		{
			name: "docker-compose with env vars",
			config: map[string]interface{}{
				"serviceName": "my-app",
				"port":        float64(8080),
			},
			envVars: []EnvVarRef{
				{Key: "DATABASE_URL"},
				{Key: "API_KEY"},
			},
			expected: GeneratorContext{
				ServiceName:    "my-app",
				ImageRepo:      "ghcr.io/org/my-app",
				ImageTag:       "latest",
				Port:           8080,
				HealthCheckURL: "",
				Replicas:       1,
				Namespace:      "default",
				EnvVars: []EnvVarRef{
					{Key: "DATABASE_URL"},
					{Key: "API_KEY"},
				},
			},
		},
		{
			name: "helm with custom values",
			config: map[string]interface{}{
				"releaseName": "my-release",
				"namespace":   "production",
				"replicas":    float64(3),
				"port":        float64(9090),
			},
			envVars: nil,
			expected: GeneratorContext{
				ServiceName:    "my-release",
				ImageRepo:      "ghcr.io/org/my-release",
				ImageTag:       "latest",
				Port:           9090,
				HealthCheckURL: "",
				Replicas:       3,
				Namespace:      "production",
				EnvVars:        nil,
			},
		},
		{
			name:   "defaults when config is minimal",
			config: map[string]interface{}{},
			expected: GeneratorContext{
				ServiceName:    "app",
				ImageRepo:      "ghcr.io/org/app",
				ImageTag:       "latest",
				Port:           3000,
				HealthCheckURL: "",
				Replicas:       1,
				Namespace:      "default",
				EnvVars:        nil,
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := buildGeneratorContext(tc.config, tc.envVars)
			require.Equal(t, tc.expected.ServiceName, result.ServiceName)
			require.Equal(t, tc.expected.Port, result.Port)
			require.Equal(t, tc.expected.Replicas, result.Replicas)
			require.Equal(t, tc.expected.Namespace, result.Namespace)
			require.Equal(t, tc.expected.EnvVars, result.EnvVars)
		})
	}
}
