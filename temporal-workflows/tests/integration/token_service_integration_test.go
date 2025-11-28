//go:build integration

package integration

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

func TestTokenService_Integration(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	orbitAPIURL := os.Getenv("ORBIT_API_URL")
	if orbitAPIURL == "" {
		orbitAPIURL = "http://localhost:3000"
	}

	apiKey := os.Getenv("ORBIT_INTERNAL_API_KEY")
	if apiKey == "" {
		t.Skip("ORBIT_INTERNAL_API_KEY not set")
	}

	installationID := os.Getenv("TEST_INSTALLATION_ID")
	if installationID == "" {
		t.Skip("TEST_INSTALLATION_ID not set")
	}

	svc := services.NewPayloadTokenService(orbitAPIURL, apiKey)

	token, err := svc.GetInstallationToken(context.Background(), installationID)
	require.NoError(t, err)
	require.NotEmpty(t, token)
	require.True(t, len(token) > 20, "Token should be a reasonable length")

	t.Logf("Successfully retrieved token (first 10 chars): %s...", token[:10])
}
