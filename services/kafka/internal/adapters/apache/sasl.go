package apache

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"strings"

	"github.com/twmb/franz-go/pkg/sasl"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	"github.com/twmb/franz-go/pkg/sasl/scram"
)

var (
	// ErrUnsupportedSASLMechanism is returned when an unsupported SASL mechanism is requested
	ErrUnsupportedSASLMechanism = errors.New("unsupported SASL mechanism")

	// ErrInvalidCACert is returned when the CA certificate is invalid
	ErrInvalidCACert = errors.New("failed to parse CA certificate")
)

// buildSASLMechanism creates a SASL mechanism based on the configuration.
// Returns nil if no authentication is configured (empty username or mechanism).
// Returns an error for unsupported mechanisms.
func buildSASLMechanism(mechanism, username, password string) (sasl.Mechanism, error) {
	// No auth if username or mechanism is empty
	if username == "" || mechanism == "" {
		return nil, nil
	}

	switch strings.ToUpper(mechanism) {
	case "PLAIN":
		return plain.Plain(func(ctx context.Context) (plain.Auth, error) {
			return plain.Auth{
				User: username,
				Pass: password,
			}, nil
		}), nil

	case "SCRAM-SHA-256":
		return scram.Sha256(func(ctx context.Context) (scram.Auth, error) {
			return scram.Auth{
				User: username,
				Pass: password,
			}, nil
		}), nil

	case "SCRAM-SHA-512":
		return scram.Sha512(func(ctx context.Context) (scram.Auth, error) {
			return scram.Auth{
				User: username,
				Pass: password,
			}, nil
		}), nil

	default:
		return nil, ErrUnsupportedSASLMechanism
	}
}

// buildTLSConfig creates a TLS configuration based on the provided settings.
// Returns nil if TLS is disabled.
// Returns an error if the CA certificate is invalid.
func buildTLSConfig(tlsEnabled, tlsSkipVerify bool, tlsCACert string) (*tls.Config, error) {
	if !tlsEnabled {
		return nil, nil
	}

	tlsConfig := &tls.Config{
		InsecureSkipVerify: tlsSkipVerify,
		MinVersion:         tls.VersionTLS12,
	}

	// Add custom CA certificate if provided
	if tlsCACert != "" {
		certPool := x509.NewCertPool()
		if !certPool.AppendCertsFromPEM([]byte(tlsCACert)) {
			return nil, ErrInvalidCACert
		}
		tlsConfig.RootCAs = certPool
	}

	return tlsConfig, nil
}

// shouldEnableTLS determines if TLS should be enabled based on config.
// TLS is enabled if explicitly set or if the security protocol ends with "SSL".
func shouldEnableTLS(tlsEnabled bool, securityProtocol string) bool {
	if tlsEnabled {
		return true
	}
	return strings.HasSuffix(strings.ToUpper(securityProtocol), "SSL")
}
