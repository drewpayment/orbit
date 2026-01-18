// services/bifrost/internal/admin/server.go
package admin

import (
	"fmt"
	"net"

	"github.com/sirupsen/logrus"
	"google.golang.org/grpc"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

// Server wraps the gRPC server for the Admin API.
type Server struct {
	grpcServer *grpc.Server
	service    *Service
	port       int
}

// NewServer creates a new admin server.
func NewServer(service *Service, port int) *Server {
	grpcServer := grpc.NewServer()
	gatewayv1.RegisterBifrostAdminServiceServer(grpcServer, service)

	return &Server{
		grpcServer: grpcServer,
		service:    service,
		port:       port,
	}
}

// Start begins listening for gRPC connections.
func (s *Server) Start() error {
	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", s.port))
	if err != nil {
		return fmt.Errorf("failed to listen on port %d: %w", s.port, err)
	}

	logrus.Infof("Admin gRPC server listening on port %d", s.port)

	return s.grpcServer.Serve(lis)
}

// Stop gracefully shuts down the server.
func (s *Server) Stop() {
	logrus.Info("Stopping Admin gRPC server...")
	s.grpcServer.GracefulStop()
}

// Port returns the configured port for this server.
func (s *Server) Port() int {
	return s.port
}
