package grpc

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPayloadActionRunClient_GetActionRun(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		runID     string
		handler   http.HandlerFunc
		wantErr   string
		wantErrIs error
		assert    func(t *testing.T, got *ActionRunData)
	}{
		{
			name:  "decodes a fully populated run",
			runID: "0123456789abcdef01234567",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(`{"run":{
					"id":"0123456789abcdef01234567",
					"workspace":{"id":"ws-1","slug":"acme","name":"Acme Inc"},
					"templateVersion":"ver-1",
					"dryRun":true,
					"status":"pending",
					"triggeredBy":{"id":"user-1","email":"dev@acme.test","name":"Dev"}
				}}`))
			},
			assert: func(t *testing.T, got *ActionRunData) {
				t.Helper()
				assert.Equal(t, "0123456789abcdef01234567", got.ID)
				assert.Equal(t, "ws-1", got.Workspace.ID)
				assert.Equal(t, "acme", got.Workspace.Slug)
				assert.Equal(t, "Acme Inc", got.Workspace.Name)
				assert.Equal(t, "ver-1", got.TemplateVersionID)
				assert.True(t, got.DryRun)
				assert.Equal(t, "pending", got.Status)
				require.NotNil(t, got.TriggeredBy)
				assert.Equal(t, "user-1", got.TriggeredBy.ID)
				assert.Equal(t, "dev@acme.test", got.TriggeredBy.Email)
				assert.Equal(t, "Dev", got.TriggeredBy.Name)
			},
		},
		{
			name:  "tolerates the unpopulated shape",
			runID: "run-2",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				// The route flattens a bare relationship id to
				// {id, slug: null, name: null}; nulls must not break decoding.
				_, _ = w.Write([]byte(`{"run":{
					"id":"run-2",
					"workspace":{"id":"ws-1","slug":null,"name":null},
					"templateVersion":null,
					"dryRun":false,
					"status":"running",
					"triggeredBy":null
				}}`))
			},
			assert: func(t *testing.T, got *ActionRunData) {
				t.Helper()
				assert.Equal(t, "ws-1", got.Workspace.ID)
				assert.Empty(t, got.Workspace.Slug)
				assert.Empty(t, got.Workspace.Name)
				assert.Empty(t, got.TemplateVersionID)
				assert.False(t, got.DryRun)
				assert.Nil(t, got.TriggeredBy, "an automation-triggered run has no user")
			},
		},
		{
			name:  "tolerates a triggeredBy with null contact fields",
			runID: "run-3",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(`{"run":{"id":"run-3","workspace":{"id":"ws-1"},"status":"pending","triggeredBy":{"id":"user-1","email":null,"name":null}}}`))
			},
			assert: func(t *testing.T, got *ActionRunData) {
				t.Helper()
				require.NotNil(t, got.TriggeredBy)
				assert.Equal(t, "user-1", got.TriggeredBy.ID)
				assert.Empty(t, got.TriggeredBy.Email)
			},
		},
		{
			name:      "maps 404 to ErrActionRunNotFound",
			runID:     "missing",
			handler:   func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNotFound) },
			wantErrIs: ErrActionRunNotFound,
		},
		{
			name:    "rejects a response with no run",
			runID:   "run-4",
			handler: func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{}`)) },
			wantErr: "carried no run",
		},
		{
			name:    "surfaces a non-2xx body",
			runID:   "run-5",
			handler: func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "nope", http.StatusInternalServerError) },
			wantErr: "HTTP 500",
		},
		{
			name:    "surfaces a 401 rather than treating it as absent",
			runID:   "run-6",
			handler: func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "unauthorized", http.StatusUnauthorized) },
			wantErr: "HTTP 401",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var gotMethod, gotPath, gotAPIKey string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotMethod, gotPath = r.Method, r.URL.Path
				gotAPIKey = r.Header.Get("X-API-Key")
				tt.handler(w, r)
			}))
			defer srv.Close()

			client := NewPayloadActionRunClient(srv.URL, "test-api-key")
			got, err := client.GetActionRun(context.Background(), tt.runID)

			switch {
			case tt.wantErrIs != nil:
				require.True(t, errors.Is(err, tt.wantErrIs), "got %v", err)
			case tt.wantErr != "":
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.wantErr)
			default:
				require.NoError(t, err)
				assert.Equal(t, http.MethodGet, gotMethod)
				assert.Equal(t, "/api/internal/action-runs/"+tt.runID, gotPath)
				assert.Equal(t, "test-api-key", gotAPIKey)
				tt.assert(t, got)
			}
		})
	}
}

func TestPayloadActionRunClient_RejectsAnEmptyID(t *testing.T) {
	t.Parallel()
	client := NewPayloadActionRunClient("http://unused", "k")
	_, err := client.GetActionRun(context.Background(), "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "id required")
}
