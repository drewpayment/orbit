package admin

import (
	"context"
	"errors"
	"io"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	reflectionpb "google.golang.org/grpc/reflection/grpc_reflection_v1"
)

// reflectionServices asks the server's reflection endpoint to list its
// services, as grpcurl would.
func reflectionServices(t *testing.T, conn *grpc.ClientConn, ctx context.Context) ([]string, error) {
	t.Helper()
	stream, err := reflectionpb.NewServerReflectionClient(conn).ServerReflectionInfo(ctx)
	if err != nil {
		return nil, err
	}
	err = stream.Send(&reflectionpb.ServerReflectionRequest{
		MessageRequest: &reflectionpb.ServerReflectionRequest_ListServices{ListServices: ""},
	})
	// When the server rejects the stream, Send reports io.EOF and the real
	// status is on Recv.
	if err != nil && !errors.Is(err, io.EOF) {
		require.NoError(t, err)
	}
	resp, err := stream.Recv()
	if err != nil {
		return nil, err
	}
	var names []string
	for _, s := range resp.GetListServicesResponse().GetService() {
		names = append(names, s.GetName())
	}
	return names, nil
}
