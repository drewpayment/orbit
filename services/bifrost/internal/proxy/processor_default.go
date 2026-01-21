package proxy

import (
	"bytes"
	"errors"
	"fmt"
	"github.com/drewpayment/orbit/services/bifrost/internal/proxy/protocol"
	"github.com/sirupsen/logrus"
	"io"
	"strconv"
	"time"
)

type DefaultRequestHandler struct {
}

type DefaultResponseHandler struct {
}

func (handler *DefaultRequestHandler) handleRequest(dst DeadlineWriter, src DeadlineReaderWriter, ctx *RequestsLoopContext) (readErr bool, err error) {
	// logrus.Println("Await Kafka request")

	// waiting for first bytes or EOF - reset deadlines
	if err = src.SetReadDeadline(time.Time{}); err != nil {
		return true, err
	}
	if err = dst.SetWriteDeadline(time.Time{}); err != nil {
		return true, err
	}

	keyVersionBuf := make([]byte, 8) // Size => int32 + ApiKey => int16 + ApiVersion => int16

	if _, err = io.ReadFull(src, keyVersionBuf); err != nil {
		return true, err
	}

	requestKeyVersion := &protocol.RequestKeyVersion{}
	if err = protocol.Decode(keyVersionBuf, requestKeyVersion); err != nil {
		return true, err
	}
	logrus.Debugf("Kafka request key %v, version %v, length %v", requestKeyVersion.ApiKey, requestKeyVersion.ApiVersion, requestKeyVersion.Length)

	if requestKeyVersion.ApiKey < minRequestApiKey || requestKeyVersion.ApiKey > maxRequestApiKey {
		return true, fmt.Errorf("api key %d is invalid, possible cause: using plain connection instead of TLS", requestKeyVersion.ApiKey)
	}

	proxyRequestsTotal.WithLabelValues(ctx.brokerAddress, strconv.Itoa(int(requestKeyVersion.ApiKey)), strconv.Itoa(int(requestKeyVersion.ApiVersion))).Inc()
	proxyRequestsBytes.WithLabelValues(ctx.brokerAddress).Add(float64(requestKeyVersion.Length + 4))

	if _, ok := ctx.forbiddenApiKeys[requestKeyVersion.ApiKey]; ok {
		return true, fmt.Errorf("api key %d is forbidden", requestKeyVersion.ApiKey)
	}

	if ctx.localSasl != nil && ctx.localSasl.enabled {
		if ctx.localSaslDone {
			if requestKeyVersion.ApiKey == apiKeySaslHandshake {
				return false, errors.New("SASL Auth was already done")
			}
		} else {
			switch requestKeyVersion.ApiKey {
			case apiKeySaslHandshake:
				switch requestKeyVersion.ApiVersion {
				case 0:
					if err = ctx.localSasl.receiveAndSendSASLAuthV0(src, keyVersionBuf); err != nil {
						return true, err
					}
				case 1:
					if err = ctx.localSasl.receiveAndSendSASLAuthV1(src, keyVersionBuf); err != nil {
						return true, err
					}
				default:
					return true, fmt.Errorf("only saslHandshake version 0 and 1 are supported, got version %d", requestKeyVersion.ApiVersion)
				}
				ctx.localSaslDone = true
				if err = src.SetDeadline(time.Time{}); err != nil {
					return false, err
				}
				// defaultRequestHandler was consumed but due to local handling enqueued defaultResponseHandler will not be.
				return false, ctx.putNextRequestHandler(defaultRequestHandler)
			case apiKeyApiApiVersions:
				// continue processing
			default:
				return false, errors.New("SASL Auth is required. Only SaslHandshake or ApiVersions requests are allowed")
			}
		}
	}

	mustReply, readBytes, err := handler.mustReply(requestKeyVersion, src, ctx)
	if err != nil {
		return true, err
	}

	// send inFlightRequest to channel before myCopyN to prevent race condition in proxyResponses
	if mustReply {
		if err = sendRequestKeyVersion(ctx.openRequestsChannel, openRequestSendTimeout, requestKeyVersion); err != nil {
			return true, err
		}
	}

	requestDeadline := time.Now().Add(ctx.timeout)
	err = dst.SetWriteDeadline(requestDeadline)
	if err != nil {
		return false, err
	}
	err = src.SetReadDeadline(requestDeadline)
	if err != nil {
		return true, err
	}

	// Get request modifier if config is available
	var requestModifier protocol.RequestModifier
	if ctx.requestModifierConfig != nil {
		requestModifier, err = protocol.GetRequestModifier(requestKeyVersion.ApiKey, requestKeyVersion.ApiVersion, *ctx.requestModifierConfig)
		if err != nil {
			logrus.Warnf("Failed to get request modifier for key=%d version=%d: %v", requestKeyVersion.ApiKey, requestKeyVersion.ApiVersion, err)
			// Continue without modification
			requestModifier = nil
		}
	}

	// Calculate remaining request body length
	remainingLen := int(requestKeyVersion.Length) - 4 - len(readBytes) // 4 = ApiKey(2) + ApiVersion(2)

	if requestModifier != nil && remainingLen > 0 {
		// Read entire request body for modification
		if int32(remainingLen)+4 > protocol.MaxRequestSize {
			return true, protocol.PacketDecodingError{Info: fmt.Sprintf("request of length %d too large", requestKeyVersion.Length)}
		}

		// Build full request body: readBytes + remaining
		fullBody := make([]byte, len(readBytes)+remainingLen)
		copy(fullBody, readBytes)
		if _, err = io.ReadFull(src, fullBody[len(readBytes):]); err != nil {
			return true, err
		}

		// Apply modifier
		modifiedBody, err := requestModifier.Apply(fullBody)
		if err != nil {
			logrus.Warnf("Failed to apply request modifier: %v, forwarding unmodified", err)
			modifiedBody = fullBody
		}

		// Write modified request: update length in header
		newLength := int32(4 + len(modifiedBody)) // 4 = ApiKey(2) + ApiVersion(2)
		newHeader := make([]byte, 8)
		newHeader[0] = byte(newLength >> 24)
		newHeader[1] = byte(newLength >> 16)
		newHeader[2] = byte(newLength >> 8)
		newHeader[3] = byte(newLength)
		newHeader[4] = keyVersionBuf[4] // ApiKey high
		newHeader[5] = keyVersionBuf[5] // ApiKey low
		newHeader[6] = keyVersionBuf[6] // ApiVersion high
		newHeader[7] = keyVersionBuf[7] // ApiVersion low

		logrus.Debugf("Writing modified request to upstream: key=%d, version=%d, originalLength=%d, newLength=%d", requestKeyVersion.ApiKey, requestKeyVersion.ApiVersion, requestKeyVersion.Length, newLength)
		if _, err = dst.Write(newHeader); err != nil {
			logrus.Errorf("Failed to write modified header to upstream: %v", err)
			return false, err
		}
		if _, err = dst.Write(modifiedBody); err != nil {
			logrus.Errorf("Failed to write modified body to upstream: %v", err)
			return false, err
		}
	} else {
		// write - send to broker without modification
		logrus.Debugf("Writing request to upstream: key=%d, version=%d, length=%d", requestKeyVersion.ApiKey, requestKeyVersion.ApiVersion, requestKeyVersion.Length)
		if _, err = dst.Write(keyVersionBuf); err != nil {
			logrus.Errorf("Failed to write header to upstream: %v", err)
			return false, err
		}
		// write - send to broker
		if len(readBytes) > 0 {
			if _, err = dst.Write(readBytes); err != nil {
				return false, err
			}
		}
		// 4 bytes were written as keyVersionBuf (ApiKey, ApiVersion)
		copyLen := int64(requestKeyVersion.Length - int32(4+len(readBytes)))
		if readErr, err = myCopyN(dst, src, copyLen, ctx.buf); err != nil {
			logrus.Errorf("Failed to copy request body to upstream (copyLen=%d): %v", copyLen, err)
			return readErr, err
		}
	}
	logrus.Debugf("Request forwarded to upstream successfully")
	if requestKeyVersion.ApiKey == apiKeySaslHandshake {
		if requestKeyVersion.ApiVersion == 0 {
			return false, ctx.putNextHandlers(saslAuthV0RequestHandler, saslAuthV0ResponseHandler)
		}
	}
	if mustReply {
		return false, ctx.putNextHandlers(defaultRequestHandler, defaultResponseHandler)
	} else {
		return false, ctx.putNextRequestHandler(defaultRequestHandler)
	}
}

