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

// TestListAPISchemas_Success tests successful API schema listing
func TestListAPISchemas_Success(t *testing.T) {
	// This test should fail until APICatalogService is implemented
	t.Skip("Implementation pending - TDD requirement: test must exist and fail before implementation")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient
	
	req := &apicatalogpb.ListAPISchemasRequest{
		WorkspaceId: "workspace-123",
		Pagination: &commonpb.PaginationRequest{
			PageSize: 10,
			Page:     1,
		},
	}

	resp, err := service.ListAPISchemas(ctx, req)

	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.ApiSchemas)
	require.NotNil(t, resp.Pagination)

	// Validate pagination response
	assert.LessOrEqual(t, len(resp.ApiSchemas), int(req.Pagination.PageSize))
	assert.GreaterOrEqual(t, resp.Pagination.TotalItems, int64(len(resp.ApiSchemas)))
	assert.Equal(t, req.Pagination.Page, resp.Pagination.Page)
	assert.Equal(t, req.Pagination.PageSize, resp.Pagination.PageSize)

	// Validate each schema has required fields
	for _, schema := range resp.ApiSchemas {
		assert.NotEmpty(t, schema.Id)
		assert.NotEmpty(t, schema.Name)
		assert.NotEmpty(t, schema.Version)
		assert.NotEmpty(t, schema.WorkspaceId)
		assert.Equal(t, req.WorkspaceId, schema.WorkspaceId)
		assert.NotNil(t, schema.CreatedAt)
		assert.NotNil(t, schema.UpdatedAt)
		assert.NotEqual(t, apicatalogpb.APISchema_SCHEMA_TYPE_UNSPECIFIED, schema.SchemaType)
	}
}

// TestListAPISchemas_EmptyWorkspace tests listing schemas in empty workspace
func TestListAPISchemas_EmptyWorkspace(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient
	
	req := &apicatalogpb.ListAPISchemasRequest{
		WorkspaceId: "empty-workspace-123",
		Pagination: &commonpb.PaginationRequest{
			PageSize: 10,
			Page:     1,
		},
	}

	resp, err := service.ListAPISchemas(ctx, req)

	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.ApiSchemas)
	require.NotNil(t, resp.Pagination)

	assert.Empty(t, resp.ApiSchemas)
	assert.Equal(t, int64(0), resp.Pagination.TotalItems)
	assert.Equal(t, int64(1), resp.Pagination.Page)
	assert.Equal(t, int64(0), resp.Pagination.TotalPages)
}

// TestListAPISchemas_Filtering tests API schema filtering
func TestListAPISchemas_Filtering(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient

	testCases := []struct {
		name   string
		filter *apicatalogpb.APISchemaFilter
	}{
		{
			name: "filter by schema type",
			filter: &apicatalogpb.APISchemaFilter{
				SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
			},
		},
		{
			name: "filter by status",
			filter: &apicatalogpb.APISchemaFilter{
				Status: apicatalogpb.APISchema_STATUS_ACTIVE,
			},
		},
		{
			name: "filter by tags",
			filter: &apicatalogpb.APISchemaFilter{
				Tags: []string{"users", "authentication"},
			},
		},
		{
			name: "search by name",
			filter: &apicatalogpb.APISchemaFilter{
				Search: "user",
			},
		},
		{
			name: "filter by version pattern",
			filter: &apicatalogpb.APISchemaFilter{
				VersionPattern: "v1.*",
			},
		},
		{
			name: "multiple filters",
			filter: &apicatalogpb.APISchemaFilter{
				SchemaType: apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
				Status:     apicatalogpb.APISchema_STATUS_ACTIVE,
				Tags:       []string{"users"},
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &apicatalogpb.ListAPISchemasRequest{
				WorkspaceId: "workspace-123",
				Filter:      tc.filter,
				Pagination: &commonpb.PaginationRequest{
					PageSize: 20,
					Page:     1,
				},
			}

			resp, err := service.ListAPISchemas(ctx, req)

			require.NoError(t, err)
			require.NotNil(t, resp)

			// Validate that returned schemas match filter criteria
			for _, schema := range resp.ApiSchemas {
				if tc.filter.SchemaType != apicatalogpb.APISchema_SCHEMA_TYPE_UNSPECIFIED {
					assert.Equal(t, tc.filter.SchemaType, schema.SchemaType)
				}
				if tc.filter.Status != apicatalogpb.APISchema_STATUS_UNSPECIFIED {
					assert.Equal(t, tc.filter.Status, schema.Status)
				}
				if tc.filter.Search != "" {
					// Name or description should contain search term
					nameMatch := assert.Contains(t, schema.Name, tc.filter.Search)
					descMatch := assert.Contains(t, schema.Description, tc.filter.Search)
					assert.True(t, nameMatch || descMatch, "Schema should match search term")
				}
				if len(tc.filter.Tags) > 0 {
					// Schema should have at least one matching tag
					hasMatchingTag := false
					for _, filterTag := range tc.filter.Tags {
						for _, schemaTag := range schema.Tags {
							if filterTag == schemaTag {
								hasMatchingTag = true
								break
							}
						}
					}
					assert.True(t, hasMatchingTag, "Schema should have at least one matching tag")
				}
				if tc.filter.VersionPattern != "" {
					// Version should match pattern (simplified check)
					if tc.filter.VersionPattern == "v1.*" {
						assert.Contains(t, schema.Version, "v1.")
					}
				}
			}
		})
	}
}

