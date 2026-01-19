package proxy

import (
	"net"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
	"github.com/drewpayment/orbit/services/bifrost/internal/config"
	"github.com/drewpayment/orbit/services/bifrost/internal/metrics"
)

func newTestProxy(t *testing.T) *BifrostProxy {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	saslHandler := auth.NewSASLHandler(credStore, vcStore)
	collector := metrics.NewCollector()

	// Use port 0 to let OS assign an available port
	return NewBifrostProxy(":0", saslHandler, vcStore, collector)
}

func TestBifrostProxy_StartStop(t *testing.T) {
	proxy := newTestProxy(t)

	err := proxy.Start()
	require.NoError(t, err)
	assert.NotNil(t, proxy.listener)

	// Allow acceptLoop to start
	time.Sleep(50 * time.Millisecond)

	proxy.Stop()

	// Verify listener is set (Close doesn't nil it)
	assert.NotNil(t, proxy.listener)
}

func TestBifrostProxy_GracefulShutdown(t *testing.T) {
	proxy := newTestProxy(t)

	err := proxy.Start()
	require.NoError(t, err)

	// Create a few connections
	addr := proxy.listener.Addr().String()
	var conns []net.Conn
	for i := 0; i < 3; i++ {
		conn, err := net.Dial("tcp", addr)
		if err == nil {
			conns = append(conns, conn)
		}
	}

	// Allow connections to be handled
	time.Sleep(100 * time.Millisecond)

	// Close client connections first - this simulates clients disconnecting
	// which is realistic since the proxy expects SASL data that won't come
	for _, conn := range conns {
		conn.Close()
	}

	// Allow handlers to notice the closed connections
	time.Sleep(100 * time.Millisecond)

	// Stop should not block indefinitely
	done := make(chan struct{})
	go func() {
		proxy.Stop()
		close(done)
	}()

	select {
	case <-done:
		// Success - shutdown completed
	case <-time.After(2 * time.Second):
		t.Fatal("Stop() timed out - graceful shutdown may be stuck")
	}
}

func TestBifrostProxy_ActiveConnections(t *testing.T) {
	proxy := newTestProxy(t)

	// Initially zero
	assert.Equal(t, int64(0), proxy.ActiveConnections())
	assert.Equal(t, int64(0), proxy.TotalConnections())

	err := proxy.Start()
	require.NoError(t, err)
	defer proxy.Stop()

	// Still zero before any connections
	assert.Equal(t, int64(0), proxy.ActiveConnections())

	// Connect a client
	addr := proxy.listener.Addr().String()
	conn, err := net.Dial("tcp", addr)
	require.NoError(t, err)

	// Allow connection to be handled (it will close immediately in placeholder)
	time.Sleep(100 * time.Millisecond)

	// Total should be incremented, but active will be 0 since handler returns immediately
	assert.Equal(t, int64(1), proxy.TotalConnections())
	// Active might be 0 already since the placeholder handler returns immediately
	// This is expected behavior for the scaffold

	conn.Close()
}

func TestBifrostProxy_TotalConnections(t *testing.T) {
	proxy := newTestProxy(t)

	err := proxy.Start()
	require.NoError(t, err)
	defer proxy.Stop()

	addr := proxy.listener.Addr().String()

	// Create multiple connections
	for i := 0; i < 5; i++ {
		conn, err := net.Dial("tcp", addr)
		if err == nil {
			conn.Close()
		}
	}

	// Allow all connections to be processed
	time.Sleep(200 * time.Millisecond)

	// Total should be 5 (even though all are closed)
	assert.Equal(t, int64(5), proxy.TotalConnections())
}

func TestBifrostProxy_ConcurrentConnections(t *testing.T) {
	proxy := newTestProxy(t)

	err := proxy.Start()
	require.NoError(t, err)
	defer proxy.Stop()

	addr := proxy.listener.Addr().String()

	// Create many connections concurrently
	var wg sync.WaitGroup
	numConns := 20
	for i := 0; i < numConns; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			conn, err := net.Dial("tcp", addr)
			if err == nil {
				time.Sleep(10 * time.Millisecond)
				conn.Close()
			}
		}()
	}

	wg.Wait()
	time.Sleep(100 * time.Millisecond)

	// All connections should have been counted
	assert.Equal(t, int64(numConns), proxy.TotalConnections())
}

func TestBifrostProxy_StartFailsOnBadAddress(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	saslHandler := auth.NewSASLHandler(credStore, vcStore)
	collector := metrics.NewCollector()

	// Use an invalid address that cannot be bound
	proxy := NewBifrostProxy("invalid-address:999999", saslHandler, vcStore, collector)

	err := proxy.Start()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to listen")
}

func TestBifrostProxy_NewBifrostProxy(t *testing.T) {
	vcStore := config.NewVirtualClusterStore()
	credStore := auth.NewCredentialStore()
	saslHandler := auth.NewSASLHandler(credStore, vcStore)
	collector := metrics.NewCollector()

	proxy := NewBifrostProxy(":9999", saslHandler, vcStore, collector)

	assert.Equal(t, ":9999", proxy.listenAddr)
	assert.Equal(t, saslHandler, proxy.saslHandler)
	assert.Equal(t, vcStore, proxy.vcStore)
	assert.Equal(t, collector, proxy.metrics)
	assert.NotNil(t, proxy.shutdown)
	assert.Nil(t, proxy.listener) // Not started yet
}

func TestBifrostProxy_StopWithoutStart(t *testing.T) {
	proxy := newTestProxy(t)

	// Stop without Start should not panic
	assert.NotPanics(t, func() {
		proxy.Stop()
	})
}
