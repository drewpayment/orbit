package activities

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/clients"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewTopicSyncActivities(t *testing.T) {
	logger := slog.Default()
	payloadClient := clients.NewPayloadClient("http://localhost:3000", "test-key", logger)

	activities := NewTopicSyncActivities(payloadClient, logger)
	assert.NotNil(t, activities)
	assert.NotNil(t, activities.payloadClient)
	assert.NotNil(t, activities.logger)
}

func TestTopicSyncActivities_CreateTopicRecord(t *testing.T) {
	t.Run("creates new topic when not existing", func(t *testing.T) {
		callCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++
			if callCount == 1 {
				// First call: Find existing (returns empty)
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(clients.PayloadResponse{
					Docs:      []map[string]any{},
					TotalDocs: 0,
				})
			} else {
				// Second call: Create new
				w.WriteHeader(http.StatusCreated)
				json.NewEncoder(w).Encode(map[string]any{
					"doc": map[string]any{
						"id":           "topic-new-123",
						"name":         "events",
						"physicalName": "prefix-events",
						"status":       "active",
					},
				})
			}
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewTopicSyncActivities(payloadClient, logger)

		result, err := activities.CreateTopicRecord(context.Background(), CreateTopicRecordInput{
			VirtualClusterID:  "vc-123",
			VirtualName:       "events",
			PhysicalName:      "prefix-events",
			Partitions:        3,
			ReplicationFactor: 2,
			Config: map[string]string{
				"retention.ms": "604800000",
			},
			CreatedByCredentialID: "cred-456",
		})

		require.NoError(t, err)
		assert.Equal(t, "topic-new-123", result.TopicID)
		assert.Equal(t, "active", result.Status)
		assert.Equal(t, 2, callCount)
	})

	t.Run("returns existing topic when found", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs: []map[string]any{
					{
						"id":           "topic-existing-123",
						"name":         "events",
						"physicalName": "prefix-events",
						"status":       "active",
					},
				},
				TotalDocs: 1,
			})
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewTopicSyncActivities(payloadClient, logger)

		result, err := activities.CreateTopicRecord(context.Background(), CreateTopicRecordInput{
			VirtualClusterID: "vc-123",
			VirtualName:      "events",
			PhysicalName:     "prefix-events",
			Partitions:       3,
		})

		require.NoError(t, err)
		assert.Equal(t, "topic-existing-123", result.TopicID)
		assert.Equal(t, "active", result.Status)
	})

	t.Run("includes config when provided", func(t *testing.T) {
		callCount := 0
		var capturedData map[string]any
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++
			if callCount == 1 {
				// Find returns empty
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(clients.PayloadResponse{
					Docs:      []map[string]any{},
					TotalDocs: 0,
				})
			} else {
				// Create call
				json.NewDecoder(r.Body).Decode(&capturedData)
				w.WriteHeader(http.StatusCreated)
				json.NewEncoder(w).Encode(map[string]any{
					"doc": map[string]any{"id": "topic-123"},
				})
			}
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewTopicSyncActivities(payloadClient, logger)

		_, err := activities.CreateTopicRecord(context.Background(), CreateTopicRecordInput{
			VirtualClusterID: "vc-123",
			VirtualName:      "events",
			PhysicalName:     "prefix-events",
			Config: map[string]string{
				"retention.ms": "604800000",
			},
		})

		require.NoError(t, err)
		configVal, ok := capturedData["config"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "604800000", configVal["retention.ms"])
	})

	t.Run("returns error on find failure", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewTopicSyncActivities(payloadClient, logger)

		_, err := activities.CreateTopicRecord(context.Background(), CreateTopicRecordInput{
			VirtualClusterID: "vc-123",
			VirtualName:      "events",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "checking existing topic")
	})
}

