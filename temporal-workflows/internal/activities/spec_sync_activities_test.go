package activities_test

import (
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/stretchr/testify/assert"
)

func TestSpecFilePatternMatching(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		expected bool
	}{
		// Positive cases
		{"openapi.yaml at root", "openapi.yaml", true},
		{"openapi.yml at root", "openapi.yml", true},
		{"openapi.json at root", "openapi.json", true},
		{"swagger.yaml at root", "swagger.yaml", true},
		{"swagger.yml at root", "swagger.yml", true},
		{"swagger.json at root", "swagger.json", true},
		{"asyncapi.yaml at root", "asyncapi.yaml", true},
		{"asyncapi.yml at root", "asyncapi.yml", true},
		{"asyncapi.json at root", "asyncapi.json", true},
		{"nested openapi.yaml", "docs/openapi.yaml", true},
		{"deeply nested swagger.json", "api/v2/swagger.json", true},
		{"case insensitive OpenAPI.YAML", "OpenAPI.YAML", true},
		{"mixed case Swagger.Json", "Swagger.Json", true},

		// Negative cases
		{"README.md", "README.md", false},
		{"random yaml", "config.yaml", false},
		{"partial match", "my-openapi.yaml", false},
		{"openapi in directory name", "openapi/schema.yaml", false},
		{"empty string", "", false},
		{"go file", "main.go", false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := activities.IsSpecFile(tc.path)
			assert.Equal(t, tc.expected, result, "IsSpecFile(%q)", tc.path)
		})
	}
}

func TestDetectSpecType(t *testing.T) {
	tests := []struct {
		name     string
		content  string
		expected string
	}{
		// JSON detection
		{
			name:     "JSON openapi key",
			content:  `{"openapi": "3.0.0", "info": {"title": "Test"}}`,
			expected: "openapi",
		},
		{
			name:     "JSON swagger key",
			content:  `{"swagger": "2.0", "info": {"title": "Test"}}`,
			expected: "openapi",
		},
		{
			name:     "JSON asyncapi key",
			content:  `{"asyncapi": "2.6.0", "info": {"title": "Test"}}`,
			expected: "asyncapi",
		},
		{
			name:     "JSON unknown keys",
			content:  `{"type": "object", "properties": {}}`,
			expected: "unknown",
		},

		// YAML detection
		{
			name:     "YAML openapi prefix",
			content:  "openapi: 3.1.0\ninfo:\n  title: My API",
			expected: "openapi",
		},
		{
			name:     "YAML swagger prefix",
			content:  "swagger: \"2.0\"\ninfo:\n  title: My API",
			expected: "openapi",
		},
		{
			name:     "YAML asyncapi prefix",
			content:  "asyncapi: 2.6.0\ninfo:\n  title: My Events",
			expected: "asyncapi",
		},
		{
			name:     "YAML with leading whitespace",
			content:  "  openapi: 3.0.0\ninfo:\n  title: API",
			expected: "openapi",
		},
		{
			name:     "unrecognised YAML",
			content:  "name: my-service\nversion: 1.0.0",
			expected: "unknown",
		},

		// Edge cases
		{
			name:     "empty string",
			content:  "",
			expected: "unknown",
		},
		{
			name:     "random text",
			content:  "This is not a spec file at all.",
			expected: "unknown",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := activities.DetectSpecType(tc.content)
			assert.Equal(t, tc.expected, result, "DetectSpecType(%q)", tc.content)
		})
	}
}
