// services/bifrost/internal/config/virtual_cluster.go
package config

import (
	"sync"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

// VirtualClusterStore is a thread-safe in-memory store for virtual cluster configs.
type VirtualClusterStore struct {
	mu               sync.RWMutex
	byID             map[string]*gatewayv1.VirtualClusterConfig
	byAdvertisedHost map[string]*gatewayv1.VirtualClusterConfig
}

// NewVirtualClusterStore creates a new empty store.
func NewVirtualClusterStore() *VirtualClusterStore {
	return &VirtualClusterStore{
		byID:             make(map[string]*gatewayv1.VirtualClusterConfig),
		byAdvertisedHost: make(map[string]*gatewayv1.VirtualClusterConfig),
	}
}

// Upsert adds or updates a virtual cluster config.
func (s *VirtualClusterStore) Upsert(vc *gatewayv1.VirtualClusterConfig) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Remove old advertised host mapping if exists
	if old, ok := s.byID[vc.Id]; ok {
		delete(s.byAdvertisedHost, old.AdvertisedHost)
	}

	s.byID[vc.Id] = vc
	if vc.AdvertisedHost != "" {
		s.byAdvertisedHost[vc.AdvertisedHost] = vc
	}
}

// Get retrieves a virtual cluster by ID.
func (s *VirtualClusterStore) Get(id string) (*gatewayv1.VirtualClusterConfig, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	vc, ok := s.byID[id]
	return vc, ok
}

// GetByAdvertisedHost retrieves a virtual cluster by its advertised hostname.
func (s *VirtualClusterStore) GetByAdvertisedHost(host string) (*gatewayv1.VirtualClusterConfig, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	vc, ok := s.byAdvertisedHost[host]
	return vc, ok
}

// Delete removes a virtual cluster by ID.
func (s *VirtualClusterStore) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if vc, ok := s.byID[id]; ok {
		delete(s.byAdvertisedHost, vc.AdvertisedHost)
		delete(s.byID, id)
	}
}

// List returns all virtual clusters.
func (s *VirtualClusterStore) List() []*gatewayv1.VirtualClusterConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]*gatewayv1.VirtualClusterConfig, 0, len(s.byID))
	for _, vc := range s.byID {
		result = append(result, vc)
	}
	return result
}

// Count returns the number of virtual clusters.
func (s *VirtualClusterStore) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.byID)
}
