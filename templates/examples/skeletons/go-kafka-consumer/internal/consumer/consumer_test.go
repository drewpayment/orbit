package consumer

import (
	"testing"

	"github.com/twmb/franz-go/pkg/kgo"
)

func TestConfigValidate(t *testing.T) {
	tests := []struct {
		name    string
		cfg     Config
		wantErr bool
	}{
		{
			name:    "valid",
			cfg:     Config{Brokers: "localhost:9092", Topic: "{{ .TOPIC_NAME }}", Group: "{{ .SERVICE_NAME }}"},
			wantErr: false,
		},
		{
			name:    "missing brokers",
			cfg:     Config{Brokers: "", Topic: "{{ .TOPIC_NAME }}", Group: "{{ .SERVICE_NAME }}"},
			wantErr: true,
		},
		{
			name:    "blank brokers list",
			cfg:     Config{Brokers: " , ,", Topic: "{{ .TOPIC_NAME }}", Group: "{{ .SERVICE_NAME }}"},
			wantErr: true,
		},
		{
			name:    "missing topic",
			cfg:     Config{Brokers: "localhost:9092", Topic: "", Group: "{{ .SERVICE_NAME }}"},
			wantErr: true,
		},
		{
			name:    "missing group",
			cfg:     Config{Brokers: "localhost:9092", Topic: "{{ .TOPIC_NAME }}", Group: ""},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.cfg.validate()
			if (err != nil) != tt.wantErr {
				t.Fatalf("validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestSeedBrokersSplitsAndTrims(t *testing.T) {
	cfg := Config{Brokers: "broker-a:9092, broker-b:9092 ,,broker-c:9092"}
	got := cfg.seedBrokers()
	want := []string{"broker-a:9092", "broker-b:9092", "broker-c:9092"}

	if len(got) != len(want) {
		t.Fatalf("seedBrokers() = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("seedBrokers()[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestLogRecordDoesNotError(t *testing.T) {
	r := &kgo.Record{
		Topic: "{{ .TOPIC_NAME }}",
		Key:   []byte("k"),
		Value: []byte("v"),
	}
	if err := LogRecord(r); err != nil {
		t.Fatalf("LogRecord() error = %v, want nil", err)
	}
}
