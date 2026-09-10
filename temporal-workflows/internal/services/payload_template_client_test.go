package services

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPayloadTemplateClient_FinalizeInstantiation_Success(t *testing.T) {
	var gotMethod, gotPath, gotAPIKey string
	var gotBody FinalizeInstantiationInput

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotAPIKey = r.Header.Get("X-API-Key")
		require.NoError(t, json.NewDecoder(r.Body).Decode(&gotBody))

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(FinalizeInstantiationResult{
			CatalogEntityID: "entity-1",
			UsageCount:      3,
		})
	}))
	defer srv.Close()

	client := NewPayloadTemplateClient(srv.URL, "test-api-key", nil)
	result, err := client.FinalizeInstantiation(context.Background(), "template-123", FinalizeInstantiationInput{
		WorkspaceID: "workspace-456",
		RepoURL:     "https://github.com/my-org/new-service",
		RepoName:    "new-service",
		UserID:      "user-789",
	})

	require.NoError(t, err)
	assert.Equal(t, "entity-1", result.CatalogEntityID)
	assert.Equal(t, 3, result.UsageCount)

	assert.Equal(t, http.MethodPost, gotMethod)
	assert.Equal(t, "/api/internal/templates/template-123/finalize", gotPath)
	assert.Equal(t, "test-api-key", gotAPIKey)
	assert.Equal(t, "workspace-456", gotBody.WorkspaceID)
	assert.Equal(t, "https://github.com/my-org/new-service", gotBody.RepoURL)
	assert.Equal(t, "new-service", gotBody.RepoName)
	assert.Equal(t, "user-789", gotBody.UserID)
}

func TestPayloadTemplateClient_FinalizeInstantiation_NotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "template not found"})
	}))
	defer srv.Close()

	client := NewPayloadTemplateClient(srv.URL, "test-api-key", nil)
	_, err := client.FinalizeInstantiation(context.Background(), "missing-id", FinalizeInstantiationInput{
		WorkspaceID: "workspace-456",
		RepoURL:     "https://github.com/my-org/new-service",
		RepoName:    "new-service",
	})

	require.Error(t, err)
	assert.ErrorIs(t, err, ErrTemplateNotFound)
}

func TestPayloadTemplateClient_FinalizeInstantiation_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("boom"))
	}))
	defer srv.Close()

	client := NewPayloadTemplateClient(srv.URL, "test-api-key", nil)
	_, err := client.FinalizeInstantiation(context.Background(), "template-123", FinalizeInstantiationInput{
		WorkspaceID: "workspace-456",
		RepoURL:     "https://github.com/my-org/new-service",
		RepoName:    "new-service",
	})

	require.Error(t, err)
	assert.NotErrorIs(t, err, ErrTemplateNotFound)
	assert.Contains(t, err.Error(), "500")
}
