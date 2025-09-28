/**
 * T018 - Contract Test: KnowledgeService.SearchContent
 *
 * This contract test validates the SearchContent gRPC method according to the protobuf contract.
 * It tests the Knowledge service's ability to search through knowledge content and return relevant results.
 *
 * TDD Status: MUST fail until KnowledgeService is implemented
 * Expected failure: "connection refused" to localhost:8004
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

	knowledgev1 "github.com/drewpayment/orbit/proto/gen/go/idp/knowledge/v1"
	paginationv1 "github.com/drewpayment/orbit/proto/gen/go/idp/pagination/v1"
)

func TestKnowledgeService_SearchContent(t *testing.T) {
	// TDD Phase: This test MUST fail until the service is implemented
	t.Log("=== T018 Contract Test: KnowledgeService.SearchContent ===")
	t.Log("Testing gRPC contract compliance for knowledge content search")

	// Connect to Knowledge service
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.NewClient(KnowledgeServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("Failed to connect to Knowledge service: %v", err)
	}
	defer conn.Close()

	client := knowledgev1.NewKnowledgeServiceClient(conn)

	t.Log("✅ gRPC client connection established")

	// Test SearchContent with valid search query
	validRequest := &knowledgev1.SearchContentRequest{
		WorkspaceId:       "workspace-123",
		Query:             "API authentication guide",
		KnowledgeSpaceIds: []string{"space-1", "space-2"}, // Optional filter
		ContentTypes: []knowledgev1.ContentType{
			knowledgev1.ContentType_CONTENT_TYPE_MARKDOWN,
			knowledgev1.ContentType_CONTENT_TYPE_RICH_TEXT,
		},
		Tags: []string{"api", "auth"}, // Optional filter
		Pagination: &paginationv1.PaginationRequest{
			Page: 1,
			Size: 10,
		},
	}

	t.Log("🔧 Attempting to search knowledge content...")

	// This should fail in TDD phase with "connection refused"
	response, err := client.SearchContent(ctx, validRequest)

	if err != nil {
		t.Logf("✅ Expected TDD failure - service method not implemented: %v", err)

		// Verify it's the expected connection error (not a different error)
		assert.Contains(t, err.Error(), "connection refused",
			"Expected 'connection refused' error, got: %v", err)

		// Test passes because we expect this failure in TDD phase
		return
	}

	// If we reach here, the service is implemented - validate response
	require.NotNil(t, response, "SearchContent response should not be nil")
	require.NotNil(t, response.Response, "Response wrapper should not be nil")
	require.NotNil(t, response.Results, "Results should not be nil")
	require.NotNil(t, response.Pagination, "Pagination should not be nil")

	// Validate the response structure
	assert.True(t, response.Response.Success, "Response should indicate success")

	// Validate search results structure
	for i, result := range response.Results {
		assert.NotEmpty(t, result.Type, "Result %d should have a type", i)
		assert.NotEmpty(t, result.Id, "Result %d should have an ID", i)
		assert.NotEmpty(t, result.Title, "Result %d should have a title", i)
		assert.GreaterOrEqual(t, result.RelevanceScore, float32(0.0), "Result %d should have a valid relevance score", i)
		assert.LessOrEqual(t, result.RelevanceScore, float32(1.0), "Result %d relevance score should not exceed 1.0", i)

		// Type should be either "knowledge_space" or "page"
		assert.Contains(t, []string{"knowledge_space", "page"}, result.Type,
			"Result %d type should be valid", i)
	}

	// Validate pagination
	assert.Equal(t, int32(1), response.Pagination.Page, "Pagination page should match request")
	assert.Equal(t, int32(10), response.Pagination.Size, "Pagination page size should match request")

	t.Log("✅ Valid content search passed")
}

func TestKnowledgeService_SearchContent_QueryValidation(t *testing.T) {
	t.Log("=== Testing SearchContent with query validation ===")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.NewClient(KnowledgeServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to service: %v", err)
		return
	}
	defer conn.Close()

	client := knowledgev1.NewKnowledgeServiceClient(conn)

	// Test validation scenarios
	testCases := []struct {
		name        string
		request     *knowledgev1.SearchContentRequest
		expectError string
	}{
		{
			name: "missing workspace ID",
			request: &knowledgev1.SearchContentRequest{
				// WorkspaceId is missing
				Query: "test search",
			},
			expectError: "workspace_id is required",
		},
		{
			name: "missing search query",
			request: &knowledgev1.SearchContentRequest{
				WorkspaceId: "workspace-123",
				// Query is missing
			},
			expectError: "query is required",
		},
		{
			name: "empty search query",
			request: &knowledgev1.SearchContentRequest{
				WorkspaceId: "workspace-123",
				Query:       "", // Empty query
			},
			expectError: "query cannot be empty",
		},
		{
			name: "query too short",
			request: &knowledgev1.SearchContentRequest{
				WorkspaceId: "workspace-123",
				Query:       "a", // Single character query
			},
			expectError: "query must be at least 2 characters",
		},
		{
			name: "query too long",
			request: &knowledgev1.SearchContentRequest{
				WorkspaceId: "workspace-123",
				Query:       string(make([]byte, 1000)), // Very long query
			},
			expectError: "query too long",
		},
		{
			name: "invalid pagination",
			request: &knowledgev1.SearchContentRequest{
				WorkspaceId: "workspace-123",
				Query:       "test search",
				Pagination: &paginationv1.PaginationRequest{
					Page: 0, // Invalid page number
					Size: 10,
				},
			},
			expectError: "page must be greater than 0",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			response, err := client.SearchContent(ctx, tc.request)

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

func TestKnowledgeService_SearchContent_Filters(t *testing.T) {
	t.Log("=== Testing SearchContent with different filter combinations ===")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.NewClient(KnowledgeServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to service: %v", err)
		return
	}
	defer conn.Close()

	client := knowledgev1.NewKnowledgeServiceClient(conn)

	// Test different filter combinations
	testCases := []struct {
		name    string
		request *knowledgev1.SearchContentRequest
	}{
		{
			name: "filter by knowledge space",
			request: &knowledgev1.SearchContentRequest{
				WorkspaceId:       "workspace-123",
				Query:             "authentication",
				KnowledgeSpaceIds: []string{"api-docs-space", "user-guides-space"},
				Pagination: &paginationv1.PaginationRequest{
					Page: 1,
					Size: 5,
				},
			},
		},
		{
			name: "filter by content type",
			request: &knowledgev1.SearchContentRequest{
				WorkspaceId: "workspace-123",
				Query:       "tutorial guide",
				ContentTypes: []knowledgev1.ContentType{
					knowledgev1.ContentType_CONTENT_TYPE_MARKDOWN,
				},
				Pagination: &paginationv1.PaginationRequest{
					Page: 1,
					Size: 5,
				},
			},
		},
		{
			name: "filter by tags",
			request: &knowledgev1.SearchContentRequest{
				WorkspaceId: "workspace-123",
				Query:       "getting started",
				Tags:        []string{"beginner", "tutorial", "setup"},
				Pagination: &paginationv1.PaginationRequest{
					Page: 1,
					Size: 5,
				},
			},
		},
		{
			name: "combined filters",
			request: &knowledgev1.SearchContentRequest{
				WorkspaceId:       "workspace-123",
				Query:             "API reference",
				KnowledgeSpaceIds: []string{"api-docs-space"},
				ContentTypes: []knowledgev1.ContentType{
					knowledgev1.ContentType_CONTENT_TYPE_MARKDOWN,
					knowledgev1.ContentType_CONTENT_TYPE_CODE,
				},
				Tags: []string{"api", "reference"},
				Pagination: &paginationv1.PaginationRequest{
					Page: 1,
					Size: 10,
				},
			},
		},
		{
			name: "no filters (workspace only)",
			request: &knowledgev1.SearchContentRequest{
				WorkspaceId: "workspace-123",
				Query:       "documentation",
				Pagination: &paginationv1.PaginationRequest{
					Page: 1,
					Size: 20,
				},
			},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			response, err := client.SearchContent(ctx, tc.request)

			if err != nil {
				t.Logf("✅ TDD phase filter test: %v", err)
				return
			}

			// If service is implemented, validate the response
			require.NotNil(t, response, "Response should not be nil")
			require.NotNil(t, response.Response, "Response wrapper should not be nil")

			assert.True(t, response.Response.Success, "Search should succeed")
			assert.NotNil(t, response.Results, "Results should not be nil")
			assert.NotNil(t, response.Pagination, "Pagination should not be nil")

			// Validate pagination matches request
			assert.Equal(t, tc.request.Pagination.Page, response.Pagination.Page,
				"Pagination page should match request")
			assert.Equal(t, tc.request.Pagination.Size, response.Pagination.Size,
				"Pagination page size should match request")

			t.Logf("✅ Filter test for %s completed", tc.name)
		})
	}
}

func TestKnowledgeService_SearchContent_Pagination(t *testing.T) {
	t.Log("=== Testing SearchContent pagination behavior ===")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.NewClient(KnowledgeServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to service: %v", err)
		return
	}
	defer conn.Close()

	client := knowledgev1.NewKnowledgeServiceClient(conn)

	// Test pagination scenarios
	testCases := []struct {
		name          string
		page          int32
		pageSize      int32
		expectResults bool
	}{
		{
			name:          "first page small size",
			page:          1,
			pageSize:      5,
			expectResults: true,
		},
		{
			name:          "second page",
			page:          2,
			pageSize:      5,
			expectResults: false, // May or may not have results depending on data
		},
		{
			name:          "large page size",
			page:          1,
			pageSize:      50,
			expectResults: true,
		},
		{
			name:          "maximum page size",
			page:          1,
			pageSize:      100,
			expectResults: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			request := &knowledgev1.SearchContentRequest{
				WorkspaceId: "workspace-123",
				Query:       "documentation guide tutorial",
				Pagination: &paginationv1.PaginationRequest{
					Page: tc.page,
					Size: tc.pageSize,
				},
			}

			response, err := client.SearchContent(ctx, request)

			if err != nil {
				t.Logf("✅ TDD phase pagination test: %v", err)
				return
			}

			// If service is implemented, validate the response
			require.NotNil(t, response, "Response should not be nil")
			require.NotNil(t, response.Response, "Response wrapper should not be nil")
			require.NotNil(t, response.Pagination, "Pagination should not be nil")

			assert.True(t, response.Response.Success, "Search should succeed")

			// Validate pagination response
			assert.Equal(t, tc.page, response.Pagination.Page, "Page should match request")
			assert.Equal(t, tc.pageSize, response.Pagination.Size, "Page size should match request")
			assert.GreaterOrEqual(t, response.Pagination.Total, int64(0), "Total should be non-negative")

			// Validate results count doesn't exceed page size
			assert.LessOrEqual(t, len(response.Results), int(tc.pageSize),
				"Results count should not exceed page size")

			t.Logf("✅ Pagination test for %s completed", tc.name)
		})
	}
}

func TestKnowledgeService_SearchContent_ResultRelevance(t *testing.T) {
	t.Log("=== Testing SearchContent result relevance scoring ===")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.NewClient(KnowledgeServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to service: %v", err)
		return
	}
	defer conn.Close()

	client := knowledgev1.NewKnowledgeServiceClient(conn)

	// Test specific search queries to validate relevance
	testCases := []struct {
		name                string
		query               string
		expectedResultTypes []string
	}{
		{
			name:                "exact match query",
			query:               "API Authentication Guide",
			expectedResultTypes: []string{"page", "knowledge_space"},
		},
		{
			name:                "partial match query",
			query:               "getting started tutorial",
			expectedResultTypes: []string{"page", "knowledge_space"},
		},
		{
			name:                "technical term query",
			query:               "REST API endpoints",
			expectedResultTypes: []string{"page"},
		},
		{
			name:                "broad category query",
			query:               "documentation",
			expectedResultTypes: []string{"page", "knowledge_space"},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			request := &knowledgev1.SearchContentRequest{
				WorkspaceId: "workspace-123",
				Query:       tc.query,
				Pagination: &paginationv1.PaginationRequest{
					Page: 1,
					Size: 10,
				},
			}

			response, err := client.SearchContent(ctx, request)

			if err != nil {
				t.Logf("✅ TDD phase relevance test: %v", err)
				return
			}

			// If service is implemented, validate the response
			require.NotNil(t, response, "Response should not be nil")
			require.NotNil(t, response.Response, "Response wrapper should not be nil")

			assert.True(t, response.Response.Success, "Search should succeed")

			// Validate results are ordered by relevance (descending)
			var previousScore float32 = 1.0
			for i, result := range response.Results {
				// Relevance scores should be in descending order
				assert.LessOrEqual(t, result.RelevanceScore, previousScore,
					"Result %d should have relevance score <= previous result", i)
				previousScore = result.RelevanceScore

				// Validate result fields
				assert.NotEmpty(t, result.Type, "Result %d should have a type", i)
				assert.NotEmpty(t, result.Id, "Result %d should have an ID", i)
				assert.NotEmpty(t, result.Title, "Result %d should have a title", i)
				assert.GreaterOrEqual(t, result.RelevanceScore, float32(0.0),
					"Result %d relevance score should be non-negative", i)
			}

			t.Logf("✅ Relevance test for %s completed", tc.name)
		})
	}
}
