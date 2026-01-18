// services/bifrost/internal/auth/credential_test.go
package auth

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

func TestCredentialStore_Upsert(t *testing.T) {
	store := NewCredentialStore()

	cred := &gatewayv1.CredentialConfig{
		Id:               "cred-123",
		VirtualClusterId: "vc-456",
		Username:         "payments-dev-myservice",
		PasswordHash:     "hashed-password",
	}

	store.Upsert(cred)

	got, ok := store.Get("cred-123")
	require.True(t, ok)
	assert.Equal(t, "payments-dev-myservice", got.Username)
}

func TestCredentialStore_GetByUsername(t *testing.T) {
	store := NewCredentialStore()

	cred := &gatewayv1.CredentialConfig{
		Id:       "cred-123",
		Username: "payments-dev-myservice",
	}

	store.Upsert(cred)

	got, ok := store.GetByUsername("payments-dev-myservice")
	require.True(t, ok)
	assert.Equal(t, "cred-123", got.Id)
}

func TestCredentialStore_Authenticate_Success(t *testing.T) {
	store := NewCredentialStore()

	// Use SHA256 hash of "secret123"
	cred := &gatewayv1.CredentialConfig{
		Id:           "cred-123",
		Username:     "testuser",
		PasswordHash: "fcf730b6d95236ecd3c9fc2d92d7b6b2bb061514961aec041d6c7a7192f592e4",
	}

	store.Upsert(cred)

	got, ok := store.Authenticate("testuser", "secret123")
	require.True(t, ok)
	assert.Equal(t, "cred-123", got.Id)
}

func TestCredentialStore_Authenticate_WrongPassword(t *testing.T) {
	store := NewCredentialStore()

	cred := &gatewayv1.CredentialConfig{
		Id:           "cred-123",
		Username:     "testuser",
		PasswordHash: "somehash",
	}

	store.Upsert(cred)

	_, ok := store.Authenticate("testuser", "wrongpassword")
	assert.False(t, ok)
}

func TestCredentialStore_ListByVirtualCluster(t *testing.T) {
	store := NewCredentialStore()

	store.Upsert(&gatewayv1.CredentialConfig{Id: "c1", VirtualClusterId: "vc-1"})
	store.Upsert(&gatewayv1.CredentialConfig{Id: "c2", VirtualClusterId: "vc-1"})
	store.Upsert(&gatewayv1.CredentialConfig{Id: "c3", VirtualClusterId: "vc-2"})

	list := store.ListByVirtualCluster("vc-1")
	assert.Len(t, list, 2)
}

func TestCredentialStore_Delete(t *testing.T) {
	store := NewCredentialStore()

	cred := &gatewayv1.CredentialConfig{
		Id:               "cred-123",
		VirtualClusterId: "vc-456",
		Username:         "testuser",
	}

	store.Upsert(cred)

	// Verify it exists
	_, ok := store.Get("cred-123")
	require.True(t, ok)

	// Delete it
	store.Delete("cred-123")

	// Verify it's gone
	_, ok = store.Get("cred-123")
	assert.False(t, ok)

	// Verify username lookup is also gone
	_, ok = store.GetByUsername("testuser")
	assert.False(t, ok)

	// Verify virtual cluster list is updated
	list := store.ListByVirtualCluster("vc-456")
	assert.Len(t, list, 0)
}

func TestCredentialStore_Delete_NonExistent(t *testing.T) {
	store := NewCredentialStore()

	// Deleting non-existent credential should not panic
	store.Delete("non-existent")
}

func TestCredentialStore_List(t *testing.T) {
	store := NewCredentialStore()

	store.Upsert(&gatewayv1.CredentialConfig{Id: "c1", Username: "user1"})
	store.Upsert(&gatewayv1.CredentialConfig{Id: "c2", Username: "user2"})
	store.Upsert(&gatewayv1.CredentialConfig{Id: "c3", Username: "user3"})

	list := store.List()
	assert.Len(t, list, 3)
}

func TestCredentialStore_Upsert_Update(t *testing.T) {
	store := NewCredentialStore()

	// Insert initial credential
	store.Upsert(&gatewayv1.CredentialConfig{
		Id:               "cred-123",
		VirtualClusterId: "vc-1",
		Username:         "olduser",
	})

	// Update with new username and virtual cluster
	store.Upsert(&gatewayv1.CredentialConfig{
		Id:               "cred-123",
		VirtualClusterId: "vc-2",
		Username:         "newuser",
	})

	// Old username should no longer work
	_, ok := store.GetByUsername("olduser")
	assert.False(t, ok)

	// New username should work
	got, ok := store.GetByUsername("newuser")
	require.True(t, ok)
	assert.Equal(t, "cred-123", got.Id)

	// Old virtual cluster should be empty
	list := store.ListByVirtualCluster("vc-1")
	assert.Len(t, list, 0)

	// New virtual cluster should have the credential
	list = store.ListByVirtualCluster("vc-2")
	assert.Len(t, list, 1)
}

func TestCredentialStore_Authenticate_UserNotFound(t *testing.T) {
	store := NewCredentialStore()

	_, ok := store.Authenticate("nonexistent", "password")
	assert.False(t, ok)
}

func TestCredentialStore_Get_NotFound(t *testing.T) {
	store := NewCredentialStore()

	_, ok := store.Get("nonexistent")
	assert.False(t, ok)
}

func TestCredentialStore_GetByUsername_NotFound(t *testing.T) {
	store := NewCredentialStore()

	_, ok := store.GetByUsername("nonexistent")
	assert.False(t, ok)
}

func TestCredentialStore_ListByVirtualCluster_Empty(t *testing.T) {
	store := NewCredentialStore()

	list := store.ListByVirtualCluster("nonexistent")
	assert.Len(t, list, 0)
}
