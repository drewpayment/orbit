package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestHandleHealthz(t *testing.T) {
	h := New([]byte("openapi: 3.1.0"))

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, rec.Code)
	}
}

func TestHandleSpecServesEmbeddedDocument(t *testing.T) {
	spec := []byte("openapi: 3.1.0\ninfo:\n  title: test\n")
	h := New(spec)

	req := httptest.NewRequest(http.MethodGet, "/openapi.yaml", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, rec.Code)
	}
	if !bytes.Equal(rec.Body.Bytes(), spec) {
		t.Errorf("expected body %q, got %q", spec, rec.Body.Bytes())
	}
}

func TestCreateListAndGetWidget(t *testing.T) {
	h := New(nil)

	createReq := httptest.NewRequest(http.MethodPost, "/widgets", strings.NewReader(`{"name":"sprocket"}`))
	createRec := httptest.NewRecorder()
	h.ServeHTTP(createRec, createReq)

	if createRec.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d: %s", http.StatusCreated, createRec.Code, createRec.Body.String())
	}

	var created Widget
	if err := json.NewDecoder(createRec.Body).Decode(&created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.Name != "sprocket" {
		t.Errorf("expected name %q, got %q", "sprocket", created.Name)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/widgets", nil)
	listRec := httptest.NewRecorder()
	h.ServeHTTP(listRec, listReq)

	var listed []Widget
	if err := json.NewDecoder(listRec.Body).Decode(&listed); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("expected 1 widget, got %d", len(listed))
	}

	getReq := httptest.NewRequest(http.MethodGet, "/widgets/"+strconv.Itoa(created.ID), nil)
	getRec := httptest.NewRecorder()
	h.ServeHTTP(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, getRec.Code)
	}
}

func TestCreateWidgetRejectsMissingName(t *testing.T) {
	h := New(nil)

	req := httptest.NewRequest(http.MethodPost, "/widgets", strings.NewReader(`{"name":""}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, rec.Code)
	}
}

func TestGetWidgetNotFound(t *testing.T) {
	h := New(nil)

	req := httptest.NewRequest(http.MethodGet, "/widgets/999", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status %d, got %d", http.StatusNotFound, rec.Code)
	}
}
