// temporal-workflows/internal/activities/credential_activities.go
package activities

import (
	"context"
	"log/slog"
)

// CredentialSyncInput is the input for syncing a credential to Bifrost
type CredentialSyncInput struct {
	CredentialID     string `json:"credentialId"`
	VirtualClusterID string `json:"virtualClusterId"`
	Username         string `json:"username"`
	PasswordHash     string `json:"passwordHash"`
	Template         string `json:"template"`
}

// CredentialSyncResult is the result of syncing a credential
type CredentialSyncResult struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// CredentialRevokeInput is the input for revoking a credential
type CredentialRevokeInput struct {
	CredentialID string `json:"credentialId"`
}

// CredentialRevokeResult is the result of revoking a credential
type CredentialRevokeResult struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// CredentialActivities contains activities for credential management
type CredentialActivities struct {
	bifrostURL string
	logger     *slog.Logger
}

// NewCredentialActivities creates a new CredentialActivities
func NewCredentialActivities(bifrostURL string, logger *slog.Logger) *CredentialActivities {
	return &CredentialActivities{
		bifrostURL: bifrostURL,
		logger:     logger,
	}
}

// SyncCredentialToBifrost pushes a credential to Bifrost gateway
func (a *CredentialActivities) SyncCredentialToBifrost(ctx context.Context, input CredentialSyncInput) (*CredentialSyncResult, error) {
	a.logger.Info("SyncCredentialToBifrost",
		"credentialId", input.CredentialID,
		"username", input.Username)

	// TODO: Call Bifrost gRPC Admin API to upsert credential
	// conn, err := grpc.Dial(a.bifrostURL, grpc.WithInsecure())
	// client := gatewayv1.NewBifrostAdminServiceClient(conn)
	// client.UpsertCredential(ctx, &gatewayv1.UpsertCredentialRequest{...})

	return &CredentialSyncResult{Success: true}, nil
}

// RevokeCredentialFromBifrost removes a credential from Bifrost gateway
func (a *CredentialActivities) RevokeCredentialFromBifrost(ctx context.Context, input CredentialRevokeInput) (*CredentialRevokeResult, error) {
	a.logger.Info("RevokeCredentialFromBifrost",
		"credentialId", input.CredentialID)

	// TODO: Call Bifrost gRPC Admin API to revoke credential
	// conn, err := grpc.Dial(a.bifrostURL, grpc.WithInsecure())
	// client := gatewayv1.NewBifrostAdminServiceClient(conn)
	// client.RevokeCredential(ctx, &gatewayv1.RevokeCredentialRequest{...})

	return &CredentialRevokeResult{Success: true}, nil
}
