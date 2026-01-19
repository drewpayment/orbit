// services/bifrost/internal/proxy/bifrost_connection.go
package proxy

import (
	"net"

	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
	"github.com/drewpayment/orbit/services/bifrost/internal/metrics"
)

// BifrostConnection represents a single authenticated client connection.
// It holds the connection context, rewriter, and metrics tracking for the connection.
type BifrostConnection struct {
	id         string
	clientConn net.Conn
	ctx        *auth.ConnectionContext
	rewriter   *Rewriter
	metrics    *metrics.Collector
}

// NewBifrostConnection creates a new connection handler.
// Called after successful SASL authentication.
func NewBifrostConnection(
	id string,
	clientConn net.Conn,
	ctx *auth.ConnectionContext,
	metricsCollector *metrics.Collector,
) *BifrostConnection {
	return &BifrostConnection{
		id:         id,
		clientConn: clientConn,
		ctx:        ctx,
		rewriter:   NewRewriter(ctx),
		metrics:    metricsCollector,
	}
}

// ID returns the connection identifier.
func (c *BifrostConnection) ID() string {
	return c.id
}

// VirtualClusterID returns the virtual cluster this connection belongs to.
func (c *BifrostConnection) VirtualClusterID() string {
	return c.ctx.VirtualClusterID
}

// Rewriter returns the topic/group rewriter for this connection.
func (c *BifrostConnection) Rewriter() *Rewriter {
	return c.rewriter
}

// Context returns the connection context.
func (c *BifrostConnection) Context() *auth.ConnectionContext {
	return c.ctx
}

// BootstrapServers returns the upstream Kafka bootstrap servers.
func (c *BifrostConnection) BootstrapServers() string {
	return c.ctx.BootstrapServers
}

// ClientConn returns the client network connection.
func (c *BifrostConnection) ClientConn() net.Conn {
	return c.clientConn
}