// TestListAPISchemas_Sorting tests API schema sorting
func TestListAPISchemas_Sorting(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient

	testCases := []struct {
		name    string
		sortBy  string
		sortDir commonpb.SortDirection
	}{
		{
			name:    "sort by name ascending",
			sortBy:  "name",
			sortDir: commonpb.SortDirection_SORT_DIRECTION_ASC,
		},
		{
			name:    "sort by name descending",
			sortBy:  "name",
			sortDir: commonpb.SortDirection_SORT_DIRECTION_DESC,
		},
		{
			name:    "sort by version ascending",
			sortBy:  "version",
			sortDir: commonpb.SortDirection_SORT_DIRECTION_ASC,
		},
		{
			name:    "sort by version descending",
			sortBy:  "version",
			sortDir: commonpb.SortDirection_SORT_DIRECTION_DESC,
		},
		{
			name:    "sort by created_at ascending",
			sortBy:  "created_at",
			sortDir: commonpb.SortDirection_SORT_DIRECTION_ASC,
		},
		{
			name:    "sort by created_at descending",
			sortBy:  "created_at",
			sortDir: commonpb.SortDirection_SORT_DIRECTION_DESC,
		},
		{
			name:    "sort by updated_at descending",
			sortBy:  "updated_at",
			sortDir: commonpb.SortDirection_SORT_DIRECTION_DESC,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &apicatalogpb.ListAPISchemasRequest{
				WorkspaceId: "workspace-123",
				Sort: &commonpb.SortRequest{
					SortBy:    tc.sortBy,
					Direction: tc.sortDir,
				},
				Pagination: &commonpb.PaginationRequest{
					PageSize: 20,
					Page:     1,
				},
			}

			resp, err := service.ListAPISchemas(ctx, req)

			require.NoError(t, err)
			require.NotNil(t, resp)

			// Validate sorting if we have multiple schemas
			if len(resp.ApiSchemas) > 1 {
				for i := 1; i < len(resp.ApiSchemas); i++ {
					prev := resp.ApiSchemas[i-1]
					curr := resp.ApiSchemas[i]
					
					switch tc.sortBy {
					case "name":
						if tc.sortDir == commonpb.SortDirection_SORT_DIRECTION_ASC {
							assert.LessOrEqual(t, prev.Name, curr.Name)
						} else {
							assert.GreaterOrEqual(t, prev.Name, curr.Name)
						}
					case "version":
						if tc.sortDir == commonpb.SortDirection_SORT_DIRECTION_ASC {
							assert.LessOrEqual(t, prev.Version, curr.Version)
						} else {
							assert.GreaterOrEqual(t, prev.Version, curr.Version)
						}
					case "created_at":
						if tc.sortDir == commonpb.SortDirection_SORT_DIRECTION_ASC {
							assert.LessOrEqual(t, prev.CreatedAt.AsTime(), curr.CreatedAt.AsTime())
						} else {
							assert.GreaterOrEqual(t, prev.CreatedAt.AsTime(), curr.CreatedAt.AsTime())
						}
					case "updated_at":
						if tc.sortDir == commonpb.SortDirection_SORT_DIRECTION_ASC {
							assert.LessOrEqual(t, prev.UpdatedAt.AsTime(), curr.UpdatedAt.AsTime())
						} else {
							assert.GreaterOrEqual(t, prev.UpdatedAt.AsTime(), curr.UpdatedAt.AsTime())
						}
					}
				}
			}
		})
	}
}

