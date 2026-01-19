// services/bifrost/internal/proxy/bifrost_proxy.go
package proxy

import (
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/sirupsen/logrus"

	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
	"github.com/drewpayment/orbit/services/bifrost/internal/config"
	"github.com/drewpayment/orbit/services/bifrost/internal/metrics"
	"github.com/drewpayment/orbit/services/bifrost/internal/proxy/protocol"
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

	// Phase 1: SASL Authentication
	// ---------------------------------
	// Create authenticator that will capture ConnectionContext
	authenticator := NewBifrostAuthenticator(p.saslHandler)

	// Create LocalSasl for authentication
	localSasl := CreateLocalSaslForBifrost(authenticator, 30*time.Second)

	// Perform SASL handshake directly on client connection
	// This reads SaslHandshake and SaslAuthenticate requests and responds
	if err := p.performSASLAuth(clientConn, localSasl); err != nil {
		logrus.Warnf("Connection %s: SASL auth failed: %v", connID, err)
		p.metrics.RecordAuth(false)
		return
	}
	p.metrics.RecordAuth(true)

	// Get connection context from successful auth
	ctx := authenticator.GetContext()
	if ctx == nil {
		logrus.Errorf("Connection %s: auth succeeded but no context", connID)
		return
	}

	// Phase 2: Upstream Connection and Proxying
	// -------------------------------------------
	// Record per-VC metrics
	p.metrics.RecordConnection(ctx.VirtualClusterID, true)
	defer p.metrics.RecordConnection(ctx.VirtualClusterID, false)

	// Connect to upstream Kafka (from authenticated context)
	brokerConn, err := net.DialTimeout("tcp", ctx.BootstrapServers, 10*time.Second)
	if err != nil {
		logrus.Errorf("Connection %s: failed to connect to %s: %v", connID, ctx.BootstrapServers, err)
		return
	}
	defer brokerConn.Close()

	logrus.Infof("Connection %s: user=%s vc=%s upstream=%s", connID, ctx.Username, ctx.VirtualClusterID, ctx.BootstrapServers)

	// Create BifrostConnection for state management (will be used for rewriting later)
	bifrostConn := NewBifrostConnection(connID, clientConn, ctx, p.metrics)
	_ = bifrostConn // Will be used for rewriting in later tasks

	// Create processor for proxying (SASL already done)
	// Identity address mapper - returns the same host/port (for now)
	// Task 11 will wire in proper rewriting
	identityMapper := func(host string, port int32, nodeId int32) (string, int32, error) {
		return host, port, nil
	}

	proc := newProcessor(ProcessorConfig{
		LocalSasl:             nil, // Auth complete
		MaxOpenRequests:       256,
		WriteTimeout:          30 * time.Second,
		ReadTimeout:           30 * time.Second,
		NetAddressMappingFunc: identityMapper,
	}, ctx.BootstrapServers)

	// Run proxy loops
	// RequestsLoop: client -> broker
	// ResponsesLoop: broker -> client
	done := make(chan struct{})
	go func() {
		_, err := proc.RequestsLoop(brokerConn, clientConn)
		if err != nil && err != io.EOF {
			logrus.Debugf("Connection %s: requests loop ended: %v", connID, err)
		}
		// Close broker connection to unblock ResponsesLoop
		brokerConn.Close()
		close(done)
	}()

	_, err = proc.ResponsesLoop(clientConn, brokerConn)
	if err != nil && err != io.EOF {
		logrus.Debugf("Connection %s: responses loop ended: %v", connID, err)
	}
	// Close client connection to unblock RequestsLoop (if ResponsesLoop exits first)
	clientConn.Close()
	<-done
}

// performSASLAuth handles the SASL authentication phase.
// It reads SASL requests from client and authenticates via LocalSasl.
func (p *BifrostProxy) performSASLAuth(conn net.Conn, localSasl *LocalSasl) error {
	// Set timeout for auth phase
	if err := conn.SetDeadline(time.Now().Add(30 * time.Second)); err != nil {
		return fmt.Errorf("set deadline: %w", err)
	}
	defer conn.SetDeadline(time.Time{}) // Clear deadline after auth

	// Read initial request (should be ApiVersions or SaslHandshake)
	keyVersionBuf := make([]byte, 8)
	if _, err := io.ReadFull(conn, keyVersionBuf); err != nil {
		return fmt.Errorf("read request header: %w", err)
	}

	requestKeyVersion := &protocol.RequestKeyVersion{}
	if err := protocol.Decode(keyVersionBuf, requestKeyVersion); err != nil {
		return fmt.Errorf("decode request header: %w", err)
	}

	// Handle ApiVersions if sent first (Kafka clients often send this)
	if requestKeyVersion.ApiKey == apiKeyApiApiVersions {
		if err := p.handleApiVersionsLocal(conn, requestKeyVersion, keyVersionBuf); err != nil {
			return fmt.Errorf("handle ApiVersions: %w", err)
		}

		// Read next request (should be SaslHandshake now)
		if _, err := io.ReadFull(conn, keyVersionBuf); err != nil {
			return fmt.Errorf("read sasl request header: %w", err)
		}
		if err := protocol.Decode(keyVersionBuf, requestKeyVersion); err != nil {
			return fmt.Errorf("decode sasl request header: %w", err)
		}
	}

	// Must be SaslHandshake
	if requestKeyVersion.ApiKey != apiKeySaslHandshake {
		return fmt.Errorf("expected SaslHandshake (17), got apiKey %d", requestKeyVersion.ApiKey)
	}

	// Use LocalSasl to handle the handshake
	switch requestKeyVersion.ApiVersion {
	case 0:
		return localSasl.receiveAndSendSASLAuthV0(conn, keyVersionBuf)
	case 1:
		return localSasl.receiveAndSendSASLAuthV1(conn, keyVersionBuf)
	default:
		return fmt.Errorf("unsupported SaslHandshake version %d", requestKeyVersion.ApiVersion)
	}
}

