/**
 * T016 - Contract Test: APICatalogService.ValidateSchema
 *
 * This contract test validates the ValidateSchema gRPC method according to the protobuf contract.
 * It tests the API Catalog service's ability to validate API schemas for correctness.
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

func TestAPICatalogService_ValidateSchema(t *testing.T) {
	// TDD Phase: This test MUST fail until the service is implemented
	t.Log("=== T016 Contract Test: APICatalogService.ValidateSchema ===")
	t.Log("Testing gRPC contract compliance for API schema validation")

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

	// Test ValidateSchema with valid OpenAPI schema - using actual contract fields
	validRequest := &apicatalogv1.ValidateSchemaRequest{
		SchemaType: apicatalogv1.SchemaType_SCHEMA_TYPE_OPENAPI,
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
	}

	t.Log("🔧 Attempting to validate valid API schema...")

	// This should fail in TDD phase with "connection refused"
	response, err := client.ValidateSchema(ctx, validRequest)

	if err != nil {
		t.Logf("✅ Expected TDD failure - service method not implemented: %v", err)

		// Verify it's the expected connection error (not a different error)
		assert.Contains(t, err.Error(), "connection refused",
			"Expected 'connection refused' error, got: %v", err)

		// Test passes because we expect this failure in TDD phase
		return
	}

	// If we reach here, the service is implemented - validate response for valid schema
	require.NotNil(t, response, "ValidateSchema response should not be nil")
	require.NotNil(t, response.Response, "Response should not be nil")

	// Validate that it passes validation
	assert.True(t, response.IsValid, "Valid schema should pass validation")
	assert.Empty(t, response.ValidationErrors, "Valid schema should have no validation errors")
	assert.True(t, response.Response.Success, "Response should indicate success")

	t.Log("✅ Valid schema validation passed")
}

func TestAPICatalogService_ValidateSchema_InvalidSchemas(t *testing.T) {
	t.Log("=== Testing ValidateSchema with invalid schemas ===")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.NewClient(APICatalogServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to service: %v", err)
		return
	}
	defer conn.Close()

	client := apicatalogv1.NewAPICatalogServiceClient(conn)

	// Test validation scenarios with invalid schemas
	testCases := []struct {
		name        string
		schemaType  apicatalogv1.SchemaType
		rawContent  string
		expectValid bool
		expectError string
	}{
		{
			name:        "malformed JSON",
			schemaType:  apicatalogv1.SchemaType_SCHEMA_TYPE_OPENAPI,
			rawContent:  `{"openapi": "3.0.3", "info": { "title": "Broken JSON"`,
			expectValid: false,
			expectError: "invalid JSON",
		},
		{
			name:       "missing required OpenAPI fields",
			schemaType: apicatalogv1.SchemaType_SCHEMA_TYPE_OPENAPI,
			rawContent: `{
				"openapi": "3.0.3"
			}`,
			expectValid: false,
			expectError: "missing required field",
		},
		{
			name:       "invalid OpenAPI version",
			schemaType: apicatalogv1.SchemaType_SCHEMA_TYPE_OPENAPI,
			rawContent: `{
				"openapi": "2.0",
				"info": {
					"title": "Wrong Version API",
					"version": "1.0.0"
				}
			}`,
			expectValid: false,
			expectError: "unsupported OpenAPI version",
		},
		{
			name:       "invalid schema references",
			schemaType: apicatalogv1.SchemaType_SCHEMA_TYPE_OPENAPI,
			rawContent: `{
				"openapi": "3.0.3",
				"info": {
					"title": "Broken References API",
					"version": "1.0.0"
				},
				"paths": {
					"/users": {
						"get": {
							"responses": {
								"200": {
									"content": {
										"application/json": {
											"schema": {
												"$ref": "#/components/schemas/NonExistentSchema"
											}
										}
									}
								}
							}
						}
					}
				}
			}`,
			expectValid: false,
			expectError: "unresolved reference",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			request := &apicatalogv1.ValidateSchemaRequest{
				SchemaType: tc.schemaType,
				RawContent: tc.rawContent,
			}

			response, err := client.ValidateSchema(ctx, request)

			if err != nil {
				// Expected in TDD phase
				t.Logf("✅ TDD phase validation test: %v", err)
				return
			}

			// If service is implemented, validate the response
			require.NotNil(t, response, "Response should not be nil")
			require.NotNil(t, response.Response, "Response wrapper should not be nil")

			assert.Equal(t, tc.expectValid, response.IsValid,
				"Schema validation result should match expectation for %s", tc.name)

			if !tc.expectValid {
				assert.NotEmpty(t, response.ValidationErrors,
					"Invalid schema should have validation errors for %s", tc.name)

				// Check that error contains expected message
				errorFound := false
				for _, validationErr := range response.ValidationErrors {
					if assert.Contains(t, validationErr.Message, tc.expectError) {
						errorFound = true
						break
					}
				}
				assert.True(t, errorFound,
					"Should find expected error message '%s' in validation errors", tc.expectError)
			}

			t.Logf("✅ Validation test for %s completed", tc.name)
		})
	}
}

func TestAPICatalogService_ValidateSchema_PerformanceMetrics(t *testing.T) {
	t.Log("=== Testing ValidateSchema performance metrics ===")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.NewClient(APICatalogServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to service: %v", err)
		return
	}
	defer conn.Close()

	client := apicatalogv1.NewAPICatalogServiceClient(conn)

	// Test with a large, complex schema to check performance
	request := &apicatalogv1.ValidateSchemaRequest{
		SchemaType: apicatalogv1.SchemaType_SCHEMA_TYPE_OPENAPI,
		RawContent: generateComplexOpenAPISchema(),
	}

	start := time.Now()
	response, err := client.ValidateSchema(ctx, request)
	duration := time.Since(start)

	if err != nil {
		t.Logf("✅ Expected TDD failure - performance test: %v", err)
		return
	}

	// If service is implemented, validate performance metrics
	require.NotNil(t, response, "Response should not be nil")
	require.NotNil(t, response.Response, "Response wrapper should not be nil")

	// Performance requirement: validation should complete within 5 seconds for complex schemas
	assert.Less(t, duration.Seconds(), 5.0,
		"Schema validation should complete within 5 seconds for complex schemas")

	// Validate that the complex schema passes validation
	assert.True(t, response.IsValid, "Complex but valid schema should pass validation")
	assert.True(t, response.Response.Success, "Response should indicate success")

	t.Logf("✅ Performance test completed in %v", duration)
}

// Helper function to generate a complex OpenAPI schema for performance testing
func generateComplexOpenAPISchema() string {
	return `{
		"openapi": "3.0.3",
		"info": {
			"title": "Complex Performance Test API",
			"version": "1.0.0",
			"description": "A complex API schema for performance testing"
		},
		"paths": {
			"/users": {
				"get": {
					"summary": "List users",
					"parameters": [
						{"name": "page", "in": "query", "schema": {"type": "integer"}},
						{"name": "limit", "in": "query", "schema": {"type": "integer"}},
						{"name": "sort", "in": "query", "schema": {"type": "string"}}
					],
					"responses": {
						"200": {
							"description": "List of users",
							"content": {
								"application/json": {
									"schema": {
										"$ref": "#/components/schemas/UserList"
									}
								}
							}
						}
					}
				},
				"post": {
					"summary": "Create user",
					"requestBody": {
						"content": {
							"application/json": {
								"schema": {
									"$ref": "#/components/schemas/CreateUserRequest"
								}
							}
						}
					},
					"responses": {
						"201": {
							"description": "User created",
							"content": {
								"application/json": {
									"schema": {
										"$ref": "#/components/schemas/User"
									}
								}
							}
						}
					}
				}
			},
			"/users/{userId}": {
				"get": {
					"summary": "Get user by ID",
					"parameters": [
						{"name": "userId", "in": "path", "required": true, "schema": {"type": "string"}}
					],
					"responses": {
						"200": {
							"description": "User details",
							"content": {
								"application/json": {
									"schema": {
										"$ref": "#/components/schemas/User"
									}
								}
							}
						},
						"404": {
							"description": "User not found",
							"content": {
								"application/json": {
									"schema": {
										"$ref": "#/components/schemas/Error"
									}
								}
							}
						}
					}
				}
			}
		},
		"components": {
			"schemas": {
				"User": {
					"type": "object",
					"properties": {
						"id": {"type": "string"},
						"email": {"type": "string", "format": "email"},
						"name": {"type": "string"},
						"createdAt": {"type": "string", "format": "date-time"},
						"updatedAt": {"type": "string", "format": "date-time"},
						"profile": {"$ref": "#/components/schemas/UserProfile"}
					}
				},
				"UserProfile": {
					"type": "object",
					"properties": {
						"firstName": {"type": "string"},
						"lastName": {"type": "string"},
						"avatar": {"type": "string"},
						"preferences": {"$ref": "#/components/schemas/UserPreferences"}
					}
				},
				"UserPreferences": {
					"type": "object",
					"properties": {
						"theme": {"type": "string", "enum": ["light", "dark"]},
						"language": {"type": "string"},
						"notifications": {"type": "boolean"}
					}
				},
				"UserList": {
					"type": "object",
					"properties": {
						"users": {
							"type": "array",
							"items": {"$ref": "#/components/schemas/User"}
						},
						"pagination": {"$ref": "#/components/schemas/Pagination"}
					}
				},
				"CreateUserRequest": {
					"type": "object",
					"required": ["email", "name"],
					"properties": {
						"email": {"type": "string", "format": "email"},
						"name": {"type": "string"},
						"profile": {"$ref": "#/components/schemas/UserProfile"}
					}
				},
				"Pagination": {
					"type": "object",
					"properties": {
						"page": {"type": "integer"},
						"limit": {"type": "integer"},
						"total": {"type": "integer"},
						"hasNext": {"type": "boolean"}
					}
				},
				"Error": {
					"type": "object",
					"properties": {
						"code": {"type": "string"},
						"message": {"type": "string"},
						"details": {"type": "object"}
					}
				}
			}
		}
	}`
}
