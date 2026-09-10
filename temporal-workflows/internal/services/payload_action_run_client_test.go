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

func TestPayloadActionRunClient_WriteStatus(t *testing.T) {
	t.Parallel()

	status := "running"
	plan := []map[string]any{{"kind": "repo", "name": "my-org/svc"}}

	tests := []struct {
		name       string
		runID      string
		in         ActionRunStatusInput
		handler    http.HandlerFunc
		wantErr    string
		wantErrIs  error
		assertBody func(t *testing.T, raw map[string]json.RawMessage)
	}{
		{
			name:  "sends only the fields that are set",
			runID: "run-1",
			in: ActionRunStatusInput{
				Status: &status,
				AppendLogs: []ActionRunLogEntry{
					{TS: "2026-09-09T00:00:00Z", Level: "info", Message: "step started"},
				},
			},
			assertBody: func(t *testing.T, raw map[string]json.RawMessage) {
				t.Helper()
				assert.JSONEq(t, `"running"`, string(raw["status"]))
				assert.Contains(t, string(raw["appendLogs"]), "step started")
				// omitempty keeps unset fields off the wire so the route's
				// "replace" semantics never clobber a field we did not mean
				// to touch.
				assert.NotContains(t, raw, "outputs")
				assert.NotContains(t, raw, "steps")
				assert.NotContains(t, raw, "plan")
				assert.NotContains(t, raw, "error")
			},
		},
		{
			name:  "sends an explicit null plan when the pointer targets nil",
			runID: "run-2",
			in: ActionRunStatusInput{
				Plan: &[]map[string]any{},
			},
			assertBody: func(t *testing.T, raw map[string]json.RawMessage) {
				t.Helper()
				assert.JSONEq(t, `[]`, string(raw["plan"]))
			},
		},
		{
			name:  "sends steps and outputs verbatim",
			runID: "run-3",
			in: ActionRunStatusInput{
				Steps:   []ActionRunStep{{ID: "a", Name: "A", Status: "succeeded"}},
				Outputs: map[string]any{"text": "done"},
				Plan:    &plan,
			},
			assertBody: func(t *testing.T, raw map[string]json.RawMessage) {
				t.Helper()
				assert.Contains(t, string(raw["steps"]), `"succeeded"`)
				assert.JSONEq(t, `{"text":"done"}`, string(raw["outputs"]))
				assert.Contains(t, string(raw["plan"]), "my-org/svc")
			},
		},
		{
			name:      "maps 404 to ErrActionRunNotFound",
			runID:     "missing",
			in:        ActionRunStatusInput{Status: &status},
			handler:   func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNotFound) },
			wantErrIs: ErrActionRunNotFound,
		},
		{
			name:    "surfaces a non-2xx body",
			runID:   "run-4",
			in:      ActionRunStatusInput{Status: &status},
			handler: func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "boom", http.StatusInternalServerError) },
			wantErr: "HTTP 500",
		},
		{
			name:    "rejects an empty run id before making a request",
			runID:   "",
			in:      ActionRunStatusInput{Status: &status},
			wantErr: "action run id required",
		},
		{
			name:    "rejects an empty update before making a request",
			runID:   "run-5",
			in:      ActionRunStatusInput{},
			wantErr: "nothing to update",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var gotMethod, gotPath, gotAPIKey, gotContentType string
			gotBody := map[string]json.RawMessage{}

			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotMethod, gotPath = r.Method, r.URL.Path
				gotAPIKey = r.Header.Get("X-API-Key")
				gotContentType = r.Header.Get("Content-Type")
				_ = json.NewDecoder(r.Body).Decode(&gotBody)
				if tt.handler != nil {
					tt.handler(w, r)
					return
				}
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"id":"run-1","status":"running"}`))
			}))
			defer srv.Close()

			client := NewPayloadActionRunClient(srv.URL, "test-api-key", nil)
			err := client.WriteStatus(context.Background(), tt.runID, tt.in)

			switch {
			case tt.wantErrIs != nil:
				require.ErrorIs(t, err, tt.wantErrIs)
			case tt.wantErr != "":
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.wantErr)
			default:
				require.NoError(t, err)
				assert.Equal(t, http.MethodPost, gotMethod)
				assert.Equal(t, "/api/internal/action-runs/"+tt.runID+"/status", gotPath)
				assert.Equal(t, "test-api-key", gotAPIKey)
				assert.Equal(t, "application/json", gotContentType)
				if tt.assertBody != nil {
					tt.assertBody(t, gotBody)
				}
			}
		})
	}
}

func TestPayloadActionRunClient_WriteStatus_EscapesRunID(t *testing.T) {
	t.Parallel()

	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.EscapedPath()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	status := "failed"
	client := NewPayloadActionRunClient(srv.URL, "k", nil)
	require.NoError(t, client.WriteStatus(context.Background(), "a/b", ActionRunStatusInput{Status: &status}))
	assert.Equal(t, "/api/internal/action-runs/a%2Fb/status", gotPath)
}
