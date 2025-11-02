package workflows

import (
	"context"
	"errors"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/testsuite"
)

type CodeGenerationWorkflowTestSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
	env *testsuite.TestWorkflowEnvironment
}

func (s *CodeGenerationWorkflowTestSuite) SetupTest() {
	s.env = s.NewTestWorkflowEnvironment()

	// Register stub activities for testing
	s.env.RegisterActivity(validateSchemaActivityStub)
	s.env.RegisterActivity(generateCodeActivityStub)
	s.env.RegisterActivity(packageArtifactsActivityStub)
	s.env.RegisterActivity(uploadArtifactsActivityStub)
}

func (s *CodeGenerationWorkflowTestSuite) AfterTest(suiteName, testName string) {
	s.env.AssertExpectations(s.T())
}

func TestCodeGenerationWorkflowTestSuite(t *testing.T) {
	suite.Run(t, new(CodeGenerationWorkflowTestSuite))
}

// Test successful code generation workflow with multiple languages
func (s *CodeGenerationWorkflowTestSuite) TestCodeGenerationWorkflow_Success() {
	input := CodeGenerationWorkflowInput{
		WorkspaceID:   "workspace-123",
		SchemaID:      "schema-456",
		SchemaType:    "protobuf",
		SchemaContent: "syntax = \"proto3\";\n\nservice GreeterService {\n  rpc SayHello (HelloRequest) returns (HelloReply) {}\n}\n\nmessage HelloRequest {\n  string name = 1;\n}\n\nmessage HelloReply {\n  string message = 1;\n}",
		Languages:     []string{"go", "typescript", "python"},
	}

	// Mock ValidateSchemaActivity
	s.env.OnActivity(validateSchemaActivityStub, mock.Anything, mock.Anything).Return(nil)

	// Mock GenerateCodeActivity
	generatedCode := map[string]string{
		"go":         "package main\n\n// Generated Go code",
		"typescript": "// Generated TypeScript code",
		"python":     "# Generated Python code",
	}
	s.env.OnActivity(generateCodeActivityStub, mock.Anything, mock.Anything).Return(generatedCode, nil)

	// Mock PackageArtifactsActivity
	packages := map[string][]byte{
		"go":         []byte("go-package-content"),
		"typescript": []byte("ts-package-content"),
		"python":     []byte("python-package-content"),
	}
	s.env.OnActivity(packageArtifactsActivityStub, mock.Anything, mock.Anything).Return(packages, nil)

	// Mock UploadArtifactsActivity
	downloadURLs := map[string]string{
		"go":         "https://storage.orbit.dev/workspace-123/schema-456/go.tar.gz",
		"typescript": "https://storage.orbit.dev/workspace-123/schema-456/typescript.tar.gz",
		"python":     "https://storage.orbit.dev/workspace-123/schema-456/python.tar.gz",
	}
	s.env.OnActivity(uploadArtifactsActivityStub, mock.Anything, mock.Anything).Return(downloadURLs, nil)

	s.env.ExecuteWorkflow(CodeGenerationWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result CodeGenerationWorkflowResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.Equal("schema-456", result.SchemaID)
	s.Equal("completed", result.Status)
	s.Equal(3, len(result.DownloadURLs))
	s.Contains(result.DownloadURLs, "go")
	s.Contains(result.DownloadURLs, "typescript")
	s.Contains(result.DownloadURLs, "python")
}

// Test workflow failure when schema validation fails
func (s *CodeGenerationWorkflowTestSuite) TestCodeGenerationWorkflow_ValidationFailure() {
	input := CodeGenerationWorkflowInput{
		WorkspaceID:   "workspace-123",
		SchemaID:      "schema-456",
		SchemaType:    "protobuf",
		SchemaContent: "invalid proto content",
		Languages:     []string{"go"},
	}

	// Mock ValidateSchemaActivity to return an error
	s.env.OnActivity(validateSchemaActivityStub, mock.Anything, mock.Anything).
		Return(errors.New("invalid schema syntax: expected 'syntax' declaration"))

	s.env.ExecuteWorkflow(CodeGenerationWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.Error(s.env.GetWorkflowError())
}

// Test workflow failure when code generation fails
func (s *CodeGenerationWorkflowTestSuite) TestCodeGenerationWorkflow_GenerationFailure() {
	input := CodeGenerationWorkflowInput{
		WorkspaceID:   "workspace-123",
		SchemaID:      "schema-456",
		SchemaType:    "openapi",
		SchemaContent: `{"openapi": "3.0.0", "info": {"title": "Test API"}}`,
		Languages:     []string{"go", "java"},
	}

	// Mock ValidateSchemaActivity
	s.env.OnActivity(validateSchemaActivityStub, mock.Anything, mock.Anything).Return(nil)

	// Mock GenerateCodeActivity to return an error
	s.env.OnActivity(generateCodeActivityStub, mock.Anything, mock.Anything).
		Return(nil, errors.New("code generation failed: unsupported language"))

	s.env.ExecuteWorkflow(CodeGenerationWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.Error(s.env.GetWorkflowError())
}

// Test workflow failure when artifact upload fails
func (s *CodeGenerationWorkflowTestSuite) TestCodeGenerationWorkflow_UploadFailure() {
	input := CodeGenerationWorkflowInput{
		WorkspaceID:   "workspace-123",
		SchemaID:      "schema-456",
		SchemaType:    "graphql",
		SchemaContent: "type Query { hello: String }",
		Languages:     []string{"typescript"},
	}

	// Mock successful activities until UploadArtifactsActivity
	s.env.OnActivity(validateSchemaActivityStub, mock.Anything, mock.Anything).Return(nil)

	generatedCode := map[string]string{
		"typescript": "// Generated TypeScript code",
	}
	s.env.OnActivity(generateCodeActivityStub, mock.Anything, mock.Anything).Return(generatedCode, nil)

	packages := map[string][]byte{
		"typescript": []byte("ts-package-content"),
	}
	s.env.OnActivity(packageArtifactsActivityStub, mock.Anything, mock.Anything).Return(packages, nil)

	s.env.OnActivity(uploadArtifactsActivityStub, mock.Anything, mock.Anything).
		Return(nil, errors.New("upload failed: storage unavailable"))

	s.env.ExecuteWorkflow(CodeGenerationWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.Error(s.env.GetWorkflowError())
}

// Test retry behavior when generation temporarily fails
func (s *CodeGenerationWorkflowTestSuite) TestCodeGenerationWorkflow_RetryBehavior() {
	input := CodeGenerationWorkflowInput{
		WorkspaceID:   "workspace-123",
		SchemaID:      "schema-456",
		SchemaType:    "protobuf",
		SchemaContent: "syntax = \"proto3\";\n\nmessage Test { string id = 1; }",
		Languages:     []string{"go"},
	}

	// Mock ValidateSchemaActivity
	s.env.OnActivity(validateSchemaActivityStub, mock.Anything, mock.Anything).Return(nil)

	// Mock GenerateCodeActivity to fail twice then succeed
	callCount := 0
	s.env.OnActivity(generateCodeActivityStub, mock.Anything, mock.Anything).
		Return(func(ctx context.Context, input activities.GenerateCodeInput) (map[string]string, error) {
			callCount++
			if callCount < 3 {
				return nil, errors.New("temporary generation failure")
			}
			return map[string]string{"go": "package main\n\n// Generated"}, nil
		})

	// Mock other activities
	packages := map[string][]byte{"go": []byte("go-package")}
	s.env.OnActivity(packageArtifactsActivityStub, mock.Anything, mock.Anything).Return(packages, nil)

	downloadURLs := map[string]string{"go": "https://storage.orbit.dev/workspace-123/schema-456/go.tar.gz"}
	s.env.OnActivity(uploadArtifactsActivityStub, mock.Anything, mock.Anything).Return(downloadURLs, nil)

	s.env.ExecuteWorkflow(CodeGenerationWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result CodeGenerationWorkflowResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.Equal("completed", result.Status)
}
