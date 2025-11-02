package activities

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateSchemaActivity_Protobuf(t *testing.T) {
	activities := NewCodeGenActivities("https://storage.test", "test-bucket")

	tests := []struct {
		name        string
		input       ValidateSchemaInput
		expectError bool
		errorMsg    string
	}{
		{
			name: "valid protobuf schema",
			input: ValidateSchemaInput{
				SchemaType:    "protobuf",
				SchemaContent: "syntax = \"proto3\";\n\nmessage Test { string id = 1; }",
			},
			expectError: false,
		},
		{
			name: "missing syntax declaration",
			input: ValidateSchemaInput{
				SchemaType:    "protobuf",
				SchemaContent: "message Test { string id = 1; }",
			},
			expectError: true,
			errorMsg:    "missing 'syntax' declaration",
		},
		{
			name: "not proto3",
			input: ValidateSchemaInput{
				SchemaType:    "protobuf",
				SchemaContent: "syntax = \"proto2\";\n\nmessage Test { optional string id = 1; }",
			},
			expectError: true,
			errorMsg:    "only proto3 syntax is supported",
		},
		{
			name: "empty schema type",
			input: ValidateSchemaInput{
				SchemaType:    "",
				SchemaContent: "syntax = \"proto3\";",
			},
			expectError: true,
			errorMsg:    "schema type cannot be empty",
		},
		{
			name: "empty schema content",
			input: ValidateSchemaInput{
				SchemaType:    "protobuf",
				SchemaContent: "",
			},
			expectError: true,
			errorMsg:    "schema content cannot be empty",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := activities.ValidateSchemaActivity(context.Background(), tt.input)
			if tt.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errorMsg)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestValidateSchemaActivity_OpenAPI(t *testing.T) {
	activities := NewCodeGenActivities("https://storage.test", "test-bucket")

	tests := []struct {
		name        string
		content     string
		expectError bool
		errorMsg    string
	}{
		{
			name: "valid OpenAPI JSON",
			content: `{
				"openapi": "3.0.0",
				"info": {"title": "Test API", "version": "1.0.0"}
			}`,
			expectError: false,
		},
		{
			name: "valid OpenAPI YAML",
			content: `openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0`,
			expectError: false,
		},
		{
			name:        "missing openapi field",
			content:     `{"info": {"title": "Test"}}`,
			expectError: true,
			errorMsg:    "missing 'openapi' field",
		},
		{
			name: "wrong OpenAPI version",
			content: `{
				"openapi": "2.0",
				"info": {"title": "Test"}
			}`,
			expectError: true,
			errorMsg:    "only OpenAPI 3.x is supported",
		},
		{
			name: "missing info section",
			content: `{
				"openapi": "3.0.0"
			}`,
			expectError: true,
			errorMsg:    "missing 'info' section",
		},
		{
			name:        "invalid JSON/YAML",
			content:     "not valid {json or yaml",
			expectError: true,
			errorMsg:    "not valid JSON or YAML",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := ValidateSchemaInput{
				SchemaType:    "openapi",
				SchemaContent: tt.content,
			}
			err := activities.ValidateSchemaActivity(context.Background(), input)
			if tt.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errorMsg)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestValidateSchemaActivity_GraphQL(t *testing.T) {
	activities := NewCodeGenActivities("https://storage.test", "test-bucket")

	tests := []struct {
		name        string
		content     string
		expectError bool
		errorMsg    string
	}{
		{
			name:        "valid GraphQL schema with type",
			content:     "type Query { hello: String }",
			expectError: false,
		},
		{
			name:        "valid GraphQL schema with interface",
			content:     "interface Node { id: ID! }",
			expectError: false,
		},
		{
			name:        "valid GraphQL schema with input",
			content:     "input CreateUserInput { name: String! }",
			expectError: false,
		},
		{
			name:        "valid GraphQL schema with enum",
			content:     "enum Status { ACTIVE INACTIVE }",
			expectError: false,
		},
		{
			name:        "empty schema",
			content:     "",
			expectError: true,
			errorMsg:    "schema content cannot be empty",
		},
		{
			name:        "no type definitions",
			content:     "# Just a comment",
			expectError: true,
			errorMsg:    "no type definitions found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := ValidateSchemaInput{
				SchemaType:    "graphql",
				SchemaContent: tt.content,
			}
			err := activities.ValidateSchemaActivity(context.Background(), input)
			if tt.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errorMsg)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestValidateSchemaActivity_UnsupportedType(t *testing.T) {
	activities := NewCodeGenActivities("https://storage.test", "test-bucket")

	input := ValidateSchemaInput{
		SchemaType:    "swagger",
		SchemaContent: "some content",
	}

	err := activities.ValidateSchemaActivity(context.Background(), input)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported schema type: swagger")
}

func TestGenerateCodeActivity(t *testing.T) {
	activities := NewCodeGenActivities("https://storage.test", "test-bucket")

	tests := []struct {
		name        string
		input       GenerateCodeInput
		expectError bool
		errorMsg    string
		validate    func(t *testing.T, code map[string]string)
	}{
		{
			name: "generate Go code",
			input: GenerateCodeInput{
				SchemaType:    "protobuf",
				SchemaContent: "syntax = \"proto3\";",
				Languages:     []string{"go"},
			},
			expectError: false,
			validate: func(t *testing.T, code map[string]string) {
				require.Contains(t, code, "go")
				assert.Contains(t, code["go"], "package client")
				assert.Contains(t, code["go"], "Code generated")
			},
		},
		{
			name: "generate multiple languages",
			input: GenerateCodeInput{
				SchemaType:    "openapi",
				SchemaContent: `{"openapi": "3.0.0"}`,
				Languages:     []string{"go", "typescript", "python"},
			},
			expectError: false,
			validate: func(t *testing.T, code map[string]string) {
				require.Len(t, code, 3)
				assert.Contains(t, code, "go")
				assert.Contains(t, code, "typescript")
				assert.Contains(t, code, "python")
			},
		},
		{
			name: "generate Java code",
			input: GenerateCodeInput{
				SchemaType:    "graphql",
				SchemaContent: "type Query { hello: String }",
				Languages:     []string{"java"},
			},
			expectError: false,
			validate: func(t *testing.T, code map[string]string) {
				require.Contains(t, code, "java")
				assert.Contains(t, code["java"], "public class Client")
			},
		},
		{
			name: "no languages specified",
			input: GenerateCodeInput{
				SchemaType:    "protobuf",
				SchemaContent: "syntax = \"proto3\";",
				Languages:     []string{},
			},
			expectError: true,
			errorMsg:    "no target languages specified",
		},
		{
			name: "unsupported language",
			input: GenerateCodeInput{
				SchemaType:    "protobuf",
				SchemaContent: "syntax = \"proto3\";",
				Languages:     []string{"rust"},
			},
			expectError: true,
			errorMsg:    "unsupported language: rust",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code, err := activities.GenerateCodeActivity(context.Background(), tt.input)
			if tt.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errorMsg)
			} else {
				require.NoError(t, err)
				if tt.validate != nil {
					tt.validate(t, code)
				}
			}
		})
	}
}

func TestGenerateCodeActivity_AllLanguages(t *testing.T) {
	activities := NewCodeGenActivities("https://storage.test", "test-bucket")

	languages := []string{"go", "typescript", "python", "java"}
	input := GenerateCodeInput{
		SchemaType:    "protobuf",
		SchemaContent: "syntax = \"proto3\";",
		Languages:     languages,
	}

	code, err := activities.GenerateCodeActivity(context.Background(), input)
	require.NoError(t, err)
	require.Len(t, code, 4)

	// Verify each language has generated code
	for _, lang := range languages {
		assert.Contains(t, code, lang)
		assert.NotEmpty(t, code[lang])
	}
}

func TestPackageArtifactsActivity(t *testing.T) {
	activities := NewCodeGenActivities("https://storage.test", "test-bucket")

	tests := []struct {
		name        string
		input       PackageArtifactsInput
		expectError bool
		errorMsg    string
		validate    func(t *testing.T, packages map[string][]byte)
	}{
		{
			name: "package single language",
			input: PackageArtifactsInput{
				Code: map[string]string{
					"go": "package main\n\nfunc main() {}",
				},
			},
			expectError: false,
			validate: func(t *testing.T, packages map[string][]byte) {
				require.Contains(t, packages, "go")
				assert.NotEmpty(t, packages["go"])
				// Verify it's a valid gzip archive (starts with gzip magic number)
				assert.Equal(t, byte(0x1f), packages["go"][0])
				assert.Equal(t, byte(0x8b), packages["go"][1])
			},
		},
		{
			name: "package multiple languages",
			input: PackageArtifactsInput{
				Code: map[string]string{
					"go":         "package main",
					"typescript": "export class Client {}",
					"python":     "class Client: pass",
				},
			},
			expectError: false,
			validate: func(t *testing.T, packages map[string][]byte) {
				require.Len(t, packages, 3)
				for _, pkg := range packages {
					// Verify gzip format
					assert.Equal(t, byte(0x1f), pkg[0])
					assert.Equal(t, byte(0x8b), pkg[1])
				}
			},
		},
		{
			name: "no code to package",
			input: PackageArtifactsInput{
				Code: map[string]string{},
			},
			expectError: true,
			errorMsg:    "no code to package",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			packages, err := activities.PackageArtifactsActivity(context.Background(), tt.input)
			if tt.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errorMsg)
			} else {
				require.NoError(t, err)
				if tt.validate != nil {
					tt.validate(t, packages)
				}
			}
		})
	}
}

