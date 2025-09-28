package contract

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	
	knowledgepb "github.com/drewpayment/orbit/proto/gen/go/idp/knowledge/v1"
	commonpb "github.com/drewpayment/orbit/proto/gen/go/idp/common/v1"
)

// TestSearchDocuments_Success tests successful document search
func TestSearchDocuments_Success(t *testing.T) {
	// This test should fail until KnowledgeService is implemented
	t.Skip("Implementation pending - TDD requirement: test must exist and fail before implementation")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient
	
	req := &knowledgepb.SearchDocumentsRequest{
		WorkspaceId: "workspace-123",
		Query:       "API documentation",
		Pagination: &commonpb.PaginationRequest{
			PageSize: 10,
			Page:     1,
		},
	}

	resp, err := service.SearchDocuments(ctx, req)

	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Documents)
	require.NotNil(t, resp.Pagination)

	// Validate pagination response
	assert.LessOrEqual(t, len(resp.Documents), int(req.Pagination.PageSize))
	assert.GreaterOrEqual(t, resp.Pagination.TotalItems, int64(len(resp.Documents)))
	assert.Equal(t, req.Pagination.Page, resp.Pagination.Page)
	assert.Equal(t, req.Pagination.PageSize, resp.Pagination.PageSize)

	// Validate each document has required fields and relevance scores
	for _, result := range resp.Documents {
		assert.NotNil(t, result.Document)
		assert.NotEmpty(t, result.Document.Id)
		assert.NotEmpty(t, result.Document.Title)
		assert.NotEmpty(t, result.Document.WorkspaceId)
		assert.Equal(t, req.WorkspaceId, result.Document.WorkspaceId)
		assert.GreaterOrEqual(t, result.RelevanceScore, float32(0.0))
		assert.LessOrEqual(t, result.RelevanceScore, float32(1.0))
		
		// Results should be ordered by relevance (highest first)
		if len(resp.Documents) > 1 {
			for i := 1; i < len(resp.Documents); i++ {
				assert.GreaterOrEqual(t, resp.Documents[i-1].RelevanceScore, resp.Documents[i].RelevanceScore)
			}
		}
	}
}

// TestSearchDocuments_EmptyQuery tests search with empty query
func TestSearchDocuments_EmptyQuery(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient
	
	req := &knowledgepb.SearchDocumentsRequest{
		WorkspaceId: "workspace-123",
		Query:       "",
		Pagination: &commonpb.PaginationRequest{
			PageSize: 10,
			Page:     1,
		},
	}

	_, err := service.SearchDocuments(ctx, req)
	
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.InvalidArgument, st.Code())
	assert.Contains(t, st.Message(), "query is required")
}

// TestSearchDocuments_NoResults tests search with no matching documents
func TestSearchDocuments_NoResults(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient
	
	req := &knowledgepb.SearchDocumentsRequest{
		WorkspaceId: "workspace-123",
		Query:       "very-specific-query-that-matches-nothing-12345",
		Pagination: &commonpb.PaginationRequest{
			PageSize: 10,
			Page:     1,
		},
	}

	resp, err := service.SearchDocuments(ctx, req)

	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Documents)
	require.NotNil(t, resp.Pagination)

	assert.Empty(t, resp.Documents)
	assert.Equal(t, int64(0), resp.Pagination.TotalItems)
	assert.Equal(t, int64(1), resp.Pagination.Page)
	assert.Equal(t, int64(0), resp.Pagination.TotalPages)
}

