package schema

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"github.com/drewpayment/orbit/services/kafka/internal/domain"
)

func TestNewClient_ValidConfig(t *testing.T) {
	config := Config{
		URL: "http://localhost:8081",
	}

	client, err := NewClient(config)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client == nil {
		t.Fatal("expected client to be non-nil")
	}
}

func TestNewClient_EmptyURL(t *testing.T) {
	config := Config{
		URL: "",
	}

	client, err := NewClient(config)
	if err == nil {
		t.Fatal("expected error for empty URL")
	}
	if client != nil {
		t.Fatal("expected client to be nil")
	}
	if err.Error() != "URL required" {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestGenerateSubject(t *testing.T) {
	tests := []struct {
		env        string
		workspace  string
		topic      string
		schemaType string
		expected   string
	}{
		{"dev", "payments", "orders", "value", "dev.payments.orders-value"},
		{"prod", "analytics", "events", "key", "prod.analytics.events-key"},
		{"staging", "platform", "logs", "value", "staging.platform.logs-value"},
	}

	for _, tt := range tests {
		result := GenerateSubject(tt.env, tt.workspace, tt.topic, tt.schemaType)
		if result != tt.expected {
			t.Errorf("GenerateSubject(%q, %q, %q, %q) = %q, want %q",
				tt.env, tt.workspace, tt.topic, tt.schemaType, result, tt.expected)
		}
	}
}

func TestConfig_Validate(t *testing.T) {
	tests := []struct {
		name    string
		config  Config
		wantErr bool
	}{
		{
			name:    "valid URL",
			config:  Config{URL: "http://localhost:8081"},
			wantErr: false,
		},
		{
			name:    "empty URL",
			config:  Config{URL: ""},
			wantErr: true,
		},
		{
			name:    "URL with auth",
			config:  Config{URL: "http://localhost:8081", Username: "user", Password: "pass"},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.config.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestClient_ImplementsInterface(t *testing.T) {
	// Verify at compile time that Client implements SchemaRegistryAdapter
	var _ adapters.SchemaRegistryAdapter = (*Client)(nil)
}

func TestMapCompatibility(t *testing.T) {
	tests := []struct {
		input    string
		expected domain.SchemaCompatibility
	}{
		{"BACKWARD", domain.SchemaCompatibilityBackward},
		{"BACKWARD_TRANSITIVE", domain.SchemaCompatibilityBackward},
		{"FORWARD", domain.SchemaCompatibilityForward},
		{"FORWARD_TRANSITIVE", domain.SchemaCompatibilityForward},
		{"FULL", domain.SchemaCompatibilityFull},
		{"FULL_TRANSITIVE", domain.SchemaCompatibilityFull},
		{"NONE", domain.SchemaCompatibilityNone},
		{"UNKNOWN", domain.SchemaCompatibilityBackward}, // defaults to backward
	}

	for _, tt := range tests {
		result := mapCompatibility(tt.input)
		if result != tt.expected {
			t.Errorf("mapCompatibility(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestMapCompatibilityToAPI(t *testing.T) {
	tests := []struct {
		input    domain.SchemaCompatibility
		expected string
	}{
		{domain.SchemaCompatibilityBackward, "BACKWARD"},
		{domain.SchemaCompatibilityForward, "FORWARD"},
		{domain.SchemaCompatibilityFull, "FULL"},
		{domain.SchemaCompatibilityNone, "NONE"},
	}

	for _, tt := range tests {
		result := mapCompatibilityToAPI(tt.input)
		if result != tt.expected {
			t.Errorf("mapCompatibilityToAPI(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestClient_ListSubjects(t *testing.T) {
	// Create test server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/subjects" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Method != "GET" {
			t.Errorf("unexpected method: %s", r.Method)
		}

		w.Header().Set("Content-Type", "application/vnd.schemaregistry.v1+json")
		json.NewEncoder(w).Encode([]string{"subject1", "subject2", "subject3"})
	}))
	defer server.Close()

	client, err := NewClient(Config{URL: server.URL})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	subjects, err := client.ListSubjects(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(subjects) != 3 {
		t.Errorf("expected 3 subjects, got %d", len(subjects))
	}
	if subjects[0] != "subject1" {
		t.Errorf("expected first subject to be subject1, got %s", subjects[0])
	}
}

func TestClient_ListVersions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/subjects/test-subject/versions" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/vnd.schemaregistry.v1+json")
		json.NewEncoder(w).Encode([]int{1, 2, 3})
	}))
	defer server.Close()

	client, err := NewClient(Config{URL: server.URL})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	versions, err := client.ListVersions(context.Background(), "test-subject")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(versions) != 3 {
		t.Errorf("expected 3 versions, got %d", len(versions))
	}
}

func TestClient_ListVersions_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error_code": 40401,
			"message":    "Subject not found",
		})
	}))
	defer server.Close()

	client, err := NewClient(Config{URL: server.URL})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	_, err = client.ListVersions(context.Background(), "nonexistent")
	if err != adapters.ErrSchemaNotFound {
		t.Errorf("expected ErrSchemaNotFound, got %v", err)
	}
}

