// services/bifrost/internal/auth/sasl_test.go
package auth

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/services/bifrost/internal/config"
	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

func TestSASLHandler_Authenticate(t *testing.T) {
	credStore := NewCredentialStore()
	vcStore := config.NewVirtualClusterStore()

	// Setup test data
	vcStore.Upsert(&gatewayv1.VirtualClusterConfig{
		Id:          "vc-123",
		TopicPrefix: "test-",
	})

	credStore.Upsert(&gatewayv1.CredentialConfig{
		Id:               "cred-123",
		VirtualClusterId: "vc-123",
		Username:         "testuser",
		// SHA256 of "secret123"
		PasswordHash: "fcf730b6d95236ecd3c9fc2d92d7b6b2bb061514961aec041d6c7a7192f592e4",
	})

	handler := NewSASLHandler(credStore, vcStore)

	// Test successful auth
	ctx, err := handler.Authenticate("testuser", "secret123")
	require.NoError(t, err)
	assert.Equal(t, "cred-123", ctx.CredentialID)
	assert.Equal(t, "vc-123", ctx.VirtualClusterID)
	assert.Equal(t, "test-", ctx.TopicPrefix)
}

func TestSASLHandler_Authenticate_InvalidPassword(t *testing.T) {
	credStore := NewCredentialStore()
	vcStore := config.NewVirtualClusterStore()

	credStore.Upsert(&gatewayv1.CredentialConfig{
		Id:           "cred-123",
		Username:     "testuser",
		PasswordHash: "somehash",
	})

	handler := NewSASLHandler(credStore, vcStore)

	_, err := handler.Authenticate("testuser", "wrongpassword")
	assert.Error(t, err)
	assert.ErrorIs(t, err, ErrAuthFailed)
}

func TestSASLHandler_Authenticate_UnknownUser(t *testing.T) {
	credStore := NewCredentialStore()
	vcStore := config.NewVirtualClusterStore()

	handler := NewSASLHandler(credStore, vcStore)

	_, err := handler.Authenticate("unknownuser", "password")
	assert.Error(t, err)
	assert.ErrorIs(t, err, ErrUnknownUser)
}

func TestSASLHandler_Authenticate_MissingVirtualCluster(t *testing.T) {
	credStore := NewCredentialStore()
	vcStore := config.NewVirtualClusterStore()

	// Credential points to a non-existent virtual cluster
	credStore.Upsert(&gatewayv1.CredentialConfig{
		Id:               "cred-123",
		VirtualClusterId: "vc-missing",
		Username:         "testuser",
		// SHA256 of "secret123"
		PasswordHash: "fcf730b6d95236ecd3c9fc2d92d7b6b2bb061514961aec041d6c7a7192f592e4",
	})

	handler := NewSASLHandler(credStore, vcStore)

	_, err := handler.Authenticate("testuser", "secret123")
	assert.Error(t, err)
	assert.ErrorIs(t, err, ErrInvalidCluster)
}

func TestSASLHandler_Authenticate_FullContext(t *testing.T) {
	credStore := NewCredentialStore()
	vcStore := config.NewVirtualClusterStore()

	// Setup virtual cluster with all prefixes
	vcStore.Upsert(&gatewayv1.VirtualClusterConfig{
		Id:                       "vc-456",
		TopicPrefix:              "payments-dev-",
		GroupPrefix:              "payments-dev-",
		TransactionIdPrefix:      "payments-dev-",
		PhysicalBootstrapServers: "kafka-1:9092,kafka-2:9092",
	})

	credStore.Upsert(&gatewayv1.CredentialConfig{
		Id:               "cred-456",
		VirtualClusterId: "vc-456",
		Username:         "payments-service",
		// SHA256 of "mypassword"
		PasswordHash: "89e01536ac207279409d4de1e5253e01f4a1769e696db0d6062ca9b8f56767c8",
	})

	handler := NewSASLHandler(credStore, vcStore)

	ctx, err := handler.Authenticate("payments-service", "mypassword")
	require.NoError(t, err)

	assert.Equal(t, "cred-456", ctx.CredentialID)
	assert.Equal(t, "vc-456", ctx.VirtualClusterID)
	assert.Equal(t, "payments-service", ctx.Username)
	assert.Equal(t, "payments-dev-", ctx.TopicPrefix)
	assert.Equal(t, "payments-dev-", ctx.GroupPrefix)
	assert.Equal(t, "payments-dev-", ctx.TxnIDPrefix)
	assert.Equal(t, "kafka-1:9092,kafka-2:9092", ctx.BootstrapServers)
}
