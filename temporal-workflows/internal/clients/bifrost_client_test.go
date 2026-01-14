package clients

import (
	"context"
	"log/slog"
	"net"
	"testing"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
)

// mockBifrostServer implements the BifrostAdminServiceServer for testing
type mockBifrostServer struct {
	gatewayv1.UnimplementedBifrostAdminServiceServer

	// Control responses
	upsertVCSuccess        bool
	upsertVCError          error
	deleteVCSuccess        bool
	deleteVCError          error
	setReadOnlySuccess     bool
	setReadOnlyError       error
	upsertCredSuccess      bool
	upsertCredError        error
	revokeCredSuccess      bool
	revokeCredError        error
	getStatusError         error
	listVCError            error
	virtualClusters        []*gatewayv1.VirtualClusterConfig

	// Track calls
	lastUpsertVCConfig     *gatewayv1.VirtualClusterConfig
	lastDeleteVCID         string
	lastSetReadOnlyID      string
	lastSetReadOnlyValue   bool
	lastUpsertCredConfig   *gatewayv1.CredentialConfig
	lastRevokeCredID       string
}

func (m *mockBifrostServer) UpsertVirtualCluster(ctx context.Context, req *gatewayv1.UpsertVirtualClusterRequest) (*gatewayv1.UpsertVirtualClusterResponse, error) {
	m.lastUpsertVCConfig = req.GetConfig()
	if m.upsertVCError != nil {
		return nil, m.upsertVCError
	}
	return &gatewayv1.UpsertVirtualClusterResponse{Success: m.upsertVCSuccess}, nil
}

func (m *mockBifrostServer) DeleteVirtualCluster(ctx context.Context, req *gatewayv1.DeleteVirtualClusterRequest) (*gatewayv1.DeleteVirtualClusterResponse, error) {
	m.lastDeleteVCID = req.GetVirtualClusterId()
	if m.deleteVCError != nil {
		return nil, m.deleteVCError
	}
	return &gatewayv1.DeleteVirtualClusterResponse{Success: m.deleteVCSuccess}, nil
}

func (m *mockBifrostServer) SetVirtualClusterReadOnly(ctx context.Context, req *gatewayv1.SetVirtualClusterReadOnlyRequest) (*gatewayv1.SetVirtualClusterReadOnlyResponse, error) {
	m.lastSetReadOnlyID = req.GetVirtualClusterId()
	m.lastSetReadOnlyValue = req.GetReadOnly()
	if m.setReadOnlyError != nil {
		return nil, m.setReadOnlyError
	}
	return &gatewayv1.SetVirtualClusterReadOnlyResponse{Success: m.setReadOnlySuccess}, nil
}

func (m *mockBifrostServer) UpsertCredential(ctx context.Context, req *gatewayv1.UpsertCredentialRequest) (*gatewayv1.UpsertCredentialResponse, error) {
	m.lastUpsertCredConfig = req.GetConfig()
	if m.upsertCredError != nil {
		return nil, m.upsertCredError
	}
	return &gatewayv1.UpsertCredentialResponse{Success: m.upsertCredSuccess}, nil
}

func (m *mockBifrostServer) RevokeCredential(ctx context.Context, req *gatewayv1.RevokeCredentialRequest) (*gatewayv1.RevokeCredentialResponse, error) {
	m.lastRevokeCredID = req.GetCredentialId()
	if m.revokeCredError != nil {
		return nil, m.revokeCredError
	}
	return &gatewayv1.RevokeCredentialResponse{Success: m.revokeCredSuccess}, nil
}

func (m *mockBifrostServer) GetStatus(ctx context.Context, req *gatewayv1.GetStatusRequest) (*gatewayv1.GetStatusResponse, error) {
	if m.getStatusError != nil {
		return nil, m.getStatusError
	}
	return &gatewayv1.GetStatusResponse{
		Status:              "healthy",
		VirtualClusterCount: 5,
		ActiveConnections:   10,
	}, nil
}

func (m *mockBifrostServer) ListVirtualClusters(ctx context.Context, req *gatewayv1.ListVirtualClustersRequest) (*gatewayv1.ListVirtualClustersResponse, error) {
	if m.listVCError != nil {
		return nil, m.listVCError
	}
	return &gatewayv1.ListVirtualClustersResponse{
		VirtualClusters: m.virtualClusters,
	}, nil
}

