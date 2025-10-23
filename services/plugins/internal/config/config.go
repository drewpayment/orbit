package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds the application configuration
type Config struct {
	// Server configuration
	GRPCPort int
	HTTPPort int // For metrics/health checks

	// Backstage configuration
	BackstageURL string

	// Auth configuration
	JWTSecret []byte

	// Timeouts
	BackstageRequestTimeout time.Duration
	GRPCRequestDeadline     time.Duration
	CircuitBreakerTimeout   time.Duration

	// Database (for future use)
	DatabaseURL string

	// Redis (for caching)
	RedisURL string
}

// LoadFromEnv loads configuration from environment variables
func LoadFromEnv() (*Config, error) {
	cfg := &Config{
		GRPCPort:                getEnvAsInt("GRPC_PORT", 50053),
		HTTPPort:                getEnvAsInt("HTTP_PORT", 8080),
		BackstageURL:            getEnv("BACKSTAGE_URL", "http://localhost:7007"),
		JWTSecret:               []byte(getEnv("JWT_SECRET", "dev-secret-key")),
		BackstageRequestTimeout: getEnvAsDuration("BACKSTAGE_TIMEOUT", 10*time.Second),
		GRPCRequestDeadline:     getEnvAsDuration("GRPC_DEADLINE", 15*time.Second),
		CircuitBreakerTimeout:   getEnvAsDuration("CIRCUIT_BREAKER_TIMEOUT", 30*time.Second),
		DatabaseURL:             getEnv("DATABASE_URL", ""),
		RedisURL:                getEnv("REDIS_URL", "redis://localhost:6379"),
	}

	// Validate required configuration
	if cfg.BackstageURL == "" {
		return nil, fmt.Errorf("BACKSTAGE_URL is required")
	}

	return cfg, nil
}

// getEnv gets an environment variable or returns a default value
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getEnvAsInt gets an environment variable as int or returns a default value
func getEnvAsInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return defaultValue
}

// getEnvAsDuration gets an environment variable as duration or returns a default value
func getEnvAsDuration(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if duration, err := time.ParseDuration(value); err == nil {
			return duration
		}
	}
	return defaultValue
}
