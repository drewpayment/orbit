// temporal-workflows/internal/activities/credential_activities.go
package activities

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

// CredentialSyncInput is the input for syncing a credential to Bifrost
type CredentialSyncInput struct {
	CredentialID     string `json:"credentialId"`
	VirtualClusterID string `json:"virtualClusterId"`
	Username         string `json:"username"`
	PasswordHash     string `json:"passwordHash"`
	Template         string `json:"template"` // "producer", "consumer", "admin", "custom"
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

// BifrostCredentialClient defines the interface for credential operations on Bifrost
type BifrostCredentialClient interface {
	UpsertCredential(ctx context.Context, cred *gatewayv1.CredentialConfig) error
	RevokeCredential(ctx context.Context, credentialID string) error
}

// CredentialActivities contains activities for credential management
type CredentialActivities struct {
	bifrostClient BifrostCredentialClient
	logger        *slog.Logger
}

// NewCredentialActivities creates a new CredentialActivities
func NewCredentialActivities(bifrostClient BifrostCredentialClient, logger *slog.Logger) *CredentialActivities {
	return &CredentialActivities{
		bifrostClient: bifrostClient,
		logger:        logger,
	}
}

// SyncCredentialToBifrost pushes a credential to Bifrost gateway
func (a *CredentialActivities) SyncCredentialToBifrost(ctx context.Context, input CredentialSyncInput) (*CredentialSyncResult, error) {
	a.logger.Info("SyncCredentialToBifrost",
		"credentialId", input.CredentialID,
		"virtualClusterId", input.VirtualClusterID,
		"username", input.Username,
		"template", input.Template)

	if a.bifrostClient == nil {
		return nil, fmt.Errorf("bifrost client not configured")
	}

	// Map template string to proto enum
	template := parsePermissionTemplate(input.Template)

	// Build credential config
	credConfig := &gatewayv1.CredentialConfig{
		Id:               input.CredentialID,
		VirtualClusterId: input.VirtualClusterID,
		Username:         input.Username,
		PasswordHash:     input.PasswordHash,
		Template:         template,
	}

	// Call Bifrost to upsert credential
	if err := a.bifrostClient.UpsertCredential(ctx, credConfig); err != nil {
		a.logger.Error("failed to upsert credential to Bifrost",
			"credentialId", input.CredentialID,
			"error", err)
		return nil, fmt.Errorf("upserting credential to bifrost: %w", err)
	}

	a.logger.Info("successfully synced credential to Bifrost",
		"credentialId", input.CredentialID,
		"username", input.Username)

	return &CredentialSyncResult{Success: true}, nil
}

// RevokeCredentialFromBifrost removes a credential from Bifrost gateway
func (a *CredentialActivities) RevokeCredentialFromBifrost(ctx context.Context, input CredentialRevokeInput) (*CredentialRevokeResult, error) {
	a.logger.Info("RevokeCredentialFromBifrost",
		"credentialId", input.CredentialID)

	if a.bifrostClient == nil {
		return nil, fmt.Errorf("bifrost client not configured")
	}

	// Call Bifrost to revoke credential
	if err := a.bifrostClient.RevokeCredential(ctx, input.CredentialID); err != nil {
		a.logger.Error("failed to revoke credential from Bifrost",
			"credentialId", input.CredentialID,
			"error", err)
		return nil, fmt.Errorf("revoking credential from bifrost: %w", err)
	}

	a.logger.Info("successfully revoked credential from Bifrost",
		"credentialId", input.CredentialID)

	return &CredentialRevokeResult{Success: true}, nil
}

// parsePermissionTemplate converts a string template to the proto enum
func parsePermissionTemplate(template string) gatewayv1.PermissionTemplate {
	switch strings.ToLower(template) {
	case "producer":
		return gatewayv1.PermissionTemplate_PERMISSION_TEMPLATE_PRODUCER
	case "consumer":
		return gatewayv1.PermissionTemplate_PERMISSION_TEMPLATE_CONSUMER
	case "admin":
		return gatewayv1.PermissionTemplate_PERMISSION_TEMPLATE_ADMIN
	case "custom":
		return gatewayv1.PermissionTemplate_PERMISSION_TEMPLATE_CUSTOM
	default:
		return gatewayv1.PermissionTemplate_PERMISSION_TEMPLATE_UNSPECIFIED
	}
}
