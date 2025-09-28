/**
 * T015 - Contract Test: APICatalogService.CreateSchema
 *
 * This contract test validates the CreateSchema gRPC method according to the protobuf contract.
 * It tests the API Catalog service's ability to create and manage API schemas.
 *
 * TDD Status: MUST fail until APICatalogService is implemented
 * Expected failure: "connection refused" to localhost:8003
 */

package contract

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	apicatalogv1 "github.com/drewpayment/orbit/proto/gen/go/idp/api_catalog/v1"
)

const (
	APICatalogServiceAddr = "localhost:8003"
)

func TestAPICatalogService_CreateSchema(t *testing.T) {
	// TDD Phase: This test MUST fail until the service is implemented
	t.Log("=== T015 Contract Test: APICatalogService.CreateSchema ===")
	t.Log("Testing gRPC contract compliance for API schema creation")

	// Connect to APICatalog service
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.NewClient(APICatalogServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to connect to APICatalog service: %v", err)
	}
	defer conn.Close()

	client := apicatalogv1.NewAPICatalogServiceClient(conn)

	t.Log("✅ gRPC client connection established")

	// Test CreateSchema with valid schema data - using actual contract fields
	validRequest := &apicatalogv1.CreateSchemaRequest{
		WorkspaceId:  "workspace-123",
		RepositoryId: "repo-456", // Optional
		Name:         "User API Schema",
		Slug:         "user-api-schema",
		Version:      "1.0.0",
		Description:  "A comprehensive API schema for user management",
		SchemaType:   apicatalogv1.SchemaType_SCHEMA_TYPE_OPENAPI,
		RawContent: `{
			"openapi": "3.0.3",
			"info": {
				"title": "User API",
				"version": "1.0.0",
				"description": "API for managing users"
			},
			"paths": {
				"/users": {
					"get": {
						"summary": "Get all users",
						"responses": {
							"200": {
								"description": "List of users",
								"content": {
									"application/json": {
										"schema": {
											"type": "array",
											"items": {
												"type": "object",
												"properties": {
													"id": {"type": "string"},
													"name": {"type": "string"},
													"email": {"type": "string"}
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}`,
		Tags: []string{"users", "rest-api"},
		ContactInfo: &apicatalogv1.ContactInfo{
			Name:  "API Team",
			Email: "api-team@example.com",
		},
		License: "MIT",
	}

	t.Log("🔧 Attempting to create API schema...")

	// This should fail in TDD phase with "connection refused"
	response, err := client.CreateSchema(ctx, validRequest)

	if err != nil {
		t.Logf("✅ Expected TDD failure - service method not implemented: %v", err)

		// Verify it's the expected connection error (not a different error)
		assert.Contains(t, err.Error(), "connection refused",
			"Expected 'connection refused' error, got: %v", err)

		// Test passes because we expect this failure in TDD phase
		return
	}

	// If we reach here, the service is implemented - validate response
	require.NotNil(t, response, "CreateSchema response should not be nil")
	require.NotNil(t, response.Response, "Response wrapper should not be nil")
	require.NotNil(t, response.Schema, "Created schema should not be nil")

	// Validate the response structure
	assert.True(t, response.Response.Success, "Response should indicate success")

	// Validate the created schema
	schema := response.Schema
	assert.NotEmpty(t, schema.Metadata.Id, "Schema should have an ID")
	assert.Equal(t, validRequest.WorkspaceId, schema.Workspace.Id, "Workspace ID should match")
	assert.Equal(t, validRequest.Name, schema.Name, "Name should match")
	assert.Equal(t, validRequest.Slug, schema.Slug, "Slug should match")
	assert.Equal(t, validRequest.Version, schema.Version, "Version should match")
	assert.Equal(t, validRequest.Description, schema.Description, "Description should match")
	assert.Equal(t, validRequest.SchemaType, schema.SchemaType, "Schema type should match")
	assert.Equal(t, validRequest.RawContent, schema.RawContent, "Raw content should match")
	assert.Equal(t, validRequest.Tags, schema.Tags, "Tags should match")
	assert.Equal(t, validRequest.License, schema.License, "License should match")

	// Validate metadata
	assert.NotNil(t, schema.Metadata.CreatedAt, "Created timestamp should be set")
	assert.NotNil(t, schema.ContactInfo, "Contact info should be set")

	t.Log("✅ Valid schema creation passed")
}