// setupTestServer creates a test gRPC server and returns the client and mock
func setupTestServer(t *testing.T) (*BifrostClient, *mockBifrostServer, func()) {
	t.Helper()

	// Create a listener on a random port
	lis, err := net.Listen("tcp", "localhost:0")
	require.NoError(t, err)

	// Create mock server
	mock := &mockBifrostServer{
		upsertVCSuccess:    true,
		deleteVCSuccess:    true,
		setReadOnlySuccess: true,
		upsertCredSuccess:  true,
		revokeCredSuccess:  true,
	}

	// Create gRPC server
	server := grpc.NewServer()
	gatewayv1.RegisterBifrostAdminServiceServer(server, mock)

	// Start server in background
	go func() {
		_ = server.Serve(lis)
	}()

	// Create client
	logger := slog.Default()
	conn, err := grpc.NewClient(lis.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err)

	client := &BifrostClient{
		conn:   conn,
		client: gatewayv1.NewBifrostAdminServiceClient(conn),
		logger: logger,
	}

	cleanup := func() {
		client.Close()
		server.Stop()
		lis.Close()
	}

	return client, mock, cleanup
}

func TestNewBifrostClient(t *testing.T) {
	// Test that NewBifrostClient creates a client with valid connection
	// Note: This won't actually connect since there's no server, but it should create the client
	logger := slog.Default()

	// Creating a client to a non-existent address should succeed (connection is lazy)
	client, err := NewBifrostClient("localhost:0", logger)
	require.NoError(t, err)
	assert.NotNil(t, client)
	assert.NotNil(t, client.client)
	assert.NotNil(t, client.logger)
	client.Close()
}

func TestBifrostClient_Close(t *testing.T) {
	t.Run("closes connection", func(t *testing.T) {
		client, _, cleanup := setupTestServer(t)
		defer cleanup()

		err := client.Close()
		assert.NoError(t, err)
	})

	t.Run("handles nil connection", func(t *testing.T) {
		client := &BifrostClient{}
		err := client.Close()
		assert.NoError(t, err)
	})
}

func TestBifrostClient_UpsertVirtualCluster(t *testing.T) {
	t.Run("successful upsert", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		config := &gatewayv1.VirtualClusterConfig{
			Id:                       "vc-123",
			ApplicationId:            "app-456",
			Environment:              "development",
			TopicPrefix:              "myapp-dev-",
			PhysicalBootstrapServers: "kafka:9092",
			AdvertisedPort:           19092,
		}

		err := client.UpsertVirtualCluster(context.Background(), config)
		require.NoError(t, err)
		assert.Equal(t, config.Id, mock.lastUpsertVCConfig.GetId())
		assert.Equal(t, config.ApplicationId, mock.lastUpsertVCConfig.GetApplicationId())
	})

	t.Run("returns error when success=false", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		mock.upsertVCSuccess = false

		config := &gatewayv1.VirtualClusterConfig{Id: "vc-123"}
		err := client.UpsertVirtualCluster(context.Background(), config)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "success=false")
	})

	t.Run("returns error on gRPC failure", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		mock.upsertVCError = status.Error(codes.Internal, "internal error")

		config := &gatewayv1.VirtualClusterConfig{Id: "vc-123"}
		err := client.UpsertVirtualCluster(context.Background(), config)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "upserting virtual cluster")
	})
}

func TestBifrostClient_DeleteVirtualCluster(t *testing.T) {
	t.Run("successful delete", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		err := client.DeleteVirtualCluster(context.Background(), "vc-123")
		require.NoError(t, err)
		assert.Equal(t, "vc-123", mock.lastDeleteVCID)
	})

	t.Run("returns error when success=false", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		mock.deleteVCSuccess = false

		err := client.DeleteVirtualCluster(context.Background(), "vc-123")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "success=false")
	})

	t.Run("returns error on gRPC failure", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		mock.deleteVCError = status.Error(codes.NotFound, "not found")

		err := client.DeleteVirtualCluster(context.Background(), "vc-123")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "deleting virtual cluster")
	})
}

