package activities

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/drewpayment/orbit/temporal-workflows/pkg/types"
)

// PayloadLaunchClient defines the interface for Payload CMS operations related to launches
type PayloadLaunchClient interface {
	UpdateLaunchStatus(ctx context.Context, launchID string, status string, errMsg string) error
	StoreLaunchOutputs(ctx context.Context, launchID string, outputs map[string]interface{}) error
	GetCloudAccountCredentials(ctx context.Context, cloudAccountID string) (map[string]interface{}, error)
}

// LaunchActivities holds dependencies for launch activities
type LaunchActivities struct {
	payloadClient PayloadLaunchClient
	logger        *slog.Logger
}

// NewLaunchActivities creates a new instance
func NewLaunchActivities(payloadClient PayloadLaunchClient, logger *slog.Logger) *LaunchActivities {
	if logger == nil {
		logger = slog.Default()
	}
	return &LaunchActivities{
		payloadClient: payloadClient,
		logger:        logger,
	}
}

// ValidateLaunchInputs validates all required fields in the launch workflow input
func (a *LaunchActivities) ValidateLaunchInputs(ctx context.Context, input types.LaunchWorkflowInput) error {
	if input.LaunchID == "" {
		return fmt.Errorf("launchId is required")
	}
	if input.TemplateSlug == "" {
		return fmt.Errorf("templateSlug is required")
	}
	if input.CloudAccountID == "" {
		return fmt.Errorf("cloudAccountId is required")
	}
	if input.Provider == "" {
		return fmt.Errorf("provider is required")
	}
	if input.Region == "" {
		return fmt.Errorf("region is required")
	}
	if input.PulumiProjectPath == "" {
		return fmt.Errorf("pulumiProjectPath is required")
	}
	a.logger.Info("Launch inputs validated",
		"launchId", input.LaunchID,
		"template", input.TemplateSlug,
		"provider", input.Provider,
		"region", input.Region,
	)
	return nil
}

// UpdateLaunchStatus updates the launch status in Payload CMS
func (a *LaunchActivities) UpdateLaunchStatus(ctx context.Context, input types.UpdateLaunchStatusInput) error {
	a.logger.Info("Updating launch status",
		"launchId", input.LaunchID,
		"status", input.Status,
	)
	return a.payloadClient.UpdateLaunchStatus(ctx, input.LaunchID, input.Status, input.Error)
}

// StoreLaunchOutputs stores the infrastructure outputs in Payload CMS
func (a *LaunchActivities) StoreLaunchOutputs(ctx context.Context, input types.StoreLaunchOutputsInput) error {
	a.logger.Info("Storing launch outputs",
		"launchId", input.LaunchID,
	)
	return a.payloadClient.StoreLaunchOutputs(ctx, input.LaunchID, input.Outputs)
}
