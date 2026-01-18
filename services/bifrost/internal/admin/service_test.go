// services/bifrost/internal/admin/service_test.go
package admin

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
	"github.com/drewpayment/orbit/services/bifrost/internal/config"
	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

func TestService_UpsertVirtualCluster(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	svc := NewService(vcStore, credStore)

	ctx := context.Background()
	req := &gatewayv1.UpsertVirtualClusterRequest{
		Config: &gatewayv1.VirtualClusterConfig{
			Id:          "vc-123",
			TopicPrefix: "test-",
		},
	}

	resp, err := svc.UpsertVirtualCluster(ctx, req)
	require.NoError(t, err)
	assert.True(t, resp.Success)

	// Verify it was stored
	vc, ok := vcStore.Get("vc-123")
	require.True(t, ok)
	assert.Equal(t, "test-", vc.TopicPrefix)
}

func TestService_UpsertVirtualCluster_NilConfig(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	svc := NewService(vcStore, credStore)

	ctx := context.Background()
	req := &gatewayv1.UpsertVirtualClusterRequest{
		Config: nil,
	}

	_, err := svc.UpsertVirtualCluster(ctx, req)
	require.Error(t, err)
}

func TestService_DeleteVirtualCluster(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	svc := NewService(vcStore, credStore)

	// Add a virtual cluster first
	vcStore.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-123"})

	ctx := context.Background()
	req := &gatewayv1.DeleteVirtualClusterRequest{
		VirtualClusterId: "vc-123",
	}

	resp, err := svc.DeleteVirtualCluster(ctx, req)
	require.NoError(t, err)
	assert.True(t, resp.Success)

	// Verify it was deleted
	_, ok := vcStore.Get("vc-123")
	assert.False(t, ok)
}

func TestService_ListVirtualClusters(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	svc := NewService(vcStore, credStore)

	// Add some virtual clusters
	vcStore.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-1"})
	vcStore.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-2"})

	ctx := context.Background()
	resp, err := svc.ListVirtualClusters(ctx, &gatewayv1.ListVirtualClustersRequest{})
	require.NoError(t, err)

	assert.Len(t, resp.VirtualClusters, 2)
}

func TestService_UpsertCredential(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	svc := NewService(vcStore, credStore)

	ctx := context.Background()
	req := &gatewayv1.UpsertCredentialRequest{
		Config: &gatewayv1.CredentialConfig{
			Id:       "cred-123",
			Username: "testuser",
		},
	}

	resp, err := svc.UpsertCredential(ctx, req)
	require.NoError(t, err)
	assert.True(t, resp.Success)

	// Verify it was stored
	cred, ok := credStore.Get("cred-123")
	require.True(t, ok)
	assert.Equal(t, "testuser", cred.Username)
}

func TestService_UpsertCredential_NilConfig(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	svc := NewService(vcStore, credStore)

	ctx := context.Background()
	req := &gatewayv1.UpsertCredentialRequest{
		Config: nil,
	}

	_, err := svc.UpsertCredential(ctx, req)
	require.Error(t, err)
}

func TestService_RevokeCredential(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	svc := NewService(vcStore, credStore)

	// Add a credential first
	credStore.Upsert(&gatewayv1.CredentialConfig{Id: "cred-123"})

	ctx := context.Background()
	req := &gatewayv1.RevokeCredentialRequest{
		CredentialId: "cred-123",
	}

	resp, err := svc.RevokeCredential(ctx, req)
	require.NoError(t, err)
	assert.True(t, resp.Success)

	// Verify it was deleted
	_, ok := credStore.Get("cred-123")
	assert.False(t, ok)
}

