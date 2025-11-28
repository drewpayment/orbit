package services

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPayloadTokenService_GetInstallationToken_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "/api/internal/github/token", r.URL.Path)
		assert.Equal(t, "test-api-key", r.Header.Get("X-API-Key"))

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"token": "ghs_test_token_12345", "expiresAt": "2025-01-28T12:00:00Z"}`))
	}))
	defer server.Close()

	svc := NewPayloadTokenService(server.URL, "test-api-key")

	token, err := svc.GetInstallationToken(context.Background(), "12345")

	require.NoError(t, err)
	assert.Equal(t, "ghs_test_token_12345", token)
}

func TestPayloadTokenService_GetInstallationToken_Unauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error": "Unauthorized", "code": "UNAUTHORIZED"}`))
	}))
	defer server.Close()

	svc := NewPayloadTokenService(server.URL, "wrong-key")

	_, err := svc.GetInstallationToken(context.Background(), "12345")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "unauthorized")
}

func TestPayloadTokenService_GetInstallationToken_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"error": "Installation not found", "code": "NOT_FOUND"}`))
	}))
	defer server.Close()

	svc := NewPayloadTokenService(server.URL, "test-api-key")

	_, err := svc.GetInstallationToken(context.Background(), "99999")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestPayloadTokenService_GetInstallationToken_Expired(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusGone)
		w.Write([]byte(`{"error": "Token expired", "code": "EXPIRED"}`))
	}))
	defer server.Close()

	svc := NewPayloadTokenService(server.URL, "test-api-key")

	_, err := svc.GetInstallationToken(context.Background(), "12345")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "expired")
}
