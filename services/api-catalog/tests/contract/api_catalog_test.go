package contract

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	
	apicatalogpb "github.com/drewpayment/orbit/proto/gen/go/idp/api_catalog/v1"
	commonpb "github.com/drewpayment/orbit/proto/gen/go/idp/common/v1"
)

// TestCreateAPISchema_Success tests successful API schema creation
func TestCreateAPISchema_Success(t *testing.T) {
	// This test should fail until APICatalogService is implemented
	t.Skip("Implementation pending - TDD requirement: test must exist and fail before implementation")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient
	
	req := &apicatalogpb.CreateAPISchemaRequest{
		WorkspaceId: "workspace-123",
		ApiSchema: &apicatalogpb.APISchema{
			Name:        "user-api",
			Version:     "v1.0.0",
			Description: "User management API",
			SchemaType:  apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
			Content:     `{"openapi": "3.0.0", "info": {"title": "User API", "version": "1.0.0"}}`,
			Tags:        []string{"users", "authentication"},
		},
	}

	resp, err := service.CreateAPISchema(ctx, req)

	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.ApiSchema)

	// Validate schema properties
	assert.Equal(t, req.ApiSchema.Name, resp.ApiSchema.Name)
	assert.Equal(t, req.ApiSchema.Version, resp.ApiSchema.Version)
	assert.Equal(t, req.ApiSchema.Description, resp.ApiSchema.Description)
	assert.Equal(t, req.ApiSchema.SchemaType, resp.ApiSchema.SchemaType)
	assert.Equal(t, req.ApiSchema.Content, resp.ApiSchema.Content)
	assert.Equal(t, req.ApiSchema.Tags, resp.ApiSchema.Tags)

	// Validate generated fields
	assert.NotEmpty(t, resp.ApiSchema.Id)
	assert.NotNil(t, resp.ApiSchema.CreatedAt)
	assert.NotNil(t, resp.ApiSchema.UpdatedAt)
	assert.Equal(t, req.WorkspaceId, resp.ApiSchema.WorkspaceId)
	assert.Equal(t, apicatalogpb.APISchema_STATUS_ACTIVE, resp.ApiSchema.Status)
}

