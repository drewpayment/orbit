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

// AnalyzeRepository analyzes a repository to detect build configuration (placeholder)
func (s *BuildServer) AnalyzeRepository(ctx context.Context, req *buildv1.AnalyzeRepositoryRequest) (*buildv1.AnalyzeRepositoryResponse, error) {
	s.logger.Info("AnalyzeRepository request received", "repo_url", req.RepoUrl)

	// TODO: Implement actual repository analysis in Task 5
	return nil, status.Error(codes.Unimplemented, "AnalyzeRepository method not yet implemented")
}

// BuildImage builds and pushes a container image (placeholder)
func (s *BuildServer) BuildImage(ctx context.Context, req *buildv1.BuildImageRequest) (*buildv1.BuildImageResponse, error) {
	s.logger.Info("BuildImage request received", "request_id", req.RequestId, "app_id", req.AppId)

	// TODO: Implement actual image building in Task 5
	return nil, status.Error(codes.Unimplemented, "BuildImage method not yet implemented")
}

// StreamBuildLogs streams build logs in real-time (placeholder)
func (s *BuildServer) StreamBuildLogs(req *buildv1.StreamBuildLogsRequest, stream buildv1.BuildService_StreamBuildLogsServer) error {
	s.logger.Info("StreamBuildLogs request received", "request_id", req.RequestId)

	// TODO: Implement actual log streaming in Task 5
	return status.Error(codes.Unimplemented, "StreamBuildLogs method not yet implemented")
}
