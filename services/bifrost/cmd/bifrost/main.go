// services/bifrost/cmd/bifrost/main.go
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/sirupsen/logrus"

	"github.com/drewpayment/orbit/services/bifrost/internal/admin"
	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
	"github.com/drewpayment/orbit/services/bifrost/internal/config"
	"github.com/drewpayment/orbit/services/bifrost/internal/metrics"
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

	// Initialize SASL handler (for future proxy integration)
	_ = auth.NewSASLHandler(credStore, vcStore)

	// Start metrics HTTP server
	go func() {
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

		addr := ":" + strconv.Itoa(cfg.MetricsPort)
		logrus.Infof("Metrics server listening on %s", addr)
		if err := http.ListenAndServe(addr, mux); err != nil {
			logrus.Fatalf("Metrics server failed: %v", err)
		}
	}()

	// Start admin gRPC server
	go func() {
		if err := adminServer.Start(); err != nil {
			logrus.Fatalf("Admin server failed: %v", err)
		}
	}()

	// TODO: Start Kafka proxy (Task 10)
	logrus.Warn("Kafka proxy not yet implemented - only Admin API available")

	// Wait for shutdown signal
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	logrus.Info("Bifrost Gateway started successfully")
	<-ctx.Done()

	logrus.Info("Shutting down...")
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
