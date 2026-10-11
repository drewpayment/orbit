package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLoadConfig_MissingAuthSecretDisablesAdminOnly(t *testing.T) {
	for name, val := range map[string]string{"unset": "", "too short": "short"} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("ORBIT_SVC_AUTH_SECRET", val)

			cfg := loadConfig() // must not exit the process

			assert.Nil(t, cfg.AuthSecret, "no usable secret: admin API stays disabled")
			assert.Equal(t, 9092, cfg.ProxyPort, "the Kafka proxy config is unaffected")
		})
	}
}

func TestLoadConfig_ValidAuthSecret(t *testing.T) {
	t.Setenv("ORBIT_SVC_AUTH_SECRET", "a-valid-secret-that-is-at-least-32-bytes")
	assert.NotNil(t, loadConfig().AuthSecret)
}

func TestReadyHandler(t *testing.T) {
	tests := []struct {
		name         string
		adminEnabled bool
		wantStatus   int
	}{
		{"admin API enabled is ready", true, http.StatusOK},
		{"admin API disabled is not ready", false, http.StatusServiceUnavailable},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			readyHandler(tc.adminEnabled)(rec, httptest.NewRequest(http.MethodGet, "/ready", nil))
			assert.Equal(t, tc.wantStatus, rec.Code)
		})
	}
}
