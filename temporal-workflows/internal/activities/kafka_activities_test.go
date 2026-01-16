package activities

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/drewpayment/orbit/services/kafka/pkg/adapters"
	"github.com/drewpayment/orbit/temporal-workflows/internal/clients"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewKafkaActivities(t *testing.T) {
	logger := slog.Default()
	payloadClient := clients.NewPayloadClient("http://localhost:3000", "test-key", logger)
	adapterFactory := clients.NewKafkaAdapterFactory(payloadClient)

	activities := NewKafkaActivities(payloadClient, adapterFactory, logger)
	assert.NotNil(t, activities)
	assert.NotNil(t, activities.payloadClient)
	assert.NotNil(t, activities.adapterFactory)
	assert.NotNil(t, activities.logger)
}

func TestKafkaActivities_ProvisionTopic(t *testing.T) {
	t.Run("returns error when bootstrap servers missing", func(t *testing.T) {
		logger := slog.Default()
		payloadClient := clients.NewPayloadClient("http://localhost:3000", "test-key", logger)
		adapterFactory := clients.NewKafkaAdapterFactory(payloadClient)
		activities := NewKafkaActivities(payloadClient, adapterFactory, logger)

		_, err := activities.ProvisionTopic(context.Background(), KafkaTopicProvisionInput{
			TopicID:          "topic-123",
			VirtualClusterID: "vc-456",
			TopicPrefix:      "myws-myapp-dev-",
			TopicName:        "events",
			Partitions:       3,
			// BootstrapServers not provided
		})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "bootstrap servers required")
	})

	// Note: Tests that verify actual topic creation require a real Kafka cluster.
	// Those tests should be in an integration test file.
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
		adapterFactory := clients.NewKafkaAdapterFactory(payloadClient)
		activities := NewKafkaActivities(payloadClient, adapterFactory, logger)

		err := activities.UpdateTopicStatus(context.Background(), KafkaUpdateTopicStatusInput{
			TopicID: "topic-123",
			Status:  "active",
		})

		require.NoError(t, err)
		assert.Contains(t, capturedPath, "/kafka-topics/topic-123")
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
		adapterFactory := clients.NewKafkaAdapterFactory(payloadClient)
		activities := NewKafkaActivities(payloadClient, adapterFactory, logger)

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
		adapterFactory := clients.NewKafkaAdapterFactory(payloadClient)
		activities := NewKafkaActivities(payloadClient, adapterFactory, logger)

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
		adapterFactory := clients.NewKafkaAdapterFactory(payloadClient)
		activities := NewKafkaActivities(payloadClient, adapterFactory, logger)

		err := activities.UpdateTopicStatus(context.Background(), KafkaUpdateTopicStatusInput{
			TopicID: "topic-123",
			Status:  "active",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "updating topic status")
	})
}

func TestKafkaActivities_DeleteTopic(t *testing.T) {
	// Note: DeleteTopic now requires a real Kafka cluster connection through the adapter.
	// Tests that verify actual topic deletion should be in an integration test file.
	// Unit tests here can only verify error handling for missing configuration.
}

func TestKafkaActivities_ValidateSchema(t *testing.T) {
	// Note: ValidateSchema now requires a real Schema Registry connection through the adapter.
	// Tests that verify actual schema validation should be in an integration test file.
}

func TestMapSchemaFormat(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"avro", "AVRO"},
		{"protobuf", "PROTOBUF"},
		{"json", "JSON"},
		{"unknown", "AVRO"}, // default
		{"", "AVRO"},        // default
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			result := mapSchemaFormat(tc.input)
			assert.Equal(t, tc.expected, result)
		})
	}
}

