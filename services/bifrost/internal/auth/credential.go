// services/bifrost/internal/auth/credential.go
package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"sync"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

// CredentialStore is a thread-safe in-memory store for credentials.
type CredentialStore struct {
	mu               sync.RWMutex
	byID             map[string]*gatewayv1.CredentialConfig
	byUsername       map[string]*gatewayv1.CredentialConfig
	byVirtualCluster map[string][]*gatewayv1.CredentialConfig
}

// NewCredentialStore creates a new empty credential store.
func NewCredentialStore() *CredentialStore {
	return &CredentialStore{
		byID:             make(map[string]*gatewayv1.CredentialConfig),
		byUsername:       make(map[string]*gatewayv1.CredentialConfig),
		byVirtualCluster: make(map[string][]*gatewayv1.CredentialConfig),
	}
}

// Upsert adds or updates a credential.
func (s *CredentialStore) Upsert(cred *gatewayv1.CredentialConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Clean up old mappings if updating
	if old, ok := s.byID[cred.Id]; ok {
		delete(s.byUsername, old.Username)
		s.removeFromVCList(old.VirtualClusterId, old.Id)
	}

	s.byID[cred.Id] = cred
	s.byUsername[cred.Username] = cred

	// Add to virtual cluster index
	s.byVirtualCluster[cred.VirtualClusterId] = append(
		s.byVirtualCluster[cred.VirtualClusterId], cred)
}

func (s *CredentialStore) removeFromVCList(vcID, credID string) {
	list := s.byVirtualCluster[vcID]
	for i, c := range list {
		if c.Id == credID {
			s.byVirtualCluster[vcID] = append(list[:i], list[i+1:]...)
			return
		}
	}
}

// Get retrieves a credential by ID.
// WARNING: Returns a direct reference to internal storage. Do not mutate.
func (s *CredentialStore) Get(id string) (*gatewayv1.CredentialConfig, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cred, ok := s.byID[id]
	return cred, ok
}

// GetByUsername retrieves a credential by username.
// WARNING: Returns a direct reference to internal storage. Do not mutate.
func (s *CredentialStore) GetByUsername(username string) (*gatewayv1.CredentialConfig, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cred, ok := s.byUsername[username]
	return cred, ok
}

// Authenticate validates username/password and returns the credential if valid.
// WARNING: Returns a direct reference to internal storage. Do not mutate.
func (s *CredentialStore) Authenticate(username, password string) (*gatewayv1.CredentialConfig, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	cred, ok := s.byUsername[username]
	if !ok {
		return nil, false
	}

	// Hash the provided password and compare
	hash := sha256.Sum256([]byte(password))
	hashStr := hex.EncodeToString(hash[:])

	if hashStr != cred.PasswordHash {
		return nil, false
	}

	return cred, true
}

// Delete removes a credential by ID.
func (s *CredentialStore) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if cred, ok := s.byID[id]; ok {
		delete(s.byUsername, cred.Username)
		s.removeFromVCList(cred.VirtualClusterId, id)
		delete(s.byID, id)
	}
}

// ListByVirtualCluster returns all credentials for a virtual cluster.
// WARNING: The returned configs are direct references to internal storage.
// Callers MUST NOT mutate the returned configs.
func (s *CredentialStore) ListByVirtualCluster(vcID string) []*gatewayv1.CredentialConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()

	list := s.byVirtualCluster[vcID]
	result := make([]*gatewayv1.CredentialConfig, len(list))
	copy(result, list)
	return result
}

// List returns all credentials.
// WARNING: The returned configs are direct references to internal storage.
// Callers MUST NOT mutate the returned configs.
func (s *CredentialStore) List() []*gatewayv1.CredentialConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]*gatewayv1.CredentialConfig, 0, len(s.byID))
	for _, cred := range s.byID {
		result = append(result, cred)
	}
	return result
}