// TestSearchDocuments_Filtering tests document filtering in search
func TestSearchDocuments_Filtering(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient

	testCases := []struct {
		name   string
		filter *knowledgepb.DocumentFilter
	}{
		{
			name: "filter by content type",
			filter: &knowledgepb.DocumentFilter{
				ContentType: knowledgepb.Document_CONTENT_TYPE_MARKDOWN,
			},
		},
		{
			name: "filter by category",
			filter: &knowledgepb.DocumentFilter{
				Category: "documentation",
			},
		},
		{
			name: "filter by tags",
			filter: &knowledgepb.DocumentFilter{
				Tags: []string{"api", "guide"},
			},
		},
		{
			name: "filter by status",
			filter: &knowledgepb.DocumentFilter{
				Status: knowledgepb.Document_STATUS_PUBLISHED,
			},
		},
		{
			name: "filter by public visibility",
			filter: &knowledgepb.DocumentFilter{
				IsPublic: &knowledgepb.DocumentFilter_Public{Public: true},
			},
		},
		{
			name: "filter by private visibility",
			filter: &knowledgepb.DocumentFilter{
				IsPublic: &knowledgepb.DocumentFilter_Public{Public: false},
			},
		},
		{
			name: "filter by date range",
			filter: &knowledgepb.DocumentFilter{
				CreatedAfter:  &commonpb.Timestamp{Seconds: 1640995200}, // 2022-01-01
				CreatedBefore: &commonpb.Timestamp{Seconds: 1672531199}, // 2022-12-31
			},
		},
		{
			name: "multiple filters",
			filter: &knowledgepb.DocumentFilter{
				ContentType: knowledgepb.Document_CONTENT_TYPE_MARKDOWN,
				Category:    "documentation",
				Status:      knowledgepb.Document_STATUS_PUBLISHED,
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &knowledgepb.SearchDocumentsRequest{
				WorkspaceId: "workspace-123",
				Query:       "test",
				Filter:      tc.filter,
				Pagination: &commonpb.PaginationRequest{
					PageSize: 20,
					Page:     1,
				},
			}

			resp, err := service.SearchDocuments(ctx, req)

			require.NoError(t, err)
			require.NotNil(t, resp)

			// Validate that returned documents match filter criteria
			for _, result := range resp.Documents {
				doc := result.Document
				
				if tc.filter.ContentType != knowledgepb.Document_CONTENT_TYPE_UNSPECIFIED {
					assert.Equal(t, tc.filter.ContentType, doc.ContentType)
				}
				if tc.filter.Category != "" {
					assert.Equal(t, tc.filter.Category, doc.Category)
				}
				if tc.filter.Status != knowledgepb.Document_STATUS_UNSPECIFIED {
					assert.Equal(t, tc.filter.Status, doc.Status)
				}
				if tc.filter.IsPublic != nil {
					assert.Equal(t, tc.filter.IsPublic.(*knowledgepb.DocumentFilter_Public).Public, doc.IsPublic)
				}
				if len(tc.filter.Tags) > 0 {
					// Document should have at least one matching tag
					hasMatchingTag := false
					for _, filterTag := range tc.filter.Tags {
						for _, docTag := range doc.Tags {
							if filterTag == docTag {
								hasMatchingTag = true
								break
							}
						}
					}
					assert.True(t, hasMatchingTag, "Document should have at least one matching tag")
				}
				if tc.filter.CreatedAfter != nil {
					assert.GreaterOrEqual(t, doc.CreatedAt.AsTime(), tc.filter.CreatedAfter.AsTime())
				}
				if tc.filter.CreatedBefore != nil {
					assert.LessOrEqual(t, doc.CreatedAt.AsTime(), tc.filter.CreatedBefore.AsTime())
				}
			}
		})
	}
}

// TestSearchDocuments_Pagination tests pagination functionality
func TestSearchDocuments_Pagination(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient

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
			req := &knowledgepb.SearchDocumentsRequest{
				WorkspaceId: "workspace-123",
				Query:       "test",
				Pagination: &commonpb.PaginationRequest{
					PageSize: tc.pageSize,
					Page:     tc.page,
				},
			}

			resp, err := service.SearchDocuments(ctx, req)

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

// TestSearchDocuments_SearchTypes tests different search types
func TestSearchDocuments_SearchTypes(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient

	testCases := []struct {
		name       string
		searchType knowledgepb.SearchDocumentsRequest_SearchType
		query      string
	}{
		{
			name:       "fulltext search",
			searchType: knowledgepb.SearchDocumentsRequest_SEARCH_TYPE_FULLTEXT,
			query:      "API documentation guide",
		},
		{
			name:       "semantic search",
			searchType: knowledgepb.SearchDocumentsRequest_SEARCH_TYPE_SEMANTIC,
			query:      "how to use the API",
		},
		{
			name:       "hybrid search",
			searchType: knowledgepb.SearchDocumentsRequest_SEARCH_TYPE_HYBRID,
			query:      "API authentication methods",
		},
		{
			name:       "exact match",
			searchType: knowledgepb.SearchDocumentsRequest_SEARCH_TYPE_EXACT,
			query:      "Bearer token",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &knowledgepb.SearchDocumentsRequest{
				WorkspaceId: "workspace-123",
				Query:       tc.query,
				SearchType:  tc.searchType,
				Pagination: &commonpb.PaginationRequest{
					PageSize: 10,
					Page:     1,
				},
			}

			resp, err := service.SearchDocuments(ctx, req)

			require.NoError(t, err)
			require.NotNil(t, resp)

			// Validate search type affects results appropriately
			for _, result := range resp.Documents {
				assert.GreaterOrEqual(t, result.RelevanceScore, float32(0.0))
				assert.LessOrEqual(t, result.RelevanceScore, float32(1.0))
				
				// For exact match, results should have higher precision
				if tc.searchType == knowledgepb.SearchDocumentsRequest_SEARCH_TYPE_EXACT {
					// Should have fewer but more precise results
					assert.GreaterOrEqual(t, result.RelevanceScore, float32(0.8))
				}
			}
		})
	}
}

