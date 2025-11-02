package activities

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFetchKnowledgePagesActivity(t *testing.T) {
	activities := NewKnowledgeSyncActivities()
	ctx := context.Background()

	t.Run("successful fetch", func(t *testing.T) {
		input := FetchKnowledgePagesInput{
			SpaceID: "space-123",
		}

		pages, err := activities.FetchKnowledgePagesActivity(ctx, input)

		require.NoError(t, err)
		assert.NotEmpty(t, pages)
		assert.Equal(t, "space-123", pages[0].SpaceID)
		assert.NotEmpty(t, pages[0].ID)
		assert.NotEmpty(t, pages[0].Title)
		assert.NotEmpty(t, pages[0].Content)
	})

	t.Run("empty space", func(t *testing.T) {
		input := FetchKnowledgePagesInput{
			SpaceID: "space-empty",
		}

		pages, err := activities.FetchKnowledgePagesActivity(ctx, input)

		require.NoError(t, err)
		assert.Empty(t, pages)
	})

	t.Run("missing space ID", func(t *testing.T) {
		input := FetchKnowledgePagesInput{
			SpaceID: "",
		}

		pages, err := activities.FetchKnowledgePagesActivity(ctx, input)

		require.Error(t, err)
		assert.Nil(t, pages)
		assert.Contains(t, err.Error(), "space ID cannot be empty")
	})
}

func TestTransformContentActivity(t *testing.T) {
	activities := NewKnowledgeSyncActivities()
	ctx := context.Background()

	mockPages := []KnowledgePage{
		{
			ID:      "page-1",
			Title:   "Getting Started",
			Content: "# Getting Started\n\nThis is **bold** and *italic* text.",
			SpaceID: "space-123",
			Tags:    []string{"documentation"},
		},
		{
			ID:      "page-2",
			Title:   "API Reference",
			Content: "# API Reference\n\n## Authentication\n\nDetails here.",
			SpaceID: "space-123",
			Tags:    []string{"api"},
		},
	}

	t.Run("transform to confluence", func(t *testing.T) {
		input := TransformContentInput{
			Pages:        mockPages,
			TargetSystem: "confluence",
		}

		transformed, err := activities.TransformContentActivity(ctx, input)

		require.NoError(t, err)
		assert.Len(t, transformed, 2)
		assert.Equal(t, "page-1", transformed[0].ID)
		assert.Equal(t, "confluence_storage", transformed[0].Format)
		assert.Contains(t, transformed[0].Content, "<ac:structured-macro")
		assert.Contains(t, transformed[0].Content, "<h1>Getting Started</h1>")
	})

	t.Run("transform to notion", func(t *testing.T) {
		input := TransformContentInput{
			Pages:        mockPages,
			TargetSystem: "notion",
		}

		transformed, err := activities.TransformContentActivity(ctx, input)

		require.NoError(t, err)
		assert.Len(t, transformed, 2)
		assert.Equal(t, "page-1", transformed[0].ID)
		assert.Equal(t, "notion_blocks", transformed[0].Format)

		// Verify JSON structure
		var notionData map[string]interface{}
		err = json.Unmarshal([]byte(transformed[0].Content), &notionData)
		require.NoError(t, err)
		assert.Contains(t, notionData, "blocks")
	})

	t.Run("transform to github_pages", func(t *testing.T) {
		input := TransformContentInput{
			Pages:        mockPages,
			TargetSystem: "github_pages",
		}

		transformed, err := activities.TransformContentActivity(ctx, input)

		require.NoError(t, err)
		assert.Len(t, transformed, 2)
		assert.Equal(t, "page-1", transformed[0].ID)
		assert.Equal(t, "markdown", transformed[0].Format)
		assert.Contains(t, transformed[0].Content, "---")
		assert.Contains(t, transformed[0].Content, "title: Getting Started")
		assert.Contains(t, transformed[0].Content, "# Getting Started")
	})

	t.Run("unsupported target system", func(t *testing.T) {
		input := TransformContentInput{
			Pages:        mockPages,
			TargetSystem: "unsupported",
		}

		transformed, err := activities.TransformContentActivity(ctx, input)

		require.Error(t, err)
		assert.Nil(t, transformed)
		assert.Contains(t, err.Error(), "unsupported target system")
	})

	t.Run("missing target system", func(t *testing.T) {
		input := TransformContentInput{
			Pages:        mockPages,
			TargetSystem: "",
		}

		transformed, err := activities.TransformContentActivity(ctx, input)

		require.Error(t, err)
		assert.Nil(t, transformed)
		assert.Contains(t, err.Error(), "target system cannot be empty")
	})

	t.Run("empty pages list", func(t *testing.T) {
		input := TransformContentInput{
			Pages:        []KnowledgePage{},
			TargetSystem: "confluence",
		}

		transformed, err := activities.TransformContentActivity(ctx, input)

		require.NoError(t, err)
		assert.Empty(t, transformed)
	})
}

