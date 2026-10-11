package clients

import (
	"context"
	"log/slog"
	"net"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
	"github.com/drewpayment/orbit/proto/pkg/svcauth"
)

var bifrostAuthTestSecret = []byte("worker-bifrost-auth-test-secret-32b!")

// adminOnlyBifrost mimics Bifrost's admin server: svcauth verification plus a
// platform-admin requirement on UpsertVirtualCluster.
type adminOnlyBifrost struct {
	gatewayv1.UnimplementedBifrostAdminServiceServer
	subject string
}

func (s *adminOnlyBifrost) UpsertVirtualCluster(ctx context.Context, _ *gatewayv1.UpsertVirtualClusterRequest) (*gatewayv1.UpsertVirtualClusterResponse, error) {
	if err := svcauth.EnforcePlatformAdmin(ctx); err != nil {
		return nil, err
	}
	id, _ := svcauth.IdentityFromContext(ctx)
	s.subject = id.UserID
	return &gatewayv1.UpsertVirtualClusterResponse{Success: true}, nil
}

func startAdminOnlyBifrost(t *testing.T) (string, *adminOnlyBifrost) {
	t.Helper()
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	impl := &adminOnlyBifrost{}
	srv := grpc.NewServer(grpc.UnaryInterceptor(svcauth.UnaryServerInterceptor(bifrostAuthTestSecret, true)))
	gatewayv1.RegisterBifrostAdminServiceServer(srv, impl)
	go func() { _ = srv.Serve(lis) }()
	t.Cleanup(srv.Stop)
	return lis.Addr().String(), impl
}

func TestBifrostClient_WithServiceAuthAuthenticatesAsAdmin(t *testing.T) {
	addr, impl := startAdminOnlyBifrost(t)
	client, err := NewBifrostClient(addr, slog.Default(), WithServiceAuth(bifrostAuthTestSecret))
	require.NoError(t, err)
	defer client.Close()

	err = client.UpsertVirtualCluster(context.Background(), &gatewayv1.VirtualClusterConfig{Id: "vc-1"})

	require.NoError(t, err)
	assert.Equal(t, "temporal-worker", impl.subject)
}

func TestBifrostClient_WithoutServiceAuthIsRejected(t *testing.T) {
	addr, _ := startAdminOnlyBifrost(t)
	client, err := NewBifrostClient(addr, slog.Default())
	require.NoError(t, err)
	defer client.Close()

	err = client.UpsertVirtualCluster(context.Background(), &gatewayv1.VirtualClusterConfig{Id: "vc-1"})

	require.Error(t, err)
	assert.Equal(t, codes.Unauthenticated, status.Code(unwrapGRPC(err)))
}

func TestNewBifrostClient_RejectsShortSecret(t *testing.T) {
	_, err := NewBifrostClient("localhost:0", slog.Default(), WithServiceAuth([]byte("short")))
	assert.Error(t, err)
}

// unwrapGRPC finds the gRPC status through the client's %w wrapping.
func unwrapGRPC(err error) error {
	for err != nil {
		if _, ok := status.FromError(err); ok && status.Code(err) != codes.Unknown {
			return err
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return err
		}
		err = u.Unwrap()
	}
	return err
}