func (handler *DefaultRequestHandler) mustReply(requestKeyVersion *protocol.RequestKeyVersion, src io.Reader, ctx *RequestsLoopContext) (bool, []byte, error) {
	if requestKeyVersion.ApiKey == apiKeyProduce {
		if ctx.producerAcks0Disabled {
			return true, nil, nil
		}
		// header version for produce [0..8] is 1 (request_api_key,request_api_version,correlation_id (INT32),client_id, NULLABLE_STRING )
		acksReader := protocol.RequestAcksReader{}

		var (
			acks int16
			err  error
		)
		var bufferRead bytes.Buffer
		reader := io.TeeReader(src, &bufferRead)
		switch requestKeyVersion.ApiVersion {
		case 0, 1, 2:
			// CorrelationID + ClientID
			if err = acksReader.ReadAndDiscardHeaderV1Part(reader); err != nil {
				return false, nil, err
			}
			// acks (INT16)
			acks, err = acksReader.ReadAndDiscardProduceAcks(reader)
			if err != nil {
				return false, nil, err
			}
		default:
			// case 3, 4, 5, 6, 7, 8, 9, 10, 11, 12:
			// CorrelationID + ClientID
			if err = acksReader.ReadAndDiscardHeaderV1Part(reader); err != nil {
				return false, nil, err
			}
			// transactional_id (NULLABLE_STRING),acks (INT16)
			acks, err = acksReader.ReadAndDiscardProduceTxnAcks(reader)
			if err != nil {
				return false, nil, err
			}
		}
		return acks != 0, bufferRead.Bytes(), nil
	}
	return true, nil, nil
}

