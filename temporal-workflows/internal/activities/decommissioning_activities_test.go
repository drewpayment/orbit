package activities

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
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
