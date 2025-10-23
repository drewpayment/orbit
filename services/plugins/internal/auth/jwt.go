package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims represents the JWT claims for Orbit users
type Claims struct {
	UserID     string   `json:"sub"`
	Email      string   `json:"email"`
	Workspaces []string `json:"workspaces"`
	Role       string   `json:"role"`
	jwt.RegisteredClaims
}

// HasWorkspaceAccess checks if the user has access to a workspace
func (c *Claims) HasWorkspaceAccess(workspaceID string) bool {
	for _, ws := range c.Workspaces {
		if ws == workspaceID {
			return true
		}
	}
	return false
}

// ValidateJWT validates a JWT token and returns the claims
func ValidateJWT(tokenString string, secretKey []byte) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		// Validate signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return secretKey, nil
	})

	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		// Check expiration
		if claims.ExpiresAt != nil && claims.ExpiresAt.Before(time.Now()) {
			return nil, fmt.Errorf("token expired")
		}
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}
