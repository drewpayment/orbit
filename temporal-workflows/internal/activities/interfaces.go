package activities

import (
	"context"
	"time"
)

// PayloadClient interface for interacting with Payload CMS
type PayloadClient interface {
	GetDocument(ctx context.Context, collection string, id string) (map[string]interface{}, error)
	UpdateDocument(ctx context.Context, collection string, id string, data map[string]interface{}) error
	FindDocuments(ctx context.Context, collection string, query map[string]interface{}) ([]map[string]interface{}, error)
}

// GitHubClient interface for GitHub API operations
type GitHubClient interface {
	CreateInstallationAccessToken(ctx context.Context, installationID int64) (token string, expiresAt time.Time, err error)
}

// EncryptionService interface for encrypting/decrypting sensitive data
type EncryptionService interface {
	Encrypt(plaintext string) (string, error)
	Decrypt(ciphertext string) (string, error)
}
