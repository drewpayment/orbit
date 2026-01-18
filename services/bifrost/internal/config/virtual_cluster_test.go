// services/bifrost/internal/config/virtual_cluster_test.go
package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

func TestVirtualClusterStore_Upsert(t *testing.T) {
	store := NewVirtualClusterStore()

	vc := &gatewayv1.VirtualClusterConfig{
		Id:                       "vc-123",
		ApplicationSlug:          "payments",
		Environment:              "dev",
		TopicPrefix:              "payments-dev-",
		GroupPrefix:              "payments-dev-",
		TransactionIdPrefix:      "payments-dev-",
		AdvertisedHost:           "payments.dev.kafka.orbit.io",
		AdvertisedPort:           9092,
		PhysicalBootstrapServers: "redpanda:9092",
	}

	store.Upsert(vc)

	got, ok := store.Get("vc-123")
	require.True(t, ok)
	assert.Equal(t, "payments-dev-", got.TopicPrefix)
}

func TestVirtualClusterStore_GetByAdvertisedHost(t *testing.T) {
	store := NewVirtualClusterStore()

	vc := &gatewayv1.VirtualClusterConfig{
		Id:             "vc-123",
		AdvertisedHost: "payments.dev.kafka.orbit.io",
		AdvertisedPort: 9092,
	}

	store.Upsert(vc)

	got, ok := store.GetByAdvertisedHost("payments.dev.kafka.orbit.io")
	require.True(t, ok)
	assert.Equal(t, "vc-123", got.Id)
}

func TestVirtualClusterStore_Delete(t *testing.T) {
	store := NewVirtualClusterStore()

	vc := &gatewayv1.VirtualClusterConfig{Id: "vc-123"}
	store.Upsert(vc)

	store.Delete("vc-123")

	_, ok := store.Get("vc-123")
	assert.False(t, ok)
}

func TestVirtualClusterStore_List(t *testing.T) {
	store := NewVirtualClusterStore()

	store.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-1"})
	store.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-2"})

	list := store.List()
	assert.Len(t, list, 2)
}

func TestVirtualClusterStore_Count(t *testing.T) {
	store := NewVirtualClusterStore()

	assert.Equal(t, 0, store.Count())

	store.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-1"})
	assert.Equal(t, 1, store.Count())

	store.Upsert(&gatewayv1.VirtualClusterConfig{Id: "vc-2"})
	assert.Equal(t, 2, store.Count())

	store.Delete("vc-1")
	assert.Equal(t, 1, store.Count())
}

func TestVirtualClusterStore_UpsertUpdatesAdvertisedHost(t *testing.T) {
	store := NewVirtualClusterStore()

	// Insert with original host
	vc := &gatewayv1.VirtualClusterConfig{
		Id:             "vc-123",
		AdvertisedHost: "old.host.io",
	}
	store.Upsert(vc)

	// Verify original host lookup works
	_, ok := store.GetByAdvertisedHost("old.host.io")
	require.True(t, ok)

	// Update to new host
	vcUpdated := &gatewayv1.VirtualClusterConfig{
		Id:             "vc-123",
		AdvertisedHost: "new.host.io",
	}
	store.Upsert(vcUpdated)

	// Old host should no longer work
	_, ok = store.GetByAdvertisedHost("old.host.io")
	assert.False(t, ok)

	// New host should work
	got, ok := store.GetByAdvertisedHost("new.host.io")
	require.True(t, ok)
	assert.Equal(t, "vc-123", got.Id)
}

func TestVirtualClusterStore_DeleteClearsAdvertisedHost(t *testing.T) {
	store := NewVirtualClusterStore()

	vc := &gatewayv1.VirtualClusterConfig{
		Id:             "vc-123",
		AdvertisedHost: "payments.dev.kafka.orbit.io",
	}
	store.Upsert(vc)

	// Verify host lookup works before delete
	_, ok := store.GetByAdvertisedHost("payments.dev.kafka.orbit.io")
	require.True(t, ok)

	// Delete the virtual cluster
	store.Delete("vc-123")

	// Host lookup should fail after delete
	_, ok = store.GetByAdvertisedHost("payments.dev.kafka.orbit.io")
	assert.False(t, ok)
}

func TestVirtualClusterStore_GetNonExistent(t *testing.T) {
	store := NewVirtualClusterStore()

	_, ok := store.Get("non-existent")
	assert.False(t, ok)

	_, ok = store.GetByAdvertisedHost("non-existent.host.io")
	assert.False(t, ok)
}

func TestVirtualClusterStore_DeleteNonExistent(t *testing.T) {
	store := NewVirtualClusterStore()

	// Should not panic when deleting non-existent entry
	store.Delete("non-existent")
	assert.Equal(t, 0, store.Count())
}
