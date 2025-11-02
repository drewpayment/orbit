package activities

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// CodeGenActivities provides code generation operations for schema-to-code workflows
type CodeGenActivities struct {
	storageEndpoint string
	storageBucket   string
}

// NewCodeGenActivities creates a new CodeGenActivities instance
func NewCodeGenActivities(storageEndpoint, storageBucket string) *CodeGenActivities {
	return &CodeGenActivities{
		storageEndpoint: storageEndpoint,
		storageBucket:   storageBucket,
	}
}

// ValidateSchemaInput contains parameters for schema validation
type ValidateSchemaInput struct {
	SchemaType    string // "protobuf", "openapi", "graphql"
	SchemaContent string
}

// GenerateCodeInput contains parameters for code generation
type GenerateCodeInput struct {
	SchemaType    string
	SchemaContent string
	Languages     []string
}

// PackageArtifactsInput contains parameters for packaging generated code
type PackageArtifactsInput struct {
	Code map[string]string // language -> generated code
}

// UploadArtifactsInput contains parameters for uploading artifacts to storage
type UploadArtifactsInput struct {
	Packages    map[string][]byte // language -> packaged artifact
	WorkspaceID string
	SchemaID    string
}

// ValidateSchemaActivity validates the syntax and structure of a schema
// This activity is idempotent and can be safely retried
func (a *CodeGenActivities) ValidateSchemaActivity(ctx context.Context, input ValidateSchemaInput) error {
	if input.SchemaType == "" {
		return errors.New("schema type cannot be empty")
	}

	if input.SchemaContent == "" {
		return errors.New("schema content cannot be empty")
	}

	// Validate based on schema type
	switch input.SchemaType {
	case "protobuf":
		return a.validateProtobuf(input.SchemaContent)
	case "openapi":
		return a.validateOpenAPI(input.SchemaContent)
	case "graphql":
		return a.validateGraphQL(input.SchemaContent)
	default:
		return fmt.Errorf("unsupported schema type: %s", input.SchemaType)
	}
}

// validateProtobuf validates protobuf schema syntax
func (a *CodeGenActivities) validateProtobuf(content string) error {
	// Basic protobuf validation
	if !strings.Contains(content, "syntax") {
		return errors.New("invalid protobuf schema: missing 'syntax' declaration")
	}

	// Check for proto3 syntax (we only support proto3)
	if !strings.Contains(content, "proto3") {
		return errors.New("invalid protobuf schema: only proto3 syntax is supported")
	}

	// In a real implementation, we would use a proper protobuf parser
	// For now, basic checks are sufficient
	return nil
}

// validateOpenAPI validates OpenAPI schema syntax
func (a *CodeGenActivities) validateOpenAPI(content string) error {
	var spec map[string]interface{}

	// Try JSON first
	err := json.Unmarshal([]byte(content), &spec)
	if err != nil {
		// Try YAML
		err = yaml.Unmarshal([]byte(content), &spec)
		if err != nil {
			return fmt.Errorf("invalid OpenAPI schema: not valid JSON or YAML: %w", err)
		}
	}

	// Check for required OpenAPI fields
	openapi, ok := spec["openapi"]
	if !ok {
		return errors.New("invalid OpenAPI schema: missing 'openapi' field")
	}

	// Verify version is 3.x
	version, ok := openapi.(string)
	if !ok || !strings.HasPrefix(version, "3.") {
		return errors.New("invalid OpenAPI schema: only OpenAPI 3.x is supported")
	}

	// Check for info section
	if _, ok := spec["info"]; !ok {
		return errors.New("invalid OpenAPI schema: missing 'info' section")
	}

	return nil
}

// validateGraphQL validates GraphQL schema syntax
func (a *CodeGenActivities) validateGraphQL(content string) error {
	// Basic GraphQL validation
	if content == "" {
		return errors.New("invalid GraphQL schema: schema is empty")
	}

	// Check for common GraphQL keywords
	hasTypes := strings.Contains(content, "type ") ||
		strings.Contains(content, "interface ") ||
		strings.Contains(content, "input ") ||
		strings.Contains(content, "enum ")

	if !hasTypes {
		return errors.New("invalid GraphQL schema: no type definitions found")
	}

	// In a real implementation, we would use a proper GraphQL parser
	return nil
}

