package activities

import (
	"context"
	"fmt"
	"time"
)

type GitHubTokenActivities struct {
	payloadClient PayloadClient
	githubClient  GitHubClient
	encryption    EncryptionService
}

func NewGitHubTokenActivities(
	payloadClient PayloadClient,
	githubClient GitHubClient,
	encryption EncryptionService,
) *GitHubTokenActivities {
	return &GitHubTokenActivities{
		payloadClient: payloadClient,
		githubClient:  githubClient,
		encryption:    encryption,
	}
}

type RefreshTokenResult struct {
	Success      bool
	ExpiresAt    time.Time
	ErrorMessage string
}

// RefreshGitHubInstallationTokenActivity refreshes a GitHub App installation token
func (a *GitHubTokenActivities) RefreshGitHubInstallationTokenActivity(
	ctx context.Context,
	installationID string,
) (RefreshTokenResult, error) {
	// Fetch installation from Payload
	installation, err := a.payloadClient.GetDocument(ctx, "github-installations", installationID)
	if err != nil {
		return RefreshTokenResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("failed to fetch installation: %v", err),
		}, err
	}

	// Get GitHub installation ID
	githubInstallationID := installation["installationId"].(int64)

	// Generate new installation access token from GitHub
	token, expiresAt, err := a.githubClient.CreateInstallationAccessToken(ctx, githubInstallationID)
	if err != nil {
		return RefreshTokenResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("failed to create token: %v", err),
		}, err
	}

	// Encrypt token
	encryptedToken, err := a.encryption.Encrypt(token)
	if err != nil {
		return RefreshTokenResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("failed to encrypt token: %v", err),
		}, err
	}

	// Update Payload document
	err = a.payloadClient.UpdateDocument(ctx, "github-installations", installationID, map[string]interface{}{
		"installationToken":      encryptedToken,
		"tokenExpiresAt":         expiresAt,
		"tokenLastRefreshedAt":   time.Now(),
		"status":                 "active",
		"temporalWorkflowStatus": "running",
	})
	if err != nil {
		return RefreshTokenResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("failed to update installation: %v", err),
		}, err
	}

	return RefreshTokenResult{
		Success:   true,
		ExpiresAt: expiresAt,
	}, nil
}

// UpdateInstallationStatusActivity updates the status of a GitHub installation
func (a *GitHubTokenActivities) UpdateInstallationStatusActivity(
	ctx context.Context,
	installationID string,
	status string,
	reason string,
) error {
	updates := map[string]interface{}{
		"status": status,
	}

	if reason != "" {
		updates["suspensionReason"] = reason
		if status == "suspended" {
			updates["suspendedAt"] = time.Now()
		}
	}

	return a.payloadClient.UpdateDocument(ctx, "github-installations", installationID, updates)
}
