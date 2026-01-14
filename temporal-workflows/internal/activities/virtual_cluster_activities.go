package activities

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/drewpayment/orbit/temporal-workflows/internal/clients"
	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
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
	AdvertisedPort   int32  `json:"advertisedPort"`
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
	AdvertisedPort   int32  `json:"advertisedPort"`
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
	ErrorMessage     string `json:"errorMessage,omitempty"`
}

// VirtualClusterActivities contains activities for virtual cluster provisioning
type VirtualClusterActivities struct {
	payloadClient *clients.PayloadClient
	bifrostClient *clients.BifrostClient
	logger        *slog.Logger
}

// NewVirtualClusterActivities creates a new VirtualClusterActivities
func NewVirtualClusterActivities(
	payloadClient *clients.PayloadClient,
	bifrostClient *clients.BifrostClient,
	logger *slog.Logger,
) *VirtualClusterActivities {
	return &VirtualClusterActivities{
		payloadClient: payloadClient,
		bifrostClient: bifrostClient,
		logger:        logger,
	}
}

// GetEnvironmentMapping gets the cluster mapping for an environment.
// Queries kafka-environment-mappings collection to find the default cluster for the environment.
func (a *VirtualClusterActivities) GetEnvironmentMapping(
	ctx context.Context,
	input GetEnvironmentMappingInput,
) (*GetEnvironmentMappingResult, error) {
	a.logger.Info("GetEnvironmentMapping", "environment", input.Environment)

	// Query environment mappings for this environment with isDefault=true
	query := clients.NewQueryBuilder().
		WhereEquals("environment", input.Environment).
		WhereEquals("isDefault", "true").
		Depth(1). // Populate cluster relationship
		Limit(1).
		Build()

	docs, err := a.payloadClient.Find(ctx, "kafka-environment-mappings", query)
	if err != nil {
		return nil, fmt.Errorf("querying environment mappings: %w", err)
	}

	if len(docs) == 0 {
		return nil, fmt.Errorf("no default cluster mapping found for environment: %s", input.Environment)
	}

	mapping := docs[0]

	// Extract cluster info from populated relationship
	cluster, ok := mapping["cluster"].(map[string]any)
	if !ok {
		// Maybe cluster is just an ID string, not populated
		clusterID, ok := mapping["cluster"].(string)
		if !ok {
			return nil, fmt.Errorf("invalid cluster field in mapping")
		}

		// Fetch the cluster directly
		cluster, err = a.payloadClient.Get(ctx, "kafka-clusters", clusterID)
		if err != nil {
			return nil, fmt.Errorf("fetching cluster %s: %w", clusterID, err)
		}
	}

	clusterID, _ := cluster["id"].(string)

	// Extract bootstrap servers from connectionConfig
	connectionConfig, ok := cluster["connectionConfig"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid connectionConfig in cluster")
	}

	bootstrapServers, _ := connectionConfig["bootstrapServers"].(string)
	if bootstrapServers == "" {
		return nil, fmt.Errorf("no bootstrapServers in cluster connectionConfig")
	}

	return &GetEnvironmentMappingResult{
		ClusterID:        clusterID,
		BootstrapServers: bootstrapServers,
	}, nil
}