// GenerateCodeActivity generates client code for target languages from a schema
// This activity is idempotent - same input produces same output
func (a *CodeGenActivities) GenerateCodeActivity(ctx context.Context, input GenerateCodeInput) (map[string]string, error) {
	if len(input.Languages) == 0 {
		return nil, errors.New("no target languages specified")
	}

	generatedCode := make(map[string]string)

	for _, lang := range input.Languages {
		code, err := a.generateForLanguage(input.SchemaType, input.SchemaContent, lang)
		if err != nil {
			return nil, fmt.Errorf("failed to generate code for %s: %w", lang, err)
		}
		generatedCode[lang] = code
	}

	return generatedCode, nil
}

// generateForLanguage generates code for a specific language
func (a *CodeGenActivities) generateForLanguage(schemaType, schemaContent, language string) (string, error) {
	// Validate language support
	supportedLanguages := map[string]bool{
		"go":         true,
		"typescript": true,
		"python":     true,
		"java":       true,
	}

	if !supportedLanguages[language] {
		return "", fmt.Errorf("unsupported language: %s", language)
	}

	// In a real implementation, this would use actual code generators:
	// - Protobuf: protoc with language plugins
	// - OpenAPI: openapi-generator or similar
	// - GraphQL: graphql-codegen or similar
	//
	// For now, we generate placeholder code that demonstrates the structure

	switch language {
	case "go":
		return a.generateGoCode(schemaType, schemaContent)
	case "typescript":
		return a.generateTypeScriptCode(schemaType, schemaContent)
	case "python":
		return a.generatePythonCode(schemaType, schemaContent)
	case "java":
		return a.generateJavaCode(schemaType, schemaContent)
	default:
		return "", fmt.Errorf("unsupported language: %s", language)
	}
}

func (a *CodeGenActivities) generateGoCode(schemaType, schemaContent string) (string, error) {
	return fmt.Sprintf(`// Code generated from %s schema. DO NOT EDIT.
package client

import (
	"context"
	"fmt"
)

// Client provides access to the API
type Client struct {
	baseURL string
}

// NewClient creates a new API client
func NewClient(baseURL string) *Client {
	return &Client{baseURL: baseURL}
}

// Schema type: %s
// Generated code would include actual types and methods based on the schema
`, schemaType, schemaType), nil
}

func (a *CodeGenActivities) generateTypeScriptCode(schemaType, schemaContent string) (string, error) {
	return fmt.Sprintf(`// Code generated from %s schema. DO NOT EDIT.

export class Client {
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  // Schema type: %s
  // Generated code would include actual types and methods based on the schema
}
`, schemaType, schemaType), nil
}

func (a *CodeGenActivities) generatePythonCode(schemaType, schemaContent string) (string, error) {
	return fmt.Sprintf(`"""Code generated from %s schema. DO NOT EDIT."""

class Client:
    """Client provides access to the API"""

    def __init__(self, base_url: str):
        self.base_url = base_url

    # Schema type: %s
    # Generated code would include actual types and methods based on the schema
`, schemaType, schemaType), nil
}

func (a *CodeGenActivities) generateJavaCode(schemaType, schemaContent string) (string, error) {
	return fmt.Sprintf(`// Code generated from %s schema. DO NOT EDIT.
package com.orbit.client;

public class Client {
    private String baseURL;

    public Client(String baseURL) {
        this.baseURL = baseURL;
    }

    // Schema type: %s
    // Generated code would include actual types and methods based on the schema
}
`, schemaType, schemaType), nil
}

