package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"

	pluginsv1 "github.com/drewpayment/orbit/proto/gen/go/idp/plugins/v1"
	"github.com/drewpayment/orbit/services/plugins/internal/backstage"
	"github.com/drewpayment/orbit/services/plugins/internal/config"
	grpcServer "github.com/drewpayment/orbit/services/plugins/internal/grpc"
	"github.com/drewpayment/orbit/services/plugins/internal/service"
)

func main() {
	log.Println("Starting Orbit Plugins gRPC Service...")

	// Load configuration
	cfg, err := config.LoadFromEnv()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	log.Printf("Configuration loaded: Backstage URL=%s, gRPC Port=%d", cfg.BackstageURL, cfg.GRPCPort)

	// Create Backstage client with circuit breaker
	backstageClient := backstage.NewClientWithCircuitBreaker(cfg.BackstageURL)
	log.Printf("Backstage client created with circuit breaker")

	// Create services
	pluginsService := service.NewPluginsService(backstageClient, cfg.JWTSecret)
	log.Printf("Plugins service initialized")

	// Create gRPC server
	grpcSrv := grpc.NewServer(
		// TODO: Add interceptors for logging, auth, metrics
	)

	// Register services
	pluginsServer := grpcServer.NewServer(pluginsService)
	pluginsv1.RegisterPluginsServiceServer(grpcSrv, pluginsServer)
	log.Printf("Plugins gRPC service registered")

	// Register health check service
	healthServer := health.NewServer()
	grpc_health_v1.RegisterHealthServer(grpcSrv, healthServer)
	healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)
	log.Printf("Health check service registered")

	// Enable reflection for grpcurl/grpcui
	reflection.Register(grpcSrv)
	log.Printf("gRPC reflection enabled")

	// Start gRPC server
	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", cfg.GRPCPort))
	if err != nil {
		log.Fatalf("Failed to listen on port %d: %v", cfg.GRPCPort, err)
	}

	// Start HTTP server for health checks and metrics
	go startHTTPServer(cfg.HTTPPort)

	// Start gRPC server in goroutine
	go func() {
		log.Printf("gRPC server listening on :%d", cfg.GRPCPort)
		if err := grpcSrv.Serve(lis); err != nil {
			log.Fatalf("Failed to serve gRPC: %v", err)
		}
	}()

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	grpcSrv.GracefulStop()
	log.Println("Server stopped")
}

// startHTTPServer starts an HTTP server for health checks and metrics
func startHTTPServer(port int) {
	mux := http.NewServeMux()

	// Health check endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Ready check endpoint
	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		// TODO: Check Backstage backend connectivity
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("READY"))
	})

	// Metrics endpoint (Prometheus format)
	// TODO: Add Prometheus metrics
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("# HELP plugins_requests_total Total number of plugin requests\n"))
		w.Write([]byte("# TYPE plugins_requests_total counter\n"))
		w.Write([]byte("plugins_requests_total 0\n"))
	})

	log.Printf("HTTP server listening on :%d", port)
	if err := http.ListenAndServe(fmt.Sprintf(":%d", port), mux); err != nil {
		log.Fatalf("Failed to start HTTP server: %v", err)
	}
}