func TestService_ListCredentials(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	svc := NewService(vcStore, credStore)

	// Add some credentials
	credStore.Upsert(&gatewayv1.CredentialConfig{Id: "cred-1", VirtualClusterId: "vc-1"})
	credStore.Upsert(&gatewayv1.CredentialConfig{Id: "cred-2", VirtualClusterId: "vc-1"})
	credStore.Upsert(&gatewayv1.CredentialConfig{Id: "cred-3", VirtualClusterId: "vc-2"})

	ctx := context.Background()

	// Test listing all credentials
	resp, err := svc.ListCredentials(ctx, &gatewayv1.ListCredentialsRequest{})
	require.NoError(t, err)
	assert.Len(t, resp.Credentials, 3)

	// Test listing credentials filtered by virtual cluster
	resp, err = svc.ListCredentials(ctx, &gatewayv1.ListCredentialsRequest{
		VirtualClusterId: "vc-1",
	})
	require.NoError(t, err)
	assert.Len(t, resp.Credentials, 2)
}

func TestService_GetStatus(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	svc := NewService(vcStore, credStore)

	// Add some data
	vcStore.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-1"})
	vcStore.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-2"})

	ctx := context.Background()
	resp, err := svc.GetStatus(ctx, &gatewayv1.GetStatusRequest{})
	require.NoError(t, err)

	assert.Equal(t, "healthy", resp.Status)
	assert.Equal(t, int32(2), resp.VirtualClusterCount)
}

func TestService_GetFullConfig(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	svc := NewService(vcStore, credStore)

	vcStore.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-1"})
	credStore.Upsert(&gatewayv1.CredentialConfig{Id: "cred-1", VirtualClusterId: "vc-1"})

	ctx := context.Background()
	resp, err := svc.GetFullConfig(ctx, &gatewayv1.GetFullConfigRequest{})
	require.NoError(t, err)

	assert.Len(t, resp.VirtualClusters, 1)
	assert.Len(t, resp.Credentials, 1)
}

func TestService_SetVirtualClusterReadOnly(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	svc := NewService(vcStore, credStore)

	// Add a virtual cluster
	vcStore.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-1", ReadOnly: false})

	ctx := context.Background()
	req := &gatewayv1.SetVirtualClusterReadOnlyRequest{
		VirtualClusterId: "vc-1",
		ReadOnly:         true,
	}

	resp, err := svc.SetVirtualClusterReadOnly(ctx, req)
	require.NoError(t, err)
	assert.True(t, resp.Success)

	// Verify the change
	vc, ok := vcStore.Get("vc-1")
	require.True(t, ok)
	assert.True(t, vc.ReadOnly)
}

func TestService_SetVirtualClusterReadOnly_NotFound(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	svc := NewService(vcStore, credStore)

	ctx := context.Background()
	req := &gatewayv1.SetVirtualClusterReadOnlyRequest{
		VirtualClusterId: "nonexistent",
		ReadOnly:         true,
	}

	_, err := svc.SetVirtualClusterReadOnly(ctx, req)
	require.Error(t, err)
}

// Policy stubs should return unimplemented
func TestService_PolicyStubs(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	svc := NewService(vcStore, credStore)
	ctx := context.Background()

	_, err := svc.UpsertPolicy(ctx, &gatewayv1.UpsertPolicyRequest{})
	assert.Error(t, err)

	_, err = svc.DeletePolicy(ctx, &gatewayv1.DeletePolicyRequest{})
	assert.Error(t, err)

	_, err = svc.ListPolicies(ctx, &gatewayv1.ListPoliciesRequest{})
	assert.Error(t, err)
}

// Topic ACL stubs should return unimplemented
func TestService_TopicACLStubs(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	svc := NewService(vcStore, credStore)
	ctx := context.Background()

	_, err := svc.UpsertTopicACL(ctx, &gatewayv1.UpsertTopicACLRequest{})
	assert.Error(t, err)

	_, err = svc.RevokeTopicACL(ctx, &gatewayv1.RevokeTopicACLRequest{})
	assert.Error(t, err)

	_, err = svc.ListTopicACLs(ctx, &gatewayv1.ListTopicACLsRequest{})
	assert.Error(t, err)
}
