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

// TestPayloadADOConnectionClient_GetConnectionToken_ForwardsWorkspaceID is
// the regression test for the workspace-scoping fix: the client must
// include workspaceId in the request body so the internal token route can
// enforce that the connection is authorized for the caller's workspace.
func TestPayloadADOConnectionClient_GetConnectionToken_ForwardsWorkspaceID(t *testing.T) {
	var gotBody map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"provider":"azure-devops","organization":"acme","project":"proj","baseUrl":"https://dev.azure.com","authMode":"basic-pat","token":"pat-123"}`))
	}))
	defer srv.Close()

	c := NewPayloadADOConnectionClient(srv.URL, "test-key", nil)
	_, err := c.GetConnectionToken(context.Background(), "conn-1", "ws-1")
	require.NoError(t, err)
	assert.Equal(t, "conn-1", gotBody["connectionId"])
	assert.Equal(t, "ws-1", gotBody["workspaceId"])
}

// TestPayloadADOConnectionClient_GetConnectionToken_EmptyWorkspaceID_Errors
// asserts the client fails closed rather than forwarding an unscoped
// lookup: an empty workspaceID must never reach the network as a way to
// bypass the route's workspace check.
func TestPayloadADOConnectionClient_GetConnectionToken_EmptyWorkspaceID_Errors(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := NewPayloadADOConnectionClient(srv.URL, "test-key", nil)
	_, err := c.GetConnectionToken(context.Background(), "conn-1", "")
	require.Error(t, err)
	assert.False(t, called, "must not call the token route with an empty workspaceID")
}

func TestPayloadADOConnectionClient_GetConnectionToken_NotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	c := NewPayloadADOConnectionClient(srv.URL, "test-key", nil)
	_, err := c.GetConnectionToken(context.Background(), "conn-1", "ws-1")
	require.ErrorIs(t, err, ErrConnectionNotFound)
}
