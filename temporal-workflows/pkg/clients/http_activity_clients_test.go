package clients

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/temporal"
)

func TestRefreshGitHubInstallationTokenActivity_SendsAPIKey(t *testing.T) {
	var gotKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("X-API-Key")
		_, _ = w.Write([]byte(`{"Success":true,"ExpiresAt":"2030-01-01T00:00:00Z","ErrorMessage":""}`))
	}))
	defer srv.Close()

	c := NewHTTPActivityClientsWithAuth(srv.URL, "secret")
	res, err := c.RefreshGitHubInstallationTokenActivity(context.Background(), "inst-1")
	require.NoError(t, err)
	assert.True(t, res.Success)
	assert.Equal(t, "secret", gotKey)
}

func TestUpdateInstallationStatusActivity_SendsAPIKey(t *testing.T) {
	var gotKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("X-API-Key")
		_, _ = w.Write([]byte(`{"success":true}`))
	}))
	defer srv.Close()

	c := NewHTTPActivityClientsWithAuth(srv.URL, "secret")
	require.NoError(t, c.UpdateInstallationStatusActivity(context.Background(), "inst-1", "active", ""))
	assert.Equal(t, "secret", gotKey)
}

// A 401 from the route's API-key gate means the worker is misconfigured, not that
// the GitHub installation needs reconnecting. It must be retryable so a bad key
// never escalates every installation to needs_reconnect.
func TestRefreshGitHubInstallationTokenActivity_GateUnauthorizedIsRetryable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"Unauthorized","code":"UNAUTHORIZED"}`))
	}))
	defer srv.Close()

	c := NewHTTPActivityClientsWithAuth(srv.URL, "wrong")
	_, err := c.RefreshGitHubInstallationTokenActivity(context.Background(), "inst-1")
	require.Error(t, err)
	var appErr *temporal.ApplicationError
	if errors.As(err, &appErr) {
		assert.False(t, appErr.NonRetryable())
	}
}

// A GitHub-level 401 (BAD_CREDENTIALS) stays terminal.
func TestRefreshGitHubInstallationTokenActivity_GitHubBadCredentialsStaysTerminal(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"Success":false,"code":"BAD_CREDENTIALS","terminal":true}`))
	}))
	defer srv.Close()

	c := NewHTTPActivityClientsWithAuth(srv.URL, "secret")
	_, err := c.RefreshGitHubInstallationTokenActivity(context.Background(), "inst-1")
	var appErr *temporal.ApplicationError
	require.ErrorAs(t, err, &appErr)
	assert.True(t, appErr.NonRetryable())
}
