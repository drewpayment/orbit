package activities

import (
	"context"
	"fmt"
	"log/slog"
)

// GetEnvironmentMappingInput is the input for getting environment mapping
type GetEnvironmentMappingInput struct {
	Environment string `json:"environment"`
}

// GetEnvironmentMappingResult is the result of getting environment mapping
type GetEnvironmentMappingResult struct {
	ClusterID        string `json:"clusterId"`
	BootstrapServers string `json:"bootstrapServers"`
}

// CreateVirtualClusterInput is the input for creating a virtual cluster
type CreateVirtualClusterInput struct {
	ApplicationID     string `json:"applicationId"`
	ApplicationSlug   string `json:"applicationSlug"`
	WorkspaceSlug     string `json:"workspaceSlug"`
	Environment       string `json:"environment"`
	PhysicalClusterID string `json:"physicalClusterId"`
	BootstrapServers  string `json:"bootstrapServers"`
}

// CreateVirtualClusterResult is the result of creating a virtual cluster
type CreateVirtualClusterResult struct {
	VirtualClusterID string `json:"virtualClusterId"`
	TopicPrefix      string `json:"topicPrefix"`
	GroupPrefix      string `json:"groupPrefix"`
	AdvertisedHost   string `json:"advertisedHost"`
}

// PushToBifrostInput is the input for pushing config to Bifrost
type PushToBifrostInput struct {
	VirtualClusterID string `json:"virtualClusterId"`
	ApplicationID    string `json:"applicationId"`
	ApplicationSlug  string `json:"applicationSlug"`
	WorkspaceSlug    string `json:"workspaceSlug"`
	Environment      string `json:"environment"`
	TopicPrefix      string `json:"topicPrefix"`
	GroupPrefix      string `json:"groupPrefix"`
	AdvertisedHost   string `json:"advertisedHost"`
	BootstrapServers string `json:"bootstrapServers"`
}

// PushToBifrostResult is the result of pushing config to Bifrost
type PushToBifrostResult struct {
	Success bool `json:"success"`
}

// UpdateVirtualClusterStatusInput is the input for updating virtual cluster status
type UpdateVirtualClusterStatusInput struct {
	VirtualClusterID string `json:"virtualClusterId"`
	Status           string `json:"status"`
}

// VirtualClusterActivities contains activities for virtual cluster provisioning
type VirtualClusterActivities struct {
	payloadURL string
	bifrostURL string
	logger     *slog.Logger
}

// NewVirtualClusterActivities creates a new VirtualClusterActivities
func NewVirtualClusterActivities(payloadURL, bifrostURL string, logger *slog.Logger) *VirtualClusterActivities {
	return &VirtualClusterActivities{
		payloadURL: payloadURL,
		bifrostURL: bifrostURL,
		logger:     logger,
	}
}

// GetEnvironmentMapping gets the cluster mapping for an environment
func (a *VirtualClusterActivities) GetEnvironmentMapping(ctx context.Context, input GetEnvironmentMappingInput) (*GetEnvironmentMappingResult, error) {
	a.logger.Info("GetEnvironmentMapping", "environment", input.Environment)

	// TODO: Call Payload API to get environment mapping
	// For now, return mock data
	return &GetEnvironmentMappingResult{
		ClusterID:        "cluster-" + input.Environment,
		BootstrapServers: "localhost:19092", // Redpanda in docker-compose
	}, nil
}

// CreateVirtualCluster creates a virtual cluster record in Payload
func (a *VirtualClusterActivities) CreateVirtualCluster(ctx context.Context, input CreateVirtualClusterInput) (*CreateVirtualClusterResult, error) {
	a.logger.Info("CreateVirtualCluster",
		"app", input.ApplicationSlug,
		"env", input.Environment)

	// Generate prefixes based on workspace and application
	prefix := fmt.Sprintf("%s-%s-%s-", input.WorkspaceSlug, input.ApplicationSlug, input.Environment)
	advertisedHost := fmt.Sprintf("%s.%s.kafka.orbit.io", input.ApplicationSlug, input.Environment)

	// TODO: Call Payload API to create virtual cluster
	// For now, return mock data
	return &CreateVirtualClusterResult{
		VirtualClusterID: fmt.Sprintf("vc-%s-%s", input.ApplicationSlug, input.Environment),
		TopicPrefix:      prefix,
		GroupPrefix:      prefix,
		AdvertisedHost:   advertisedHost,
	}, nil
}

// PushToBifrost pushes virtual cluster config to Bifrost gateway
func (a *VirtualClusterActivities) PushToBifrost(ctx context.Context, input PushToBifrostInput) (*PushToBifrostResult, error) {
	a.logger.Info("PushToBifrost",
		"virtualCluster", input.VirtualClusterID,
		"advertisedHost", input.AdvertisedHost)

	// TODO: Call Bifrost gRPC Admin API to upsert virtual cluster
	// For now, return success
	return &PushToBifrostResult{Success: true}, nil
}

// UpdateVirtualClusterStatus updates the status of a virtual cluster
func (a *VirtualClusterActivities) UpdateVirtualClusterStatus(ctx context.Context, input UpdateVirtualClusterStatusInput) error {
	a.logger.Info("UpdateVirtualClusterStatus",
		"virtualCluster", input.VirtualClusterID,
		"status", input.Status)

	// TODO: Call Payload API to update status
	return nil
}