func TestUploadArtifactsActivity(t *testing.T) {
	activities := NewCodeGenActivities("https://storage.test", "test-bucket")

	tests := []struct {
		name        string
		input       UploadArtifactsInput
		expectError bool
		errorMsg    string
		validate    func(t *testing.T, urls map[string]string)
	}{
		{
			name: "upload single artifact",
			input: UploadArtifactsInput{
				Packages: map[string][]byte{
					"go": []byte("package data"),
				},
				WorkspaceID: "workspace-123",
				SchemaID:    "schema-456",
			},
			expectError: false,
			validate: func(t *testing.T, urls map[string]string) {
				require.Contains(t, urls, "go")
				assert.Contains(t, urls["go"], "workspace-123")
				assert.Contains(t, urls["go"], "schema-456")
				assert.Contains(t, urls["go"], "go.tar.gz")
			},
		},
		{
			name: "upload multiple artifacts",
			input: UploadArtifactsInput{
				Packages: map[string][]byte{
					"go":         []byte("go data"),
					"typescript": []byte("ts data"),
					"python":     []byte("py data"),
				},
				WorkspaceID: "workspace-789",
				SchemaID:    "schema-101",
			},
			expectError: false,
			validate: func(t *testing.T, urls map[string]string) {
				require.Len(t, urls, 3)
				assert.Contains(t, urls["go"], "go.tar.gz")
				assert.Contains(t, urls["typescript"], "typescript.tar.gz")
				assert.Contains(t, urls["python"], "python.tar.gz")
			},
		},
		{
			name: "no packages to upload",
			input: UploadArtifactsInput{
				Packages:    map[string][]byte{},
				WorkspaceID: "workspace-123",
				SchemaID:    "schema-456",
			},
			expectError: true,
			errorMsg:    "no packages to upload",
		},
		{
			name: "missing workspace ID",
			input: UploadArtifactsInput{
				Packages: map[string][]byte{
					"go": []byte("data"),
				},
				WorkspaceID: "",
				SchemaID:    "schema-456",
			},
			expectError: true,
			errorMsg:    "workspace ID cannot be empty",
		},
		{
			name: "missing schema ID",
			input: UploadArtifactsInput{
				Packages: map[string][]byte{
					"go": []byte("data"),
				},
				WorkspaceID: "workspace-123",
				SchemaID:    "",
			},
			expectError: true,
			errorMsg:    "schema ID cannot be empty",
		},
		{
			name: "empty package data",
			input: UploadArtifactsInput{
				Packages: map[string][]byte{
					"go": []byte{},
				},
				WorkspaceID: "workspace-123",
				SchemaID:    "schema-456",
			},
			expectError: true,
			errorMsg:    "package data is empty",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			urls, err := activities.UploadArtifactsActivity(context.Background(), tt.input)
			if tt.expectError {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errorMsg)
			} else {
				require.NoError(t, err)
				if tt.validate != nil {
					tt.validate(t, urls)
				}
			}
		})
	}
}

