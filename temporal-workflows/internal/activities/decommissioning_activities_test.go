package activities

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/temporal-workflows/internal/clients"
)

func TestDecommissioningActivities_CheckApplicationStatus(t *testing.T) {
	tests := []struct {
		name             string
		appStatus        string
		expectCanProceed bool
	}{
		{
			name:             "decommissioning status can proceed",
			appStatus:        "decommissioning",
			expectCanProceed: true,
		},
		{
			name:             "active status cannot proceed",
			appStatus:        "active",
			expectCanProceed: false,
		},
		{
			name:             "deleted status cannot proceed",
			appStatus:        "deleted",
			expectCanProceed: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]any{
					"id":     "app-123",
					"status": tt.appStatus,
				})
			}))
			defer server.Close()

			logger := slog.Default()
			payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)

			activities := NewDecommissioningActivities(
				payloadClient,
				nil, // bifrostClient
				nil, // adapterFactory
				nil, // storageClient
				nil, // temporalClient
				logger,
			)

			result, err := activities.CheckApplicationStatus(context.Background(), CheckApplicationStatusInput{
				ApplicationID: "app-123",
			})

			require.NoError(t, err)
			assert.Equal(t, tt.appStatus, result.Status)
			assert.Equal(t, tt.expectCanProceed, result.CanProceed)
		})
	}

	t.Run("returns error when application not found", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)

		activities := NewDecommissioningActivities(
			payloadClient,
			nil, nil, nil, nil,
			logger,
		)

		_, err := activities.CheckApplicationStatus(context.Background(), CheckApplicationStatusInput{
			ApplicationID: "nonexistent-app",
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "fetching application")
	})

	t.Run("returns error when application has no status field", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]any{
				"id":   "app-123",
				"name": "test-app",
				// no status field
			})
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)

		activities := NewDecommissioningActivities(
			payloadClient,
			nil, nil, nil, nil,
			logger,
		)

		_, err := activities.CheckApplicationStatus(context.Background(), CheckApplicationStatusInput{
			ApplicationID: "app-123",
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "application has no status field")
	})

	t.Run("returns error on server error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)

		activities := NewDecommissioningActivities(
			payloadClient,
			nil, nil, nil, nil,
			logger,
		)

		_, err := activities.CheckApplicationStatus(context.Background(), CheckApplicationStatusInput{
			ApplicationID: "app-123",
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "fetching application")
	})
}

func TestDecommissioningActivities_SetVirtualClustersReadOnly(t *testing.T) {
	t.Run("sets all virtual clusters to read-only", func(t *testing.T) {
		// Mock Payload server
		payloadServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet && strings.Contains(r.URL.Path, "kafka-virtual-clusters") {
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(clients.PayloadResponse{
					Docs: []map[string]any{
						{"id": "vc-1", "name": "vc-one"},
						{"id": "vc-2", "name": "vc-two"},
					},
					TotalDocs: 2,
				})
				return
			}
			w.WriteHeader(http.StatusNotFound)
		}))
		defer payloadServer.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(payloadServer.URL, "test-key", logger)

		activities := NewDecommissioningActivities(
			payloadClient,
			nil, // bifrostClient - would need mock for full test
			nil,
			nil,
			nil,
			logger,
		)

		// Test that activity queries Payload correctly
		// Without bifrostClient, it will return empty results
		result, err := activities.SetVirtualClustersReadOnly(context.Background(), SetVirtualClustersReadOnlyInput{
			ApplicationID: "app-123",
			ReadOnly:      true,
		})

		require.NoError(t, err)
		// Without Bifrost client, no VCs will be updated
		assert.False(t, result.Success)
		assert.Empty(t, result.UpdatedVirtualClusterIDs)
	})

	t.Run("returns success when no virtual clusters found", func(t *testing.T) {
		payloadServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs:      []map[string]any{},
				TotalDocs: 0,
			})
		}))
		defer payloadServer.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(payloadServer.URL, "test-key", logger)

		activities := NewDecommissioningActivities(
			payloadClient,
			nil,
			nil,
			nil,
			nil,
			logger,
		)

		result, err := activities.SetVirtualClustersReadOnly(context.Background(), SetVirtualClustersReadOnlyInput{
			ApplicationID: "app-123",
			ReadOnly:      true,
		})

		require.NoError(t, err)
		assert.True(t, result.Success)
		assert.Empty(t, result.UpdatedVirtualClusterIDs)
	})
}

func TestDecommissioningActivities_MarkApplicationDeleted(t *testing.T) {
	// Track PATCH request
	var patchCalled bool
	var patchBody map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "PATCH" && strings.Contains(r.URL.Path, "/api/kafka-applications/app-123") {
			patchCalled = true
			body, _ := io.ReadAll(r.Body)
			json.Unmarshal(body, &patchBody)
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]any{"id": "app-123", "status": "deleted"})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
	activities := NewDecommissioningActivities(payloadClient, nil, nil, nil, nil, logger)

	err := activities.MarkApplicationDeleted(context.Background(), MarkApplicationDeletedInput{
		ApplicationID: "app-123",
		DeletedBy:     "user@example.com",
		ForceDeleted:  true,
	})

	require.NoError(t, err)
	assert.True(t, patchCalled, "PATCH should be called")
	assert.Equal(t, "deleted", patchBody["status"])
	assert.Equal(t, "user@example.com", patchBody["deletedBy"])
	assert.Equal(t, true, patchBody["forceDeleted"])
	assert.NotEmpty(t, patchBody["deletedAt"])
}

