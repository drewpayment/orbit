package admin

import (
	"context"
	"net"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
	"github.com/drewpayment/orbit/proto/pkg/svcauth"
	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
	"github.com/drewpayment/orbit/services/bifrost/internal/config"
)

var testSecret = []byte("bifrost-admin-test-secret-32-bytes!!")

// startAuthedAdmin serves the real admin gRPC server (interceptors included) on
// an in-memory listener and returns a client plus the backing stores.
func startAuthedAdmin(t *testing.T, opts ServerOptions) (gatewayv1.BifrostAdminServiceClient, *config.VirtualClusterStore, *grpc.ClientConn) {
	t.Helper()
	vcStore := config.NewVirtualClusterStore()
	svc := NewService(vcStore, auth.NewCredentialStore())
	opts.Secret = testSecret
	srv := NewServer(svc, 0, opts)

	lis := bufconn.Listen(1 << 20)
	go func() { _ = srv.grpcServer.Serve(lis) }()
	t.Cleanup(srv.grpcServer.Stop)

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return lis.Dial() }),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	return gatewayv1.NewBifrostAdminServiceClient(conn), vcStore, conn
}

func withToken(t *testing.T, wid string, admin bool) context.Context {
	t.Helper()
	tok, err := svcauth.MintToken(testSecret, "user-1", wid, admin)
	require.NoError(t, err)
	return metadata.AppendToOutgoingContext(context.Background(), "authorization", "Bearer "+tok)
}

func TestAdminServer_NoTokenIsUnauthenticated(t *testing.T) {
	client, vcStore, _ := startAuthedAdmin(t, ServerOptions{})

	_, err := client.UpsertVirtualCluster(context.Background(), &gatewayv1.UpsertVirtualClusterRequest{
		Config: &gatewayv1.VirtualClusterConfig{Id: "vc-1"},
	})

	assert.Equal(t, codes.Unauthenticated, status.Code(err))
	_, stored := vcStore.Get("vc-1")
	assert.False(t, stored, "an unauthenticated call must not mutate state")
}

func TestAdminServer_TokenSignedWithWrongSecretIsUnauthenticated(t *testing.T) {
	client, _, _ := startAuthedAdmin(t, ServerOptions{})
	tok, err := svcauth.MintToken([]byte("another-secret-that-is-32-bytes-long!"), "u", "", true)
	require.NoError(t, err)
	ctx := metadata.AppendToOutgoingContext(context.Background(), "authorization", "Bearer "+tok)

	_, err = client.GetStatus(ctx, &gatewayv1.GetStatusRequest{})

	assert.Equal(t, codes.Unauthenticated, status.Code(err))
}