func TestSyncToExternalSystemActivity(t *testing.T) {
	activities := NewKnowledgeSyncActivities()
	ctx := context.Background()

	mockPages := []TransformedPage{
		{
			ID:      "page-1",
			Title:   "Test Page",
			Content: "Test content",
			Format:  "confluence_storage",
		},
	}

	t.Run("sync to confluence with valid credentials", func(t *testing.T) {
		input := SyncToExternalSystemInput{
			Pages:  mockPages,
			System: "confluence",
			Credentials: map[string]string{
				"api_key":  "test-key",
				"base_url": "https://test.atlassian.net",
			},
		}

		err := activities.SyncToExternalSystemActivity(ctx, input)

		require.NoError(t, err)
	})

	t.Run("sync to notion with valid credentials", func(t *testing.T) {
		input := SyncToExternalSystemInput{
			Pages:  mockPages,
			System: "notion",
			Credentials: map[string]string{
				"api_key": "test-key",
			},
		}

		err := activities.SyncToExternalSystemActivity(ctx, input)

		require.NoError(t, err)
	})

	t.Run("sync to github_pages with valid credentials", func(t *testing.T) {
		input := SyncToExternalSystemInput{
			Pages:  mockPages,
			System: "github_pages",
			Credentials: map[string]string{
				"repo_url": "https://github.com/test/docs.git",
				"token":    "test-token",
			},
		}

		err := activities.SyncToExternalSystemActivity(ctx, input)

		require.NoError(t, err)
	})

	t.Run("empty pages list", func(t *testing.T) {
		input := SyncToExternalSystemInput{
			Pages:  []TransformedPage{},
			System: "confluence",
			Credentials: map[string]string{
				"api_key":  "test-key",
				"base_url": "https://test.atlassian.net",
			},
		}

		err := activities.SyncToExternalSystemActivity(ctx, input)

		require.NoError(t, err)
	})

	t.Run("missing system", func(t *testing.T) {
		input := SyncToExternalSystemInput{
			Pages:       mockPages,
			System:      "",
			Credentials: map[string]string{},
		}

		err := activities.SyncToExternalSystemActivity(ctx, input)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "system cannot be empty")
	})

	t.Run("unsupported system", func(t *testing.T) {
		input := SyncToExternalSystemInput{
			Pages:       mockPages,
			System:      "unsupported",
			Credentials: map[string]string{},
		}

		err := activities.SyncToExternalSystemActivity(ctx, input)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "unsupported system")
	})

	t.Run("confluence missing credentials", func(t *testing.T) {
		input := SyncToExternalSystemInput{
			Pages:       mockPages,
			System:      "confluence",
			Credentials: map[string]string{},
		}

		err := activities.SyncToExternalSystemActivity(ctx, input)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "api_key")
	})

	t.Run("notion missing credentials", func(t *testing.T) {
		input := SyncToExternalSystemInput{
			Pages:       mockPages,
			System:      "notion",
			Credentials: map[string]string{},
		}

		err := activities.SyncToExternalSystemActivity(ctx, input)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "api_key")
	})

	t.Run("github_pages missing credentials", func(t *testing.T) {
		input := SyncToExternalSystemInput{
			Pages:       mockPages,
			System:      "github_pages",
			Credentials: map[string]string{},
		}

		err := activities.SyncToExternalSystemActivity(ctx, input)

		require.Error(t, err)
		assert.True(t, strings.Contains(err.Error(), "repo_url") || strings.Contains(err.Error(), "token"))
	})
}