func TestKafkaActivities_RegisterSchema(t *testing.T) {
	// Note: RegisterSchema now requires a real Schema Registry connection through the adapter.
	// Tests that verify actual schema registration should be in an integration test file.
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
		adapterFactory := clients.NewKafkaAdapterFactory(payloadClient)
		activities := NewKafkaActivities(payloadClient, adapterFactory, logger)

		err := activities.UpdateSchemaStatus(context.Background(), KafkaUpdateSchemaStatusInput{
			SchemaID:   "schema-123",
			Status:     "active",
			RegistryID: 100,
			Version:    3,
		})

		require.NoError(t, err)
		assert.Contains(t, capturedPath, "/kafka-schemas/schema-123")
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
		adapterFactory := clients.NewKafkaAdapterFactory(payloadClient)
		activities := NewKafkaActivities(payloadClient, adapterFactory, logger)

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
		adapterFactory := clients.NewKafkaAdapterFactory(payloadClient)
		activities := NewKafkaActivities(payloadClient, adapterFactory, logger)

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
	// Note: ProvisionAccess now requires a real Kafka cluster connection through the adapter.
	// Tests that verify actual ACL creation should be in an integration test file.
}

func TestBuildACLsForPermission(t *testing.T) {
	t.Run("read permission creates DESCRIBE and READ ACLs", func(t *testing.T) {
		acls := buildACLsForPermission("User:test-user", "test-topic", "read")

		assert.Len(t, acls, 2)

		// First ACL should be DESCRIBE
		assert.Equal(t, "test-topic", acls[0].ResourceName)
		assert.Equal(t, "User:test-user", acls[0].Principal)
		assert.Equal(t, adapters.ACLOperationDescribe, acls[0].Operation)

		// Second ACL should be READ
		assert.Equal(t, adapters.ACLOperationRead, acls[1].Operation)
	})

	t.Run("write permission creates DESCRIBE and WRITE ACLs", func(t *testing.T) {
		acls := buildACLsForPermission("User:test-user", "test-topic", "write")

		assert.Len(t, acls, 2)

		// First ACL should be DESCRIBE
		assert.Equal(t, adapters.ACLOperationDescribe, acls[0].Operation)

		// Second ACL should be WRITE
		assert.Equal(t, adapters.ACLOperationWrite, acls[1].Operation)
	})

	t.Run("read_write permission creates DESCRIBE, READ, and WRITE ACLs", func(t *testing.T) {
		acls := buildACLsForPermission("User:test-user", "test-topic", "read_write")

		assert.Len(t, acls, 3)

		// Should have DESCRIBE, READ, and WRITE
		ops := make([]adapters.ACLOperation, len(acls))
		for i, acl := range acls {
			ops[i] = acl.Operation
		}
		assert.Contains(t, ops, adapters.ACLOperationDescribe)
		assert.Contains(t, ops, adapters.ACLOperationRead)
		assert.Contains(t, ops, adapters.ACLOperationWrite)
	})

	t.Run("unknown permission only creates DESCRIBE ACL", func(t *testing.T) {
		acls := buildACLsForPermission("User:test-user", "test-topic", "unknown")

		assert.Len(t, acls, 1)
		assert.Equal(t, adapters.ACLOperationDescribe, acls[0].Operation)
	})
}

func TestKafkaActivities_RevokeAccess(t *testing.T) {
	// Note: RevokeAccess now requires a real Kafka cluster connection through the adapter.
	// Tests that verify actual ACL deletion should be in an integration test file.
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
		adapterFactory := clients.NewKafkaAdapterFactory(payloadClient)
		activities := NewKafkaActivities(payloadClient, adapterFactory, logger)

		err := activities.UpdateShareStatus(context.Background(), KafkaUpdateShareStatusInput{
			ShareID: "share-123",
			Status:  "active",
		})

		require.NoError(t, err)
		assert.Contains(t, capturedPath, "/kafka-topic-shares/share-123")
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
		adapterFactory := clients.NewKafkaAdapterFactory(payloadClient)
		activities := NewKafkaActivities(payloadClient, adapterFactory, logger)

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
		adapterFactory := clients.NewKafkaAdapterFactory(payloadClient)
		activities := NewKafkaActivities(payloadClient, adapterFactory, logger)

		err := activities.UpdateShareStatus(context.Background(), KafkaUpdateShareStatusInput{
			ShareID: "share-123",
			Status:  "active",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "updating share status")
	})
}
