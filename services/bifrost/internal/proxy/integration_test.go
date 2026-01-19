// services/bifrost/internal/proxy/integration_test.go
package proxy

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"io"
	"net"
	"testing"
	"time"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
	"github.com/drewpayment/orbit/services/bifrost/internal/config"
	"github.com/drewpayment/orbit/services/bifrost/internal/metrics"
	"github.com/drewpayment/orbit/services/bifrost/internal/proxy/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func hashPassword(password string) string {
	hash := sha256.Sum256([]byte(password))
	return hex.EncodeToString(hash[:])
}

func TestBifrostProxy_FullFlow_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	// Start a mock Kafka server that accepts connections after SASL
	mockKafka, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer mockKafka.Close()

	mockKafkaAddr := mockKafka.Addr().String()

	// Handle mock Kafka connections - just respond to metadata
	mockKafkaDone := make(chan struct{})
	go func() {
		defer close(mockKafkaDone)
		for {
			conn, err := mockKafka.Accept()
			if err != nil {
				return
			}
			go handleMockKafkaMetadata(t, conn)
		}
	}()

	// Set up Bifrost with test credentials
	credStore := auth.NewCredentialStore()
	credStore.Upsert(&gatewayv1.CredentialConfig{
		Id:               "cred-1",
		Username:         "testuser",
		PasswordHash:     hashPassword("testpass"),
		VirtualClusterId: "vc-1",
	})

	vcStore := config.NewVirtualClusterStore()
	vcStore.Upsert(&gatewayv1.VirtualClusterConfig{
		Id:                       "vc-1",
		TopicPrefix:              "tenant-a:",
		GroupPrefix:              "tenant-a:",
		TransactionIdPrefix:      "tenant-a:",
		PhysicalBootstrapServers: mockKafkaAddr,
	})

	saslHandler := auth.NewSASLHandler(credStore, vcStore)
	collector := metrics.NewCollector()

	proxy := NewBifrostProxy("127.0.0.1:0", saslHandler, vcStore, collector)
	err = proxy.Start()
	require.NoError(t, err)
	defer proxy.Stop()

	proxyAddr := proxy.listener.Addr().String()

	// Connect to Bifrost as a client
	conn, err := net.DialTimeout("tcp", proxyAddr, 5*time.Second)
	require.NoError(t, err)
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(10 * time.Second))

	// Step 1: Send SaslHandshake request
	err = sendSaslHandshake(conn, "PLAIN")
	require.NoError(t, err, "send SASL handshake")

	// Step 2: Read SaslHandshake response
	err = readSaslHandshakeResponse(conn)
	require.NoError(t, err, "read SASL handshake response")

	// Step 3: Send SaslAuthenticate request with credentials
	err = sendSaslAuthenticate(conn, "testuser", "testpass")
	require.NoError(t, err, "send SASL authenticate")

	// Step 4: Read SaslAuthenticate response
	err = readSaslAuthenticateResponse(conn)
	require.NoError(t, err, "read SASL authenticate response")

	// Step 5: Send a Metadata request (should be proxied to mock Kafka)
	err = sendMetadataRequest(conn)
	require.NoError(t, err, "send metadata request")

	// Step 6: Read Metadata response (from mock Kafka)
	err = readMetadataResponse(conn)
	require.NoError(t, err, "read metadata response")

	// Verify metrics
	assert.Equal(t, int64(1), proxy.TotalConnections())
}

func sendSaslHandshake(conn net.Conn, mechanism string) error {
	// Build SaslHandshake request (API key 17, version 1)
	body := &protocol.SaslHandshakeRequestV0orV1{Version: 1, Mechanism: mechanism}

	// Build request header
	req := &protocol.Request{
		CorrelationID: 1,
		ClientID:      "test-client",
		Body:          body,
	}
	reqBuf, err := protocol.Encode(req)
	if err != nil {
		return err
	}

	// Write length + request
	lengthBuf := make([]byte, 4)
	binary.BigEndian.PutUint32(lengthBuf, uint32(len(reqBuf)))
	if _, err := conn.Write(lengthBuf); err != nil {
		return err
	}
	_, err = conn.Write(reqBuf)
	return err
}

func readSaslHandshakeResponse(conn net.Conn) error {
	// Read response length
	lengthBuf := make([]byte, 4)
	if _, err := io.ReadFull(conn, lengthBuf); err != nil {
		return err
	}
	length := binary.BigEndian.Uint32(lengthBuf)

	// Read response body
	respBuf := make([]byte, length)
	if _, err := io.ReadFull(conn, respBuf); err != nil {
		return err
	}

	// Parse correlation ID and error code
	if len(respBuf) < 6 {
		return io.ErrUnexpectedEOF
	}
	// correlationID := binary.BigEndian.Uint32(respBuf[0:4])
	errorCode := binary.BigEndian.Uint16(respBuf[4:6])
	if errorCode != 0 {
		return &protocol.PacketDecodingError{Info: "SASL handshake error"}
	}
	return nil
}

