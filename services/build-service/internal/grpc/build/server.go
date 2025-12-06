package build

import (
	"context"
	"log/slog"

	buildv1 "github.com/drewpayment/orbit/proto/gen/go/idp/build/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// BuildServer implements the BuildService gRPC server
type BuildServer struct {
	buildv1.UnimplementedBuildServiceServer
	logger *slog.Logger
}

// NewBuildServer creates a new BuildServer instance
func NewBuildServer(logger *slog.Logger) *BuildServer {
	return &BuildServer{
		logger: logger,
	}
}

// AnalyzeRepository analyzes a repository to detect build configuration
func (s *BuildServer) AnalyzeRepository(ctx context.Context, req *buildv1.AnalyzeRepositoryRequest) (*buildv1.AnalyzeRepositoryResponse, error) {
	s.logger.Info("AnalyzeRepository called",
		"repo_url", req.RepoUrl,
		"ref", req.Ref,
	)

	// TODO: Implement Railpack analysis
	return &buildv1.AnalyzeRepositoryResponse{
		Detected: false,
		Error:    "not implemented yet",
	}, nil
}

// BuildImage builds and pushes a container image
func (s *BuildServer) BuildImage(
	ctx context.Context,
	req *buildv1.BuildImageRequest,
) (*buildv1.BuildImageResponse, error) {
	s.logger.Info("BuildImage called",
		"request_id", req.RequestId,
		"app_id", req.AppId,
		"repo_url", req.RepoUrl,
	)

	// TODO: Implement Railpack build
	return &buildv1.BuildImageResponse{
		Success: false,
		Error:   "not implemented yet",
	}, nil
}

// StreamBuildLogs streams build logs in real-time
func (s *BuildServer) StreamBuildLogs(
	req *buildv1.StreamBuildLogsRequest,
	stream buildv1.BuildService_StreamBuildLogsServer,
) error {
	s.logger.Info("StreamBuildLogs called",
		"request_id", req.RequestId,
	)

	// TODO: Implement log streaming
	return status.Error(codes.Unimplemented, "StreamBuildLogs not yet implemented")
}