func TestTopicSyncActivities_MarkTopicDeleted(t *testing.T) {
	t.Run("marks topic as deleted", func(t *testing.T) {
		callCount := 0
		var capturedData map[string]any
		var capturedPath string
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++
			if callCount == 1 {
				// Find call
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(clients.PayloadResponse{
					Docs: []map[string]any{
						{"id": "topic-123", "name": "events"},
					},
					TotalDocs: 1,
				})
			} else {
				// Update call
				capturedPath = r.URL.Path
				json.NewDecoder(r.Body).Decode(&capturedData)
				w.WriteHeader(http.StatusOK)
			}
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewTopicSyncActivities(payloadClient, logger)

		err := activities.MarkTopicDeleted(context.Background(), MarkTopicDeletedInput{
			VirtualClusterID:      "vc-123",
			VirtualName:           "events",
			PhysicalName:          "prefix-events",
			DeletedByCredentialID: "cred-456",
		})

		require.NoError(t, err)
		assert.Contains(t, capturedPath, "/api/kafka-topics/topic-123")
		assert.Equal(t, "deleted", capturedData["status"])
		assert.NotEmpty(t, capturedData["deletedAt"])
		assert.Equal(t, "cred-456", capturedData["deletedByCredential"])
	})

	t.Run("succeeds when topic not found (no-op)", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs:      []map[string]any{},
				TotalDocs: 0,
			})
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewTopicSyncActivities(payloadClient, logger)

		err := activities.MarkTopicDeleted(context.Background(), MarkTopicDeletedInput{
			VirtualClusterID: "vc-123",
			VirtualName:      "nonexistent",
		})

		assert.NoError(t, err)
	})

	t.Run("omits deletedByCredential when not provided", func(t *testing.T) {
		callCount := 0
		var capturedData map[string]any
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++
			if callCount == 1 {
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(clients.PayloadResponse{
					Docs:      []map[string]any{{"id": "topic-123"}},
					TotalDocs: 1,
				})
			} else {
				json.NewDecoder(r.Body).Decode(&capturedData)
				w.WriteHeader(http.StatusOK)
			}
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewTopicSyncActivities(payloadClient, logger)

		err := activities.MarkTopicDeleted(context.Background(), MarkTopicDeletedInput{
			VirtualClusterID: "vc-123",
			VirtualName:      "events",
		})

		require.NoError(t, err)
		assert.Nil(t, capturedData["deletedByCredential"])
	})

	t.Run("returns error on find failure", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewTopicSyncActivities(payloadClient, logger)

		err := activities.MarkTopicDeleted(context.Background(), MarkTopicDeletedInput{
			VirtualClusterID: "vc-123",
			VirtualName:      "events",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "finding topic")
	})

	t.Run("returns error on update failure", func(t *testing.T) {
		callCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++
			if callCount == 1 {
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(clients.PayloadResponse{
					Docs:      []map[string]any{{"id": "topic-123"}},
					TotalDocs: 1,
				})
			} else {
				w.WriteHeader(http.StatusInternalServerError)
			}
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewTopicSyncActivities(payloadClient, logger)

		err := activities.MarkTopicDeleted(context.Background(), MarkTopicDeletedInput{
			VirtualClusterID: "vc-123",
			VirtualName:      "events",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "marking topic as deleted")
	})
}

func TestTopicSyncActivities_UpdateTopicConfig(t *testing.T) {
	t.Run("updates topic config", func(t *testing.T) {
		callCount := 0
		var capturedData map[string]any
		var capturedPath string
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++
			if callCount == 1 {
				// Find call
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(clients.PayloadResponse{
					Docs:      []map[string]any{{"id": "topic-123"}},
					TotalDocs: 1,
				})
			} else {
				// Update call
				capturedPath = r.URL.Path
				json.NewDecoder(r.Body).Decode(&capturedData)
				w.WriteHeader(http.StatusOK)
			}
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewTopicSyncActivities(payloadClient, logger)

		err := activities.UpdateTopicConfig(context.Background(), UpdateTopicConfigInput{
			VirtualClusterID: "vc-123",
			VirtualName:      "events",
			Config: map[string]string{
				"retention.ms":    "604800000",
				"cleanup.policy":  "compact",
			},
			UpdatedByCredentialID: "cred-789",
		})

		require.NoError(t, err)
		assert.Contains(t, capturedPath, "/api/kafka-topics/topic-123")
		configVal, ok := capturedData["config"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "604800000", configVal["retention.ms"])
		assert.Equal(t, "compact", configVal["cleanup.policy"])
		assert.NotEmpty(t, capturedData["updatedAt"])
		assert.Equal(t, "cred-789", capturedData["updatedByCredential"])
	})

	t.Run("succeeds when topic not found (no-op)", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs:      []map[string]any{},
				TotalDocs: 0,
			})
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewTopicSyncActivities(payloadClient, logger)

		err := activities.UpdateTopicConfig(context.Background(), UpdateTopicConfigInput{
			VirtualClusterID: "vc-123",
			VirtualName:      "nonexistent",
			Config:          map[string]string{},
		})

		assert.NoError(t, err)
	})

	t.Run("omits updatedByCredential when not provided", func(t *testing.T) {
		callCount := 0
		var capturedData map[string]any
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++
			if callCount == 1 {
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(clients.PayloadResponse{
					Docs:      []map[string]any{{"id": "topic-123"}},
					TotalDocs: 1,
				})
			} else {
				json.NewDecoder(r.Body).Decode(&capturedData)
				w.WriteHeader(http.StatusOK)
			}
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewTopicSyncActivities(payloadClient, logger)

		err := activities.UpdateTopicConfig(context.Background(), UpdateTopicConfigInput{
			VirtualClusterID: "vc-123",
			VirtualName:      "events",
			Config:          map[string]string{"key": "value"},
		})

		require.NoError(t, err)
		assert.Nil(t, capturedData["updatedByCredential"])
	})

	t.Run("returns error on find failure", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewTopicSyncActivities(payloadClient, logger)

		err := activities.UpdateTopicConfig(context.Background(), UpdateTopicConfigInput{
			VirtualClusterID: "vc-123",
			VirtualName:      "events",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "finding topic")
	})

	t.Run("returns error on update failure", func(t *testing.T) {
		callCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++
			if callCount == 1 {
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(clients.PayloadResponse{
					Docs:      []map[string]any{{"id": "topic-123"}},
					TotalDocs: 1,
				})
			} else {
				w.WriteHeader(http.StatusInternalServerError)
			}
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewTopicSyncActivities(payloadClient, logger)

		err := activities.UpdateTopicConfig(context.Background(), UpdateTopicConfigInput{
			VirtualClusterID: "vc-123",
			VirtualName:      "events",
			Config:          map[string]string{"key": "value"},
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "updating topic config")
	})
}
