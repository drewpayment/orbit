// services/bifrost/internal/auth/sasl.go
package auth

import (
	"errors"

	"github.com/drewpayment/orbit/services/bifrost/internal/config"
)

var (
	// ErrAuthFailed indicates authentication failed (wrong password).
	ErrAuthFailed = errors.New("authentication failed")
	// ErrUnknownUser indicates the user was not found.
	ErrUnknownUser = errors.New("unknown user")
	// ErrInvalidCluster indicates the virtual cluster was not found.
	ErrInvalidCluster = errors.New("virtual cluster not found")
)

// ConnectionContext holds authenticated connection state.
// This is returned after successful SASL authentication and contains
// all the information needed to rewrite topics, groups, and transaction IDs
// for the connection.
type ConnectionContext struct {
	CredentialID     string
	VirtualClusterID string
	Username         string
	TopicPrefix      string
	GroupPrefix      string
	TxnIDPrefix      string
	BootstrapServers string
	AdvertisedHost   string
	AdvertisedPort   int32
}

// SASLHandler handles SASL/PLAIN authentication.
type SASLHandler struct {
	credStore *CredentialStore
	vcStore   *config.VirtualClusterStore
}

// NewSASLHandler creates a new SASL handler.
func NewSASLHandler(credStore *CredentialStore, vcStore *config.VirtualClusterStore) *SASLHandler {
	return &SASLHandler{
		credStore: credStore,
		vcStore:   vcStore,
	}
}

// Authenticate validates credentials and returns connection context.
// It performs the following steps:
// 1. Looks up the credential by username
// 2. Validates the password hash
// 3. Retrieves the associated virtual cluster
// 4. Returns a ConnectionContext with all prefixes for rewriting
func (h *SASLHandler) Authenticate(username, password string) (*ConnectionContext, error) {
	// Authenticate against credential store
	cred, ok := h.credStore.Authenticate(username, password)
	if !ok {
		// Check if user exists for better error
		if _, exists := h.credStore.GetByUsername(username); !exists {
			return nil, ErrUnknownUser
		}
		return nil, ErrAuthFailed
	}

	// Get virtual cluster for this credential
	vc, ok := h.vcStore.Get(cred.VirtualClusterId)
	if !ok {
		return nil, ErrInvalidCluster
	}

	return &ConnectionContext{
		CredentialID:     cred.Id,
		VirtualClusterID: vc.Id,
		Username:         username,
		TopicPrefix:      vc.TopicPrefix,
		GroupPrefix:      vc.GroupPrefix,
		TxnIDPrefix:      vc.TransactionIdPrefix,
		BootstrapServers: vc.PhysicalBootstrapServers,
		AdvertisedHost:   vc.AdvertisedHost,
		AdvertisedPort:   vc.AdvertisedPort,
	}, nil
}