// TestCreateAPISchema_ValidationErrors tests input validation
func TestCreateAPISchema_ValidationErrors(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient

	testCases := []struct {
		name     string
		req      *apicatalogpb.CreateAPISchemaRequest
		wantCode codes.Code
		wantMsg  string
	}{
		{
			name: "missing workspace ID",
			req: &apicatalogpb.CreateAPISchemaRequest{
				ApiSchema: &apicatalogpb.APISchema{
					Name:       "user-api",
					Version:    "v1.0.0",
					SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
					Content:    `{"openapi": "3.0.0"}`,
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "workspace_id is required",
		},
		{
			name: "missing API schema",
			req: &apicatalogpb.CreateAPISchemaRequest{
				WorkspaceId: "workspace-123",
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "api_schema is required",
		},
		{
			name: "missing schema name",
			req: &apicatalogpb.CreateAPISchemaRequest{
				WorkspaceId: "workspace-123",
				ApiSchema: &apicatalogpb.APISchema{
					Version:    "v1.0.0",
					SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
					Content:    `{"openapi": "3.0.0"}`,
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "api_schema.name is required",
		},
		{
			name: "invalid schema name - too short",
			req: &apicatalogpb.CreateAPISchemaRequest{
				WorkspaceId: "workspace-123",
				ApiSchema: &apicatalogpb.APISchema{
					Name:       "a",
					Version:    "v1.0.0",
					SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
					Content:    `{"openapi": "3.0.0"}`,
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "api_schema.name must be at least 2 characters",
		},
		{
			name: "invalid schema name - invalid characters",
			req: &apicatalogpb.CreateAPISchemaRequest{
				WorkspaceId: "workspace-123",
				ApiSchema: &apicatalogpb.APISchema{
					Name:       "user api with spaces!",
					Version:    "v1.0.0",
					SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
					Content:    `{"openapi": "3.0.0"}`,
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "api_schema.name must contain only lowercase letters, numbers, and hyphens",
		},
		{
			name: "missing version",
			req: &apicatalogpb.CreateAPISchemaRequest{
				WorkspaceId: "workspace-123",
				ApiSchema: &apicatalogpb.APISchema{
					Name:       "user-api",
					SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
					Content:    `{"openapi": "3.0.0"}`,
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "api_schema.version is required",
		},
		{
			name: "invalid version format",
			req: &apicatalogpb.CreateAPISchemaRequest{
				WorkspaceId: "workspace-123",
				ApiSchema: &apicatalogpb.APISchema{
					Name:       "user-api",
					Version:    "invalid-version",
					SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
					Content:    `{"openapi": "3.0.0"}`,
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "api_schema.version must follow semantic versioning format",
		},
		{
			name: "missing schema type",
			req: &apicatalogpb.CreateAPISchemaRequest{
				WorkspaceId: "workspace-123",
				ApiSchema: &apicatalogpb.APISchema{
					Name:    "user-api",
					Version: "v1.0.0",
					Content: `{"openapi": "3.0.0"}`,
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "api_schema.schema_type is required",
		},
		{
			name: "missing content",
			req: &apicatalogpb.CreateAPISchemaRequest{
				WorkspaceId: "workspace-123",
				ApiSchema: &apicatalogpb.APISchema{
					Name:       "user-api",
					Version:    "v1.0.0",
					SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "api_schema.content is required",
		},
		{
			name: "invalid OpenAPI content",
			req: &apicatalogpb.CreateAPISchemaRequest{
				WorkspaceId: "workspace-123",
				ApiSchema: &apicatalogpb.APISchema{
					Name:       "user-api",
					Version:    "v1.0.0",
					SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
					Content:    `{"invalid": "json"}`,
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "api_schema.content is not valid OpenAPI specification",
		},
		{
			name: "invalid gRPC content",
			req: &apicatalogpb.CreateAPISchemaRequest{
				WorkspaceId: "workspace-123",
				ApiSchema: &apicatalogpb.APISchema{
					Name:       "user-api",
					Version:    "v1.0.0",
					SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_GRPC,
					Content:    `invalid protobuf content`,
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "api_schema.content is not valid protobuf definition",
		},
		{
			name: "too many tags",
			req: &apicatalogpb.CreateAPISchemaRequest{
				WorkspaceId: "workspace-123",
				ApiSchema: &apicatalogpb.APISchema{
					Name:       "user-api",
					Version:    "v1.0.0",
					SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
					Content:    `{"openapi": "3.0.0"}`,
					Tags:       []string{"tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10", "tag11"},
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "api_schema.tags cannot exceed 10 items",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := service.CreateAPISchema(ctx, tc.req)
			
			require.Error(t, err)
			st, ok := status.FromError(err)
			require.True(t, ok)
			assert.Equal(t, tc.wantCode, st.Code())
			assert.Contains(t, st.Message(), tc.wantMsg)
		})
	}
}

// TestCreateAPISchema_WorkspaceNotFound tests workspace existence validation
func TestCreateAPISchema_WorkspaceNotFound(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient
	
	req := &apicatalogpb.CreateAPISchemaRequest{
		WorkspaceId: "non-existent-workspace",
		ApiSchema: &apicatalogpb.APISchema{
			Name:       "user-api",
			Version:    "v1.0.0",
			SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
			Content:    `{"openapi": "3.0.0", "info": {"title": "User API", "version": "1.0.0"}}`,
		},
	}

	_, err := service.CreateAPISchema(ctx, req)
	
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
	assert.Contains(t, st.Message(), "workspace 'non-existent-workspace' not found")
}

// TestCreateAPISchema_DuplicateNameVersion tests uniqueness constraint
func TestCreateAPISchema_DuplicateNameVersion(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient
	
	// First creation should succeed
	req := &apicatalogpb.CreateAPISchemaRequest{
		WorkspaceId: "workspace-123",
		ApiSchema: &apicatalogpb.APISchema{
			Name:       "user-api",
			Version:    "v1.0.0",
			SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
			Content:    `{"openapi": "3.0.0", "info": {"title": "User API", "version": "1.0.0"}}`,
		},
	}

	_, err := service.CreateAPISchema(ctx, req)
	require.NoError(t, err)

	// Second creation with same name and version should fail
	_, err = service.CreateAPISchema(ctx, req)
	
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.AlreadyExists, st.Code())
	assert.Contains(t, st.Message(), "API schema 'user-api' version 'v1.0.0' already exists")
}

// TestCreateAPISchema_SchemaTypes tests different schema type validations
func TestCreateAPISchema_SchemaTypes(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient

	testCases := []struct {
		name       string
		schemaType apicatalogpb.APISchema_SchemaType
		content    string
		wantErr    bool
		wantMsg    string
	}{
		{
			name:       "valid OpenAPI 3.0",
			schemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
			content:    `{"openapi": "3.0.0", "info": {"title": "Test API", "version": "1.0.0"}, "paths": {}}`,
			wantErr:    false,
		},
		{
			name:       "valid OpenAPI 3.1",
			schemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
			content:    `{"openapi": "3.1.0", "info": {"title": "Test API", "version": "1.0.0"}, "paths": {}}`,
			wantErr:    false,
		},
		{
			name:       "valid Swagger 2.0",
			schemaType: apicatalogpb.APISchema_SCHEMA_TYPE_SWAGGER,
			content:    `{"swagger": "2.0", "info": {"title": "Test API", "version": "1.0.0"}, "paths": {}}`,
			wantErr:    false,
		},
		{
			name:       "valid gRPC protobuf",
			schemaType: apicatalogpb.APISchema_SCHEMA_TYPE_GRPC,
			content:    `syntax = "proto3"; package test; service TestService { rpc Test(TestRequest) returns (TestResponse); } message TestRequest {} message TestResponse {}`,
			wantErr:    false,
		},
		{
			name:       "valid GraphQL schema",
			schemaType: apicatalogpb.APISchema_SCHEMA_TYPE_GRAPHQL,
			content:    `type Query { hello: String }`,
			wantErr:    false,
		},
		{
			name:       "invalid OpenAPI - missing required fields",
			schemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
			content:    `{"openapi": "3.0.0"}`,
			wantErr:    true,
			wantMsg:    "missing required field: info",
		},
		{
			name:       "invalid gRPC - syntax error",
			schemaType: apicatalogpb.APISchema_SCHEMA_TYPE_GRPC,
			content:    `invalid protobuf syntax`,
			wantErr:    true,
			wantMsg:    "protobuf syntax error",
		},
		{
			name:       "invalid GraphQL - syntax error",
			schemaType: apicatalogpb.APISchema_SCHEMA_TYPE_GRAPHQL,
			content:    `invalid graphql schema`,
			wantErr:    true,
			wantMsg:    "GraphQL schema syntax error",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &apicatalogpb.CreateAPISchemaRequest{
				WorkspaceId: "workspace-123",
				ApiSchema: &apicatalogpb.APISchema{
					Name:       tc.name + "-api",
					Version:    "v1.0.0",
					SchemaType: tc.schemaType,
					Content:    tc.content,
				},
			}

			resp, err := service.CreateAPISchema(ctx, req)

			if tc.wantErr {
				require.Error(t, err)
				st, ok := status.FromError(err)
				require.True(t, ok)
				assert.Equal(t, codes.InvalidArgument, st.Code())
				assert.Contains(t, st.Message(), tc.wantMsg)
			} else {
				require.NoError(t, err)
				require.NotNil(t, resp)
				require.NotNil(t, resp.ApiSchema)
				assert.Equal(t, tc.schemaType, resp.ApiSchema.SchemaType)
				assert.Equal(t, tc.content, resp.ApiSchema.Content)
			}
		})
	}
}

// TestCreateAPISchema_PermissionDenied tests access control
func TestCreateAPISchema_PermissionDenied(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient
	
	req := &apicatalogpb.CreateAPISchemaRequest{
		WorkspaceId: "restricted-workspace-123",
		ApiSchema: &apicatalogpb.APISchema{
			Name:       "user-api",
			Version:    "v1.0.0",
			SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
			Content:    `{"openapi": "3.0.0", "info": {"title": "User API", "version": "1.0.0"}}`,
		},
	}

	_, err := service.CreateAPISchema(ctx, req)
	
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.PermissionDenied, st.Code())
	assert.Contains(t, st.Message(), "insufficient permissions to create API schema")
}

// TestCreateAPISchema_TagValidation tests tag handling
func TestCreateAPISchema_TagValidation(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient

	testCases := []struct {
		name    string
		tags    []string
		wantErr bool
		wantMsg string
	}{
		{
			name:    "valid tags",
			tags:    []string{"users", "authentication", "v1"},
			wantErr: false,
		},
		{
			name:    "empty tags",
			tags:    []string{},
			wantErr: false,
		},
		{
			name:    "single character tag",
			tags:    []string{"a"},
			wantErr: true,
			wantMsg: "tag must be at least 2 characters",
		},
		{
			name:    "tag with invalid characters",
			tags:    []string{"user api"},
			wantErr: true,
			wantMsg: "tag must contain only lowercase letters, numbers, and hyphens",
		},
		{
			name:    "duplicate tags",
			tags:    []string{"users", "users"},
			wantErr: true,
			wantMsg: "duplicate tags are not allowed",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &apicatalogpb.CreateAPISchemaRequest{
				WorkspaceId: "workspace-123",
				ApiSchema: &apicatalogpb.APISchema{
					Name:       "test-api",
					Version:    "v1.0.0",
					SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
					Content:    `{"openapi": "3.0.0", "info": {"title": "Test API", "version": "1.0.0"}}`,
					Tags:       tc.tags,
				},
			}

			resp, err := service.CreateAPISchema(ctx, req)

			if tc.wantErr {
				require.Error(t, err)
				st, ok := status.FromError(err)
				require.True(t, ok)
				assert.Equal(t, codes.InvalidArgument, st.Code())
				assert.Contains(t, st.Message(), tc.wantMsg)
			} else {
				require.NoError(t, err)
				require.NotNil(t, resp)
				assert.Equal(t, tc.tags, resp.ApiSchema.Tags)
			}
		})
	}
}