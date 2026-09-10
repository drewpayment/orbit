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

func TestPayloadTemplateSweepClient_ListDryRunSweepCandidates_Success(t *testing.T) {
	var gotMethod, gotPath, gotAPIKey string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotAPIKey = r.Header.Get("X-API-Key")

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"templates": []map[string]any{
				{
					"id":               "def-1",
					"name":             "Service Template",
					"workspaceId":      "ws-1",
					"currentVersionId": "ver-1",
					"fixtures": []map[string]any{
						{"id": "fix-1", "name": "Basic", "values": map[string]any{"name": "orders"}},
					},
				},
				{
					"id":               "def-2",
					"name":             "No Fixtures Template",
					"workspaceId":      "ws-2",
					"currentVersionId": "ver-2",
					"fixtures":         []map[string]any{},
				},
			},
		})
	}))
	defer srv.Close()

	client := NewPayloadTemplateSweepClient(srv.URL, "test-api-key", nil)
	result, err := client.ListDryRunSweepCandidates(context.Background())
	require.NoError(t, err)

	assert.Equal(t, http.MethodGet, gotMethod)
	assert.Equal(t, "/api/internal/template-definitions/dry-run-sweep-candidates", gotPath)
	assert.Equal(t, "test-api-key", gotAPIKey)

	require.Len(t, result, 2)
	assert.Equal(t, "def-1", result[0].DefinitionID)
	assert.Equal(t, "Service Template", result[0].Name)
	assert.Equal(t, "ws-1", result[0].WorkspaceID)
	assert.Equal(t, "ver-1", result[0].CurrentVersionID)
	require.Len(t, result[0].Fixtures, 1)
	assert.Equal(t, "fix-1", result[0].Fixtures[0].ID)
	assert.Equal(t, "Basic", result[0].Fixtures[0].Name)
	assert.Equal(t, "orders", result[0].Fixtures[0].Values["name"])

	assert.Equal(t, "def-2", result[1].DefinitionID)
	assert.Empty(t, result[1].Fixtures)
}

func TestPayloadTemplateSweepClient_ListDryRunSweepCandidates_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("boom"))
	}))
	defer srv.Close()

	client := NewPayloadTemplateSweepClient(srv.URL, "test-api-key", nil)
	_, err := client.ListDryRunSweepCandidates(context.Background())
	require.Error(t, err)
}

func TestPayloadTemplateSweepClient_TriggerDryRun_Success(t *testing.T) {
	var gotMethod, gotPath string
	var gotBody TriggerDryRunInput

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		require.NoError(t, json.NewDecoder(r.Body).Decode(&gotBody))

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"runId":          "run-1",
			"workspaceId":    "ws-1",
			"definitionJson": map[string]any{"apiVersion": "orbit/v2", "kind": "Template"},
		})
	}))
	defer srv.Close()

	client := NewPayloadTemplateSweepClient(srv.URL, "test-api-key", nil)
	result, err := client.TriggerDryRun(context.Background(), "def-1", TriggerDryRunInput{
		TemplateVersionID: "ver-1",
		Parameters:        map[string]any{"name": "orders"},
		Trigger:           "scheduled-sweep",
	})
	require.NoError(t, err)

	assert.Equal(t, http.MethodPost, gotMethod)
	assert.Equal(t, "/api/internal/template-definitions/def-1/trigger-dry-run", gotPath)
	assert.Equal(t, "ver-1", gotBody.TemplateVersionID)
	assert.Equal(t, "orders", gotBody.Parameters["name"])
	assert.Equal(t, "scheduled-sweep", gotBody.Trigger)

	assert.Equal(t, "run-1", result.RunID)
	assert.Equal(t, "ws-1", result.WorkspaceID)
	require.NotNil(t, result.DefinitionJSON)
}

func TestPayloadTemplateSweepClient_TriggerDryRun_NotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "template definition not found"})
	}))
	defer srv.Close()

	client := NewPayloadTemplateSweepClient(srv.URL, "test-api-key", nil)
	_, err := client.TriggerDryRun(context.Background(), "missing", TriggerDryRunInput{TemplateVersionID: "ver-1"})
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrTemplateDefinitionNotFound)
}

func TestPayloadTemplateSweepClient_WriteDryRunSweepResult_Success(t *testing.T) {
	var gotMethod, gotPath string
	var gotBody DryRunSweepResultInput

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		require.NoError(t, json.NewDecoder(r.Body).Decode(&gotBody))

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "drifted"})
	}))
	defer srv.Close()

	client := NewPayloadTemplateSweepClient(srv.URL, "test-api-key", nil)
	result, err := client.WriteDryRunSweepResult(context.Background(), "def-1", DryRunSweepResultInput{
		Failed:   false,
		PlanHash: "hash-1",
	})
	require.NoError(t, err)

	assert.Equal(t, http.MethodPost, gotMethod)
	assert.Equal(t, "/api/internal/template-definitions/def-1/dry-run-sweep-result", gotPath)
	assert.False(t, gotBody.Failed)
	assert.Equal(t, "hash-1", gotBody.PlanHash)
	assert.Equal(t, "drifted", result.Status)
}

func TestPayloadTemplateSweepClient_WriteDryRunSweepResult_NotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "template definition not found"})
	}))
	defer srv.Close()

	client := NewPayloadTemplateSweepClient(srv.URL, "test-api-key", nil)
	_, err := client.WriteDryRunSweepResult(context.Background(), "missing", DryRunSweepResultInput{})
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrTemplateDefinitionNotFound)
}
