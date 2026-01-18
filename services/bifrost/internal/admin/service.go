// services/bifrost/internal/admin/service.go
package admin

import (
	"context"

	"github.com/sirupsen/logrus"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
	"github.com/drewpayment/orbit/services/bifrost/internal/config"
	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

// Service implements the BifrostAdminService gRPC interface.
// It receives configuration pushes from Orbit's control plane and manages
// virtual clusters and credentials in memory.
type Service struct {
	gatewayv1.UnimplementedBifrostAdminServiceServer

	vcStore   *config.VirtualClusterStore
	credStore *auth.CredentialStore
}

// NewService creates a new admin service with the given stores.
func NewService(vcStore *config.VirtualClusterStore, credStore *auth.CredentialStore) *Service {
	return &Service{
		vcStore:   vcStore,
		credStore: credStore,
	}
}

// UpsertVirtualCluster adds or updates a virtual cluster configuration.
func (s *Service) UpsertVirtualCluster(ctx context.Context, req *gatewayv1.UpsertVirtualClusterRequest) (*gatewayv1.UpsertVirtualClusterResponse, error) {
	if req.Config == nil {
		return nil, status.Error(codes.InvalidArgument, "config is required")
	}

	logrus.WithFields(logrus.Fields{
		"virtual_cluster_id": req.Config.Id,
		"topic_prefix":       req.Config.TopicPrefix,
	}).Info("Upserting virtual cluster")

	s.vcStore.Upsert(req.Config)

	return &gatewayv1.UpsertVirtualClusterResponse{Success: true}, nil
}

// DeleteVirtualCluster removes a virtual cluster configuration.
func (s *Service) DeleteVirtualCluster(ctx context.Context, req *gatewayv1.DeleteVirtualClusterRequest) (*gatewayv1.DeleteVirtualClusterResponse, error) {
	logrus.WithField("virtual_cluster_id", req.VirtualClusterId).Info("Deleting virtual cluster")

	s.vcStore.Delete(req.VirtualClusterId)

	return &gatewayv1.DeleteVirtualClusterResponse{Success: true}, nil
}

// SetVirtualClusterReadOnly sets the read-only flag on a virtual cluster.
func (s *Service) SetVirtualClusterReadOnly(ctx context.Context, req *gatewayv1.SetVirtualClusterReadOnlyRequest) (*gatewayv1.SetVirtualClusterReadOnlyResponse, error) {
	vc, ok := s.vcStore.Get(req.VirtualClusterId)
	if !ok {
		return nil, status.Errorf(codes.NotFound, "virtual cluster %s not found", req.VirtualClusterId)
	}

	logrus.WithFields(logrus.Fields{
		"virtual_cluster_id": req.VirtualClusterId,
		"read_only":          req.ReadOnly,
	}).Info("Setting virtual cluster read-only flag")

	// Create a new config with the updated read-only flag
	// We need to clone to avoid race conditions since Get returns direct reference
	updatedVC := &gatewayv1.VirtualClusterConfig{
		Id:                       vc.Id,
		ApplicationId:            vc.ApplicationId,
		ApplicationSlug:          vc.ApplicationSlug,
		WorkspaceSlug:            vc.WorkspaceSlug,
		Environment:              vc.Environment,
		TopicPrefix:              vc.TopicPrefix,
		GroupPrefix:              vc.GroupPrefix,
		TransactionIdPrefix:      vc.TransactionIdPrefix,
		AdvertisedHost:           vc.AdvertisedHost,
		AdvertisedPort:           vc.AdvertisedPort,
		PhysicalBootstrapServers: vc.PhysicalBootstrapServers,
		ReadOnly:                 req.ReadOnly,
	}
	s.vcStore.Upsert(updatedVC)

	return &gatewayv1.SetVirtualClusterReadOnlyResponse{Success: true}, nil
}

// ListVirtualClusters returns all virtual clusters.
func (s *Service) ListVirtualClusters(ctx context.Context, req *gatewayv1.ListVirtualClustersRequest) (*gatewayv1.ListVirtualClustersResponse, error) {
	vcs := s.vcStore.List()

	return &gatewayv1.ListVirtualClustersResponse{
		VirtualClusters: vcs,
	}, nil
}

// UpsertCredential adds or updates a credential configuration.
func (s *Service) UpsertCredential(ctx context.Context, req *gatewayv1.UpsertCredentialRequest) (*gatewayv1.UpsertCredentialResponse, error) {
	if req.Config == nil {
		return nil, status.Error(codes.InvalidArgument, "config is required")
	}

	logrus.WithFields(logrus.Fields{
		"credential_id":      req.Config.Id,
		"virtual_cluster_id": req.Config.VirtualClusterId,
		"username":           req.Config.Username,
	}).Info("Upserting credential")

	s.credStore.Upsert(req.Config)

	return &gatewayv1.UpsertCredentialResponse{Success: true}, nil
}

// RevokeCredential removes a credential.
func (s *Service) RevokeCredential(ctx context.Context, req *gatewayv1.RevokeCredentialRequest) (*gatewayv1.RevokeCredentialResponse, error) {
	logrus.WithField("credential_id", req.CredentialId).Info("Revoking credential")

	s.credStore.Delete(req.CredentialId)

	return &gatewayv1.RevokeCredentialResponse{Success: true}, nil
}

// ListCredentials returns credentials, optionally filtered by virtual cluster.
func (s *Service) ListCredentials(ctx context.Context, req *gatewayv1.ListCredentialsRequest) (*gatewayv1.ListCredentialsResponse, error) {
	var creds []*gatewayv1.CredentialConfig

	if req.VirtualClusterId != "" {
		creds = s.credStore.ListByVirtualCluster(req.VirtualClusterId)
	} else {
		creds = s.credStore.List()
	}

	return &gatewayv1.ListCredentialsResponse{
		Credentials: creds,
	}, nil
}

// GetStatus returns the current status of the Bifrost gateway.
func (s *Service) GetStatus(ctx context.Context, req *gatewayv1.GetStatusRequest) (*gatewayv1.GetStatusResponse, error) {
	return &gatewayv1.GetStatusResponse{
		Status:              "healthy",
		ActiveConnections:   0, // TODO: Track active connections when proxy is integrated
		VirtualClusterCount: int32(s.vcStore.Count()),
		VersionInfo: map[string]string{
			"version": "0.1.0",
		},
	}, nil
}

// GetFullConfig returns all current configuration for reconciliation.
func (s *Service) GetFullConfig(ctx context.Context, req *gatewayv1.GetFullConfigRequest) (*gatewayv1.GetFullConfigResponse, error) {
	return &gatewayv1.GetFullConfigResponse{
		VirtualClusters: s.vcStore.List(),
		Credentials:     s.credStore.List(),
		Policies:        nil, // Policies not yet implemented
		TopicAcls:       nil, // Topic ACLs not yet implemented
	}, nil
}

// UpsertPolicy is a stub for future policy management.
func (s *Service) UpsertPolicy(ctx context.Context, req *gatewayv1.UpsertPolicyRequest) (*gatewayv1.UpsertPolicyResponse, error) {
	return nil, status.Error(codes.Unimplemented, "policy management not yet implemented")
}

// DeletePolicy is a stub for future policy management.
func (s *Service) DeletePolicy(ctx context.Context, req *gatewayv1.DeletePolicyRequest) (*gatewayv1.DeletePolicyResponse, error) {
	return nil, status.Error(codes.Unimplemented, "policy management not yet implemented")
}

// ListPolicies is a stub for future policy management.
func (s *Service) ListPolicies(ctx context.Context, req *gatewayv1.ListPoliciesRequest) (*gatewayv1.ListPoliciesResponse, error) {
	return nil, status.Error(codes.Unimplemented, "policy management not yet implemented")
}

// UpsertTopicACL is a stub for future topic ACL management.
func (s *Service) UpsertTopicACL(ctx context.Context, req *gatewayv1.UpsertTopicACLRequest) (*gatewayv1.UpsertTopicACLResponse, error) {
	return nil, status.Error(codes.Unimplemented, "topic ACL management not yet implemented")
}

// RevokeTopicACL is a stub for future topic ACL management.
func (s *Service) RevokeTopicACL(ctx context.Context, req *gatewayv1.RevokeTopicACLRequest) (*gatewayv1.RevokeTopicACLResponse, error) {
	return nil, status.Error(codes.Unimplemented, "topic ACL management not yet implemented")
}

// ListTopicACLs is a stub for future topic ACL management.
func (s *Service) ListTopicACLs(ctx context.Context, req *gatewayv1.ListTopicACLsRequest) (*gatewayv1.ListTopicACLsResponse, error) {
	return nil, status.Error(codes.Unimplemented, "topic ACL management not yet implemented")
}