// TestSearchDocuments_ValidationErrors tests input validation
func TestSearchDocuments_ValidationErrors(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient

	testCases := []struct {
		name     string
		req      *knowledgepb.SearchDocumentsRequest
		wantCode codes.Code
		wantMsg  string
	}{
		{
			name: "missing workspace ID",
			req: &knowledgepb.SearchDocumentsRequest{
				Query: "test",
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "workspace_id is required",
		},
		{
			name: "missing query",
			req: &knowledgepb.SearchDocumentsRequest{
				WorkspaceId: "workspace-123",
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "query is required",
		},
		{
			name: "query too long",
			req: &knowledgepb.SearchDocumentsRequest{
				WorkspaceId: "workspace-123",
				Query:       string(make([]byte, 1001)), // > 1000 chars
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "query must be at most 1000 characters",
		},
		{
			name: "invalid search type",
			req: &knowledgepb.SearchDocumentsRequest{
				WorkspaceId: "workspace-123",
				Query:       "test",
				SearchType:  knowledgepb.SearchDocumentsRequest_SearchType(999),
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "invalid search_type",
		},
		{
			name: "invalid date range",
			req: &knowledgepb.SearchDocumentsRequest{
				WorkspaceId: "workspace-123",
				Query:       "test",
				Filter: &knowledgepb.DocumentFilter{
					CreatedAfter:  &commonpb.Timestamp{Seconds: 1672531199}, // 2022-12-31
					CreatedBefore: &commonpb.Timestamp{Seconds: 1640995200}, // 2022-01-01
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "created_after cannot be after created_before",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := service.SearchDocuments(ctx, tc.req)
			
			require.Error(t, err)
			st, ok := status.FromError(err)
			require.True(t, ok)
			assert.Equal(t, tc.wantCode, st.Code())
			assert.Contains(t, st.Message(), tc.wantMsg)
		})
	}
}

// TestSearchDocuments_WorkspaceNotFound tests workspace existence validation
func TestSearchDocuments_WorkspaceNotFound(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient
	
	req := &knowledgepb.SearchDocumentsRequest{
		WorkspaceId: "non-existent-workspace",
		Query:       "test",
		Pagination: &commonpb.PaginationRequest{
			PageSize: 10,
			Page:     1,
		},
	}

	_, err := service.SearchDocuments(ctx, req)
	
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
	assert.Contains(t, st.Message(), "workspace 'non-existent-workspace' not found")
}

// TestSearchDocuments_PermissionDenied tests access control
func TestSearchDocuments_PermissionDenied(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient
	
	req := &knowledgepb.SearchDocumentsRequest{
		WorkspaceId: "restricted-workspace-123",
		Query:       "test",
		Pagination: &commonpb.PaginationRequest{
			PageSize: 10,
			Page:     1,
		},
	}

	_, err := service.SearchDocuments(ctx, req)
	
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.PermissionDenied, st.Code())
	assert.Contains(t, st.Message(), "insufficient permissions to search documents")
}

// TestSearchDocuments_RelevanceScoring tests relevance scoring accuracy
func TestSearchDocuments_RelevanceScoring(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient
	
	req := &knowledgepb.SearchDocumentsRequest{
		WorkspaceId: "workspace-123",
		Query:       "API authentication JWT token",
		SearchType:  knowledgepb.SearchDocumentsRequest_SEARCH_TYPE_HYBRID,
		Pagination: &commonpb.PaginationRequest{
			PageSize: 20,
			Page:     1,
		},
	}

	resp, err := service.SearchDocuments(ctx, req)

	require.NoError(t, err)
	require.NotNil(t, resp)

	// Results should be sorted by relevance score (descending)
	if len(resp.Documents) > 1 {
		for i := 1; i < len(resp.Documents); i++ {
			assert.GreaterOrEqual(t, resp.Documents[i-1].RelevanceScore, resp.Documents[i].RelevanceScore,
				"Results should be sorted by relevance score (highest first)")
		}
	}

	// All relevance scores should be valid (0.0 to 1.0)
	for i, result := range resp.Documents {
		assert.GreaterOrEqual(t, result.RelevanceScore, float32(0.0),
			"Relevance score at index %d should be >= 0.0", i)
		assert.LessOrEqual(t, result.RelevanceScore, float32(1.0),
			"Relevance score at index %d should be <= 1.0", i)
	}
}

// TestSearchDocuments_HighlightSnippets tests search result highlighting
func TestSearchDocuments_HighlightSnippets(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient
	
	req := &knowledgepb.SearchDocumentsRequest{
		WorkspaceId:        "workspace-123",
		Query:              "authentication JWT",
		IncludeHighlights:  true,
		SnippetLength:      200,
		Pagination: &commonpb.PaginationRequest{
			PageSize: 10,
			Page:     1,
		},
	}

	resp, err := service.SearchDocuments(ctx, req)

	require.NoError(t, err)
	require.NotNil(t, resp)

	// Validate highlights are included when requested
	for _, result := range resp.Documents {
		if result.RelevanceScore > 0.1 { // Only check results with decent relevance
			assert.NotEmpty(t, result.Highlights, "High-relevance results should include highlights")
			
			// Validate highlight snippets
			for _, highlight := range result.Highlights {
				assert.NotEmpty(t, highlight.Field, "Highlight should specify field")
				assert.NotEmpty(t, highlight.Snippet, "Highlight should include snippet")
				assert.LessOrEqual(t, len(highlight.Snippet), int(req.SnippetLength+50), // Allow some buffer
					"Snippet should respect length limit")
			}
		}
	}
}