// TestListAPISchemas_Pagination tests pagination functionality
func TestListAPISchemas_Pagination(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient

	testCases := []struct {
		name     string
		pageSize int64
		page     int64
		wantErr  bool
	}{
		{
			name:     "first page",
			pageSize: 5,
			page:     1,
			wantErr:  false,
		},
		{
			name:     "second page",
			pageSize: 5,
			page:     2,
			wantErr:  false,
		},
		{
			name:     "large page size",
			pageSize: 100,
			page:     1,
			wantErr:  false,
		},
		{
			name:     "zero page size (should use default)",
			pageSize: 0,
			page:     1,
			wantErr:  false,
		},
		{
			name:     "excessive page size",
			pageSize: 1000,
			page:     1,
			wantErr:  true,
		},
		{
			name:     "negative page",
			pageSize: 10,
			page:     -1,
			wantErr:  true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &apicatalogpb.ListAPISchemasRequest{
				WorkspaceId: "workspace-123",
				Pagination: &commonpb.PaginationRequest{
					PageSize: tc.pageSize,
					Page:     tc.page,
				},
			}

			resp, err := service.ListAPISchemas(ctx, req)

			if tc.wantErr {
				require.Error(t, err)
				st, ok := status.FromError(err)
				require.True(t, ok)
				assert.Equal(t, codes.InvalidArgument, st.Code())
			} else {
				require.NoError(t, err)
				require.NotNil(t, resp)
				
				// Validate pagination normalization
				expectedPageSize := tc.pageSize
				if expectedPageSize <= 0 {
					expectedPageSize = 20 // default page size
				}
				if expectedPageSize > 100 {
					expectedPageSize = 100 // max page size
				}
				
				expectedPage := tc.page
				if expectedPage <= 0 {
					expectedPage = 1 // default page
				}
				
				assert.Equal(t, expectedPageSize, resp.Pagination.PageSize)
				assert.Equal(t, expectedPage, resp.Pagination.Page)
			}
		})
	}
}

// TestListAPISchemas_ValidationErrors tests input validation
func TestListAPISchemas_ValidationErrors(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient

	testCases := []struct {
		name     string
		req      *apicatalogpb.ListAPISchemasRequest
		wantCode codes.Code
		wantMsg  string
	}{
		{
			name:     "missing workspace ID",
			req:      &apicatalogpb.ListAPISchemasRequest{},
			wantCode: codes.InvalidArgument,
			wantMsg:  "workspace_id is required",
		},
		{
			name: "invalid sort field",
			req: &apicatalogpb.ListAPISchemasRequest{
				WorkspaceId: "workspace-123",
				Sort: &commonpb.SortRequest{
					SortBy:    "invalid_field",
					Direction: commonpb.SortDirection_SORT_DIRECTION_ASC,
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "sort_by 'invalid_field' is not supported",
		},
		{
			name: "invalid version pattern",
			req: &apicatalogpb.ListAPISchemasRequest{
				WorkspaceId: "workspace-123",
				Filter: &apicatalogpb.APISchemaFilter{
					VersionPattern: "[invalid-regex",
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "invalid version_pattern regex",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := service.ListAPISchemas(ctx, tc.req)
			
			require.Error(t, err)
			st, ok := status.FromError(err)
			require.True(t, ok)
			assert.Equal(t, tc.wantCode, st.Code())
			assert.Contains(t, st.Message(), tc.wantMsg)
		})
	}
}

// TestListAPISchemas_WorkspaceNotFound tests workspace existence validation
func TestListAPISchemas_WorkspaceNotFound(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient
	
	req := &apicatalogpb.ListAPISchemasRequest{
		WorkspaceId: "non-existent-workspace",
		Pagination: &commonpb.PaginationRequest{
			PageSize: 10,
			Page:     1,
		},
	}

	_, err := service.ListAPISchemas(ctx, req)
	
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
	assert.Contains(t, st.Message(), "workspace 'non-existent-workspace' not found")
}

// TestListAPISchemas_PermissionDenied tests access control
func TestListAPISchemas_PermissionDenied(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient
	
	req := &apicatalogpb.ListAPISchemasRequest{
		WorkspaceId: "restricted-workspace-123",
		Pagination: &commonpb.PaginationRequest{
			PageSize: 10,
			Page:     1,
		},
	}

	_, err := service.ListAPISchemas(ctx, req)
	
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.PermissionDenied, st.Code())
	assert.Contains(t, st.Message(), "insufficient permissions to list API schemas")
}

// TestListAPISchemas_SchemaTypeFiltering tests schema type specific filtering
func TestListAPISchemas_SchemaTypeFiltering(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service apicatalogpb.APICatalogServiceClient

	schemaTypes := []apicatalogpb.APISchema_SchemaType{
		apicatalogpb.APISchema_SCHEMA_TYPE_OPENAPI,
		apicatalogpb.APISchema_SCHEMA_TYPE_SWAGGER,
		apicatalogpb.APISchema_SCHEMA_TYPE_GRPC,
		apicatalogpb.APISchema_SCHEMA_TYPE_GRAPHQL,
	}

	for _, schemaType := range schemaTypes {
		t.Run(schemaType.String(), func(t *testing.T) {
			req := &apicatalogpb.ListAPISchemasRequest{
				WorkspaceId: "workspace-123",
				Filter: &apicatalogpb.APISchemaFilter{
					SchemaType: schemaType,
				},
				Pagination: &commonpb.PaginationRequest{
					PageSize: 20,
					Page:     1,
				},
			}

			resp, err := service.ListAPISchemas(ctx, req)

			require.NoError(t, err)
			require.NotNil(t, resp)

			// All returned schemas should match the filtered type
			for _, schema := range resp.ApiSchemas {
				assert.Equal(t, schemaType, schema.SchemaType)
			}
		})
	}
}