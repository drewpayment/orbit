package activities

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/clients"
	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// mockBifrostServer for testing
type mockBifrostServer struct {
	gatewayv1.UnimplementedBifrostAdminServiceServer
	upsertVCError      error
	lastUpsertVCConfig *gatewayv1.VirtualClusterConfig
}

func (m *mockBifrostServer) UpsertVirtualCluster(ctx context.Context, req *gatewayv1.UpsertVirtualClusterRequest) (*gatewayv1.UpsertVirtualClusterResponse, error) {
	m.lastUpsertVCConfig = req.GetConfig()
	if m.upsertVCError != nil {
		return nil, m.upsertVCError
	}
	return &gatewayv1.UpsertVirtualClusterResponse{Success: true}, nil
}

// setupBifrostTestServer creates a test gRPC server and returns a connected BifrostClient
func setupBifrostTestServer(t *testing.T) (*clients.BifrostClient, *mockBifrostServer, func()) {
	t.Helper()

	lis, err := net.Listen("tcp", "localhost:0")
	require.NoError(t, err)

	mock := &mockBifrostServer{}
	server := grpc.NewServer()
	gatewayv1.RegisterBifrostAdminServiceServer(server, mock)

	go func() {
		_ = server.Serve(lis)
	}()

	logger := slog.Default()
	conn, err := grpc.NewClient(lis.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err)

	// Create BifrostClient using internal structure
	client := &clients.BifrostClient{}
	// We need to use reflection or create a test constructor since fields are unexported
	// For now, we'll create the client via NewBifrostClient with the test server address
	client, err = clients.NewBifrostClient(lis.Addr().String(), logger)
	require.NoError(t, err)
	conn.Close() // Close the duplicate connection

	cleanup := func() {
		client.Close()
		server.Stop()
		lis.Close()
	}

	return client, mock, cleanup
}

func TestNewVirtualClusterActivities(t *testing.T) {
	logger := slog.Default()
	payloadClient := clients.NewPayloadClient("http://localhost:3000", "test-key", logger)

	activities := NewVirtualClusterActivities(payloadClient, nil, logger)
	assert.NotNil(t, activities)
	assert.NotNil(t, activities.payloadClient)
	assert.NotNil(t, activities.logger)
}

func TestVirtualClusterActivities_GetEnvironmentMapping(t *testing.T) {
	t.Run("successful mapping with populated cluster", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs: []map[string]any{
					{
						"id":          "mapping-123",
						"environment": "development",
						"isDefault":   true,
						"cluster": map[string]any{
							"id": "cluster-456",
							"connectionConfig": map[string]any{
								"bootstrapServers": "kafka:9092",
							},
						},
					},
				},
				TotalDocs: 1,
			})
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewVirtualClusterActivities(payloadClient, nil, logger)

		result, err := activities.GetEnvironmentMapping(context.Background(), GetEnvironmentMappingInput{
			Environment: "development",
		})

		require.NoError(t, err)
		assert.Equal(t, "cluster-456", result.ClusterID)
		assert.Equal(t, "kafka:9092", result.BootstrapServers)
	})

	t.Run("successful mapping with cluster ID reference", func(t *testing.T) {
		callCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			callCount++
			w.WriteHeader(http.StatusOK)

			if callCount == 1 {
				// First call: Find environment mapping
				json.NewEncoder(w).Encode(clients.PayloadResponse{
					Docs: []map[string]any{
						{
							"id":          "mapping-123",
							"environment": "development",
							"isDefault":   true,
							"cluster":     "cluster-456", // Just an ID reference
						},
					},
					TotalDocs: 1,
				})
			} else {
				// Second call: Get cluster by ID
				json.NewEncoder(w).Encode(map[string]any{
					"id": "cluster-456",
					"connectionConfig": map[string]any{
						"bootstrapServers": "kafka:9092",
					},
				})
			}
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewVirtualClusterActivities(payloadClient, nil, logger)

		result, err := activities.GetEnvironmentMapping(context.Background(), GetEnvironmentMappingInput{
			Environment: "development",
		})

		require.NoError(t, err)
		assert.Equal(t, "cluster-456", result.ClusterID)
		assert.Equal(t, "kafka:9092", result.BootstrapServers)
	})

	t.Run("no mapping found", func(t *testing.T) {
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
		activities := NewVirtualClusterActivities(payloadClient, nil, logger)

		_, err := activities.GetEnvironmentMapping(context.Background(), GetEnvironmentMappingInput{
			Environment: "production",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "no default cluster mapping found")
	})

	t.Run("invalid cluster field", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs: []map[string]any{
					{
						"id":          "mapping-123",
						"environment": "development",
						"isDefault":   true,
						"cluster":     12345, // Invalid type
					},
				},
				TotalDocs: 1,
			})
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewVirtualClusterActivities(payloadClient, nil, logger)

		_, err := activities.GetEnvironmentMapping(context.Background(), GetEnvironmentMappingInput{
			Environment: "development",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid cluster field")
	})

	t.Run("missing bootstrap servers", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs: []map[string]any{
					{
						"id":          "mapping-123",
						"environment": "development",
						"isDefault":   true,
						"cluster": map[string]any{
							"id":               "cluster-456",
							"connectionConfig": map[string]any{},
						},
					},
				},
				TotalDocs: 1,
			})
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewVirtualClusterActivities(payloadClient, nil, logger)

		_, err := activities.GetEnvironmentMapping(context.Background(), GetEnvironmentMappingInput{
			Environment: "development",
		})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "no bootstrapServers")
	})
}

