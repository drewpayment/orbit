// services/build-service/internal/grpc/build/server_test.go
package build

import (
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/require"

	buildv1 "github.com/drewpayment/orbit/proto/gen/go/idp/build/v1"
)

func TestAnalyzeRepository_ReturnsDetectedConfig(t *testing.T) {
	logger := slog.Default()
	server := NewBuildServer(logger)

	req := &buildv1.AnalyzeRepositoryRequest{
		RepoUrl: "https://github.com/test/nodejs-app",
		Ref:     "main",
	}

	resp, err := server.AnalyzeRepository(context.Background(), req)

	require.NoError(t, err)
	require.NotNil(t, resp)
	// Stub returns not implemented for now
	require.False(t, resp.Detected)
	require.Contains(t, resp.Error, "not implemented")
}
