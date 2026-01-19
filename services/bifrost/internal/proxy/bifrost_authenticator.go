// services/bifrost/internal/proxy/bifrost_authenticator.go
package proxy

import (
	"sync"

	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
	"github.com/drewpayment/orbit/services/bifrost/internal/pkg/apis"
)

// SASLAuthenticator is the interface our SASLHandler implements.
// This allows for testing with mocks.
type SASLAuthenticator interface {
	Authenticate(username, password string) (*auth.ConnectionContext, error)
}

// BifrostAuthenticator adapts our SASLHandler to the PasswordAuthenticator interface
// used by the vendored kafka-proxy code. It captures the ConnectionContext from
// successful authentication for later use in request/response rewriting.
type BifrostAuthenticator struct {
	handler SASLAuthenticator
	mu      sync.RWMutex
	ctx     *auth.ConnectionContext
}

// Compile-time check that BifrostAuthenticator implements PasswordAuthenticator
var _ apis.PasswordAuthenticator = (*BifrostAuthenticator)(nil)

// NewBifrostAuthenticator creates an authenticator that wraps our SASLHandler.
func NewBifrostAuthenticator(handler SASLAuthenticator) *BifrostAuthenticator {
	return &BifrostAuthenticator{
		handler: handler,
	}
}

// Authenticate implements apis.PasswordAuthenticator.
// Returns (true, 0, nil) on success, (false, status, nil) on auth failure.
// The error return is reserved for unexpected errors (network issues, etc).
func (a *BifrostAuthenticator) Authenticate(username, password string) (bool, int32, error) {
	ctx, err := a.handler.Authenticate(username, password)
	if err != nil {
		// Map known errors to status codes
		switch err {
		case auth.ErrAuthFailed:
			return false, 1, nil
		case auth.ErrUnknownUser:
			return false, 2, nil
		case auth.ErrInvalidCluster:
			return false, 3, nil
		default:
			// Unexpected error - return it
			return false, 0, err
		}
	}

	// Store context for later retrieval
	a.mu.Lock()
	a.ctx = ctx
	a.mu.Unlock()

	return true, 0, nil
}

// GetContext returns the ConnectionContext from the last successful authentication.
// Returns nil if no successful auth has occurred.
func (a *BifrostAuthenticator) GetContext() *auth.ConnectionContext {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.ctx
}
