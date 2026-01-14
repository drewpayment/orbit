package clients

import (
	"context"
	"fmt"
	"log/slog"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// BifrostClient provides gRPC access to the Bifrost Admin Service.
type BifrostClient struct {
	conn   *grpc.ClientConn
	client gatewayv1.BifrostAdminServiceClient
	logger *slog.Logger
}

// NewBifrostClient creates a new Bifrost gRPC client.
func NewBifrostClient(address string, logger *slog.Logger) (*BifrostClient, error) {
	// TODO: Add TLS support for production
	conn, err := grpc.NewClient(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("connecting to bifrost: %w", err)
	}

	return &BifrostClient{
		conn:   conn,
		client: gatewayv1.NewBifrostAdminServiceClient(conn),
		logger: logger,
	}, nil
}

// Close closes the gRPC connection.
func (c *BifrostClient) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

// UpsertVirtualCluster creates or updates a virtual cluster configuration.
func (c *BifrostClient) UpsertVirtualCluster(ctx context.Context, config *gatewayv1.VirtualClusterConfig) error {
	c.logger.Debug("upserting virtual cluster",
		slog.String("id", config.GetId()),
		slog.String("application_id", config.GetApplicationId()),
		slog.String("environment", config.GetEnvironment()),
	)

	resp, err := c.client.UpsertVirtualCluster(ctx, &gatewayv1.UpsertVirtualClusterRequest{
		Config: config,
	})
	if err != nil {
		return fmt.Errorf("upserting virtual cluster: %w", err)
	}

	if !resp.GetSuccess() {
		return fmt.Errorf("bifrost returned success=false for virtual cluster upsert")
	}

	return nil
}

// DeleteVirtualCluster removes a virtual cluster from Bifrost.
func (c *BifrostClient) DeleteVirtualCluster(ctx context.Context, virtualClusterID string) error {
	c.logger.Debug("deleting virtual cluster",
		slog.String("virtual_cluster_id", virtualClusterID),
	)

	resp, err := c.client.DeleteVirtualCluster(ctx, &gatewayv1.DeleteVirtualClusterRequest{
		VirtualClusterId: virtualClusterID,
	})
	if err != nil {
		return fmt.Errorf("deleting virtual cluster: %w", err)
	}

	if !resp.GetSuccess() {
		return fmt.Errorf("bifrost returned success=false for virtual cluster delete")
	}

	return nil
}

// SetVirtualClusterReadOnly sets the read-only flag on a virtual cluster.
func (c *BifrostClient) SetVirtualClusterReadOnly(ctx context.Context, virtualClusterID string, readOnly bool) error {
	c.logger.Debug("setting virtual cluster read-only",
		slog.String("virtual_cluster_id", virtualClusterID),
		slog.Bool("read_only", readOnly),
	)

	resp, err := c.client.SetVirtualClusterReadOnly(ctx, &gatewayv1.SetVirtualClusterReadOnlyRequest{
		VirtualClusterId: virtualClusterID,
		ReadOnly:         readOnly,
	})
	if err != nil {
		return fmt.Errorf("setting virtual cluster read-only: %w", err)
	}

	if !resp.GetSuccess() {
		return fmt.Errorf("bifrost returned success=false for set read-only")
	}

	return nil
}

// UpsertCredential creates or updates a credential in Bifrost.
func (c *BifrostClient) UpsertCredential(ctx context.Context, cred *gatewayv1.CredentialConfig) error {
	c.logger.Debug("upserting credential",
		slog.String("id", cred.GetId()),
		slog.String("virtual_cluster_id", cred.GetVirtualClusterId()),
	)

	resp, err := c.client.UpsertCredential(ctx, &gatewayv1.UpsertCredentialRequest{
		Config: cred,
	})
	if err != nil {
		return fmt.Errorf("upserting credential: %w", err)
	}

	if !resp.GetSuccess() {
		return fmt.Errorf("bifrost returned success=false for credential upsert")
	}

	return nil
}

// RevokeCredential removes a credential from Bifrost.
func (c *BifrostClient) RevokeCredential(ctx context.Context, credentialID string) error {
	c.logger.Debug("revoking credential",
		slog.String("credential_id", credentialID),
	)

	resp, err := c.client.RevokeCredential(ctx, &gatewayv1.RevokeCredentialRequest{
		CredentialId: credentialID,
	})
	if err != nil {
		return fmt.Errorf("revoking credential: %w", err)
	}

	if !resp.GetSuccess() {
		return fmt.Errorf("bifrost returned success=false for credential revoke")
	}

	return nil
}

// GetStatus retrieves the current status of Bifrost.
func (c *BifrostClient) GetStatus(ctx context.Context) (*gatewayv1.GetStatusResponse, error) {
	c.logger.Debug("getting bifrost status")

	resp, err := c.client.GetStatus(ctx, &gatewayv1.GetStatusRequest{})
	if err != nil {
		return nil, fmt.Errorf("getting bifrost status: %w", err)
	}

	return resp, nil
}

// ListVirtualClusters lists all virtual clusters in Bifrost.
func (c *BifrostClient) ListVirtualClusters(ctx context.Context) ([]*gatewayv1.VirtualClusterConfig, error) {
	c.logger.Debug("listing virtual clusters")

	resp, err := c.client.ListVirtualClusters(ctx, &gatewayv1.ListVirtualClustersRequest{})
	if err != nil {
		return nil, fmt.Errorf("listing virtual clusters: %w", err)
	}

	return resp.GetVirtualClusters(), nil
}
