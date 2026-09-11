// Command {{ .SERVICE_NAME }} is {{ .DESCRIPTION }}. It serves the API
// described by api/openapi.yaml, registered with Orbit's API catalog by the
// template that scaffolded this repository.
package main

import (
	"context"
	_ "embed"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"{{ .MODULE_PATH }}/internal/handlers"
)

//go:embed api/openapi.yaml
var openapiSpec []byte

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "{{ .PORT }}"
	}

	h := handlers.New(openapiSpec)
	httpServer := &http.Server{
		Addr:              ":" + port,
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("{{ .SERVICE_NAME }} listening on :%s (spec at /openapi.yaml)", port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down {{ .SERVICE_NAME }}")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("graceful shutdown failed: %v", err)
	}
}
