package contract

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	kafkapb "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
)

// TestListProviders_Success tests listing available Kafka providers
func TestListProviders_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	req := &kafkapb.ListProvidersRequest{}

	resp, err := client.ListProviders(ctx, req)
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotEmpty(t, resp.Providers)

	// Verify provider structure
	for _, provider := range resp.Providers {
		assert.NotEmpty(t, provider.Id)
		assert.NotEmpty(t, provider.Name)
		assert.NotEmpty(t, provider.DisplayName)
		assert.NotEmpty(t, provider.AdapterType)
		assert.NotNil(t, provider.Capabilities)
	}

	// Check for expected providers
	providerNames := make(map[string]bool)
	for _, p := range resp.Providers {
		providerNames[p.Name] = true
	}

	// At minimum, we should have Apache Kafka
	assert.True(t, providerNames["apache-kafka"], "Apache Kafka provider should be available")
}

// TestRegisterCluster_Success tests successful cluster registration
func TestRegisterCluster_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Get providers first
	providersResp, err := client.ListProviders(ctx, &kafkapb.ListProvidersRequest{})
	require.NoError(t, err)
	require.NotEmpty(t, providersResp.Providers)

	providerID := providersResp.Providers[0].Id

	req := &kafkapb.RegisterClusterRequest{
		Name:       "test-cluster-" + uuid.New().String()[:8],
		ProviderId: providerID,
		ConnectionConfig: map[string]string{
			"bootstrapServers": "localhost:9092",
			"securityProtocol": "PLAINTEXT",
		},
		Credentials: map[string]string{},
	}

	resp, err := client.RegisterCluster(ctx, req)
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Cluster)

	assert.NotEmpty(t, resp.Cluster.Id)
	assert.Equal(t, req.Name, resp.Cluster.Name)
	assert.Equal(t, providerID, resp.Cluster.ProviderId)
	assert.Equal(t, kafkapb.ClusterValidationStatus_CLUSTER_VALIDATION_STATUS_PENDING, resp.Cluster.ValidationStatus)
}

// TestRegisterCluster_ValidationErrors tests cluster registration validation
func TestRegisterCluster_ValidationErrors(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	testCases := []struct {
		name     string
		req      *kafkapb.RegisterClusterRequest
		wantCode codes.Code
	}{
		{
			name: "missing name",
			req: &kafkapb.RegisterClusterRequest{
				ProviderId: uuid.New().String(),
				ConnectionConfig: map[string]string{
					"bootstrapServers": "localhost:9092",
				},
			},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "missing provider ID",
			req: &kafkapb.RegisterClusterRequest{
				Name: "test-cluster",
				ConnectionConfig: map[string]string{
					"bootstrapServers": "localhost:9092",
				},
			},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "missing connection config",
			req: &kafkapb.RegisterClusterRequest{
				Name:       "test-cluster",
				ProviderId: uuid.New().String(),
			},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "missing bootstrap servers",
			req: &kafkapb.RegisterClusterRequest{
				Name:             "test-cluster",
				ProviderId:       uuid.New().String(),
				ConnectionConfig: map[string]string{},
			},
			wantCode: codes.InvalidArgument,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := client.RegisterCluster(ctx, tc.req)
			require.Error(t, err)
			assert.Nil(t, resp)

			st, ok := status.FromError(err)
			require.True(t, ok)
			assert.Equal(t, tc.wantCode, st.Code())
		})
	}
}

// TestValidateCluster_Success tests successful cluster validation
func TestValidateCluster_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Get providers first
	providersResp, err := client.ListProviders(ctx, &kafkapb.ListProvidersRequest{})
	require.NoError(t, err)
	require.NotEmpty(t, providersResp.Providers)

	providerID := providersResp.Providers[0].Id

	// Register a cluster
	registerReq := &kafkapb.RegisterClusterRequest{
		Name:       "validate-test-cluster-" + uuid.New().String()[:8],
		ProviderId: providerID,
		ConnectionConfig: map[string]string{
			"bootstrapServers": "localhost:9092",
			"securityProtocol": "PLAINTEXT",
		},
		Credentials: map[string]string{},
	}

	registerResp, err := client.RegisterCluster(ctx, registerReq)
	require.NoError(t, err)

	// Validate the cluster
	validateReq := &kafkapb.ValidateClusterRequest{
		ClusterId: registerResp.Cluster.Id,
	}

	resp, err := client.ValidateCluster(ctx, validateReq)
	require.NoError(t, err)
	require.NotNil(t, resp)

	// Result depends on whether Kafka is actually running
	// In tests, we just check the response structure
	// resp.Valid will be true if Kafka is accessible
}