func (handler *DefaultResponseHandler) handleResponse(dst DeadlineWriter, src DeadlineReader, ctx *ResponsesLoopContext) (readErr bool, err error) {
	//logrus.Println("Await Kafka response")

	// waiting for first bytes or EOF - reset deadlines
	if err = src.SetReadDeadline(time.Time{}); err != nil {
		return true, err
	}
	if err = dst.SetWriteDeadline(time.Time{}); err != nil {
		return true, err
	}

	responseHeaderBuf := make([]byte, 8) // Size => int32, CorrelationId => int32
	if _, err = io.ReadFull(src, responseHeaderBuf); err != nil {
		return true, err
	}

	var responseHeader protocol.ResponseHeader
	if err = protocol.Decode(responseHeaderBuf, &responseHeader); err != nil {
		return true, err
	}

	// Read the inFlightRequests channel after header is read. Otherwise the channel would block and socket EOF from remote would not be received.
	requestKeyVersion, err := receiveRequestKeyVersion(ctx.openRequestsChannel, openRequestReceiveTimeout)
	if err != nil {
		return true, err
	}
	proxyResponsesBytes.WithLabelValues(ctx.brokerAddress).Add(float64(responseHeader.Length + 4))
	logrus.Debugf("Kafka response key %v, version %v, length %v", requestKeyVersion.ApiKey, requestKeyVersion.ApiVersion, responseHeader.Length)

	responseDeadline := time.Now().Add(ctx.timeout)
	err = dst.SetWriteDeadline(responseDeadline)
	if err != nil {
		return false, err
	}
	err = src.SetReadDeadline(responseDeadline)
	if err != nil {
		return true, err
	}
	responseHeaderTaggedFields, err := protocol.NewResponseHeaderTaggedFields(requestKeyVersion)
	if err != nil {
		return true, err
	}
	unknownTaggedFields, err := responseHeaderTaggedFields.MaybeRead(src)
	if err != nil {
		return true, err
	}
	readResponsesHeaderLength := int32(4 + len(unknownTaggedFields)) // 4 = Length + CorrelationID

	// Get response modifier - use extended config if available
	var responseModifier protocol.ResponseModifier
	if ctx.responseModifierConfig != nil {
		responseModifier, err = protocol.GetResponseModifierWithConfig(requestKeyVersion.ApiKey, requestKeyVersion.ApiVersion, *ctx.responseModifierConfig)
	} else {
		responseModifier, err = protocol.GetResponseModifier(requestKeyVersion.ApiKey, requestKeyVersion.ApiVersion, ctx.netAddressMappingFunc)
	}
	if err != nil {
		return true, err
	}
	if responseModifier != nil {
		if responseHeader.Length > protocol.MaxResponseSize {
			return true, protocol.PacketDecodingError{Info: fmt.Sprintf("message of length %d too large", responseHeader.Length)}
		}
		resp := make([]byte, int(responseHeader.Length-readResponsesHeaderLength))
		if _, err = io.ReadFull(src, resp); err != nil {
			return true, err
		}
		newResponseBuf, err := responseModifier.Apply(resp)
		if err != nil {
			return true, err
		}
		// add 4 bytes (CorrelationId) to the length
		newHeaderBuf, err := protocol.Encode(&protocol.ResponseHeader{Length: int32(len(newResponseBuf) + int(readResponsesHeaderLength)), CorrelationID: responseHeader.CorrelationID})
		if err != nil {
			return true, err
		}
		if _, err := dst.Write(newHeaderBuf); err != nil {
			return false, err
		}
		if _, err := dst.Write(unknownTaggedFields); err != nil {
			return false, err
		}
		if _, err := dst.Write(newResponseBuf); err != nil {
			return false, err
		}
	} else {
		// write - send to local
		if _, err := dst.Write(responseHeaderBuf); err != nil {
			return false, err
		}
		if _, err := dst.Write(unknownTaggedFields); err != nil {
			return false, err
		}
		// 4 bytes were written as responseHeaderBuf (CorrelationId) + tagged fields
		if readErr, err = myCopyN(dst, src, int64(responseHeader.Length-readResponsesHeaderLength), ctx.buf); err != nil {
			return readErr, err
		}
	}
	return false, nil // continue nextResponse
}

func sendRequestKeyVersion(openRequestsChannel chan<- protocol.RequestKeyVersion, timeout time.Duration, request *protocol.RequestKeyVersion) error {
	select {
	case openRequestsChannel <- *request:
	default:
		// timer.Stop() will be invoked only after sendRequestKeyVersion is finished (not after select default) !
		timer := time.NewTimer(timeout)
		defer timer.Stop()

		select {
		case openRequestsChannel <- *request:
		case <-timer.C:
			return errors.New("open requests buffer is full")
		}
	}
	return nil
}

func receiveRequestKeyVersion(openRequestsChannel <-chan protocol.RequestKeyVersion, timeout time.Duration) (*protocol.RequestKeyVersion, error) {
	var request protocol.RequestKeyVersion
	select {
	case request = <-openRequestsChannel:
	default:
		// timer.Stop() will be invoked only after receiveRequestKeyVersion is finished (not after select default) !
		timer := time.NewTimer(timeout)
		defer timer.Stop()

		select {
		case request = <-openRequestsChannel:
		case <-timer.C:
			return nil, errors.New("open request is missing")
		}
	}
	return &request, nil
}