// TestAdminServer_RPCPolicy pins the authorization of every admin RPC: control
// plane RPCs are platform-admin only, consumer-group RPCs additionally admit a
// workspace-scoped token (orbit-www signs wid only for a verified member).
func TestAdminServer_RPCPolicy(t *testing.T) {
	client, _, _ := startAuthedAdmin(t, ServerOptions{})

	calls := map[string]func(ctx context.Context) error{
		"UpsertVirtualCluster": func(ctx context.Context) error {
			_, err := client.UpsertVirtualCluster(ctx, &gatewayv1.UpsertVirtualClusterRequest{Config: &gatewayv1.VirtualClusterConfig{Id: "vc"}})
			return err
		},
		"DeleteVirtualCluster": func(ctx context.Context) error {
			_, err := client.DeleteVirtualCluster(ctx, &gatewayv1.DeleteVirtualClusterRequest{VirtualClusterId: "vc"})
			return err
		},
		"SetVirtualClusterReadOnly": func(ctx context.Context) error {
			_, err := client.SetVirtualClusterReadOnly(ctx, &gatewayv1.SetVirtualClusterReadOnlyRequest{VirtualClusterId: "vc"})
			return err
		},
		"ListVirtualClusters": func(ctx context.Context) error {
			_, err := client.ListVirtualClusters(ctx, &gatewayv1.ListVirtualClustersRequest{})
			return err
		},
		"UpsertCredential": func(ctx context.Context) error {
			_, err := client.UpsertCredential(ctx, &gatewayv1.UpsertCredentialRequest{Config: &gatewayv1.CredentialConfig{Id: "c", VirtualClusterId: "vc"}})
			return err
		},
		"RevokeCredential": func(ctx context.Context) error {
			_, err := client.RevokeCredential(ctx, &gatewayv1.RevokeCredentialRequest{CredentialId: "c"})
			return err
		},
		"ListCredentials": func(ctx context.Context) error {
			_, err := client.ListCredentials(ctx, &gatewayv1.ListCredentialsRequest{})
			return err
		},
		"GetFullConfig": func(ctx context.Context) error {
			_, err := client.GetFullConfig(ctx, &gatewayv1.GetFullConfigRequest{})
			return err
		},
		"GetStatus": func(ctx context.Context) error {
			_, err := client.GetStatus(ctx, &gatewayv1.GetStatusRequest{})
			return err
		},
		"UpsertPolicy": func(ctx context.Context) error {
			_, err := client.UpsertPolicy(ctx, &gatewayv1.UpsertPolicyRequest{})
			return err
		},
		"DeletePolicy": func(ctx context.Context) error {
			_, err := client.DeletePolicy(ctx, &gatewayv1.DeletePolicyRequest{})
			return err
		},
		"ListPolicies": func(ctx context.Context) error {
			_, err := client.ListPolicies(ctx, &gatewayv1.ListPoliciesRequest{})
			return err
		},
		"UpsertTopicACL": func(ctx context.Context) error {
			_, err := client.UpsertTopicACL(ctx, &gatewayv1.UpsertTopicACLRequest{})
			return err
		},
		"RevokeTopicACL": func(ctx context.Context) error {
			_, err := client.RevokeTopicACL(ctx, &gatewayv1.RevokeTopicACLRequest{})
			return err
		},
		"ListTopicACLs": func(ctx context.Context) error {
			_, err := client.ListTopicACLs(ctx, &gatewayv1.ListTopicACLsRequest{})
			return err
		},
		"ListConsumerGroups": func(ctx context.Context) error {
			_, err := client.ListConsumerGroups(ctx, &gatewayv1.ListConsumerGroupsRequest{VirtualClusterId: "vc"})
			return err
		},
		"DescribeConsumerGroup": func(ctx context.Context) error {
			_, err := client.DescribeConsumerGroup(ctx, &gatewayv1.DescribeConsumerGroupRequest{VirtualClusterId: "vc", GroupId: "g"})
			return err
		},
		"ResetConsumerGroupOffsets": func(ctx context.Context) error {
			_, err := client.ResetConsumerGroupOffsets(ctx, &gatewayv1.ResetConsumerGroupOffsetsRequest{VirtualClusterId: "vc", GroupId: "g", Topic: "t"})
			return err
		},
	}
	workspaceScoped := map[string]bool{
		"ListConsumerGroups": true, "DescribeConsumerGroup": true, "ResetConsumerGroupOffsets": true,
	}

	// Every RPC on the service must have a case here, so a newly added RPC
	// cannot ship without its policy being considered.
	desc := gatewayv1.BifrostAdminService_ServiceDesc
	require.Len(t, calls, len(desc.Methods), "add the new RPC to this test and to methodPolicies")

	for name, call := range calls {
		t.Run(name+"/token without workspace or admin claim", func(t *testing.T) {
			err := call(withToken(t, "", false))
			assert.Equal(t, codes.PermissionDenied, status.Code(err), "err: %v", err)
		})

		t.Run(name+"/workspace-scoped token", func(t *testing.T) {
			err := call(withToken(t, "ws-1", false))
			if workspaceScoped[name] {
				assert.NotEqual(t, codes.PermissionDenied, status.Code(err), "workspace-scoped RPC must admit a workspace token; err: %v", err)
				assert.NotEqual(t, codes.Unauthenticated, status.Code(err))
			} else {
				assert.Equal(t, codes.PermissionDenied, status.Code(err), "err: %v", err)
			}
		})

		t.Run(name+"/platform admin", func(t *testing.T) {
			err := call(withToken(t, "", true))
			assert.NotEqual(t, codes.PermissionDenied, status.Code(err), "err: %v", err)
			assert.NotEqual(t, codes.Unauthenticated, status.Code(err), "err: %v", err)
		})
	}
}

func TestAdminServer_UnlistedMethodIsAdminOnly(t *testing.T) {
	// A method with no explicit policy must default to platform-admin only.
	assert.Equal(t, policyPlatformAdmin, policyFor("/idp.gateway.v1.BifrostAdminService/SomethingNew"))
}

func TestAdminServer_ReflectionDisabledByDefault(t *testing.T) {
	_, _, conn := startAuthedAdmin(t, ServerOptions{})

	_, err := reflectionServices(t, conn, withToken(t, "", true))

	require.Error(t, err)
	assert.Equal(t, codes.Unimplemented, status.Code(err))
}

func TestAdminServer_ReflectionOptIn(t *testing.T) {
	_, _, conn := startAuthedAdmin(t, ServerOptions{EnableReflection: true})

	services, err := reflectionServices(t, conn, context.Background())

	require.NoError(t, err)
	assert.Contains(t, services, "idp.gateway.v1.BifrostAdminService")
}
