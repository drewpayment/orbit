// services/bifrost/internal/proxy/sasl_handshake_test.go
package proxy

import (
	"testing"
	"time"

	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateLocalSaslForBifrost_CreatesEnabledLocalSasl(t *testing.T) {
	ctx := &auth.ConnectionContext{
		VirtualClusterID: "vc-123",
		TopicPrefix:      "tenant:",
	}
	handler := &mockSASLHandler{ctx: ctx}
	authenticator := NewBifrostAuthenticator(handler)

	localSasl := CreateLocalSaslForBifrost(authenticator, 30*time.Second)

	require.NotNil(t, localSasl)
	assert.True(t, localSasl.enabled)
}

func TestCreateLocalSaslForBifrost_ConfiguresTimeout(t *testing.T) {
	ctx := &auth.ConnectionContext{
		VirtualClusterID: "vc-123",
	}
	handler := &mockSASLHandler{ctx: ctx}
	authenticator := NewBifrostAuthenticator(handler)

	timeout := 45 * time.Second
	localSasl := CreateLocalSaslForBifrost(authenticator, timeout)

	require.NotNil(t, localSasl)
	assert.Equal(t, timeout, localSasl.timeout)
}

func TestCreateLocalSaslForBifrost_RegistersPlainMechanism(t *testing.T) {
	ctx := &auth.ConnectionContext{
		VirtualClusterID: "vc-123",
	}
	handler := &mockSASLHandler{ctx: ctx}
	authenticator := NewBifrostAuthenticator(handler)

	localSasl := CreateLocalSaslForBifrost(authenticator, 30*time.Second)

	require.NotNil(t, localSasl)
	// The localAuthenticators map should have PLAIN mechanism registered
	assert.NotNil(t, localSasl.localAuthenticators)
	assert.Contains(t, localSasl.localAuthenticators, SASLPlain)
}
