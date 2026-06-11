package svcauth

import (
	"fmt"

	"github.com/golang-jwt/jwt/v5"
)

// Claims is the verified claim set. It embeds jwt.RegisteredClaims (iss, aud,
// sub, iat, exp, jti) and adds the workspace claim. Subject is the betterAuth
// user id; WorkspaceID is the authorized workspace.
type Claims struct {
	jwt.RegisteredClaims
	WorkspaceID string `json:"wid"`
}

// LoadSecret validates a raw secret string and returns it as bytes. It is the
// single place the >= 32 byte / non-empty rule is enforced, so both services
// and any future caller fail-fast identically. Callers wire this into their
// config load and log.Fatalf on error — there is deliberately no default.
func LoadSecret(raw string) ([]byte, error) {
	if raw == "" {
		return nil, fmt.Errorf("ORBIT_SVC_AUTH_SECRET is not set")
	}
	if len(raw) < minSecretBytes {
		return nil, fmt.Errorf("ORBIT_SVC_AUTH_SECRET must be at least %d bytes (got %d)", minSecretBytes, len(raw))
	}
	return []byte(raw), nil
}

// ParseAndVerify parses tokenString, verifies the HS256 signature against
// secret, and validates exp, iss, and aud. The signing method is pinned to
// HMAC via WithValidMethods to block alg-confusion attacks (e.g. "none" or an
// asymmetric alg whose verification would otherwise treat the secret as a
// public key). A nil error guarantees every claim below was checked.
func ParseAndVerify(tokenString string, secret []byte) (*Claims, error) {
	if tokenString == "" {
		return nil, fmt.Errorf("empty token")
	}

	claims := &Claims{}
	_, err := jwt.ParseWithClaims(
		tokenString,
		claims,
		func(t *jwt.Token) (interface{}, error) {
			// Defense in depth alongside WithValidMethods: reject anything that
			// is not concretely an HMAC method before returning the key.
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return secret, nil
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(expectedIssuer),
		jwt.WithAudience(expectedAudience),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, fmt.Errorf("token verification failed: %w", err)
	}

	return claims, nil
}
