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

	// Send ApiVersions to upstream broker (required by most brokers)
	if err := p.sendUpstreamApiVersions(brokerConn); err != nil {
		logrus.Errorf("Connection %s: upstream ApiVersions failed: %v", connID, err)
		return
	}

	logrus.Infof("Connection %s: user=%s vc=%s upstream=%s", connID, ctx.Username, ctx.VirtualClusterID, ctx.BootstrapServers)

	// Create BifrostConnection for state management
	bifrostConn := NewBifrostConnection(connID, clientConn, ctx, p.metrics)

	// Create rewriter functions based on virtual cluster configuration
	// Topic prefixer: adds tenant prefix to outgoing topics
	topicPrefixer := func(topic string) string {
		return bifrostConn.rewriter.PrefixTopic(topic)
	}
	// Topic unprefixer: removes tenant prefix from incoming topics
	topicUnprefixer := func(topic string) string {
		unprefixed, _ := bifrostConn.rewriter.UnprefixTopic(topic)
		return unprefixed
	}
	// Topic filter: only include topics belonging to this tenant
	topicFilter := func(topic string) bool {
		return bifrostConn.rewriter.TopicBelongsToTenant(topic)
	}

	// Address mapper - maps internal broker addresses to the advertised address
	// This ensures clients connect back through Bifrost, not directly to the broker
	advertisedMapper := func(host string, port int32, nodeId int32) (string, int32, error) {
		// Return the advertised address from the virtual cluster config
		// This allows clients to connect back through the proxy
		if ctx.AdvertisedHost != "" {
			return ctx.AdvertisedHost, ctx.AdvertisedPort, nil
		}
		// Fallback to original if no advertised address configured
		return host, port, nil
	}

	// Group unprefixer: removes tenant prefix from incoming group IDs
	groupUnprefixer := func(group string) string {
		unprefixed, _ := bifrostConn.rewriter.UnprefixGroup(group)
		return unprefixed
	}
	// Group filter: only include groups belonging to this tenant
	groupFilter := func(group string) bool {
		return bifrostConn.rewriter.GroupBelongsToTenant(group)
	}

	// Create response modifier config with topic and group rewriting
	responseModifierConfig := &protocol.ResponseModifierConfig{
		NetAddressMappingFunc: advertisedMapper,
		TopicUnprefixer:       topicUnprefixer,
		TopicFilter:           topicFilter,
		GroupUnprefixer:       groupUnprefixer,
		GroupFilter:           groupFilter,
	}

	// Create request modifier config with topic prefixing
	requestModifierConfig := &protocol.RequestModifierConfig{
		TopicPrefixer: topicPrefixer,
		GroupPrefixer: func(group string) string {
			return bifrostConn.rewriter.PrefixGroup(group)
		},
		TxnIDPrefixer: func(txnID string) string {
			return bifrostConn.rewriter.PrefixTransactionID(txnID)
		},
	}

	proc := newProcessor(ProcessorConfig{
		LocalSasl:              nil, // Auth complete
		MaxOpenRequests:        256,
		WriteTimeout:           30 * time.Second,
		ReadTimeout:            30 * time.Second,
		NetAddressMappingFunc:  advertisedMapper,
		ResponseModifierConfig: responseModifierConfig,
		RequestModifierConfig:  requestModifierConfig,
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

	readErr, err := proc.ResponsesLoop(clientConn, brokerConn)
	if err != nil {
		logrus.Debugf("Connection %s: responses loop ended: readErr=%v err=%v", connID, readErr, err)
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
	logrus.Debugf("handleApiVersionsLocal: version=%d, length=%d", reqKV.ApiVersion, reqKV.Length)

	// Read the rest of the request
	if int32(reqKV.Length) > protocol.MaxRequestSize {
		return fmt.Errorf("request too large: %d", reqKV.Length)
	}

	restBuf := make([]byte, int(reqKV.Length-4))
	if _, err := io.ReadFull(conn, restBuf); err != nil {
		return fmt.Errorf("read request body: %w", err)
	}

	// Extract correlation ID directly from the payload
	// Format after keyVersionBuf[4:]: ApiKey(2) + ApiVersion(2) + CorrelationID(4) + ...
	// keyVersionBuf[4:] starts at ApiKey, so bytes 4-7 are CorrelationID
	payload := append(keyVersionBuf[4:], restBuf...)
	if len(payload) < 8 {
		return fmt.Errorf("payload too short for ApiVersions request")
	}
	correlationID := int32(payload[4])<<24 | int32(payload[5])<<16 | int32(payload[6])<<8 | int32(payload[7])
	logrus.Debugf("handleApiVersionsLocal: correlationID=%d", correlationID)

	// Build minimal ApiVersions response with supported APIs
	// NOTE: These versions should match what the upstream broker (Redpanda) supports
	// to avoid version mismatches. Query upstream with ApiVersions v0 to check.
	apiVersions := []protocol.ApiVersionsResponseKey{
		{ApiKey: 0, MinVersion: 0, MaxVersion: 7},  // Produce (Redpanda max)
		{ApiKey: 1, MinVersion: 0, MaxVersion: 11}, // Fetch (Redpanda max)
		{ApiKey: 2, MinVersion: 0, MaxVersion: 4},  // ListOffsets (Redpanda max)
		{ApiKey: 3, MinVersion: 0, MaxVersion: 8},  // Metadata (Redpanda max is 8, NOT 12!)
		{ApiKey: 8, MinVersion: 0, MaxVersion: 8},  // OffsetCommit
		{ApiKey: 9, MinVersion: 0, MaxVersion: 7},  // OffsetFetch (Redpanda max)
		{ApiKey: 10, MinVersion: 0, MaxVersion: 3}, // FindCoordinator (Redpanda max)
		{ApiKey: 11, MinVersion: 0, MaxVersion: 6}, // JoinGroup (Redpanda max)
		{ApiKey: 12, MinVersion: 0, MaxVersion: 4}, // Heartbeat
		{ApiKey: 13, MinVersion: 0, MaxVersion: 4}, // LeaveGroup (Redpanda max)
		{ApiKey: 14, MinVersion: 0, MaxVersion: 4}, // SyncGroup (Redpanda max)
		{ApiKey: 15, MinVersion: 0, MaxVersion: 4}, // DescribeGroups (Redpanda max)
		{ApiKey: 16, MinVersion: 0, MaxVersion: 4}, // ListGroups
		{ApiKey: 17, MinVersion: 0, MaxVersion: 1}, // SaslHandshake
		{ApiKey: 18, MinVersion: 0, MaxVersion: 3}, // ApiVersions (Redpanda max)
		{ApiKey: 19, MinVersion: 0, MaxVersion: 6}, // CreateTopics (Redpanda max)
		{ApiKey: 20, MinVersion: 0, MaxVersion: 4}, // DeleteTopics (Redpanda max)
		{ApiKey: 36, MinVersion: 0, MaxVersion: 2}, // SaslAuthenticate
	}

	response := &protocol.ApiVersionsResponse{
		Err:         protocol.ErrNoError,
		ApiVersions: apiVersions,
		ThrottleMs:  0,
	}

	var bodyBuf []byte
	var err error

	// ApiVersions v3+ uses flexible encoding
	if reqKV.ApiVersion >= 3 {
		bodyBuf, err = response.EncodeFlexible()
		if err != nil {
			return fmt.Errorf("encode ApiVersions response (flexible): %w", err)
		}
	} else {
		bodyBuf, err = protocol.Encode(response)
		if err != nil {
			return fmt.Errorf("encode ApiVersions response: %w", err)
		}
	}

	// Create response header
	// IMPORTANT: ApiVersions response ALWAYS uses v0 header (no tagged fields)
	// even when the body uses flexible encoding for v3+. This is a special case
	// in the Kafka protocol to support version negotiation fallback logic.
	// See: https://github.com/twmb/franz-go/blob/master/pkg/kgo/broker.go
	header := &protocol.ResponseHeader{
		Length:        int32(len(bodyBuf) + 4), // +4 for correlationID
		CorrelationID: correlationID,
	}
	headerBuf, err := protocol.Encode(header)
	if err != nil {
		return fmt.Errorf("encode response header: %w", err)
	}

	// Write response
	logrus.Debugf("handleApiVersionsLocal: sending response (v%d) header len=%d, body len=%d", reqKV.ApiVersion, len(headerBuf), len(bodyBuf))
	if _, err := conn.Write(headerBuf); err != nil {
		return fmt.Errorf("write header: %w", err)
	}
	if _, err := conn.Write(bodyBuf); err != nil {
		return fmt.Errorf("write body: %w", err)
	}

	logrus.Debug("handleApiVersionsLocal: response sent successfully")
	return nil
}

// sendUpstreamApiVersions sends an ApiVersions request to the upstream broker
// and reads the response. This is required because Kafka brokers expect
// ApiVersions as the first message on a new connection.
func (p *BifrostProxy) sendUpstreamApiVersions(conn net.Conn) error {
	// Build ApiVersions v4 request
	// Request Header v2: ApiKey(2) + ApiVersion(2) + CorrelationID(4) + ClientID(NULLABLE_STRING with INT16 length) + TAG_BUFFER
	// Request Body: ClientSoftwareName(COMPACT_STRING) + ClientSoftwareVersion(COMPACT_STRING) + TAG_BUFFER
	correlationID := int32(0)

	// Build request
	body := make([]byte, 0, 48)
	// ApiKey: 18 (ApiVersions)
	body = append(body, 0x00, 0x12)
	// ApiVersion: 4
	body = append(body, 0x00, 0x04)
	// CorrelationID
	body = append(body, byte(correlationID>>24), byte(correlationID>>16), byte(correlationID>>8), byte(correlationID))
	// ClientID: "bifrost" using NULLABLE_STRING (INT16 length, NOT compact!)
	// This is because ApiVersions uses request header v2 but ClientID field uses INT16 length
	body = append(body, 0x00, 0x07) // INT16 length = 7
	body = append(body, []byte("bifrost")...)
	// Request Header TAG_BUFFER (empty)
	body = append(body, 0x00)
	// ClientSoftwareName: "bifrost" as compact string (length+1 = 8)
	body = append(body, 0x08) // length+1 = 8
	body = append(body, []byte("bifrost")...)
	// ClientSoftwareVersion: "1.0.0" as compact string (length+1 = 6)
	body = append(body, 0x06) // length+1 = 6
	body = append(body, []byte("1.0.0")...)
	// Request Body TAG_BUFFER (empty)
	body = append(body, 0x00)

	// Build full request with length prefix
	request := make([]byte, 4+len(body))
	length := int32(len(body))
	request[0] = byte(length >> 24)
	request[1] = byte(length >> 16)
	request[2] = byte(length >> 8)
	request[3] = byte(length)
	copy(request[4:], body)

	logrus.Debugf("sendUpstreamApiVersions: sending %d bytes", len(request))

	// Set timeout for handshake
	if err := conn.SetDeadline(time.Now().Add(10 * time.Second)); err != nil {
		return fmt.Errorf("set deadline: %w", err)
	}
	defer conn.SetDeadline(time.Time{}) // Clear deadline after handshake

	// Send request
	if _, err := conn.Write(request); err != nil {
		return fmt.Errorf("write ApiVersions request: %w", err)
	}

	// Read response length
	lenBuf := make([]byte, 4)
	if _, err := io.ReadFull(conn, lenBuf); err != nil {
		return fmt.Errorf("read response length: %w", err)
	}
	respLen := int32(lenBuf[0])<<24 | int32(lenBuf[1])<<16 | int32(lenBuf[2])<<8 | int32(lenBuf[3])
	logrus.Debugf("sendUpstreamApiVersions: response length=%d", respLen)

	if respLen > protocol.MaxResponseSize {
		return fmt.Errorf("response too large: %d", respLen)
	}

	// Read response body (we just need to consume it, don't need to parse)
	respBody := make([]byte, respLen)
	if _, err := io.ReadFull(conn, respBody); err != nil {
		return fmt.Errorf("read response body: %w", err)
	}

	// Verify correlation ID matches (first 4 bytes of response)
	if len(respBody) >= 4 {
		respCorrelationID := int32(respBody[0])<<24 | int32(respBody[1])<<16 | int32(respBody[2])<<8 | int32(respBody[3])
		if respCorrelationID != correlationID {
			return fmt.Errorf("correlation ID mismatch: expected %d, got %d", correlationID, respCorrelationID)
		}
	}

	logrus.Debug("sendUpstreamApiVersions: handshake completed successfully")
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
