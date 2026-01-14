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

func TestNewKafkaActivities(t *testing.T) {
	logger := slog.Default()
	payloadClient := clients.NewPayloadClient("http://localhost:3000", "test-key", logger)

	activities := NewKafkaActivities(payloadClient, logger)
	assert.NotNil(t, activities)
	assert.NotNil(t, activities.payloadClient)
	assert.NotNil(t, activities.logger)
}

func TestKafkaActivities_ProvisionTopic(t *testing.T) {
	t.Run("generates physical name from prefix and name", func(t *testing.T) {
		logger := slog.Default()
		payloadClient := clients.NewPayloadClient("http://localhost:3000", "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		result, err := activities.ProvisionTopic(context.Background(), KafkaTopicProvisionInput{
			TopicID:           "topic-123",
			VirtualClusterID:  "vc-456",
			TopicPrefix:       "myws-myapp-dev-",
			TopicName:         "events",
			Partitions:        3,
			ReplicationFactor: 2,
			RetentionMs:       604800000,
			CleanupPolicy:     "delete",
			Compression:       "lz4",
			BootstrapServers:  "kafka:9092",
		})

		require.NoError(t, err)
		assert.Equal(t, "topic-123", result.TopicID)
		assert.Equal(t, "myws-myapp-dev-events", result.PhysicalName)
		assert.False(t, result.ProvisionedAt.IsZero())
	})

	t.Run("handles empty prefix", func(t *testing.T) {
		logger := slog.Default()
		payloadClient := clients.NewPayloadClient("http://localhost:3000", "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		result, err := activities.ProvisionTopic(context.Background(), KafkaTopicProvisionInput{
			TopicID:          "topic-123",
			VirtualClusterID: "vc-456",
			TopicPrefix:      "",
			TopicName:        "events",
		})

		require.NoError(t, err)
		assert.Equal(t, "events", result.PhysicalName)
	})

	t.Run("handles config map", func(t *testing.T) {
		logger := slog.Default()
		payloadClient := clients.NewPayloadClient("http://localhost:3000", "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		result, err := activities.ProvisionTopic(context.Background(), KafkaTopicProvisionInput{
			TopicID:     "topic-123",
			TopicPrefix: "prefix-",
			TopicName:   "events",
			Config: map[string]string{
				"min.insync.replicas": "2",
				"max.message.bytes":   "1048576",
			},
		})

		require.NoError(t, err)
		assert.Equal(t, "prefix-events", result.PhysicalName)
	})
}

func TestKafkaActivities_UpdateTopicStatus(t *testing.T) {
	t.Run("updates status only", func(t *testing.T) {
		var capturedData map[string]any
		var capturedPath string
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			capturedPath = r.URL.Path
			json.NewDecoder(r.Body).Decode(&capturedData)
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		err := activities.UpdateTopicStatus(context.Background(), KafkaUpdateTopicStatusInput{
			TopicID: "topic-123",
			Status:  "active",
		})

		require.NoError(t, err)
		assert.Contains(t, capturedPath, "/api/kafka-topics/topic-123")
		assert.Equal(t, "active", capturedData["status"])
		assert.Nil(t, capturedData["physicalName"])
		assert.Nil(t, capturedData["provisioningError"])
	})

	t.Run("includes physical name when provided", func(t *testing.T) {
		var capturedData map[string]any
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			json.NewDecoder(r.Body).Decode(&capturedData)
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		err := activities.UpdateTopicStatus(context.Background(), KafkaUpdateTopicStatusInput{
			TopicID:      "topic-123",
			Status:       "active",
			PhysicalName: "myws-myapp-dev-events",
		})

		require.NoError(t, err)
		assert.Equal(t, "active", capturedData["status"])
		assert.Equal(t, "myws-myapp-dev-events", capturedData["physicalName"])
	})

	t.Run("includes error message when provided", func(t *testing.T) {
		var capturedData map[string]any
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			json.NewDecoder(r.Body).Decode(&capturedData)
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		err := activities.UpdateTopicStatus(context.Background(), KafkaUpdateTopicStatusInput{
			TopicID: "topic-123",
			Status:  "failed",
			Error:   "connection timeout",
		})

		require.NoError(t, err)
		assert.Equal(t, "failed", capturedData["status"])
		assert.Equal(t, "connection timeout", capturedData["provisioningError"])
	})

	t.Run("returns error on API failure", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		err := activities.UpdateTopicStatus(context.Background(), KafkaUpdateTopicStatusInput{
			TopicID: "topic-123",
			Status:  "active",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "updating topic status")
	})
}

func TestKafkaActivities_DeleteTopic(t *testing.T) {
	t.Run("returns success for stubbed implementation", func(t *testing.T) {
		logger := slog.Default()
		payloadClient := clients.NewPayloadClient("http://localhost:3000", "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		err := activities.DeleteTopic(context.Background(), "topic-123", "physical-name", "cluster-456")
		assert.NoError(t, err)
	})
}

func TestKafkaActivities_ValidateSchema(t *testing.T) {
	t.Run("returns compatible for stubbed implementation", func(t *testing.T) {
		logger := slog.Default()
		payloadClient := clients.NewPayloadClient("http://localhost:3000", "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		result, err := activities.ValidateSchema(context.Background(), KafkaSchemaValidationInput{
			SchemaID:      "schema-123",
			TopicID:       "topic-456",
			Type:          "value",
			Format:        "avro",
			Content:       `{"type": "record", "name": "test"}`,
			Compatibility: "BACKWARD",
		})

		require.NoError(t, err)
		assert.Equal(t, "schema-123", result.SchemaID)
		assert.True(t, result.IsCompatible)
		assert.False(t, result.ValidatedAt.IsZero())
	})
}