func TestCodeGenActivities_Integration(t *testing.T) {
	// End-to-end test simulating the full workflow
	activities := NewCodeGenActivities("https://storage.orbit.dev", "orbit-artifacts")
	ctx := context.Background()

	// Step 1: Validate schema
	validateInput := ValidateSchemaInput{
		SchemaType:    "protobuf",
		SchemaContent: "syntax = \"proto3\";\n\nmessage User { string id = 1; string name = 2; }",
	}
	err := activities.ValidateSchemaActivity(ctx, validateInput)
	require.NoError(t, err)

	// Step 2: Generate code
	generateInput := GenerateCodeInput{
		SchemaType:    "protobuf",
		SchemaContent: validateInput.SchemaContent,
		Languages:     []string{"go", "typescript"},
	}
	code, err := activities.GenerateCodeActivity(ctx, generateInput)
	require.NoError(t, err)
	require.Len(t, code, 2)

	// Step 3: Package artifacts
	packageInput := PackageArtifactsInput{
		Code: code,
	}
	packages, err := activities.PackageArtifactsActivity(ctx, packageInput)
	require.NoError(t, err)
	require.Len(t, packages, 2)

	// Step 4: Upload artifacts
	uploadInput := UploadArtifactsInput{
		Packages:    packages,
		WorkspaceID: "integration-test",
		SchemaID:    "user-schema",
	}
	urls, err := activities.UploadArtifactsActivity(ctx, uploadInput)
	require.NoError(t, err)
	require.Len(t, urls, 2)

	// Verify URLs
	assert.Contains(t, urls["go"], "integration-test/user-schema/go.tar.gz")
	assert.Contains(t, urls["typescript"], "integration-test/user-schema/typescript.tar.gz")
}
