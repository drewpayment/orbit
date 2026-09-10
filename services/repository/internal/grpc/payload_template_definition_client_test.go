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

const validDefinition = `{"apiVersion":"orbit/v2","kind":"Template","metadata":{"name":"svc","title":"Service","owner":"platform"},"spec":{"parameters":[],"steps":[]}}`

func TestPayloadTemplateDefinitionClient_GetDefinitionVersion(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		versionID string
		handler   http.HandlerFunc
		wantErr   string
		wantErrIs error
		assert    func(t *testing.T, got *TemplateDefinitionVersionData)
	}{
		{
			name:      "decodes the version envelope",
			versionID: "ver-1",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(`{"version":{"id":"ver-1","definition":"def-1","workspace":"ws-1","versionNumber":3,"definitionJson":` + validDefinition + `}}`))
			},
			assert: func(t *testing.T, got *TemplateDefinitionVersionData) {
				t.Helper()
				assert.Equal(t, "ver-1", got.ID)
				assert.Equal(t, "def-1", got.DefinitionID)
				assert.Equal(t, "ws-1", got.WorkspaceID)
				assert.Equal(t, 3, got.VersionNumber)
				assert.JSONEq(t, validDefinition, string(got.DefinitionJSON))
			},
		},
		{
			name:      "maps 404 to ErrTemplateDefinitionVersionNotFound",
			versionID: "missing",
			// The route's own 404 carries its {"error": …} body; a bodyless
			// 404 means the route is absent (see the absent-route test).
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"error":"template definition version not found"}`))
			},
			wantErrIs: ErrTemplateDefinitionVersionNotFound,
		},
		{
			name:      "rejects a v1 document",
			versionID: "ver-2",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(`{"version":{"id":"ver-2","definitionJson":{"apiVersion":"orbit/v1","kind":"Template"}}}`))
			},
			wantErr: `unsupported apiVersion "orbit/v1"`,
		},
		{
			name:      "rejects an unexpected kind",
			versionID: "ver-3",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(`{"version":{"id":"ver-3","definitionJson":{"apiVersion":"orbit/v2","kind":"Pattern"}}}`))
			},
			wantErr: `unsupported kind "Pattern"`,
		},
		{
			name:      "rejects a missing definitionJson",
			versionID: "ver-4",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(`{"version":{"id":"ver-4"}}`))
			},
			wantErr: "definitionJson is empty",
		},
		{
			name:      "surfaces a non-2xx body",
			versionID: "ver-5",
			handler:   func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "nope", http.StatusInternalServerError) },
			wantErr:   "HTTP 500",
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

			client := NewPayloadTemplateDefinitionClient(srv.URL, "test-api-key")
			got, err := client.GetDefinitionVersion(context.Background(), tt.versionID)

			switch {
			case tt.wantErrIs != nil:
				require.True(t, errors.Is(err, tt.wantErrIs), "got %v", err)
			case tt.wantErr != "":
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.wantErr)
			default:
				require.NoError(t, err)
				assert.Equal(t, http.MethodGet, gotMethod)
				assert.Equal(t, "/api/internal/template-definition-versions/"+tt.versionID, gotPath)
				assert.Equal(t, "test-api-key", gotAPIKey)
				tt.assert(t, got)
			}
		})
	}
}

func TestPayloadTemplateDefinitionClient_RejectsAnEmptyID(t *testing.T) {
	t.Parallel()
	client := NewPayloadTemplateDefinitionClient("http://unused", "k")
	_, err := client.GetDefinitionVersion(context.Background(), "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "id required")
}

func TestPayloadTemplateDefinitionClient_DistinguishesAnAbsentRoute(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("<!DOCTYPE html><html><body>404</body></html>"))
	}))
	defer srv.Close()

	client := NewPayloadTemplateDefinitionClient(srv.URL, "k")
	_, err := client.GetDefinitionVersion(context.Background(), "ver-1")
	require.True(t, errors.Is(err, ErrIdentityRouteUnavailable), "got %v", err)
	require.False(t, errors.Is(err, ErrTemplateDefinitionVersionNotFound))
}