func TestKafkaActivities_RegisterSchema(t *testing.T) {
	t.Run("returns stubbed registry info", func(t *testing.T) {
		logger := slog.Default()
		payloadClient := clients.NewPayloadClient("http://localhost:3000", "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		result, err := activities.RegisterSchema(context.Background(), KafkaSchemaValidationInput{
			SchemaID: "schema-123",
			TopicID:  "topic-456",
			Type:     "value",
			Format:   "avro",
			Content:  `{"type": "record", "name": "test"}`,
		})

		require.NoError(t, err)
		assert.Equal(t, "schema-123", result.SchemaID)
		assert.Equal(t, int32(1), result.RegistryID)
		assert.Equal(t, int32(1), result.Version)
	})
}

func TestKafkaActivities_UpdateSchemaStatus(t *testing.T) {
	t.Run("updates status with registry info", func(t *testing.T) {
		var capturedData map[string]any
		var capturedPath string
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			capturedPath = r.URL.Path
			json.NewDecoder(r.Body).Decode(&capturedData)
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		err := activities.UpdateSchemaStatus(context.Background(), KafkaUpdateSchemaStatusInput{
			SchemaID:   "schema-123",
			Status:     "active",
			RegistryID: 100,
			Version:    3,
		})

		require.NoError(t, err)
		assert.Contains(t, capturedPath, "/api/kafka-schemas/schema-123")
		assert.Equal(t, "active", capturedData["status"])
		assert.Equal(t, float64(100), capturedData["registryId"])
		assert.Equal(t, float64(3), capturedData["latestVersion"])
	})

	t.Run("includes error message when provided", func(t *testing.T) {
		var capturedData map[string]any
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			json.NewDecoder(r.Body).Decode(&capturedData)
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		err := activities.UpdateSchemaStatus(context.Background(), KafkaUpdateSchemaStatusInput{
			SchemaID: "schema-123",
			Status:   "failed",
			Error:    "invalid schema format",
		})

		require.NoError(t, err)
		assert.Equal(t, "failed", capturedData["status"])
		assert.Equal(t, "invalid schema format", capturedData["registrationError"])
	})

	t.Run("omits zero registry/version", func(t *testing.T) {
		var capturedData map[string]any
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			json.NewDecoder(r.Body).Decode(&capturedData)
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		err := activities.UpdateSchemaStatus(context.Background(), KafkaUpdateSchemaStatusInput{
			SchemaID: "schema-123",
			Status:   "validating",
		})

		require.NoError(t, err)
		assert.Equal(t, "validating", capturedData["status"])
		assert.Nil(t, capturedData["registryId"])
		assert.Nil(t, capturedData["latestVersion"])
	})
}

func TestKafkaActivities_ProvisionAccess(t *testing.T) {
	t.Run("returns stubbed ACL creation", func(t *testing.T) {
		logger := slog.Default()
		payloadClient := clients.NewPayloadClient("http://localhost:3000", "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		result, err := activities.ProvisionAccess(context.Background(), KafkaAccessProvisionInput{
			ShareID:     "share-123",
			TopicID:     "topic-456",
			WorkspaceID: "ws-789",
			Permission:  "read_write",
		})

		require.NoError(t, err)
		assert.Equal(t, "share-123", result.ShareID)
		assert.Len(t, result.ACLsCreated, 1)
		assert.Contains(t, result.ACLsCreated[0], "topic-456")
		assert.Contains(t, result.ACLsCreated[0], "read_write")
		assert.False(t, result.ProvisionedAt.IsZero())
	})
}

func TestKafkaActivities_RevokeAccess(t *testing.T) {
	t.Run("returns success for stubbed implementation", func(t *testing.T) {
		logger := slog.Default()
		payloadClient := clients.NewPayloadClient("http://localhost:3000", "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		err := activities.RevokeAccess(context.Background(), "share-123", "topic-456", "ws-789")
		assert.NoError(t, err)
	})
}

func TestKafkaActivities_UpdateShareStatus(t *testing.T) {
	t.Run("updates status successfully", func(t *testing.T) {
		var capturedData map[string]any
		var capturedPath string
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			capturedPath = r.URL.Path
			json.NewDecoder(r.Body).Decode(&capturedData)
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		err := activities.UpdateShareStatus(context.Background(), KafkaUpdateShareStatusInput{
			ShareID: "share-123",
			Status:  "active",
		})

		require.NoError(t, err)
		assert.Contains(t, capturedPath, "/api/kafka-topic-shares/share-123")
		assert.Equal(t, "active", capturedData["status"])
	})

	t.Run("includes error when provided", func(t *testing.T) {
		var capturedData map[string]any
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			json.NewDecoder(r.Body).Decode(&capturedData)
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		err := activities.UpdateShareStatus(context.Background(), KafkaUpdateShareStatusInput{
			ShareID: "share-123",
			Status:  "failed",
			Error:   "ACL creation failed",
		})

		require.NoError(t, err)
		assert.Equal(t, "failed", capturedData["status"])
		assert.Equal(t, "ACL creation failed", capturedData["error"])
	})

	t.Run("returns error on API failure", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewKafkaActivities(payloadClient, logger)

		err := activities.UpdateShareStatus(context.Background(), KafkaUpdateShareStatusInput{
			ShareID: "share-123",
			Status:  "active",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "updating share status")
	})
}