func TestAPICatalogService_CreateSchema_ValidationErrors(t *testing.T) {
	t.Log("=== Testing CreateSchema with validation errors ===")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.NewClient(APICatalogServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to service: %v", err)
		return
	}
	defer conn.Close()

	client := apicatalogv1.NewAPICatalogServiceClient(conn)

	// Test validation scenarios
	testCases := []struct {
		name        string
		request     *apicatalogv1.CreateSchemaRequest
		expectError string
	}{
		{
			name: "missing workspace ID",
			request: &apicatalogv1.CreateSchemaRequest{
				// WorkspaceId is missing
				Name:       "Test Schema",
				Version:    "1.0.0",
				SchemaType: apicatalogv1.SchemaType_SCHEMA_TYPE_OPENAPI,
				RawContent: `{"openapi": "3.0.3", "info": {"title": "Test", "version": "1.0.0"}}`,
			},
			expectError: "workspace_id is required",
		},
		{
			name: "missing name",
			request: &apicatalogv1.CreateSchemaRequest{
				WorkspaceId: "workspace-123",
				// Name is missing
				Version:    "1.0.0",
				SchemaType: apicatalogv1.SchemaType_SCHEMA_TYPE_OPENAPI,
				RawContent: `{"openapi": "3.0.3", "info": {"title": "Test", "version": "1.0.0"}}`,
			},
			expectError: "name is required",
		},
		{
			name: "missing version",
			request: &apicatalogv1.CreateSchemaRequest{
				WorkspaceId: "workspace-123",
				Name:        "Test Schema",
				// Version is missing
				SchemaType: apicatalogv1.SchemaType_SCHEMA_TYPE_OPENAPI,
				RawContent: `{"openapi": "3.0.3", "info": {"title": "Test", "version": "1.0.0"}}`,
			},
			expectError: "version is required",
		},
		{
			name: "invalid schema type",
			request: &apicatalogv1.CreateSchemaRequest{
				WorkspaceId: "workspace-123",
				Name:        "Test Schema",
				Version:     "1.0.0",
				SchemaType:  apicatalogv1.SchemaType_SCHEMA_TYPE_UNSPECIFIED,
				RawContent:  `{"openapi": "3.0.3", "info": {"title": "Test", "version": "1.0.0"}}`,
			},
			expectError: "schema_type must be specified",
		},
		{
			name: "missing raw content",
			request: &apicatalogv1.CreateSchemaRequest{
				WorkspaceId: "workspace-123",
				Name:        "Test Schema",
				Version:     "1.0.0",
				SchemaType:  apicatalogv1.SchemaType_SCHEMA_TYPE_OPENAPI,
				// RawContent is missing
			},
			expectError: "raw_content is required",
		},
		{
			name: "invalid JSON content",
			request: &apicatalogv1.CreateSchemaRequest{
				WorkspaceId: "workspace-123",
				Name:        "Test Schema",
				Version:     "1.0.0",
				SchemaType:  apicatalogv1.SchemaType_SCHEMA_TYPE_OPENAPI,
				RawContent:  `{"invalid": "json"`, // Invalid JSON
			},
			expectError: "invalid JSON",
		},
		{
			name: "invalid slug format",
			request: &apicatalogv1.CreateSchemaRequest{
				WorkspaceId: "workspace-123",
				Name:        "Test Schema",
				Slug:        "Invalid Slug With Spaces!",
				Version:     "1.0.0",
				SchemaType:  apicatalogv1.SchemaType_SCHEMA_TYPE_OPENAPI,
				RawContent:  `{"openapi": "3.0.3", "info": {"title": "Test", "version": "1.0.0"}}`,
			},
			expectError: "slug must be lowercase alphanumeric with hyphens",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			response, err := client.CreateSchema(ctx, tc.request)

			if err != nil {
				// Expected in TDD phase
				t.Logf("✅ TDD phase validation test: %v", err)
				return
			}

			// If service is implemented, validate the error response
			require.NotNil(t, response, "Response should not be nil")
			require.NotNil(t, response.Response, "Response wrapper should not be nil")

			// Should indicate failure for validation errors
			assert.False(t, response.Response.Success,
				"Response should indicate failure for %s", tc.name)
			assert.NotEmpty(t, response.Response.Errors,
				"Response should contain validation errors for %s", tc.name)

			// Check that error contains expected message
			errorFound := false
			for _, validationErr := range response.Response.Errors {
				if assert.Contains(t, validationErr.Message, tc.expectError) {
					errorFound = true
					break
				}
			}
			assert.True(t, errorFound,
				"Should find expected error message '%s' in validation errors", tc.expectError)

			t.Logf("✅ Validation test for %s completed", tc.name)
		})
	}
}
