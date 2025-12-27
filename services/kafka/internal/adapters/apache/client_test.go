package apache

import (
	"context"
	"testing"

	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
)

func TestNewClient_ValidConfig(t *testing.T) {
	config := Config{
		BootstrapServers: []string{"localhost:9092"},
		SecurityProtocol: "PLAINTEXT",
	}

	client, err := NewClient(config)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client == nil {
		t.Fatal("expected client to be non-nil")
	}

	// Close should not error
	if err := client.Close(); err != nil {
		t.Errorf("unexpected close error: %v", err)
	}
}

func TestNewClient_EmptyBootstrapServers(t *testing.T) {
	config := Config{
		BootstrapServers: []string{},
		SecurityProtocol: "PLAINTEXT",
	}

	client, err := NewClient(config)
	if err == nil {
		t.Fatal("expected error for empty bootstrap servers")
	}
	if client != nil {
		t.Fatal("expected client to be nil")
	}
	if err.Error() != "bootstrap servers required" {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestConfig_Validate(t *testing.T) {
	tests := []struct {
		name    string
		config  Config
		wantErr bool
	}{
		{
			name: "valid config",
			config: Config{
				BootstrapServers: []string{"localhost:9092"},
			},
			wantErr: false,
		},
		{
			name: "empty bootstrap servers",
			config: Config{
				BootstrapServers: []string{},
			},
			wantErr: true,
		},
		{
			name:    "nil bootstrap servers",
			config:  Config{},
			wantErr: true,
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

func TestTopicSpecToConfig(t *testing.T) {
	spec := adapters.TopicSpec{
		Name:              "test-topic",
		Partitions:        3,
		ReplicationFactor: 2,
		Config: map[string]string{
			"retention.ms":   "86400000",
			"cleanup.policy": "delete",
		},
	}

	result := TopicSpecToConfig(spec)

	if result["retention.ms"] == nil || *result["retention.ms"] != "86400000" {
		t.Errorf("expected retention.ms to be 86400000, got %v", result["retention.ms"])
	}
	if result["cleanup.policy"] == nil || *result["cleanup.policy"] != "delete" {
		t.Errorf("expected cleanup.policy to be delete, got %v", result["cleanup.policy"])
	}
}

func TestSplitServers(t *testing.T) {
	tests := []struct {
		input    string
		expected []string
	}{
		{"localhost:9092", []string{"localhost:9092"}},
		{"a:9092,b:9092,c:9092", []string{"a:9092", "b:9092", "c:9092"}},
		{"", nil},
		{"a:9092,", []string{"a:9092"}},
		{",a:9092", []string{"a:9092"}},
	}

	for _, tt := range tests {
		result := splitServers(tt.input)
		if len(result) != len(tt.expected) {
			t.Errorf("splitServers(%q) = %v, want %v", tt.input, result, tt.expected)
			continue
		}
		for i, v := range result {
			if v != tt.expected[i] {
				t.Errorf("splitServers(%q)[%d] = %q, want %q", tt.input, i, v, tt.expected[i])
			}
		}
	}
}

func TestClient_ImplementsInterface(t *testing.T) {
	// Verify at compile time that Client implements KafkaAdapter
	var _ adapters.KafkaAdapter = (*Client)(nil)
}

func TestClient_StubMethodsReturnNotConfigured(t *testing.T) {
	config := Config{
		BootstrapServers: []string{"localhost:9092"},
	}
	client, err := NewClient(config)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ctx := context.Background()

	// Test that stub methods return ErrNotConfigured
	if err := client.ValidateConnection(ctx); err != ErrNotConfigured {
		t.Errorf("ValidateConnection() should return ErrNotConfigured, got %v", err)
	}

	if err := client.CreateTopic(ctx, adapters.TopicSpec{Name: "test"}); err != ErrNotConfigured {
		t.Errorf("CreateTopic() should return ErrNotConfigured, got %v", err)
	}

	if _, err := client.ListTopics(ctx); err != ErrNotConfigured {
		t.Errorf("ListTopics() should return ErrNotConfigured, got %v", err)
	}
}

func TestNewClientFromCluster(t *testing.T) {
	tests := []struct {
		name        string
		connConfig  map[string]string
		credentials map[string]string
		wantErr     bool
	}{
		{
			name: "valid config",
			connConfig: map[string]string{
				"bootstrapServers": "localhost:9092",
				"securityProtocol": "PLAINTEXT",
			},
			credentials: map[string]string{},
			wantErr:     false,
		},
		{
			name:        "missing bootstrap servers",
			connConfig:  map[string]string{},
			credentials: map[string]string{},
			wantErr:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client, err := NewClientFromCluster(tt.connConfig, tt.credentials)
			if (err != nil) != tt.wantErr {
				t.Errorf("NewClientFromCluster() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && client == nil {
				t.Error("expected non-nil client")
			}
		})
	}
}
