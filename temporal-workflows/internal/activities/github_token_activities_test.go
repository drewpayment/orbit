package activities_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
)

// Mock implementations
type MockPayloadClient struct {
	Documents map[string]map[string]interface{}
	Updates   []map[string]interface{}
}

func (m *MockPayloadClient) GetDocument(ctx context.Context, collection string, id string) (map[string]interface{}, error) {
	return m.Documents[id], nil
}

func (m *MockPayloadClient) UpdateDocument(ctx context.Context, collection string, id string, data map[string]interface{}) error {
	m.Updates = append(m.Updates, data)
	return nil
}

func (m *MockPayloadClient) FindDocuments(ctx context.Context, collection string, query map[string]interface{}) ([]map[string]interface{}, error) {
	return nil, nil
}

type MockGitHubClient struct {
	Token     string
	ExpiresAt time.Time
}

func (m *MockGitHubClient) CreateInstallationAccessToken(ctx context.Context, installationID int64) (string, time.Time, error) {
	return m.Token, m.ExpiresAt, nil
}

type MockEncryptionService struct{}

func (m *MockEncryptionService) Encrypt(plaintext string) (string, error) {
	return "encrypted:" + plaintext, nil
}

func (m *MockEncryptionService) Decrypt(ciphertext string) (string, error) {
	return ciphertext[10:], nil // Remove "encrypted:" prefix
}

func TestRefreshGitHubInstallationTokenActivity(t *testing.T) {
	mockPayload := &MockPayloadClient{
		Documents: map[string]map[string]interface{}{
			"install-123": {
				"installationId": int64(456),
				"accountLogin":   "mycompany",
			},
		},
		Updates: []map[string]interface{}{},
	}

	mockGitHub := &MockGitHubClient{
		Token:     "ghs_new_token_abc123",
		ExpiresAt: time.Now().Add(1 * time.Hour),
	}

	mockEncryption := &MockEncryptionService{}

	activities := activities.NewGitHubTokenActivities(mockPayload, mockGitHub, mockEncryption)

	result, err := activities.RefreshGitHubInstallationTokenActivity(context.Background(), "install-123")

	require.NoError(t, err)
	assert.True(t, result.Success)
	assert.Equal(t, mockGitHub.ExpiresAt, result.ExpiresAt)

	// Verify Payload was updated
	require.Len(t, mockPayload.Updates, 1)
	update := mockPayload.Updates[0]
	assert.Equal(t, "encrypted:ghs_new_token_abc123", update["installationToken"])
	assert.Equal(t, "active", update["status"])
	assert.Equal(t, "running", update["temporalWorkflowStatus"])
}

func TestUpdateInstallationStatusActivity(t *testing.T) {
	mockPayload := &MockPayloadClient{
		Updates: []map[string]interface{}{},
	}

	activities := activities.NewGitHubTokenActivities(mockPayload, nil, nil)

	err := activities.UpdateInstallationStatusActivity(context.Background(), "install-123", "suspended", "App uninstalled")

	require.NoError(t, err)
	require.Len(t, mockPayload.Updates, 1)

	update := mockPayload.Updates[0]
	assert.Equal(t, "suspended", update["status"])
	assert.Equal(t, "App uninstalled", update["suspensionReason"])
	assert.NotNil(t, update["suspendedAt"])
}