func sendSaslAuthenticate(conn net.Conn, username, password string) error {
	// Build SASL/PLAIN auth bytes: \0username\0password
	authBytes := bytes.Join([][]byte{
		{0},
		[]byte(username),
		{0},
		[]byte(password),
	}, nil)

	body := &protocol.SaslAuthenticateRequestV0{SaslAuthBytes: authBytes}
	bodyBuf, err := protocol.Encode(body)
	if err != nil {
		return err
	}

	// For SaslAuthenticate v0, we need to build the raw request manually
	// Format: Size(4) | ApiKey(2) | ApiVersion(2) | CorrelationID(4) | ClientID(string) | Body
	var buf bytes.Buffer

	// ApiKey = 36
	binary.Write(&buf, binary.BigEndian, int16(36))
	// ApiVersion = 0
	binary.Write(&buf, binary.BigEndian, int16(0))
	// CorrelationID = 2
	binary.Write(&buf, binary.BigEndian, int32(2))
	// ClientID (null string = -1 length)
	binary.Write(&buf, binary.BigEndian, int16(-1))
	// Body
	buf.Write(bodyBuf)

	reqBuf := buf.Bytes()

	// Write length + request
	lengthBuf := make([]byte, 4)
	binary.BigEndian.PutUint32(lengthBuf, uint32(len(reqBuf)))
	if _, err := conn.Write(lengthBuf); err != nil {
		return err
	}
	_, err = conn.Write(reqBuf)
	return err
}

func readSaslAuthenticateResponse(conn net.Conn) error {
	// Read response length
	lengthBuf := make([]byte, 4)
	if _, err := io.ReadFull(conn, lengthBuf); err != nil {
		return err
	}
	length := binary.BigEndian.Uint32(lengthBuf)

	// Read response body
	respBuf := make([]byte, length)
	if _, err := io.ReadFull(conn, respBuf); err != nil {
		return err
	}

	// Parse error code (after correlation ID)
	if len(respBuf) < 6 {
		return io.ErrUnexpectedEOF
	}
	// correlationID := binary.BigEndian.Uint32(respBuf[0:4])
	errorCode := binary.BigEndian.Uint16(respBuf[4:6])
	if errorCode != 0 {
		return &protocol.PacketDecodingError{Info: "SASL authenticate error"}
	}
	return nil
}

func sendMetadataRequest(conn net.Conn) error {
	// Build minimal Metadata request (API key 3, version 0)
	// Format: Size(4) | ApiKey(2) | ApiVersion(2) | CorrelationID(4) | ClientID(string) | Topics array
	var buf bytes.Buffer

	// ApiKey = 3
	binary.Write(&buf, binary.BigEndian, int16(3))
	// ApiVersion = 0
	binary.Write(&buf, binary.BigEndian, int16(0))
	// CorrelationID = 3
	binary.Write(&buf, binary.BigEndian, int32(3))
	// ClientID (null string = -1 length)
	binary.Write(&buf, binary.BigEndian, int16(-1))
	// Topics array (empty = all topics)
	binary.Write(&buf, binary.BigEndian, int32(0))

	reqBuf := buf.Bytes()

	// Write length + request
	lengthBuf := make([]byte, 4)
	binary.BigEndian.PutUint32(lengthBuf, uint32(len(reqBuf)))
	if _, err := conn.Write(lengthBuf); err != nil {
		return err
	}
	_, err := conn.Write(reqBuf)
	return err
}

func readMetadataResponse(conn net.Conn) error {
	// Read response length
	lengthBuf := make([]byte, 4)
	if _, err := io.ReadFull(conn, lengthBuf); err != nil {
		return err
	}
	length := binary.BigEndian.Uint32(lengthBuf)

	// Read response body
	respBuf := make([]byte, length)
	_, err := io.ReadFull(conn, respBuf)
	return err
}

func handleMockKafkaMetadata(t *testing.T, conn net.Conn) {
	defer conn.Close()

	for {
		// Read request
		lengthBuf := make([]byte, 4)
		if _, err := io.ReadFull(conn, lengthBuf); err != nil {
			return
		}
		length := binary.BigEndian.Uint32(lengthBuf)

		reqBuf := make([]byte, length)
		if _, err := io.ReadFull(conn, reqBuf); err != nil {
			return
		}

		// Parse ApiKey and CorrelationID
		if len(reqBuf) < 8 {
			return
		}
		apiKey := binary.BigEndian.Uint16(reqBuf[0:2])
		// apiVersion := binary.BigEndian.Uint16(reqBuf[2:4])
		correlationID := binary.BigEndian.Uint32(reqBuf[4:8])

		// Build response based on API key
		var respBody []byte
		switch apiKey {
		case 3: // Metadata
			// Minimal metadata response: brokers=[], topics=[]
			respBody = buildMinimalMetadataResponse()
		default:
			// Unknown API, send empty response
			respBody = []byte{}
		}

		// Build response with header
		var respBuf bytes.Buffer
		binary.Write(&respBuf, binary.BigEndian, int32(len(respBody)+4)) // length includes correlationID
		binary.Write(&respBuf, binary.BigEndian, correlationID)
		respBuf.Write(respBody)

		if _, err := conn.Write(respBuf.Bytes()); err != nil {
			return
		}
	}
}

func buildMinimalMetadataResponse() []byte {
	// Metadata v0 response: brokers array, topic_metadata array
	var buf bytes.Buffer
	// Brokers array length = 1
	binary.Write(&buf, binary.BigEndian, int32(1))
	// Broker: node_id, host, port
	binary.Write(&buf, binary.BigEndian, int32(0))          // node_id
	binary.Write(&buf, binary.BigEndian, int16(9))          // host length
	buf.WriteString("localhost")                            // host
	binary.Write(&buf, binary.BigEndian, int32(9092))       // port
	// Topic metadata array length = 0
	binary.Write(&buf, binary.BigEndian, int32(0))
	return buf.Bytes()
}