func TestBifrostClient_SetVirtualClusterReadOnly(t *testing.T) {
	t.Run("set read-only true", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		err := client.SetVirtualClusterReadOnly(context.Background(), "vc-123", true)
		require.NoError(t, err)
		assert.Equal(t, "vc-123", mock.lastSetReadOnlyID)
		assert.True(t, mock.lastSetReadOnlyValue)
	})

	t.Run("set read-only false", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		err := client.SetVirtualClusterReadOnly(context.Background(), "vc-123", false)
		require.NoError(t, err)
		assert.Equal(t, "vc-123", mock.lastSetReadOnlyID)
		assert.False(t, mock.lastSetReadOnlyValue)
	})

	t.Run("returns error when success=false", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		mock.setReadOnlySuccess = false

		err := client.SetVirtualClusterReadOnly(context.Background(), "vc-123", true)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "success=false")
	})

	t.Run("returns error on gRPC failure", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		mock.setReadOnlyError = status.Error(codes.Internal, "error")

		err := client.SetVirtualClusterReadOnly(context.Background(), "vc-123", true)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "setting virtual cluster read-only")
	})
}

func TestBifrostClient_UpsertCredential(t *testing.T) {
	t.Run("successful upsert", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		cred := &gatewayv1.CredentialConfig{
			Id:               "cred-123",
			VirtualClusterId: "vc-456",
			Username:         "user1",
			PasswordHash:     "hashed-password",
		}

		err := client.UpsertCredential(context.Background(), cred)
		require.NoError(t, err)
		assert.Equal(t, cred.Id, mock.lastUpsertCredConfig.GetId())
		assert.Equal(t, cred.VirtualClusterId, mock.lastUpsertCredConfig.GetVirtualClusterId())
	})

	t.Run("returns error when success=false", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		mock.upsertCredSuccess = false

		cred := &gatewayv1.CredentialConfig{Id: "cred-123"}
		err := client.UpsertCredential(context.Background(), cred)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "success=false")
	})

	t.Run("returns error on gRPC failure", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		mock.upsertCredError = status.Error(codes.InvalidArgument, "invalid")

		cred := &gatewayv1.CredentialConfig{Id: "cred-123"}
		err := client.UpsertCredential(context.Background(), cred)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "upserting credential")
	})
}

func TestBifrostClient_RevokeCredential(t *testing.T) {
	t.Run("successful revoke", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		err := client.RevokeCredential(context.Background(), "cred-123")
		require.NoError(t, err)
		assert.Equal(t, "cred-123", mock.lastRevokeCredID)
	})

	t.Run("returns error when success=false", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		mock.revokeCredSuccess = false

		err := client.RevokeCredential(context.Background(), "cred-123")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "success=false")
	})

	t.Run("returns error on gRPC failure", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		mock.revokeCredError = status.Error(codes.NotFound, "not found")

		err := client.RevokeCredential(context.Background(), "cred-123")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "revoking credential")
	})
}

func TestBifrostClient_GetStatus(t *testing.T) {
	t.Run("successful get status", func(t *testing.T) {
		client, _, cleanup := setupTestServer(t)
		defer cleanup()

		resp, err := client.GetStatus(context.Background())
		require.NoError(t, err)
		assert.Equal(t, "healthy", resp.GetStatus())
		assert.Equal(t, int32(5), resp.GetVirtualClusterCount())
		assert.Equal(t, int32(10), resp.GetActiveConnections())
	})

	t.Run("returns error on gRPC failure", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		mock.getStatusError = status.Error(codes.Unavailable, "unavailable")

		resp, err := client.GetStatus(context.Background())
		assert.Error(t, err)
		assert.Nil(t, resp)
		assert.Contains(t, err.Error(), "getting bifrost status")
	})
}

func TestBifrostClient_ListVirtualClusters(t *testing.T) {
	t.Run("successful list", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		mock.virtualClusters = []*gatewayv1.VirtualClusterConfig{
			{Id: "vc-1", ApplicationId: "app-1"},
			{Id: "vc-2", ApplicationId: "app-2"},
		}

		clusters, err := client.ListVirtualClusters(context.Background())
		require.NoError(t, err)
		assert.Len(t, clusters, 2)
		assert.Equal(t, "vc-1", clusters[0].GetId())
		assert.Equal(t, "vc-2", clusters[1].GetId())
	})

	t.Run("returns empty list", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		mock.virtualClusters = []*gatewayv1.VirtualClusterConfig{}

		clusters, err := client.ListVirtualClusters(context.Background())
		require.NoError(t, err)
		assert.Empty(t, clusters)
	})

	t.Run("returns error on gRPC failure", func(t *testing.T) {
		client, mock, cleanup := setupTestServer(t)
		defer cleanup()

		mock.listVCError = status.Error(codes.Internal, "error")

		clusters, err := client.ListVirtualClusters(context.Background())
		assert.Error(t, err)
		assert.Nil(t, clusters)
		assert.Contains(t, err.Error(), "listing virtual clusters")
	})
}
