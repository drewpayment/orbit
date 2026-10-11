package svcauth

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var mintTestSecret = []byte("mint-test-secret-at-least-32-bytes!!!")

func TestMintToken_RoundTripsThroughParseAndVerify(t *testing.T) {
	tests := []struct {
		name  string
		wid   string
		admin bool
	}{
		{"admin service token", "", true},
		{"workspace token", "ws-1", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			tok, err := MintToken(mintTestSecret, "svc", tc.wid, tc.admin)
			require.NoError(t, err)

			claims, err := ParseAndVerify(tok, mintTestSecret)
			require.NoError(t, err)
			assert.Equal(t, "svc", claims.Subject)
			assert.Equal(t, tc.wid, claims.WorkspaceID)
			assert.Equal(t, tc.admin, claims.PlatformAdmin)
		})
	}
}

func TestMintToken_RejectsBadInput(t *testing.T) {
	_, err := MintToken(mintTestSecret, "", "", true)
	assert.Error(t, err)
	_, err = MintToken([]byte("short"), "svc", "", true)
	assert.Error(t, err)
}

func TestMintToken_WrongSecretFailsVerification(t *testing.T) {
	tok, err := MintToken(mintTestSecret, "svc", "", true)
	require.NoError(t, err)
	_, err = ParseAndVerify(tok, []byte("a-different-secret-that-is-32-bytes!!"))
	assert.Error(t, err)
}

func TestPerRPCCredentials_AttachesBearerToken(t *testing.T) {
	creds, err := NewPerRPCCredentials(mintTestSecret, "svc", true)
	require.NoError(t, err)

	md, err := creds.GetRequestMetadata(context.Background())
	require.NoError(t, err)

	claims, err := ParseAndVerify(bearerFrom([]string{md["authorization"]}), mintTestSecret)
	require.NoError(t, err)
	assert.True(t, claims.PlatformAdmin)
	assert.False(t, creds.RequireTransportSecurity())
}
