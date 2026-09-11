// Package server implements the HTTP handlers for {{ .SERVICE_NAME }}.
package server

import (
	"encoding/json"
	"net/http"
	"time"
)

// Server is the top-level http.Handler for {{ .SERVICE_NAME }}.
type Server struct {
	mux       *http.ServeMux
	startedAt time.Time
}

// New builds a Server with all routes registered.
func New() *Server {
	s := &Server{
		mux:       http.NewServeMux(),
		startedAt: time.Now(),
	}
	s.routes()
	return s
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.handleHealthz)
	s.mux.HandleFunc("GET /{$}", s.handleIndex)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

type healthResponse struct {
	Status  string `json:"status"`
	Service string `json:"service"`
	Uptime  string `json:"uptime"`
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	resp := healthResponse{
		Status:  "ok",
		Service: "{{ .SERVICE_NAME }}",
		Uptime:  time.Since(s.startedAt).String(),
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleIndex(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("{{ .SERVICE_NAME }}: {{ .DESCRIPTION }}\n"))
}
