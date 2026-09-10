package services

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPayloadApiSchemaClient_RegisterSchema(t *testing.T) {
	t.Parallel()

	var gotMethod, gotPath, gotAPIKey, gotContentType string
	gotBody := map[string]json.RawMessage{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		gotAPIKey = r.Header.Get("X-API-Key")
		gotContentType = r.Header.Get("Content-Type")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"schemaId":"schema-1","versionId":"ver-1","slug":"orders-api"}`))
	}))
	defer srv.Close()

	client := NewPayloadApiSchemaClient(srv.URL, "test-api-key", nil)
	result, err := client.RegisterSchema(context.Background(), ApiSchemaRegisterInput{
		WorkspaceID: "ws-1",
		UserID:      "user-1",
		Name:        "Orders API",
		SchemaType:  "openapi",
		Content:     "openapi: 3.1.0",
		Description: "desc",
		Visibility:  "workspace",
		Source:      ApiSchemaSource{Type: "scaffolder-run", SourceID: "run-1"},
	})
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "schema-1", result.SchemaID)
	assert.Equal(t, "ver-1", result.VersionID)
	assert.Equal(t, "orders-api", result.Slug)

	assert.Equal(t, http.MethodPost, gotMethod)
	assert.Equal(t, "/api/internal/api-schemas", gotPath)
	assert.Equal(t, "test-api-key", gotAPIKey)
	assert.Equal(t, "application/json", gotContentType)
	assert.JSONEq(t, `"ws-1"`, string(gotBody["workspaceId"]))
	assert.JSONEq(t, `"Orders API"`, string(gotBody["name"]))
	assert.JSONEq(t, `"openapi"`, string(gotBody["schemaType"]))
	assert.JSONEq(t, `{"type":"scaffolder-run","sourceId":"run-1"}`, string(gotBody["source"]))
}

func TestPayloadApiSchemaClient_MapsNotFoundToSentinel(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	client := NewPayloadApiSchemaClient(srv.URL, "k", nil)
	_, err := client.RegisterSchema(context.Background(), ApiSchemaRegisterInput{
		WorkspaceID: "ws-1", UserID: "user-1", Name: "n", SchemaType: "openapi", Content: "c",
	})
	require.ErrorIs(t, err, ErrApiSchemasAPINotImplemented)
}

func TestPayloadApiSchemaClient_SurfacesNon2xxBody(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()

	client := NewPayloadApiSchemaClient(srv.URL, "k", nil)
	_, err := client.RegisterSchema(context.Background(), ApiSchemaRegisterInput{
		WorkspaceID: "ws-1", UserID: "user-1", Name: "n", SchemaType: "openapi", Content: "c",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "HTTP 500")
	// A 500 is transient — the route did not reject the request as sent —
	// so it must NOT be classified as ErrApiSchemasBadRequest.
	assert.False(t, errors.Is(err, ErrApiSchemasBadRequest))
}

func TestPayloadApiSchemaClient_Maps4xxToBadRequestSentinel(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		status int
	}{
		{"400 malformed body", http.StatusBadRequest},
		{"422 unknown workspace", http.StatusUnprocessableEntity},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, `{"error":"boom"}`, tt.status)
			}))
			defer srv.Close()

			client := NewPayloadApiSchemaClient(srv.URL, "k", nil)
			_, err := client.RegisterSchema(context.Background(), ApiSchemaRegisterInput{
				WorkspaceID: "ws-1", UserID: "user-1", Name: "n", SchemaType: "openapi", Content: "c",
			})
			require.Error(t, err)
			assert.True(t, errors.Is(err, ErrApiSchemasBadRequest))
		})
	}
}

func TestPayloadApiSchemaClient_RejectsMissingFieldsBeforeRequest(t *testing.T) {
	t.Parallel()

	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	client := NewPayloadApiSchemaClient(srv.URL, "k", nil)

	tests := []struct {
		name string
		in   ApiSchemaRegisterInput
		want string
	}{
		{"missing workspace", ApiSchemaRegisterInput{UserID: "u", Name: "n", SchemaType: "openapi", Content: "c"}, "workspace id required"},
		{"missing user", ApiSchemaRegisterInput{WorkspaceID: "ws", Name: "n", SchemaType: "openapi", Content: "c"}, "user id required"},
		{"missing name", ApiSchemaRegisterInput{WorkspaceID: "ws", UserID: "u", SchemaType: "openapi", Content: "c"}, "name required"},
		{"missing schemaType", ApiSchemaRegisterInput{WorkspaceID: "ws", UserID: "u", Name: "n", Content: "c"}, "schemaType required"},
		{"missing content", ApiSchemaRegisterInput{WorkspaceID: "ws", UserID: "u", Name: "n", SchemaType: "openapi"}, "content required"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := client.RegisterSchema(context.Background(), tt.in)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.want)
		})
	}
	assert.False(t, called, "no HTTP request should be made when input validation fails")
}
