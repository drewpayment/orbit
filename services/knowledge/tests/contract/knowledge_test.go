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

// TestCreateDocument_Success tests successful document creation
func TestCreateDocument_Success(t *testing.T) {
	// This test should fail until KnowledgeService is implemented
	t.Skip("Implementation pending - TDD requirement: test must exist and fail before implementation")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient
	
	req := &knowledgepb.CreateDocumentRequest{
		WorkspaceId: "workspace-123",
		Document: &knowledgepb.Document{
			Title:       "API Documentation",
			Content:     "# API Documentation\n\nThis document describes the API endpoints.",
			ContentType: knowledgepb.Document_CONTENT_TYPE_MARKDOWN,
			Category:    "documentation",
			Tags:        []string{"api", "documentation", "guide"},
			IsPublic:    false,
		},
	}

	resp, err := service.CreateDocument(ctx, req)

	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Document)

	// Validate document properties
	assert.Equal(t, req.Document.Title, resp.Document.Title)
	assert.Equal(t, req.Document.Content, resp.Document.Content)
	assert.Equal(t, req.Document.ContentType, resp.Document.ContentType)
	assert.Equal(t, req.Document.Category, resp.Document.Category)
	assert.Equal(t, req.Document.Tags, resp.Document.Tags)
	assert.Equal(t, req.Document.IsPublic, resp.Document.IsPublic)

	// Validate generated fields
	assert.NotEmpty(t, resp.Document.Id)
	assert.NotEmpty(t, resp.Document.Slug)
	assert.NotNil(t, resp.Document.CreatedAt)
	assert.NotNil(t, resp.Document.UpdatedAt)
	assert.Equal(t, req.WorkspaceId, resp.Document.WorkspaceId)
	assert.Equal(t, knowledgepb.Document_STATUS_PUBLISHED, resp.Document.Status)
}

