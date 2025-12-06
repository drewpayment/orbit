package main

import (
	"log"
	"log/slog"
	"net"
	"os"

	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	buildv1 "github.com/drewpayment/orbit/proto/gen/go/idp/build/v1"
	"github.com/drewpayment/orbit/services/build-service/internal/grpc/build"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	port := os.Getenv("BUILD_SERVICE_PORT")
	if port == "" {
		port = "50053"
	}

	lis, err := net.Listen("tcp", ":"+port)
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	grpcServer := grpc.NewServer()

	// Create and register build service
	buildService := build.NewBuildServer(logger)
	buildv1.RegisterBuildServiceServer(grpcServer, buildService)

	// Enable reflection for grpcurl/grpcui
	reflection.Register(grpcServer)

	logger.Info("Build service starting", "port", port)

	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("failed to serve: %v", err)
	}
}