func TestVirtualClusterActivities_CreateVirtualCluster(t *testing.T) {
	t.Run("creates new virtual cluster", func(t *testing.T) {
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
						"id":             "vc-new-123",
						"topicPrefix":    "myws-myapp-dev-",
						"groupPrefix":    "myws-myapp-dev-",
						"advertisedHost": "myapp.dev.kafka.orbit.io",
						"advertisedPort": float64(9092),
						"status":         "provisioning",
					},
				})
			}
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewVirtualClusterActivities(payloadClient, nil, logger)

		result, err := activities.CreateVirtualCluster(context.Background(), CreateVirtualClusterInput{
			ApplicationID:     "app-123",
			ApplicationSlug:   "myapp",
			WorkspaceSlug:     "myws",
			Environment:       "dev",
			PhysicalClusterID: "cluster-456",
			BootstrapServers:  "kafka:9092",
		})

		require.NoError(t, err)
		assert.Equal(t, "vc-new-123", result.VirtualClusterID)
		assert.Equal(t, "myws-myapp-dev-", result.TopicPrefix)
		assert.Equal(t, "myws-myapp-dev-", result.GroupPrefix)
		assert.Equal(t, "myapp.dev.kafka.orbit.io", result.AdvertisedHost)
		assert.Equal(t, int32(9092), result.AdvertisedPort)
	})

	t.Run("returns existing virtual cluster", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs: []map[string]any{
					{
						"id":             "vc-existing-123",
						"topicPrefix":    "existing-prefix-",
						"groupPrefix":    "existing-prefix-",
						"advertisedHost": "existing.host",
						"advertisedPort": float64(19092),
					},
				},
				TotalDocs: 1,
			})
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewVirtualClusterActivities(payloadClient, nil, logger)

		result, err := activities.CreateVirtualCluster(context.Background(), CreateVirtualClusterInput{
			ApplicationID:     "app-123",
			ApplicationSlug:   "myapp",
			WorkspaceSlug:     "myws",
			Environment:       "dev",
			PhysicalClusterID: "cluster-456",
			BootstrapServers:  "kafka:9092",
		})

		require.NoError(t, err)
		assert.Equal(t, "vc-existing-123", result.VirtualClusterID)
		assert.Equal(t, "existing-prefix-", result.TopicPrefix)
		assert.Equal(t, "existing.host", result.AdvertisedHost)
		assert.Equal(t, int32(19092), result.AdvertisedPort)
	})

	t.Run("defaults port to 9092 if missing", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(clients.PayloadResponse{
				Docs: []map[string]any{
					{
						"id":             "vc-existing-123",
						"topicPrefix":    "existing-prefix-",
						"groupPrefix":    "existing-prefix-",
						"advertisedHost": "existing.host",
						// advertisedPort omitted
					},
				},
				TotalDocs: 1,
			})
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewVirtualClusterActivities(payloadClient, nil, logger)

		result, err := activities.CreateVirtualCluster(context.Background(), CreateVirtualClusterInput{
			ApplicationID:     "app-123",
			ApplicationSlug:   "myapp",
			WorkspaceSlug:     "myws",
			Environment:       "dev",
			PhysicalClusterID: "cluster-456",
		})

		require.NoError(t, err)
		assert.Equal(t, int32(9092), result.AdvertisedPort)
	})
}

func TestVirtualClusterActivities_PushToBifrost(t *testing.T) {
	t.Run("successful push", func(t *testing.T) {
		bifrostClient, mock, cleanup := setupBifrostTestServer(t)
		defer cleanup()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient("http://localhost:3000", "test-key", logger)
		activities := NewVirtualClusterActivities(payloadClient, bifrostClient, logger)

		result, err := activities.PushToBifrost(context.Background(), PushToBifrostInput{
			VirtualClusterID: "vc-123",
			ApplicationID:    "app-456",
			ApplicationSlug:  "myapp",
			WorkspaceSlug:    "myws",
			Environment:      "development",
			TopicPrefix:      "myws-myapp-dev-",
			GroupPrefix:      "myws-myapp-dev-",
			AdvertisedHost:   "myapp.dev.kafka.orbit.io",
			AdvertisedPort:   9092,
			BootstrapServers: "kafka:9092",
		})

		require.NoError(t, err)
		assert.True(t, result.Success)
		assert.Equal(t, "vc-123", mock.lastUpsertVCConfig.GetId())
		assert.Equal(t, "myapp", mock.lastUpsertVCConfig.GetApplicationSlug())
		assert.Equal(t, "myws-myapp-dev-", mock.lastUpsertVCConfig.GetTopicPrefix())
	})
}

func TestVirtualClusterActivities_UpdateVirtualClusterStatus(t *testing.T) {
	t.Run("updates status successfully", func(t *testing.T) {
		var capturedData map[string]any
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			json.NewDecoder(r.Body).Decode(&capturedData)
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		logger := slog.Default()
		payloadClient := clients.NewPayloadClient(server.URL, "test-key", logger)
		activities := NewVirtualClusterActivities(payloadClient, nil, logger)

		err := activities.UpdateVirtualClusterStatus(context.Background(), UpdateVirtualClusterStatusInput{
			VirtualClusterID: "vc-123",
			Status:           "active",
		})

		require.NoError(t, err)
		assert.Equal(t, "active", capturedData["status"])
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
		activities := NewVirtualClusterActivities(payloadClient, nil, logger)

		err := activities.UpdateVirtualClusterStatus(context.Background(), UpdateVirtualClusterStatusInput{
			VirtualClusterID: "vc-123",
			Status:           "failed",
			ErrorMessage:     "connection timeout",
		})

		require.NoError(t, err)
		assert.Equal(t, "failed", capturedData["status"])
		assert.Equal(t, "connection timeout", capturedData["provisioningError"])
	})
}
