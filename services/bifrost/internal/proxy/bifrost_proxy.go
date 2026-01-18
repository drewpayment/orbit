// services/bifrost/internal/proxy/bifrost_proxy.go
package proxy

import (
	"fmt"
	"net"
	"sync"
	"sync/atomic"

	"github.com/sirupsen/logrus"

	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
	"github.com/drewpayment/orbit/services/bifrost/internal/config"
	"github.com/drewpayment/orbit/services/bifrost/internal/metrics"
)

// BifrostProxy is the main Kafka proxy with multi-tenant support.
type BifrostProxy struct {
	listenAddr  string
	saslHandler *auth.SASLHandler
	vcStore     *config.VirtualClusterStore
	metrics     *metrics.Collector

	listener        net.Listener
	connCount       int64 // Total connections ever created (for unique IDs)
	activeConnCount int64 // Currently active connections

	shutdown chan struct{}
	wg       sync.WaitGroup
}

// NewBifrostProxy creates a new multi-tenant Kafka proxy.
func NewBifrostProxy(
	listenAddr string,
	saslHandler *auth.SASLHandler,
	vcStore *config.VirtualClusterStore,
	metricsCollector *metrics.Collector,
) *BifrostProxy {
	return &BifrostProxy{
		listenAddr:  listenAddr,
		saslHandler: saslHandler,
		vcStore:     vcStore,
		metrics:     metricsCollector,
		shutdown:    make(chan struct{}),
	}
}

// Start begins accepting connections.
func (p *BifrostProxy) Start() error {
	var err error
	p.listener, err = net.Listen("tcp", p.listenAddr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", p.listenAddr, err)
	}

	logrus.Infof("Kafka proxy listening on %s", p.listenAddr)

	p.wg.Add(1)
	go p.acceptLoop()

	return nil
}

// acceptLoop continuously accepts new connections until shutdown.
// Shutdown handling: We check the shutdown channel before Accept() to exit quickly
// if already stopped. Accept() is blocking, so we also check after Accept() fails
// because listener.Close() in Stop() causes Accept() to return with an error.
func (p *BifrostProxy) acceptLoop() {
	defer p.wg.Done()

	for {
		// Quick exit if shutdown already triggered
		select {
		case <-p.shutdown:
			return
		default:
		}

		conn, err := p.listener.Accept()
		if err != nil {
			// Check if shutdown was triggered (listener.Close() causes Accept to fail)
			select {
			case <-p.shutdown:
				return
			default:
				logrus.Errorf("Accept error: %v", err)
				continue
			}
		}

		p.wg.Add(1)
		go p.handleConnection(conn)
	}
}

func (p *BifrostProxy) handleConnection(clientConn net.Conn) {
	defer p.wg.Done()
	defer clientConn.Close()
	defer atomic.AddInt64(&p.activeConnCount, -1)

	atomic.AddInt64(&p.activeConnCount, 1)
	connID := fmt.Sprintf("%s-%d", clientConn.RemoteAddr(), atomic.AddInt64(&p.connCount, 1))
	logrus.Debugf("New connection: %s", connID)

	// TODO: Implement full proxy logic
	// 1. Wait for SASL handshake
	// 2. Authenticate via p.saslHandler
	// 3. Get ConnectionContext with prefixes
	// 4. Create Rewriter
	// 5. Connect to upstream Kafka (from context.BootstrapServers)
	// 6. Proxy traffic with rewriting

	// For now, just log and close
	logrus.Warnf("Connection %s: proxy logic not yet implemented", connID)
}

// Stop gracefully shuts down the proxy.
func (p *BifrostProxy) Stop() {
	close(p.shutdown)
	if p.listener != nil {
		p.listener.Close()
	}
	p.wg.Wait()
	logrus.Info("Kafka proxy stopped")
}

// ActiveConnections returns the number of currently active connections.
func (p *BifrostProxy) ActiveConnections() int64 {
	return atomic.LoadInt64(&p.activeConnCount)
}

// TotalConnections returns the total number of connections ever accepted.
func (p *BifrostProxy) TotalConnections() int64 {
	return atomic.LoadInt64(&p.connCount)
}
