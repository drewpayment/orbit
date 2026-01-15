// temporal-workflows/internal/activities/credential_activities_test.go
package activities

import (
	"context"
	"errors"
	"log/slog"
	"testing"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testLogger() *slog.Logger {
	return slog.Default()
}

// mockBifrostClient implements the BifrostCredentialClient interface for testing
type mockBifrostClient struct {
	upsertCalled   bool
	upsertConfig   *gatewayv1.CredentialConfig
	upsertErr      error
	revokeCalled   bool
	revokeID       string
	revokeErr      error
}

func (m *mockBifrostClient) UpsertCredential(ctx context.Context, cred *gatewayv1.CredentialConfig) error {
	m.upsertCalled = true
	m.upsertConfig = cred
	return m.upsertErr
}

func (m *mockBifrostClient) RevokeCredential(ctx context.Context, credentialID string) error {
	m.revokeCalled = true
	m.revokeID = credentialID
	return m.revokeErr
}

func TestSyncCredentialToBifrost_Success(t *testing.T) {
	mock := &mockBifrostClient{}
	activities := NewCredentialActivities(mock, testLogger())

	input := CredentialSyncInput{
		CredentialID:     "cred-123",
		VirtualClusterID: "vc-456",
		Username:         "staging-myapp-prod-writer",
		PasswordHash:     "$2a$10$hashedpassword",
		Template:         "producer",
	}

	result, err := activities.SyncCredentialToBifrost(context.Background(), input)

	require.NoError(t, err)
	assert.True(t, result.Success)
	assert.Empty(t, result.Error)

	// Verify BifrostClient was called with correct config
	assert.True(t, mock.upsertCalled)
	assert.Equal(t, "cred-123", mock.upsertConfig.Id)
	assert.Equal(t, "vc-456", mock.upsertConfig.VirtualClusterId)
	assert.Equal(t, "staging-myapp-prod-writer", mock.upsertConfig.Username)
	assert.Equal(t, "$2a$10$hashedpassword", mock.upsertConfig.PasswordHash)
	assert.Equal(t, gatewayv1.PermissionTemplate_PERMISSION_TEMPLATE_PRODUCER, mock.upsertConfig.Template)
}

func TestSyncCredentialToBifrost_ConsumerTemplate(t *testing.T) {
	mock := &mockBifrostClient{}
	activities := NewCredentialActivities(mock, testLogger())

	input := CredentialSyncInput{
		CredentialID:     "cred-789",
		VirtualClusterID: "vc-456",
		Username:         "staging-myapp-prod-reader",
		PasswordHash:     "$2a$10$anotherHash",
		Template:         "consumer",
	}

	result, err := activities.SyncCredentialToBifrost(context.Background(), input)

	require.NoError(t, err)
	assert.True(t, result.Success)
	assert.Equal(t, gatewayv1.PermissionTemplate_PERMISSION_TEMPLATE_CONSUMER, mock.upsertConfig.Template)
}

func TestSyncCredentialToBifrost_AdminTemplate(t *testing.T) {
	mock := &mockBifrostClient{}
	activities := NewCredentialActivities(mock, testLogger())

	input := CredentialSyncInput{
		CredentialID:     "cred-admin",
		VirtualClusterID: "vc-456",
		Username:         "staging-myapp-prod-admin",
		PasswordHash:     "$2a$10$adminHash",
		Template:         "admin",
	}

	result, err := activities.SyncCredentialToBifrost(context.Background(), input)

	require.NoError(t, err)
	assert.True(t, result.Success)
	assert.Equal(t, gatewayv1.PermissionTemplate_PERMISSION_TEMPLATE_ADMIN, mock.upsertConfig.Template)
}

func TestSyncCredentialToBifrost_UnknownTemplateDefaultsToUnspecified(t *testing.T) {
	mock := &mockBifrostClient{}
	activities := NewCredentialActivities(mock, testLogger())

	input := CredentialSyncInput{
		CredentialID:     "cred-unknown",
		VirtualClusterID: "vc-456",
		Username:         "staging-myapp-prod-unknown",
		PasswordHash:     "$2a$10$unknownHash",
		Template:         "unknown-template",
	}

	result, err := activities.SyncCredentialToBifrost(context.Background(), input)

	require.NoError(t, err)
	assert.True(t, result.Success)
	assert.Equal(t, gatewayv1.PermissionTemplate_PERMISSION_TEMPLATE_UNSPECIFIED, mock.upsertConfig.Template)
}

func TestSyncCredentialToBifrost_BifrostError(t *testing.T) {
	mock := &mockBifrostClient{
		upsertErr: errors.New("bifrost unavailable"),
	}
	activities := NewCredentialActivities(mock, testLogger())

	input := CredentialSyncInput{
		CredentialID:     "cred-fail",
		VirtualClusterID: "vc-456",
		Username:         "staging-myapp-prod-fail",
		PasswordHash:     "$2a$10$failHash",
		Template:         "producer",
	}

	result, err := activities.SyncCredentialToBifrost(context.Background(), input)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "bifrost unavailable")
	assert.Nil(t, result)
}

func TestSyncCredentialToBifrost_NilBifrostClient(t *testing.T) {
	activities := NewCredentialActivities(nil, testLogger())

	input := CredentialSyncInput{
		CredentialID:     "cred-nil",
		VirtualClusterID: "vc-456",
		Username:         "staging-myapp-prod-nil",
		PasswordHash:     "$2a$10$nilHash",
		Template:         "producer",
	}

	result, err := activities.SyncCredentialToBifrost(context.Background(), input)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "bifrost client not configured")
	assert.Nil(t, result)
}

func TestRevokeCredentialFromBifrost_Success(t *testing.T) {
	mock := &mockBifrostClient{}
	activities := NewCredentialActivities(mock, testLogger())

	input := CredentialRevokeInput{
		CredentialID: "cred-to-revoke",
	}

	result, err := activities.RevokeCredentialFromBifrost(context.Background(), input)

	require.NoError(t, err)
	assert.True(t, result.Success)
	assert.Empty(t, result.Error)

	// Verify BifrostClient was called
	assert.True(t, mock.revokeCalled)
	assert.Equal(t, "cred-to-revoke", mock.revokeID)
}

func TestRevokeCredentialFromBifrost_BifrostError(t *testing.T) {
	mock := &mockBifrostClient{
		revokeErr: errors.New("credential not found"),
	}
	activities := NewCredentialActivities(mock, testLogger())

	input := CredentialRevokeInput{
		CredentialID: "cred-not-found",
	}

	result, err := activities.RevokeCredentialFromBifrost(context.Background(), input)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "credential not found")
	assert.Nil(t, result)
}

func TestRevokeCredentialFromBifrost_NilBifrostClient(t *testing.T) {
	activities := NewCredentialActivities(nil, testLogger())

	input := CredentialRevokeInput{
		CredentialID: "cred-nil-revoke",
	}

	result, err := activities.RevokeCredentialFromBifrost(context.Background(), input)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "bifrost client not configured")
	assert.Nil(t, result)
}