// PackageArtifactsActivity packages generated code into distributable artifacts
// This activity is idempotent - same input produces same output
func (a *CodeGenActivities) PackageArtifactsActivity(ctx context.Context, input PackageArtifactsInput) (map[string][]byte, error) {
	if len(input.Code) == 0 {
		return nil, errors.New("no code to package")
	}

	packages := make(map[string][]byte)

	for lang, code := range input.Code {
		pkg, err := a.createTarGz(lang, code)
		if err != nil {
			return nil, fmt.Errorf("failed to package %s code: %w", lang, err)
		}
		packages[lang] = pkg
	}

	return packages, nil
}

// createTarGz creates a tar.gz archive containing the generated code
func (a *CodeGenActivities) createTarGz(language, code string) ([]byte, error) {
	var buf bytes.Buffer
	gzw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gzw)

	// Determine file extension based on language
	ext := map[string]string{
		"go":         ".go",
		"typescript": ".ts",
		"python":     ".py",
		"java":       ".java",
	}[language]

	if ext == "" {
		ext = ".txt"
	}

	// Create main file entry
	filename := fmt.Sprintf("client%s", ext)
	header := &tar.Header{
		Name: filename,
		Mode: 0644,
		Size: int64(len(code)),
	}

	if err := tw.WriteHeader(header); err != nil {
		return nil, fmt.Errorf("failed to write tar header: %w", err)
	}

	if _, err := tw.Write([]byte(code)); err != nil {
		return nil, fmt.Errorf("failed to write tar content: %w", err)
	}

	// Add README
	readme := fmt.Sprintf("# Generated %s Client\n\nThis code was automatically generated.\n", language)
	readmeHeader := &tar.Header{
		Name: "README.md",
		Mode: 0644,
		Size: int64(len(readme)),
	}

	if err := tw.WriteHeader(readmeHeader); err != nil {
		return nil, fmt.Errorf("failed to write README header: %w", err)
	}

	if _, err := tw.Write([]byte(readme)); err != nil {
		return nil, fmt.Errorf("failed to write README content: %w", err)
	}

	// Close writers
	if err := tw.Close(); err != nil {
		return nil, fmt.Errorf("failed to close tar writer: %w", err)
	}

	if err := gzw.Close(); err != nil {
		return nil, fmt.Errorf("failed to close gzip writer: %w", err)
	}

	return buf.Bytes(), nil
}

// UploadArtifactsActivity uploads packaged artifacts to storage (S3/MinIO)
// This activity is idempotent - uploading the same file multiple times is safe
func (a *CodeGenActivities) UploadArtifactsActivity(ctx context.Context, input UploadArtifactsInput) (map[string]string, error) {
	if len(input.Packages) == 0 {
		return nil, errors.New("no packages to upload")
	}

	if input.WorkspaceID == "" {
		return nil, errors.New("workspace ID cannot be empty")
	}

	if input.SchemaID == "" {
		return nil, errors.New("schema ID cannot be empty")
	}

	downloadURLs := make(map[string]string)

	for lang, pkg := range input.Packages {
		url, err := a.uploadToStorage(input.WorkspaceID, input.SchemaID, lang, pkg)
		if err != nil {
			return nil, fmt.Errorf("failed to upload %s package: %w", lang, err)
		}
		downloadURLs[lang] = url
	}

	return downloadURLs, nil
}

// uploadToStorage uploads a package to S3/MinIO and returns the download URL
func (a *CodeGenActivities) uploadToStorage(workspaceID, schemaID, language string, data []byte) (string, error) {
	// In a real implementation, this would use the MinIO/S3 client to upload
	// For now, we return a simulated URL
	//
	// Real implementation would:
	// 1. Create S3/MinIO client
	// 2. Upload to bucket with path: workspaceID/schemaID/language.tar.gz
	// 3. Return pre-signed URL or public URL

	if len(data) == 0 {
		return "", errors.New("package data is empty")
	}

	// Simulate storage endpoint
	endpoint := a.storageEndpoint
	if endpoint == "" {
		endpoint = "https://storage.orbit.dev"
	}

	filename := fmt.Sprintf("%s.tar.gz", language)
	url := fmt.Sprintf("%s/%s/%s/%s", endpoint, workspaceID, schemaID, filename)

	return url, nil
}