func TestUpdateSyncStatusActivity(t *testing.T) {
	activities := NewKnowledgeSyncActivities()
	ctx := context.Background()

	t.Run("successful status update", func(t *testing.T) {
		input := UpdateSyncStatusInput{
			SpaceID:      "space-123",
			LastSyncTime: time.Now(),
			Status:       "completed",
		}

		err := activities.UpdateSyncStatusActivity(ctx, input)

		require.NoError(t, err)
	})

	t.Run("missing space ID", func(t *testing.T) {
		input := UpdateSyncStatusInput{
			SpaceID:      "",
			LastSyncTime: time.Now(),
			Status:       "completed",
		}

		err := activities.UpdateSyncStatusActivity(ctx, input)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "space ID cannot be empty")
	})

	t.Run("missing status", func(t *testing.T) {
		input := UpdateSyncStatusInput{
			SpaceID:      "space-123",
			LastSyncTime: time.Now(),
			Status:       "",
		}

		err := activities.UpdateSyncStatusActivity(ctx, input)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "status cannot be empty")
	})
}

func TestConfluenceTransformation(t *testing.T) {
	activities := NewKnowledgeSyncActivities()

	page := KnowledgePage{
		ID:      "test-1",
		Title:   "Test Page",
		Content: "# Heading 1\n\n## Heading 2\n\n### Heading 3\n\nThis is **bold** and *italic*.",
		SpaceID: "space-123",
		Tags:    []string{"test"},
	}

	transformed, err := activities.transformToConfluence(page)

	require.NoError(t, err)
	assert.Equal(t, "test-1", transformed.ID)
	assert.Equal(t, "confluence_storage", transformed.Format)
	assert.Contains(t, transformed.Content, "<h1>Heading 1</h1>")
	assert.Contains(t, transformed.Content, "<h2>Heading 2</h2>")
	assert.Contains(t, transformed.Content, "<h3>Heading 3</h3>")
	assert.Contains(t, transformed.Content, "<strong>bold</strong>")
	assert.Contains(t, transformed.Content, "<em>italic</em>")
}

func TestNotionTransformation(t *testing.T) {
	activities := NewKnowledgeSyncActivities()

	page := KnowledgePage{
		ID:      "test-1",
		Title:   "Test Page",
		Content: "# Heading 1\n\n## Heading 2\n\nParagraph text.",
		SpaceID: "space-123",
		Tags:    []string{"test"},
	}

	transformed, err := activities.transformToNotion(page)

	require.NoError(t, err)
	assert.Equal(t, "test-1", transformed.ID)
	assert.Equal(t, "notion_blocks", transformed.Format)

	var notionData map[string]interface{}
	err = json.Unmarshal([]byte(transformed.Content), &notionData)
	require.NoError(t, err)

	blocks, ok := notionData["blocks"].([]interface{})
	require.True(t, ok)
	assert.NotEmpty(t, blocks)

	// Check first block is heading_1
	firstBlock, ok := blocks[0].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "heading_1", firstBlock["type"])
	assert.Equal(t, "Heading 1", firstBlock["text"])
}

func TestGitHubPagesTransformation(t *testing.T) {
	activities := NewKnowledgeSyncActivities()

	now := time.Now()
	page := KnowledgePage{
		ID:        "test-1",
		Title:     "Test Page",
		Content:   "# Heading 1\n\nContent here.",
		SpaceID:   "space-123",
		UpdatedAt: now,
		Tags:      []string{"documentation", "test"},
	}

	transformed, err := activities.transformToGitHubPages(page)

	require.NoError(t, err)
	assert.Equal(t, "test-1", transformed.ID)
	assert.Equal(t, "markdown", transformed.Format)
	assert.Contains(t, transformed.Content, "---")
	assert.Contains(t, transformed.Content, "title: Test Page")
	assert.Contains(t, transformed.Content, "date: "+now.Format(time.RFC3339))
	assert.Contains(t, transformed.Content, "tags: documentation, test")
	assert.Contains(t, transformed.Content, "# Heading 1")
}
