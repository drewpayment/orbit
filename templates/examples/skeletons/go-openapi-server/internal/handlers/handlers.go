// Package handlers implements the HTTP surface for {{ .SERVICE_NAME }},
// matching the operations described in api/openapi.yaml.
package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// Widget is the one example resource this stub CRUDs, matching the
// "/widgets" path in the default OpenAPI document. Replace with your real
// domain type(s) as you flesh out api/openapi.yaml.
type Widget struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// Handlers is the top-level http.Handler for {{ .SERVICE_NAME }}.
type Handlers struct {
	mux  *http.ServeMux
	spec []byte

	mu      sync.Mutex
	nextID  int
	widgets map[int]Widget
}

// New builds a Handlers with all routes registered. spec is served verbatim
// at GET /openapi.yaml.
func New(spec []byte) *Handlers {
	h := &Handlers{
		mux:     http.NewServeMux(),
		spec:    spec,
		nextID:  1,
		widgets: make(map[int]Widget),
	}
	h.routes()
	return h
}

func (h *Handlers) routes() {
	h.mux.HandleFunc("GET /healthz", h.handleHealthz)
	h.mux.HandleFunc("GET /openapi.yaml", h.handleSpec)
	h.mux.HandleFunc("GET /widgets", h.handleListWidgets)
	h.mux.HandleFunc("POST /widgets", h.handleCreateWidget)
	h.mux.HandleFunc("GET /widgets/{id}", h.handleGetWidget)
}

func (h *Handlers) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mux.ServeHTTP(w, r)
}

func (h *Handlers) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "{{ .SERVICE_NAME }}"})
}

func (h *Handlers) handleSpec(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/yaml")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(h.spec)
}

func (h *Handlers) handleListWidgets(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()

	out := make([]Widget, 0, len(h.widgets))
	for _, widget := range h.widgets {
		out = append(out, widget)
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *Handlers) handleCreateWidget(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}

	h.mu.Lock()
	widget := Widget{ID: h.nextID, Name: in.Name}
	h.widgets[widget.ID] = widget
	h.nextID++
	h.mu.Unlock()

	writeJSON(w, http.StatusCreated, widget)
}

func (h *Handlers) handleGetWidget(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "id must be an integer"})
		return
	}

	h.mu.Lock()
	widget, ok := h.widgets[id]
	h.mu.Unlock()

	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "widget not found"})
		return
	}
	writeJSON(w, http.StatusOK, widget)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