// TestListClusters_Success tests listing clusters
func TestListClusters_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Get providers
	providersResp, err := client.ListProviders(ctx, &kafkapb.ListProvidersRequest{})
	require.NoError(t, err)
	require.NotEmpty(t, providersResp.Providers)

	providerID := providersResp.Providers[0].Id

	// Register a few clusters
	for i := 0; i < 2; i++ {
		registerReq := &kafkapb.RegisterClusterRequest{
			Name:       "list-test-cluster-" + uuid.New().String()[:8],
			ProviderId: providerID,
			ConnectionConfig: map[string]string{
				"bootstrapServers": "localhost:9092",
			},
		}
		_, err := client.RegisterCluster(ctx, registerReq)
		require.NoError(t, err)
	}

	// List clusters
	listReq := &kafkapb.ListClustersRequest{}

	resp, err := client.ListClusters(ctx, listReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.GreaterOrEqual(t, len(resp.Clusters), 2)

	// Verify cluster structure
	for _, cluster := range resp.Clusters {
		assert.NotEmpty(t, cluster.Id)
		assert.NotEmpty(t, cluster.Name)
		assert.NotEmpty(t, cluster.ProviderId)
	}
}

// TestDeleteCluster_Success tests successful cluster deletion
func TestDeleteCluster_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Get providers
	providersResp, err := client.ListProviders(ctx, &kafkapb.ListProvidersRequest{})
	require.NoError(t, err)
	require.NotEmpty(t, providersResp.Providers)

	providerID := providersResp.Providers[0].Id

	// Register a cluster
	registerReq := &kafkapb.RegisterClusterRequest{
		Name:       "delete-test-cluster-" + uuid.New().String()[:8],
		ProviderId: providerID,
		ConnectionConfig: map[string]string{
			"bootstrapServers": "localhost:9092",
		},
	}

	registerResp, err := client.RegisterCluster(ctx, registerReq)
	require.NoError(t, err)

	// Delete the cluster
	deleteReq := &kafkapb.DeleteClusterRequest{
		ClusterId: registerResp.Cluster.Id,
	}

	resp, err := client.DeleteCluster(ctx, deleteReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.True(t, resp.Success)
}

// TestDeleteCluster_NotFound tests deleting non-existent cluster
func TestDeleteCluster_NotFound(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	req := &kafkapb.DeleteClusterRequest{
		ClusterId: uuid.New().String(),
	}

	resp, err := client.DeleteCluster(ctx, req)
	require.Error(t, err)
	assert.Nil(t, resp)

	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code())
}

// TestCreateEnvironmentMapping_Success tests creating environment mappings
func TestCreateEnvironmentMapping_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Get providers and register a cluster first
	providersResp, err := client.ListProviders(ctx, &kafkapb.ListProvidersRequest{})
	require.NoError(t, err)
	require.NotEmpty(t, providersResp.Providers)

	registerReq := &kafkapb.RegisterClusterRequest{
		Name:       "env-map-test-cluster-" + uuid.New().String()[:8],
		ProviderId: providersResp.Providers[0].Id,
		ConnectionConfig: map[string]string{
			"bootstrapServers": "localhost:9092",
		},
	}

	registerResp, err := client.RegisterCluster(ctx, registerReq)
	require.NoError(t, err)

	// Create environment mapping
	mappingReq := &kafkapb.CreateEnvironmentMappingRequest{
		Environment: "development",
		ClusterId:   registerResp.Cluster.Id,
		RoutingRule: map[string]string{
			"default": "true",
		},
		Priority:  1,
		IsDefault: true,
	}

	resp, err := client.CreateEnvironmentMapping(ctx, mappingReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Mapping)

	assert.NotEmpty(t, resp.Mapping.Id)
	assert.Equal(t, "development", resp.Mapping.Environment)
	assert.Equal(t, registerResp.Cluster.Id, resp.Mapping.ClusterId)
	assert.True(t, resp.Mapping.IsDefault)
}

// TestListEnvironmentMappings_Success tests listing environment mappings
func TestListEnvironmentMappings_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Create some mappings first (assuming clusters exist)
	listReq := &kafkapb.ListEnvironmentMappingsRequest{
		Environment: "development",
	}

	resp, err := client.ListEnvironmentMappings(ctx, listReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	// Response may be empty if no mappings exist
}
