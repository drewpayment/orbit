// Command {{ .SERVICE_NAME }} is {{ .DESCRIPTION }}.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"{{ .MODULE_PATH }}/internal/server"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "{{ .PORT }}"
	}

	srv := server.New()
	httpServer := &http.Server{
		Addr:              ":" + port,
		Handler:           srv,
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("{{ .SERVICE_NAME }} listening on :%s", port)
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
