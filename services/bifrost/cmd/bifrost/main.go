// services/bifrost/cmd/bifrost/main.go
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/sirupsen/logrus"

	"github.com/drewpayment/orbit/services/bifrost/internal/admin"
	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
	"github.com/drewpayment/orbit/services/bifrost/internal/config"
	"github.com/drewpayment/orbit/services/bifrost/internal/metrics"
	"github.com/drewpayment/orbit/services/bifrost/internal/proxy"
)

func main() {
	// Configure logging
	logrus.SetFormatter(&logrus.TextFormatter{
		FullTimestamp: true,
	})
	logrus.SetLevel(logrus.InfoLevel)

	logrus.Info("Bifrost Gateway starting...")

	// Load configuration from environment
	cfg := loadConfig()

	// Set log level from config
	if level, err := logrus.ParseLevel(cfg.LogLevel); err == nil {
		logrus.SetLevel(level)
	}

	// Initialize stores
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()

	// Initialize metrics
	collector := metrics.NewCollector()
	prometheus.MustRegister(collector)

	// Initialize admin service
	adminService := admin.NewService(vcStore, credStore)
	adminServer := admin.NewServer(adminService, cfg.AdminPort)

	// Initialize SASL handler
	saslHandler := auth.NewSASLHandler(credStore, vcStore)

	// Create metrics HTTP server with proper lifecycle management
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.Handler())
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})
	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("READY"))
	})

	metricsServer := &http.Server{
		Addr:    ":" + strconv.Itoa(cfg.MetricsPort),
		Handler: mux,
	}

	// Error channel for server failures
	errChan := make(chan error, 3)

	// Start metrics HTTP server
	go func() {
		logrus.Infof("Metrics server listening on %s", metricsServer.Addr)
		if err := metricsServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			errChan <- fmt.Errorf("metrics server failed: %w", err)
		}
	}()

	// Start admin gRPC server
	go func() {
		if err := adminServer.Start(); err != nil {
			errChan <- fmt.Errorf("admin server failed: %w", err)
		}
	}()

	// Start Kafka proxy
	kafkaProxy := proxy.NewBifrostProxy(
		":"+strconv.Itoa(cfg.ProxyPort),
		saslHandler,
		vcStore,
		collector,
	)
	if err := kafkaProxy.Start(); err != nil {
		errChan <- fmt.Errorf("proxy failed to start: %w", err)
	}

	// Wait for shutdown signal or server error
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logrus.Info("Bifrost Gateway started successfully")

	select {
	case <-ctx.Done():
		logrus.Info("Shutdown signal received")
	case err := <-errChan:
		logrus.Errorf("Server error: %v", err)
	}

	logrus.Info("Shutting down...")

	// Graceful shutdown with timeout
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Stop Kafka proxy first (stops accepting connections)
	kafkaProxy.Stop()

	// Shutdown metrics server gracefully
	if err := metricsServer.Shutdown(shutdownCtx); err != nil {
		logrus.Errorf("Metrics server shutdown error: %v", err)
	}

	// Stop admin server
	adminServer.Stop()

	logrus.Info("Bifrost Gateway stopped")
}

// Config holds the Bifrost gateway configuration.
type Config struct {
	ProxyPort    int
	AdminPort    int
	MetricsPort  int
	KafkaBrokers string
	LogLevel     string
}

func loadConfig() *Config {
	return &Config{
		ProxyPort:    getEnvInt("BIFROST_PROXY_PORT", 9092),
		AdminPort:    getEnvInt("BIFROST_ADMIN_PORT", 50060),
		MetricsPort:  getEnvInt("BIFROST_METRICS_PORT", 8080),
		KafkaBrokers: getEnv("KAFKA_BOOTSTRAP_SERVERS", "redpanda:9092"),
		LogLevel:     getEnv("BIFROST_LOG_LEVEL", "info"),
	}
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}
