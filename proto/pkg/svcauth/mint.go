package svcauth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// tokenTTL matches orbit-www's TTL (lib/grpc/svc-auth-token.ts): long enough for
// clock skew, short enough that a leaked token is nearly useless.
const tokenTTL = 120 * time.Second

// MintToken signs a service-auth JWT that ParseAndVerify accepts. orbit-www
// mints the tokens for user-initiated calls; this exists for trusted in-cluster
// callers that act without a user (the Temporal worker calling Bifrost admin),
// which present a stable service subject and the platform-admin claim.
//
// subject must be non-empty. workspaceID may be empty for RPCs with no
// workspace scope. platformAdmin sets the "adm" claim; it is omitted when
// false so the token shape matches orbit-www's non-admin tokens.
func MintToken(secret []byte, subject, workspaceID string, platformAdmin bool) (string, error) {
	if subject == "" {
		return "", fmt.Errorf("svcauth: subject is required")
	}
	if len(secret) < minSecretBytes {
		return "", fmt.Errorf("svcauth: secret must be at least %d bytes", minSecretBytes)
	}

	jti := make([]byte, 16)
	if _, err := rand.Read(jti); err != nil {
		return "", fmt.Errorf("svcauth: generating jti: %w", err)
	}

	now := time.Now()
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    expectedIssuer,
			Audience:  jwt.ClaimStrings{expectedAudience},
			Subject:   subject,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(tokenTTL)),
			ID:        hex.EncodeToString(jti),
		},
		WorkspaceID:   workspaceID,
		PlatformAdmin: platformAdmin,
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
}

// perRPCCredentials implements google.golang.org/grpc/credentials.PerRPCCredentials,
// minting a fresh short-TTL token for every outbound call.
type perRPCCredentials struct {
	secret        []byte
	subject       string
	platformAdmin bool
}

// NewPerRPCCredentials returns gRPC per-RPC credentials that attach a freshly
// minted service token to every call. Use with grpc.WithPerRPCCredentials. The
// credentials do not require transport security because the token is
// short-lived and callers are in-cluster (matching the existing insecure dials).
func NewPerRPCCredentials(secret []byte, subject string, platformAdmin bool) (*perRPCCredentials, error) {
	if subject == "" {
		return nil, fmt.Errorf("svcauth: subject is required")
	}
	if len(secret) < minSecretBytes {
		return nil, fmt.Errorf("svcauth: secret must be at least %d bytes", minSecretBytes)
	}
	return &perRPCCredentials{secret: secret, subject: subject, platformAdmin: platformAdmin}, nil
}

func (c *perRPCCredentials) GetRequestMetadata(_ context.Context, _ ...string) (map[string]string, error) {
	token, err := MintToken(c.secret, c.subject, "", c.platformAdmin)
	if err != nil {
		return nil, err
	}
	return map[string]string{"authorization": "Bearer " + token}, nil
}

func (c *perRPCCredentials) RequireTransportSecurity() bool { return false }