func TestDecommissioningActivities_UpdateApplicationWorkflowID(t *testing.T) {
	var patchCalled bool
	var patchBody map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "PATCH" && strings.Contains(r.URL.Path, "/api/kafka-applications/app-123") {
			patchCalled = true
			body, _ := io.ReadAll(r.Body)
			json.Unmarshal(body, &patchBody)
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]any{"id": "app-123"})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
	activities := NewDecommissioningActivities(payloadClient, nil, nil, nil, nil, logger)

	err := activities.UpdateApplicationWorkflowID(context.Background(), UpdateApplicationWorkflowIDInput{
		ApplicationID: "app-123",
		WorkflowID:    "cleanup-wf-app-123-1234567890",
	})

	require.NoError(t, err)
	assert.True(t, patchCalled, "PATCH should be called")
	assert.Equal(t, "cleanup-wf-app-123-1234567890", patchBody["cleanupWorkflowId"])
}

func TestDecommissioningActivities_RevokeAllCredentials(t *testing.T) {
	t.Run("revokes all credentials and updates status", func(t *testing.T) {
		var patchedAccounts []string

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Find service accounts query
			if r.Method == "GET" && strings.Contains(r.URL.Path, "/api/kafka-service-accounts") {
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]any{
					"docs": []map[string]any{
						{"id": "sa-1", "status": "active"},
						{"id": "sa-2", "status": "active"},
					},
				})
				return
			}
			// Patch service account status
			if r.Method == "PATCH" && strings.Contains(r.URL.Path, "/api/kafka-service-accounts/") {
				parts := strings.Split(r.URL.Path, "/")
				accountID := parts[len(parts)-1]
				patchedAccounts = append(patchedAccounts, accountID)
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]any{"id": accountID, "status": "revoked"})
				return
			}
			w.WriteHeader(http.StatusNotFound)
		}))
		defer server.Close()

		logger := slog.New(slog.NewTextHandler(io.Discard, nil))
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		// BifrostClient is nil - should handle gracefully
		activities := NewDecommissioningActivities(payloadClient, nil, nil, nil, nil, logger)

		result, err := activities.RevokeAllCredentials(context.Background(), RevokeAllCredentialsInput{
			ApplicationID: "app-123",
		})

		require.NoError(t, err)
		assert.NotNil(t, result)
		assert.True(t, result.Success)
		assert.ElementsMatch(t, []string{"sa-1", "sa-2"}, result.RevokedCredentials)
		assert.Empty(t, result.FailedCredentials)
		assert.ElementsMatch(t, []string{"sa-1", "sa-2"}, patchedAccounts)
	})

	t.Run("returns success with empty results when no service accounts", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == "GET" && strings.Contains(r.URL.Path, "/api/kafka-service-accounts") {
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]any{
					"docs": []map[string]any{},
				})
				return
			}
			w.WriteHeader(http.StatusNotFound)
		}))
		defer server.Close()

		logger := slog.New(slog.NewTextHandler(io.Discard, nil))
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewDecommissioningActivities(payloadClient, nil, nil, nil, nil, logger)

		result, err := activities.RevokeAllCredentials(context.Background(), RevokeAllCredentialsInput{
			ApplicationID: "app-123",
		})

		require.NoError(t, err)
		assert.True(t, result.Success)
		assert.Empty(t, result.RevokedCredentials)
		assert.Empty(t, result.FailedCredentials)
	})

	t.Run("tracks failed updates in FailedCredentials", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == "GET" && strings.Contains(r.URL.Path, "/api/kafka-service-accounts") {
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]any{
					"docs": []map[string]any{
						{"id": "sa-1", "status": "active"},
						{"id": "sa-2", "status": "active"},
					},
				})
				return
			}
			// First account succeeds, second fails
			if r.Method == "PATCH" && strings.Contains(r.URL.Path, "/api/kafka-service-accounts/sa-1") {
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]any{"id": "sa-1", "status": "revoked"})
				return
			}
			if r.Method == "PATCH" && strings.Contains(r.URL.Path, "/api/kafka-service-accounts/sa-2") {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNotFound)
		}))
		defer server.Close()

		logger := slog.New(slog.NewTextHandler(io.Discard, nil))
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewDecommissioningActivities(payloadClient, nil, nil, nil, nil, logger)

		result, err := activities.RevokeAllCredentials(context.Background(), RevokeAllCredentialsInput{
			ApplicationID: "app-123",
		})

		require.NoError(t, err)
		assert.False(t, result.Success) // Partial failure
		assert.Equal(t, []string{"sa-1"}, result.RevokedCredentials)
		assert.Equal(t, []string{"sa-2"}, result.FailedCredentials)
	})

	t.Run("returns error when query fails", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		logger := slog.New(slog.NewTextHandler(io.Discard, nil))
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewDecommissioningActivities(payloadClient, nil, nil, nil, nil, logger)

		_, err := activities.RevokeAllCredentials(context.Background(), RevokeAllCredentialsInput{
			ApplicationID: "app-123",
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "querying service accounts")
	})
}
