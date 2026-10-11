// services/bifrost/internal/admin/server.go
package admin

import (
	"fmt"
	"net"

	"github.com/sirupsen/logrus"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
	"github.com/drewpayment/orbit/proto/pkg/svcauth"
)

// Server wraps the gRPC server for the Admin API.
type Server struct {
	grpcServer *grpc.Server
	service    *Service
	port       int
}

// ServerOptions configures the admin server's security posture.
type ServerOptions struct {
	// Secret is the shared ORBIT_SVC_AUTH_SECRET used to verify the service
	// token on every admin RPC. Required: callers load it with
	// svcauth.LoadSecret so a missing/short secret stops startup.
	Secret []byte
	// EnableReflection registers gRPC server reflection (grpcurl and friends).
	// Reflection is exempt from token verification, so it is off unless a
	// developer explicitly opts in (BIFROST_ADMIN_REFLECTION=true).
	EnableReflection bool
}

// NewServer creates a new admin server. Every admin RPC requires a valid
// service token (default deny) and is then checked against methodPolicies.
func NewServer(service *Service, port int, opts ServerOptions) *Server {
	grpcServer := grpc.NewServer(
		grpc.ChainUnaryInterceptor(
			svcauth.UnaryServerInterceptor(opts.Secret, true),
			policyUnaryInterceptor,
		),
		grpc.ChainStreamInterceptor(
			svcauth.StreamServerInterceptor(opts.Secret, true),
		),
	)
	gatewayv1.RegisterBifrostAdminServiceServer(grpcServer, service)

	if opts.EnableReflection {
		logrus.Warn("Admin gRPC reflection is ENABLED; do not use this setting in production")
		reflection.Register(grpcServer)
	}

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
