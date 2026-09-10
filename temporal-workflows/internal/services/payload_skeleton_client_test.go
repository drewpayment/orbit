package services

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPayloadSkeletonClient_GetSkeletonManifest_Success(t *testing.T) {
	var gotPath, gotAPIKey string
	var gotQuery url.Values

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAPIKey = r.Header.Get("X-API-Key")
		gotQuery = r.URL.Query()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"id": "skel-1", "name": "Node service", "slug": "node-service",
			"version": 2, "totalSize": 123,
			"files": [{"path": "src/index.ts", "size": 100}, {"path": "package.json", "size": 23}]
		}`))
	}))
	defer srv.Close()

	client := NewPayloadSkeletonClient(srv.URL, "test-api-key", nil)
	manifest, err := client.GetSkeletonManifest(context.Background(), "skel-1", "workspace-1")
	require.NoError(t, err)

	assert.Equal(t, "/api/internal/template-skeletons/skel-1", gotPath)
	assert.Equal(t, "test-api-key", gotAPIKey)
	assert.Equal(t, "workspace-1", gotQuery.Get("workspaceId"))
	assert.Equal(t, "1", gotQuery.Get("manifest"))

	assert.Equal(t, "skel-1", manifest.ID)
	assert.Equal(t, "Node service", manifest.Name)
	assert.Equal(t, 2, manifest.Version)
	require.Len(t, manifest.Files, 2)
	assert.Equal(t, "src/index.ts", manifest.Files[0].Path)
	assert.Equal(t, 100, manifest.Files[0].Size)
	assert.Empty(t, manifest.Files[0].Content, "manifest response carries no file content")
}

func TestPayloadSkeletonClient_GetSkeletonBundle_Success(t *testing.T) {
	var gotQuery url.Values

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"id": "skel-1", "name": "Node service", "slug": "node-service",
			"version": 2, "totalSize": 23,
			"files": [{"path": "package.json", "size": 23, "content": "{\"name\":\"x\"}"}]
		}`))
	}))
	defer srv.Close()

	client := NewPayloadSkeletonClient(srv.URL, "test-api-key", nil)
	bundle, err := client.GetSkeletonBundle(context.Background(), "skel-1", "workspace-1")
	require.NoError(t, err)

	assert.Empty(t, gotQuery.Get("manifest"), "bundle fetch must not set ?manifest=1")
	assert.Equal(t, "workspace-1", gotQuery.Get("workspaceId"))
	require.Len(t, bundle.Files, 1)
	assert.Equal(t, `{"name":"x"}`, bundle.Files[0].Content)
}

func TestPayloadSkeletonClient_GetSkeletonManifest_NotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error": "template skeleton not found"}`))
	}))
	defer srv.Close()

	client := NewPayloadSkeletonClient(srv.URL, "test-api-key", nil)
	_, err := client.GetSkeletonManifest(context.Background(), "missing", "workspace-1")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrSkeletonNotFound)
}

func TestPayloadSkeletonClient_GetSkeletonBundle_NotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	client := NewPayloadSkeletonClient(srv.URL, "test-api-key", nil)
	_, err := client.GetSkeletonBundle(context.Background(), "skel-1", "wrong-workspace")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrSkeletonNotFound)
}

func TestPayloadSkeletonClient_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("boom"))
	}))
	defer srv.Close()

	client := NewPayloadSkeletonClient(srv.URL, "test-api-key", nil)
	_, err := client.GetSkeletonBundle(context.Background(), "skel-1", "workspace-1")
	require.Error(t, err)
	assert.NotErrorIs(t, err, ErrSkeletonNotFound)
	assert.Contains(t, err.Error(), "500")
}

func TestPayloadSkeletonClient_RequiresIDs(t *testing.T) {
	client := NewPayloadSkeletonClient("http://example.invalid", "key", nil)

	_, err := client.GetSkeletonManifest(context.Background(), "", "workspace-1")
	assert.ErrorContains(t, err, "skeleton id")

	_, err = client.GetSkeletonBundle(context.Background(), "skel-1", "")
	assert.ErrorContains(t, err, "workspace id")
}