// CreateVirtualCluster creates a virtual cluster record in Payload CMS.
func (a *VirtualClusterActivities) CreateVirtualCluster(ctx context.Context, input CreateVirtualClusterInput) (*CreateVirtualClusterResult, error) {
	a.logger.Info("CreateVirtualCluster",
		"app", input.ApplicationSlug,
		"env", input.Environment)

	// Generate prefixes based on workspace and application
	prefix := fmt.Sprintf("%s-%s-%s-", input.WorkspaceSlug, input.ApplicationSlug, input.Environment)

	// Generate advertised host
	advertisedHost := fmt.Sprintf("%s.%s.kafka.orbit.io", input.ApplicationSlug, input.Environment)
	advertisedPort := int32(9092)

	// Check if virtual cluster already exists for this app+environment
	existingQuery := clients.NewQueryBuilder().
		WhereEquals("application", input.ApplicationID).
		WhereEquals("environment", input.Environment).
		Limit(1).
		Build()

	existingDocs, err := a.payloadClient.Find(ctx, "kafka-virtual-clusters", existingQuery)
	if err != nil {
		return nil, fmt.Errorf("checking existing virtual cluster: %w", err)
	}

	if len(existingDocs) > 0 {
		// Virtual cluster already exists, return it
		existing := existingDocs[0]
		vcID, _ := existing["id"].(string)
		topicPrefix, _ := existing["topicPrefix"].(string)
		groupPrefix, _ := existing["groupPrefix"].(string)
		existingHost, _ := existing["advertisedHost"].(string)

		portFloat, _ := existing["advertisedPort"].(float64)
		existingPort := int32(portFloat)
		if existingPort == 0 {
			existingPort = 9092
		}

		return &CreateVirtualClusterResult{
			VirtualClusterID: vcID,
			TopicPrefix:      topicPrefix,
			GroupPrefix:      groupPrefix,
			AdvertisedHost:   existingHost,
			AdvertisedPort:   existingPort,
		}, nil
	}

	// Create new virtual cluster record
	data := map[string]any{
		"application":     input.ApplicationID,
		"environment":     input.Environment,
		"physicalCluster": input.PhysicalClusterID,
		"topicPrefix":     prefix,
		"groupPrefix":     prefix,
		"advertisedHost":  advertisedHost,
		"advertisedPort":  advertisedPort,
		"status":          "provisioning",
	}

	result, err := a.payloadClient.Create(ctx, "kafka-virtual-clusters", data)
	if err != nil {
		return nil, fmt.Errorf("creating virtual cluster: %w", err)
	}

	vcID, _ := result["id"].(string)

	return &CreateVirtualClusterResult{
		VirtualClusterID: vcID,
		TopicPrefix:      prefix,
		GroupPrefix:      prefix,
		AdvertisedHost:   advertisedHost,
		AdvertisedPort:   advertisedPort,
	}, nil
}

// PushToBifrost pushes virtual cluster config to Bifrost gateway via gRPC.
func (a *VirtualClusterActivities) PushToBifrost(ctx context.Context, input PushToBifrostInput) (*PushToBifrostResult, error) {
	a.logger.Info("PushToBifrost",
		"virtualCluster", input.VirtualClusterID,
		"advertisedHost", input.AdvertisedHost)

	// Build the VirtualClusterConfig proto
	config := &gatewayv1.VirtualClusterConfig{
		Id:                       input.VirtualClusterID,
		ApplicationId:            input.ApplicationID,
		ApplicationSlug:          input.ApplicationSlug,
		WorkspaceSlug:            input.WorkspaceSlug,
		Environment:              input.Environment,
		TopicPrefix:              input.TopicPrefix,
		GroupPrefix:              input.GroupPrefix,
		TransactionIdPrefix:      input.TopicPrefix, // Use same prefix for txn IDs
		AdvertisedHost:           input.AdvertisedHost,
		AdvertisedPort:           input.AdvertisedPort,
		PhysicalBootstrapServers: input.BootstrapServers,
		ReadOnly:                 false,
	}

	// Call Bifrost to upsert the virtual cluster
	if err := a.bifrostClient.UpsertVirtualCluster(ctx, config); err != nil {
		return nil, fmt.Errorf("upserting to bifrost: %w", err)
	}

	return &PushToBifrostResult{Success: true}, nil
}

// UpdateVirtualClusterStatus updates the status of a virtual cluster in Payload CMS.
func (a *VirtualClusterActivities) UpdateVirtualClusterStatus(
	ctx context.Context,
	input UpdateVirtualClusterStatusInput,
) error {
	a.logger.Info("UpdateVirtualClusterStatus",
		"virtualCluster", input.VirtualClusterID,
		"status", input.Status)

	data := map[string]any{
		"status": input.Status,
	}

	// Include error message if provided
	if input.ErrorMessage != "" {
		data["provisioningError"] = input.ErrorMessage
	}

	if err := a.payloadClient.Update(ctx, "kafka-virtual-clusters", input.VirtualClusterID, data); err != nil {
		return fmt.Errorf("updating virtual cluster status: %w", err)
	}

	return nil
}
