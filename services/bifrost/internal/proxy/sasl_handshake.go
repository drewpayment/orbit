// services/bifrost/internal/proxy/sasl_handshake.go
package proxy

import (
	"time"
)

// CreateLocalSaslForBifrost creates a LocalSasl configured for Bifrost authentication.
// This uses SASL/PLAIN mechanism with our BifrostAuthenticator.
func CreateLocalSaslForBifrost(authenticator *BifrostAuthenticator, timeout time.Duration) *LocalSasl {
	return NewLocalSasl(LocalSaslParams{
		enabled:               true,
		timeout:               timeout,
		passwordAuthenticator: authenticator,
	})
}
