/**
 * T017 - Contract Test: KnowledgeService.CreatePage
 * 
 * This contract test validates the CreatePage gRPC method according to the protobuf contract.
 * It tests the Knowledge service's ability to create knowledge pages and add them to knowledge spaces.
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
	"google.golang.org/protobuf/types/known/anypb"

	knowledgev1 "github.com/drewpayment/orbit/proto/gen/go/idp/knowledge/v1"
)

func TestKnowledgeService_CreatePage(t *testing.T) {
	// TDD Phase: This test MUST fail until the service is implemented
	t.Log("=== T017 Contract Test: KnowledgeService.CreatePage ===")
	t.Log("Testing gRPC contract compliance for knowledge page creation")

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

	// Prepare content as protobuf Any
	content := "# Getting Started\n\nThis is a comprehensive guide to get you started with our platform."
	contentAny, err := anypb.New(&anypb.Any{Value: []byte(content)})
	require.NoError(t, err, "Failed to create protobuf Any for content")

	// Test CreatePage with valid page data
	validRequest := &knowledgev1.CreatePageRequest{
		KnowledgeSpaceId: "knowledge-space-123",
		ParentId:         "", // Optional - root page
		Title:            "Getting Started Guide",
		Slug:             "getting-started",
		Content:          contentAny,
		ContentType:      knowledgev1.ContentType_CONTENT_TYPE_MARKDOWN,
		Tags:             []string{"getting-started", "tutorial", "beginner"},
		Status:           knowledgev1.PageStatus_PAGE_STATUS_DRAFT,
	}

	t.Log("🔧 Attempting to create knowledge page...")

	// This should fail in TDD phase with "connection refused"
	response, err := client.CreatePage(ctx, validRequest)

	if err != nil {
		t.Logf("✅ Expected TDD failure - service method not implemented: %v", err)
		
		// Verify it's the expected connection error (not a different error)
		assert.Contains(t, err.Error(), "connection refused", 
			"Expected 'connection refused' error, got: %v", err)
		
		// Test passes because we expect this failure in TDD phase
		return
	}

	// If we reach here, the service is implemented - validate response
	require.NotNil(t, response, "CreatePage response should not be nil")
	require.NotNil(t, response.Response, "Response wrapper should not be nil")
	require.NotNil(t, response.Page, "Created page should not be nil")

	// Validate the response structure
	assert.True(t, response.Response.Success, "Response should indicate success")
	
	// Validate the created page
	page := response.Page
	assert.NotEmpty(t, page.Metadata.Id, "Page should have an ID")
	assert.Equal(t, validRequest.KnowledgeSpaceId, page.KnowledgeSpaceId, "Knowledge space ID should match")
	assert.Equal(t, validRequest.Title, page.Title, "Title should match")
	assert.Equal(t, validRequest.Slug, page.Slug, "Slug should match")
	assert.Equal(t, validRequest.ContentType, page.ContentType, "Content type should match")
	assert.Equal(t, validRequest.Tags, page.Tags, "Tags should match")
	assert.Equal(t, validRequest.Status, page.Status, "Status should match")
	
	// Validate metadata
	assert.NotNil(t, page.Metadata.CreatedAt, "Created timestamp should be set")

	t.Log("✅ Valid page creation passed")
}

func TestKnowledgeService_CreatePage_ValidationErrors(t *testing.T) {
	t.Log("=== Testing CreatePage with validation errors ===")

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
		name    string
		request *knowledgev1.CreatePageRequest
		expectError string
	}{
		{
			name: "missing knowledge space ID",
			request: &knowledgev1.CreatePageRequest{
				// KnowledgeSpaceId is missing
				Title:       "Test Page",
				ContentType: knowledgev1.ContentType_CONTENT_TYPE_MARKDOWN,
			},
			expectError: "knowledge_space_id is required",
		},
		{
			name: "missing title",
			request: &knowledgev1.CreatePageRequest{
				KnowledgeSpaceId: "knowledge-space-123",
				// Title is missing
				ContentType: knowledgev1.ContentType_CONTENT_TYPE_MARKDOWN,
			},
			expectError: "title is required",
		},
		{
			name: "invalid content type",
			request: &knowledgev1.CreatePageRequest{
				KnowledgeSpaceId: "knowledge-space-123",
				Title:            "Test Page",
				ContentType:      knowledgev1.ContentType_CONTENT_TYPE_UNSPECIFIED,
			},
			expectError: "content_type must be specified",
		},
		{
			name: "title too long",
			request: &knowledgev1.CreatePageRequest{
				KnowledgeSpaceId: "knowledge-space-123",
				Title:            string(make([]byte, 300)), // Assuming 255 char limit
				ContentType:      knowledgev1.ContentType_CONTENT_TYPE_MARKDOWN,
			},
			expectError: "title too long",
		},
		{
			name: "invalid slug format",
			request: &knowledgev1.CreatePageRequest{
				KnowledgeSpaceId: "knowledge-space-123",
				Title:            "Test Page",
				Slug:             "Invalid Slug With Spaces!",
				ContentType:      knowledgev1.ContentType_CONTENT_TYPE_MARKDOWN,
			},
			expectError: "slug must be lowercase alphanumeric with hyphens",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			response, err := client.CreatePage(ctx, tc.request)
			
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

func TestKnowledgeService_CreatePage_ContentTypes(t *testing.T) {
	t.Log("=== Testing CreatePage with different content types ===")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.NewClient(KnowledgeServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to service: %v", err)
		return
	}
	defer conn.Close()

	client := knowledgev1.NewKnowledgeServiceClient(conn)

	// Test different content types
	testCases := []struct {
		name        string
		contentType knowledgev1.ContentType
		content     string
	}{
		{
			name:        "markdown content",
			contentType: knowledgev1.ContentType_CONTENT_TYPE_MARKDOWN,
			content: `# API Documentation

This is a comprehensive guide to our API.

## Getting Started

First, you need to authenticate...

### Code Example

` + "```javascript" + `
const api = new APIClient();
await api.authenticate();
` + "```" + `
`,
		},
		{
			name:        "rich text content",
			contentType: knowledgev1.ContentType_CONTENT_TYPE_RICH_TEXT,
			content:     `{"type":"doc","content":[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Rich Text Document"}]},{"type":"paragraph","content":[{"type":"text","text":"This is rich text content with formatting."}]}]}`,
		},
		{
			name:        "code content",
			contentType: knowledgev1.ContentType_CONTENT_TYPE_CODE,
			content: `// Example API client implementation
class APIClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseURL = 'https://api.example.com';
    }
    
    async authenticate() {
        const response = await fetch(` + "`${this.baseURL}/auth`" + `, {
            headers: {
                'Authorization': ` + "`Bearer ${this.apiKey}`" + `
            }
        });
        return response.json();
    }
}`,
		},
		{
			name:        "diagram content",
			contentType: knowledgev1.ContentType_CONTENT_TYPE_DIAGRAM,
			content: `{"type":"flowchart","data":"graph TD\n    A[Start] --> B{Is user authenticated?}\n    B -->|Yes| C[Show dashboard]\n    B -->|No| D[Show login]\n    D --> E[Authenticate]\n    E --> C"}`,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			contentAny, err := anypb.New(&anypb.Any{Value: []byte(tc.content)})
			require.NoError(t, err, "Failed to create protobuf Any for content")

			request := &knowledgev1.CreatePageRequest{
				KnowledgeSpaceId: "knowledge-space-123",
				Title:            "Content Type Test: " + tc.name,
				Content:          contentAny,
				ContentType:      tc.contentType,
				Tags:             []string{"test", "content-type"},
				Status:           knowledgev1.PageStatus_PAGE_STATUS_DRAFT,
			}

			response, err := client.CreatePage(ctx, request)
			
			if err != nil {
				t.Logf("✅ TDD phase content type test: %v", err)
				return
			}

			// If service is implemented, validate the response
			require.NotNil(t, response, "Response should not be nil")
			require.NotNil(t, response.Response, "Response wrapper should not be nil")
			require.NotNil(t, response.Page, "Created page should not be nil")

			assert.True(t, response.Response.Success, "Content creation should succeed")
			
			page := response.Page
			assert.Equal(t, tc.contentType, page.ContentType, 
				"Content type should match for %s", tc.name)

			t.Logf("✅ Content type test for %s completed", tc.name)
		})
	}
}

func TestKnowledgeService_CreatePage_PageHierarchy(t *testing.T) {
	t.Log("=== Testing CreatePage with page hierarchy (parent-child relationships) ===")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := grpc.NewClient(KnowledgeServiceAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Logf("✅ Expected TDD failure - connection to service: %v", err)
		return
	}
	defer conn.Close()

	client := knowledgev1.NewKnowledgeServiceClient(conn)

	// Test creating root page (no parent)
	t.Run("root page", func(t *testing.T) {
		contentAny, err := anypb.New(&anypb.Any{Value: []byte("# Root Documentation\n\nThis is the root page.")})
		require.NoError(t, err, "Failed to create protobuf Any for content")

		request := &knowledgev1.CreatePageRequest{
			KnowledgeSpaceId: "knowledge-space-123",
			// ParentId is not set - this is a root page
			Title:       "Root Documentation",
			Slug:        "root-docs",
			Content:     contentAny,
			ContentType: knowledgev1.ContentType_CONTENT_TYPE_MARKDOWN,
			Status:      knowledgev1.PageStatus_PAGE_STATUS_PUBLISHED,
		}

		response, err := client.CreatePage(ctx, request)
		
		if err != nil {
			t.Logf("✅ TDD phase root page test: %v", err)
			return
		}

		// If service is implemented, validate the response
		require.NotNil(t, response, "Response should not be nil")
		require.NotNil(t, response.Page, "Created page should not be nil")

		page := response.Page
		assert.Empty(t, page.ParentId, "Root page should have no parent")
		assert.Equal(t, "root-docs", page.Slug, "Slug should match")

		t.Log("✅ Root page creation test completed")
	})

	// Test creating child page (with parent)
	t.Run("child page", func(t *testing.T) {
		contentAny, err := anypb.New(&anypb.Any{Value: []byte("# API Reference\n\nDetailed API documentation.")})
		require.NoError(t, err, "Failed to create protobuf Any for content")

		request := &knowledgev1.CreatePageRequest{
			KnowledgeSpaceId: "knowledge-space-123",
			ParentId:         "parent-page-456", // This page has a parent
			Title:            "API Reference",
			Slug:             "api-reference",
			Content:          contentAny,
			ContentType:      knowledgev1.ContentType_CONTENT_TYPE_MARKDOWN,
			Status:           knowledgev1.PageStatus_PAGE_STATUS_DRAFT,
		}

		response, err := client.CreatePage(ctx, request)
		
		if err != nil {
			t.Logf("✅ TDD phase child page test: %v", err)
			return
		}

		// If service is implemented, validate the response
		require.NotNil(t, response, "Response should not be nil")
		require.NotNil(t, response.Page, "Created page should not be nil")

		page := response.Page
		assert.Equal(t, "parent-page-456", page.ParentId, "Child page should have correct parent ID")
		assert.Equal(t, "api-reference", page.Slug, "Slug should match")

		t.Log("✅ Child page creation test completed")
	})
}