func TestClient_GetLatestSchema(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/vnd.schemaregistry.v1+json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"subject":    "test-subject",
			"version":    3,
			"id":         100,
			"schemaType": "AVRO",
			"schema":     `{"type":"record","name":"Test"}`,
		})
	}))
	defer server.Close()

	client, err := NewClient(Config{URL: server.URL})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	schema, err := client.GetLatestSchema(context.Background(), "test-subject")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if schema.Subject != "test-subject" {
		t.Errorf("expected subject test-subject, got %s", schema.Subject)
	}
	if schema.Version != 3 {
		t.Errorf("expected version 3, got %d", schema.Version)
	}
	if schema.ID != 100 {
		t.Errorf("expected ID 100, got %d", schema.ID)
	}
	if schema.SchemaType != "AVRO" {
		t.Errorf("expected schemaType AVRO, got %s", schema.SchemaType)
	}
}

func TestClient_CheckCompatibility(t *testing.T) {
	tests := []struct {
		name           string
		serverResponse func(w http.ResponseWriter, r *http.Request)
		expected       bool
		expectErr      bool
	}{
		{
			name: "compatible",
			serverResponse: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/vnd.schemaregistry.v1+json")
				json.NewEncoder(w).Encode(map[string]bool{"is_compatible": true})
			},
			expected:  true,
			expectErr: false,
		},
		{
			name: "incompatible",
			serverResponse: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/vnd.schemaregistry.v1+json")
				json.NewEncoder(w).Encode(map[string]bool{"is_compatible": false})
			},
			expected:  false,
			expectErr: false,
		},
		{
			name: "new subject (404 = compatible)",
			serverResponse: func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNotFound)
			},
			expected:  true,
			expectErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(tt.serverResponse))
			defer server.Close()

			client, err := NewClient(Config{URL: server.URL})
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			result, err := client.CheckCompatibility(context.Background(), "test", adapters.SchemaSpec{
				Schema:     `{"type":"string"}`,
				SchemaType: "AVRO",
			})

			if tt.expectErr && err == nil {
				t.Error("expected error but got none")
			}
			if !tt.expectErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestClient_BasicAuth(t *testing.T) {
	var receivedAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/vnd.schemaregistry.v1+json")
		json.NewEncoder(w).Encode([]string{})
	}))
	defer server.Close()

	client, err := NewClient(Config{
		URL:      server.URL,
		Username: "testuser",
		Password: "testpass",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	_, err = client.ListSubjects(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if receivedAuth == "" {
		t.Error("expected Authorization header to be set")
	}
	// Basic auth header should be present
	if receivedAuth[:6] != "Basic " {
		t.Errorf("expected Basic auth, got %s", receivedAuth[:6])
	}
}