// TestCreateDocument_ValidationErrors tests input validation
func TestCreateDocument_ValidationErrors(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient

	testCases := []struct {
		name     string
		req      *knowledgepb.CreateDocumentRequest
		wantCode codes.Code
		wantMsg  string
	}{
		{
			name: "missing workspace ID",
			req: &knowledgepb.CreateDocumentRequest{
				Document: &knowledgepb.Document{
					Title:   "Test Doc",
					Content: "Content",
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "workspace_id is required",
		},
		{
			name: "missing document",
			req: &knowledgepb.CreateDocumentRequest{
				WorkspaceId: "workspace-123",
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "document is required",
		},
		{
			name: "missing title",
			req: &knowledgepb.CreateDocumentRequest{
				WorkspaceId: "workspace-123",
				Document: &knowledgepb.Document{
					Content: "Content",
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "document.title is required",
		},
		{
			name: "title too short",
			req: &knowledgepb.CreateDocumentRequest{
				WorkspaceId: "workspace-123",
				Document: &knowledgepb.Document{
					Title:   "A",
					Content: "Content",
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "document.title must be at least 2 characters",
		},
		{
			name: "title too long",
			req: &knowledgepb.CreateDocumentRequest{
				WorkspaceId: "workspace-123",
				Document: &knowledgepb.Document{
					Title:   "This is a very long title that exceeds the maximum allowed length for document titles which should be reasonable and not too verbose for good user experience and database performance reasons",
					Content: "Content",
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "document.title must be at most 200 characters",
		},
		{
			name: "missing content",
			req: &knowledgepb.CreateDocumentRequest{
				WorkspaceId: "workspace-123",
				Document: &knowledgepb.Document{
					Title: "Test Doc",
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "document.content is required",
		},
		{
			name: "content too long",
			req: &knowledgepb.CreateDocumentRequest{
				WorkspaceId: "workspace-123",
				Document: &knowledgepb.Document{
					Title:   "Test Doc",
					Content: string(make([]byte, 1000001)), // > 1MB
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "document.content must be at most 1MB",
		},
		{
			name: "invalid content type",
			req: &knowledgepb.CreateDocumentRequest{
				WorkspaceId: "workspace-123",
				Document: &knowledgepb.Document{
					Title:       "Test Doc",
					Content:     "Content",
					ContentType: knowledgepb.Document_CONTENT_TYPE_UNSPECIFIED,
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "document.content_type is required",
		},
		{
			name: "invalid category - too long",
			req: &knowledgepb.CreateDocumentRequest{
				WorkspaceId: "workspace-123",
				Document: &knowledgepb.Document{
					Title:    "Test Doc",
					Content:  "Content",
					Category: "this-is-a-very-long-category-name-that-exceeds-maximum-allowed-length-for-categories-which-should-be-short-and-descriptive",
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "document.category must be at most 50 characters",
		},
		{
			name: "invalid category - invalid characters",
			req: &knowledgepb.CreateDocumentRequest{
				WorkspaceId: "workspace-123",
				Document: &knowledgepb.Document{
					Title:    "Test Doc",
					Content:  "Content",
					Category: "invalid category!",
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "document.category must contain only lowercase letters, numbers, and hyphens",
		},
		{
			name: "too many tags",
			req: &knowledgepb.CreateDocumentRequest{
				WorkspaceId: "workspace-123",
				Document: &knowledgepb.Document{
					Title:   "Test Doc",
					Content: "Content",
					Tags:    []string{"tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10", "tag11"},
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "document.tags cannot exceed 10 items",
		},
		{
			name: "invalid tag",
			req: &knowledgepb.CreateDocumentRequest{
				WorkspaceId: "workspace-123",
				Document: &knowledgepb.Document{
					Title:   "Test Doc",
					Content: "Content",
					Tags:    []string{"invalid tag"},
				},
			},
			wantCode: codes.InvalidArgument,
			wantMsg:  "tag must contain only lowercase letters, numbers, and hyphens",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := service.CreateDocument(ctx, tc.req)
			
			require.Error(t, err)
			st, ok := status.FromError(err)
			require.True(t, ok)
			assert.Equal(t, tc.wantCode, st.Code())
			assert.Contains(t, st.Message(), tc.wantMsg)
		})
	}
}

// TestCreateDocument_WorkspaceNotFound tests workspace existence validation
func TestCreateDocument_WorkspaceNotFound(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient
	
	req := &knowledgepb.CreateDocumentRequest{
		WorkspaceId: "non-existent-workspace",
		Document: &knowledgepb.Document{
			Title:   "Test Doc",
			Content: "Content",
		},
	}

	_, err := service.CreateDocument(ctx, req)
	
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
	assert.Contains(t, st.Message(), "workspace 'non-existent-workspace' not found")
}

// TestCreateDocument_DuplicateTitle tests title uniqueness within workspace
func TestCreateDocument_DuplicateTitle(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient
	
	// First creation should succeed
	req := &knowledgepb.CreateDocumentRequest{
		WorkspaceId: "workspace-123",
		Document: &knowledgepb.Document{
			Title:   "Unique Document Title",
			Content: "Content",
		},
	}

	_, err := service.CreateDocument(ctx, req)
	require.NoError(t, err)

	// Second creation with same title should fail
	_, err = service.CreateDocument(ctx, req)
	
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.AlreadyExists, st.Code())
	assert.Contains(t, st.Message(), "document with title 'Unique Document Title' already exists")
}

// TestCreateDocument_ContentTypes tests different content type validations
func TestCreateDocument_ContentTypes(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient

	testCases := []struct {
		name        string
		contentType knowledgepb.Document_ContentType
		content     string
		wantErr     bool
		wantMsg     string
	}{
		{
			name:        "valid markdown",
			contentType: knowledgepb.Document_CONTENT_TYPE_MARKDOWN,
			content:     "# Title\n\nThis is markdown content.",
			wantErr:     false,
		},
		{
			name:        "valid HTML",
			contentType: knowledgepb.Document_CONTENT_TYPE_HTML,
			content:     "<h1>Title</h1><p>This is HTML content.</p>",
			wantErr:     false,
		},
		{
			name:        "valid plain text",
			contentType: knowledgepb.Document_CONTENT_TYPE_TEXT,
			content:     "This is plain text content.",
			wantErr:     false,
		},
		{
			name:        "invalid HTML - malformed",
			contentType: knowledgepb.Document_CONTENT_TYPE_HTML,
			content:     "<h1>Title<p>Unclosed tags",
			wantErr:     true,
			wantMsg:     "document.content contains malformed HTML",
		},
		{
			name:        "HTML with dangerous content",
			contentType: knowledgepb.Document_CONTENT_TYPE_HTML,
			content:     "<script>alert('xss')</script><h1>Title</h1>",
			wantErr:     true,
			wantMsg:     "document.content contains potentially dangerous HTML",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &knowledgepb.CreateDocumentRequest{
				WorkspaceId: "workspace-123",
				Document: &knowledgepb.Document{
					Title:       tc.name,
					Content:     tc.content,
					ContentType: tc.contentType,
				},
			}

			resp, err := service.CreateDocument(ctx, req)

			if tc.wantErr {
				require.Error(t, err)
				st, ok := status.FromError(err)
				require.True(t, ok)
				assert.Equal(t, codes.InvalidArgument, st.Code())
				assert.Contains(t, st.Message(), tc.wantMsg)
			} else {
				require.NoError(t, err)
				require.NotNil(t, resp)
				assert.Equal(t, tc.contentType, resp.Document.ContentType)
			}
		})
	}
}

// TestCreateDocument_SlugGeneration tests automatic slug generation
func TestCreateDocument_SlugGeneration(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient

	testCases := []struct {
		name         string
		title        string
		expectedSlug string
	}{
		{
			name:         "simple title",
			title:        "Simple Title",
			expectedSlug: "simple-title",
		},
		{
			name:         "title with special characters",
			title:        "API Documentation & Guide",
			expectedSlug: "api-documentation-guide",
		},
		{
			name:         "title with numbers",
			title:        "Version 2.0 Release Notes",
			expectedSlug: "version-2-0-release-notes",
		},
		{
			name:         "long title",
			title:        "This is a very long document title that should be truncated when converted to slug",
			expectedSlug: "this-is-a-very-long-document-title-that-should-be-truncated-when",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &knowledgepb.CreateDocumentRequest{
				WorkspaceId: "workspace-123",
				Document: &knowledgepb.Document{
					Title:   tc.title,
					Content: "Content",
				},
			}

			resp, err := service.CreateDocument(ctx, req)

			require.NoError(t, err)
			require.NotNil(t, resp)
			assert.Equal(t, tc.expectedSlug, resp.Document.Slug)
		})
	}
}

// TestCreateDocument_PermissionDenied tests access control
func TestCreateDocument_PermissionDenied(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient
	
	req := &knowledgepb.CreateDocumentRequest{
		WorkspaceId: "restricted-workspace-123",
		Document: &knowledgepb.Document{
			Title:   "Test Doc",
			Content: "Content",
		},
	}

	_, err := service.CreateDocument(ctx, req)
	
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.PermissionDenied, st.Code())
	assert.Contains(t, st.Message(), "insufficient permissions to create document")
}

// TestCreateDocument_CategoryHandling tests category validation and normalization
func TestCreateDocument_CategoryHandling(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient

	testCases := []struct {
		name             string
		category         string
		expectedCategory string
		wantErr          bool
		wantMsg          string
	}{
		{
			name:             "valid category",
			category:         "documentation",
			expectedCategory: "documentation",
			wantErr:          false,
		},
		{
			name:             "category with hyphens",
			category:         "api-guides",
			expectedCategory: "api-guides",
			wantErr:          false,
		},
		{
			name:             "category with numbers",
			category:         "version-2",
			expectedCategory: "version-2",
			wantErr:          false,
		},
		{
			name:             "empty category (should use default)",
			category:         "",
			expectedCategory: "general",
			wantErr:          false,
		},
		{
			name:     "uppercase category (should be normalized)",
			category: "DOCUMENTATION",
			wantErr:  true,
			wantMsg:  "document.category must be lowercase",
		},
		{
			name:     "category with spaces",
			category: "api documentation",
			wantErr:  true,
			wantMsg:  "document.category must contain only lowercase letters, numbers, and hyphens",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &knowledgepb.CreateDocumentRequest{
				WorkspaceId: "workspace-123",
				Document: &knowledgepb.Document{
					Title:    "Test Document",
					Content:  "Content",
					Category: tc.category,
				},
			}

			resp, err := service.CreateDocument(ctx, req)

			if tc.wantErr {
				require.Error(t, err)
				st, ok := status.FromError(err)
				require.True(t, ok)
				assert.Equal(t, codes.InvalidArgument, st.Code())
				assert.Contains(t, st.Message(), tc.wantMsg)
			} else {
				require.NoError(t, err)
				require.NotNil(t, resp)
				assert.Equal(t, tc.expectedCategory, resp.Document.Category)
			}
		})
	}
}

// TestCreateDocument_TagHandling tests tag validation and deduplication
func TestCreateDocument_TagHandling(t *testing.T) {
	t.Skip("Implementation pending - TDD requirement")

	ctx := context.Background()
	var service knowledgepb.KnowledgeServiceClient

	testCases := []struct {
		name         string
		tags         []string
		expectedTags []string
		wantErr      bool
		wantMsg      string
	}{
		{
			name:         "valid tags",
			tags:         []string{"api", "documentation", "guide"},
			expectedTags: []string{"api", "documentation", "guide"},
			wantErr:      false,
		},
		{
			name:         "duplicate tags (should be deduplicated)",
			tags:         []string{"api", "documentation", "api", "guide"},
			expectedTags: []string{"api", "documentation", "guide"},
			wantErr:      false,
		},
		{
			name:         "empty tags",
			tags:         []string{},
			expectedTags: []string{},
			wantErr:      false,
		},
		{
			name:         "tags with numbers",
			tags:         []string{"version-2", "api-v1"},
			expectedTags: []string{"version-2", "api-v1"},
			wantErr:      false,
		},
		{
			name:    "tag too short",
			tags:    []string{"a"},
			wantErr: true,
			wantMsg: "tag must be at least 2 characters",
		},
		{
			name:    "tag with spaces",
			tags:    []string{"api documentation"},
			wantErr: true,
			wantMsg: "tag must contain only lowercase letters, numbers, and hyphens",
		},
		{
			name:    "uppercase tag",
			tags:    []string{"API"},
			wantErr: true,
			wantMsg: "tag must be lowercase",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := &knowledgepb.CreateDocumentRequest{
				WorkspaceId: "workspace-123",
				Document: &knowledgepb.Document{
					Title:   "Test Document",
					Content: "Content",
					Tags:    tc.tags,
				},
			}

			resp, err := service.CreateDocument(ctx, req)

			if tc.wantErr {
				require.Error(t, err)
				st, ok := status.FromError(err)
				require.True(t, ok)
				assert.Equal(t, codes.InvalidArgument, st.Code())
				assert.Contains(t, st.Message(), tc.wantMsg)
			} else {
				require.NoError(t, err)
				require.NotNil(t, resp)
				assert.ElementsMatch(t, tc.expectedTags, resp.Document.Tags)
			}
		})
	}
}