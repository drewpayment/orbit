package services

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const sampleDefinitionJSON = `{
  "apiVersion": "orbit/v2",
  "kind": "Template",
  "metadata": {"name": "svc", "title": "Service", "owner": "platform"},
  "spec": {"parameters": [], "steps": [{"id": "log", "name": "Log", "action": "debug:log", "input": {"message": "hi"}}]}
}`

func TestPayloadTemplateDefinitionClient_GetVersion(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		versionID string
		handler   http.HandlerFunc
		wantErr   string
		wantErrIs error
		assert    func(t *testing.T, got *TemplateDefinitionVersion)
	}{
		{
			name:      "decodes the version envelope",
			versionID: "ver-1",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"version":{"id":"ver-1","definition":"def-1","workspace":"ws-1","versionNumber":3,"definitionJson":` + sampleDefinitionJSON + `}}`))
			},
			assert: func(t *testing.T, got *TemplateDefinitionVersion) {
				t.Helper()
				assert.Equal(t, "ver-1", got.ID)
				assert.Equal(t, "def-1", got.DefinitionID)
				assert.Equal(t, "ws-1", got.WorkspaceID)
				assert.Equal(t, 3, got.VersionNumber)
				assert.Equal(t, "orbit/v2", got.Definition.APIVersion)
				assert.Equal(t, "Template", got.Definition.Kind)
				require.Len(t, got.Definition.Spec.Steps, 1)
				assert.Equal(t, "debug:log", got.Definition.Spec.Steps[0].Action)
			},
		},
		{
			name:      "maps 404 to ErrTemplateDefinitionVersionNotFound",
			versionID: "missing",
			handler:   func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNotFound) },
			wantErrIs: ErrTemplateDefinitionVersionNotFound,
		},
		{
			name:      "rejects a definitionJson that is not a v2 document",
			versionID: "ver-2",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(`{"version":{"id":"ver-2","definitionJson":{"apiVersion":"orbit/v1","kind":"Template"}}}`))
			},
			wantErr: `unsupported apiVersion "orbit/v1"`,
		},
		{
			name:      "rejects a missing definitionJson",
			versionID: "ver-3",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(`{"version":{"id":"ver-3"}}`))
			},
			wantErr: "definitionJson is empty",
		},
		{
			name:      "surfaces a non-2xx body",
			versionID: "ver-4",
			handler:   func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "nope", http.StatusInternalServerError) },
			wantErr:   "HTTP 500",
		},
		{
			name:      "rejects an empty id before making a request",
			versionID: "",
			wantErr:   "template definition version id required",
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

			client := NewPayloadTemplateDefinitionClient(srv.URL, "test-api-key", nil)
			got, err := client.GetVersion(context.Background(), tt.versionID)

			switch {
			case tt.wantErrIs != nil:
				require.ErrorIs(t, err, tt.wantErrIs)
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