// handleApiVersionsLocal responds to ApiVersions request locally.
// This is needed before SASL because we don't have an upstream connection yet.
func (p *BifrostProxy) handleApiVersionsLocal(conn net.Conn, reqKV *protocol.RequestKeyVersion, keyVersionBuf []byte) error {
	// Read the rest of the request
	if int32(reqKV.Length) > protocol.MaxRequestSize {
		return fmt.Errorf("request too large: %d", reqKV.Length)
	}

	restBuf := make([]byte, int(reqKV.Length-4))
	if _, err := io.ReadFull(conn, restBuf); err != nil {
		return fmt.Errorf("read request body: %w", err)
	}

	// Decode to get correlation ID
	payload := append(keyVersionBuf[4:], restBuf...)
	apiVersionsReq := &protocol.ApiVersionsRequest{}
	req := &protocol.Request{Body: apiVersionsReq}
	if err := protocol.Decode(payload, req); err != nil {
		return fmt.Errorf("decode ApiVersions request: %w", err)
	}

	// Build minimal ApiVersions response with supported APIs
	apiVersions := []protocol.ApiVersionsResponseKey{
		{ApiKey: 0, MinVersion: 0, MaxVersion: 9},   // Produce
		{ApiKey: 1, MinVersion: 0, MaxVersion: 13},  // Fetch
		{ApiKey: 2, MinVersion: 0, MaxVersion: 7},   // ListOffsets
		{ApiKey: 3, MinVersion: 0, MaxVersion: 12},  // Metadata
		{ApiKey: 8, MinVersion: 0, MaxVersion: 8},   // OffsetCommit
		{ApiKey: 9, MinVersion: 0, MaxVersion: 8},   // OffsetFetch
		{ApiKey: 10, MinVersion: 0, MaxVersion: 4},  // FindCoordinator
		{ApiKey: 11, MinVersion: 0, MaxVersion: 9},  // JoinGroup
		{ApiKey: 12, MinVersion: 0, MaxVersion: 4},  // Heartbeat
		{ApiKey: 13, MinVersion: 0, MaxVersion: 5},  // LeaveGroup
		{ApiKey: 14, MinVersion: 0, MaxVersion: 5},  // SyncGroup
		{ApiKey: 15, MinVersion: 0, MaxVersion: 5},  // DescribeGroups
		{ApiKey: 16, MinVersion: 0, MaxVersion: 4},  // ListGroups
		{ApiKey: 17, MinVersion: 0, MaxVersion: 1},  // SaslHandshake
		{ApiKey: 18, MinVersion: 0, MaxVersion: 3},  // ApiVersions
		{ApiKey: 19, MinVersion: 0, MaxVersion: 7},  // CreateTopics
		{ApiKey: 20, MinVersion: 0, MaxVersion: 6},  // DeleteTopics
		{ApiKey: 36, MinVersion: 0, MaxVersion: 2},  // SaslAuthenticate
	}

	response := &protocol.ApiVersionsResponse{
		Err:         protocol.ErrNoError,
		ApiVersions: apiVersions,
	}

	bodyBuf, err := protocol.Encode(response)
	if err != nil {
		return fmt.Errorf("encode ApiVersions response: %w", err)
	}

	// Create response header
	header := &protocol.ResponseHeader{
		Length:        int32(len(bodyBuf) + 4), // +4 for correlationID
		CorrelationID: req.CorrelationID,
	}

	headerBuf, err := protocol.Encode(header)
	if err != nil {
		return fmt.Errorf("encode response header: %w", err)
	}

	// Write response
	if _, err := conn.Write(headerBuf); err != nil {
		return fmt.Errorf("write header: %w", err)
	}
	if _, err := conn.Write(bodyBuf); err != nil {
		return fmt.Errorf("write body: %w", err)
	}

	return nil
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
