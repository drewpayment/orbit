// Command {{ .SERVICE_NAME }} is {{ .DESCRIPTION }}. It consumes from the
// "{{ .TOPIC_NAME }}" topic and logs each record; replace the record handler
// in internal/consumer with real processing logic.
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"{{ .MODULE_PATH }}/internal/consumer"
)

func main() {
	cfg := consumer.Config{
		Brokers: envOrDefault("KAFKA_BROKERS", "localhost:9092"),
		Topic:   envOrDefault("KAFKA_TOPIC", "{{ .TOPIC_NAME }}"),
		Group:   envOrDefault("KAFKA_CONSUMER_GROUP", "{{ .SERVICE_NAME }}"),
	}

	c, err := consumer.New(cfg)
	if err != nil {
		log.Fatalf("build consumer: %v", err)
	}
	defer c.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	log.Printf("{{ .SERVICE_NAME }} consuming topic %q as group %q", cfg.Topic, cfg.Group)
	if err := c.Run(ctx, consumer.LogRecord); err != nil {
		log.Fatalf("consumer stopped: %v", err)
	}
	log.Println("{{ .SERVICE_NAME }} shut down cleanly")
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
