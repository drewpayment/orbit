// services/bifrost/internal/proxy/bifrost_connection_test.go
package proxy

import (
	"net"
	"testing"

	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
	"github.com/drewpayment/orbit/services/bifrost/internal/metrics"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBifrostConnection_New(t *testing.T) {
	// Create mock connections
	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()

	ctx := &auth.ConnectionContext{
		VirtualClusterID: "vc-123",
		TopicPrefix:      "tenant:",
		GroupPrefix:      "tenant:",
		BootstrapServers: "kafka:9092",
	}

	collector := metrics.NewCollector()
	conn := NewBifrostConnection("conn-1", clientConn, ctx, collector)

	require.NotNil(t, conn)
	assert.Equal(t, "conn-1", conn.ID())
	assert.Equal(t, "vc-123", conn.VirtualClusterID())
	assert.Equal(t, "kafka:9092", conn.BootstrapServers())
}

func TestBifrostConnection_Rewriter(t *testing.T) {
	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()

	ctx := &auth.ConnectionContext{
		VirtualClusterID: "vc-123",
		TopicPrefix:      "tenant:",
		GroupPrefix:      "tenant:",
	}

	collector := metrics.NewCollector()
	conn := NewBifrostConnection("conn-1", clientConn, ctx, collector)

	rewriter := conn.Rewriter()
	require.NotNil(t, rewriter)

	// Test that rewriter has correct prefixes
	assert.Equal(t, "tenant:my-topic", rewriter.PrefixTopic("my-topic"))
	assert.Equal(t, "tenant:my-group", rewriter.PrefixGroup("my-group"))
}

func TestBifrostConnection_Context(t *testing.T) {
	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()

	ctx := &auth.ConnectionContext{
		CredentialID:     "cred-1",
		VirtualClusterID: "vc-123",
		Username:         "testuser",
		TopicPrefix:      "tenant:",
		GroupPrefix:      "tenant:",
		TxnIDPrefix:      "tenant:",
		BootstrapServers: "kafka:9092",
	}

	collector := metrics.NewCollector()
	conn := NewBifrostConnection("conn-1", clientConn, ctx, collector)

	// Should return the same context
	assert.Equal(t, ctx, conn.Context())
}

func TestBifrostConnection_ClientConn(t *testing.T) {
	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()

	ctx := &auth.ConnectionContext{
		VirtualClusterID: "vc-123",
		TopicPrefix:      "tenant:",
		GroupPrefix:      "tenant:",
	}

	collector := metrics.NewCollector()
	conn := NewBifrostConnection("conn-1", clientConn, ctx, collector)

	// Should return the original client connection
	assert.Equal(t, clientConn, conn.ClientConn())
}
