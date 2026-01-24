// services/bifrost/internal/admin/service.go
package admin

import (
	"context"
	"sort"
	"strings"

	"github.com/sirupsen/logrus"
	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
	"github.com/drewpayment/orbit/services/bifrost/internal/auth"
	"github.com/drewpayment/orbit/services/bifrost/internal/config"
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

	// Clone to avoid race conditions since Get returns direct reference
	// Using proto.Clone ensures all fields are copied, including any new fields
	// added to the protobuf definition in the future
	updatedVC := proto.Clone(vc).(*gatewayv1.VirtualClusterConfig)
	updatedVC.ReadOnly = req.ReadOnly
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

// ============================================================================
// Consumer Group Methods
// ============================================================================

// ListConsumerGroups returns all consumer groups for a virtual cluster.
func (s *Service) ListConsumerGroups(ctx context.Context, req *gatewayv1.ListConsumerGroupsRequest) (*gatewayv1.ListConsumerGroupsResponse, error) {
	vc, ok := s.vcStore.Get(req.VirtualClusterId)
	if !ok {
		return &gatewayv1.ListConsumerGroupsResponse{
			Error: "virtual cluster not found",
		}, nil
	}

	logrus.WithFields(logrus.Fields{
		"virtual_cluster_id": req.VirtualClusterId,
		"group_prefix":       vc.GroupPrefix,
	}).Debug("Listing consumer groups")

	// Create Kafka admin client
	kafkaClient, err := NewKafkaAdminClient(vc.PhysicalBootstrapServers)
	if err != nil {
		return &gatewayv1.ListConsumerGroupsResponse{
			Error: "failed to connect to Kafka: " + err.Error(),
		}, nil
	}
	defer kafkaClient.Close()

	// List all groups
	groups, err := kafkaClient.ListGroups(ctx)
	if err != nil {
		return &gatewayv1.ListConsumerGroupsResponse{
			Error: "failed to list groups: " + err.Error(),
		}, nil
	}

	// Filter by prefix and build response
	var result []*gatewayv1.ConsumerGroupSummary
	for _, group := range groups {
		// Filter by prefix - only include groups belonging to this virtual cluster
		if vc.GroupPrefix != "" && !strings.HasPrefix(group.Group, vc.GroupPrefix) {
			continue
		}

		// Unprefix the group ID
		virtualGroupID := strings.TrimPrefix(group.Group, vc.GroupPrefix)

		// Get subscribed topics and unprefix them
		physicalTopics := GetSubscribedTopics(group)
		virtualTopics := make([]string, 0, len(physicalTopics))
		for _, topic := range physicalTopics {
			if vc.TopicPrefix != "" && strings.HasPrefix(topic, vc.TopicPrefix) {
				virtualTopics = append(virtualTopics, strings.TrimPrefix(topic, vc.TopicPrefix))
			} else if vc.TopicPrefix == "" {
				virtualTopics = append(virtualTopics, topic)
			}
		}

		// Calculate lag
		lag, err := s.calculateGroupLag(ctx, kafkaClient, group.Group, physicalTopics)
		if err != nil {
			logrus.WithError(err).WithField("group", group.Group).Warn("Failed to calculate lag")
			lag = 0
		}

		result = append(result, &gatewayv1.ConsumerGroupSummary{
			GroupId:     virtualGroupID,
			State:       mapGroupState(group.State),
			MemberCount: int32(len(group.Members)),
			Topics:      virtualTopics,
			TotalLag:    lag,
		})
	}

	// Sort by group ID for consistent ordering
	sort.Slice(result, func(i, j int) bool {
		return result[i].GroupId < result[j].GroupId
	})

	return &gatewayv1.ListConsumerGroupsResponse{Groups: result}, nil
}

// DescribeConsumerGroup returns detailed information about a consumer group.
func (s *Service) DescribeConsumerGroup(ctx context.Context, req *gatewayv1.DescribeConsumerGroupRequest) (*gatewayv1.DescribeConsumerGroupResponse, error) {
	vc, ok := s.vcStore.Get(req.VirtualClusterId)
	if !ok {
		return &gatewayv1.DescribeConsumerGroupResponse{
			Error: "virtual cluster not found",
		}, nil
	}

	// Add prefix to get physical group ID
	physicalGroupID := vc.GroupPrefix + req.GroupId

	logrus.WithFields(logrus.Fields{
		"virtual_cluster_id": req.VirtualClusterId,
		"virtual_group_id":   req.GroupId,
		"physical_group_id":  physicalGroupID,
	}).Debug("Describing consumer group")

	// Create Kafka admin client
	kafkaClient, err := NewKafkaAdminClient(vc.PhysicalBootstrapServers)
	if err != nil {
		return &gatewayv1.DescribeConsumerGroupResponse{
			Error: "failed to connect to Kafka: " + err.Error(),
		}, nil
	}
	defer kafkaClient.Close()

	// Describe the group
	group, err := kafkaClient.DescribeGroup(ctx, physicalGroupID)
	if err != nil {
		return &gatewayv1.DescribeConsumerGroupResponse{
			Error: "failed to describe group: " + err.Error(),
		}, nil
	}

	// Get subscribed topics
	physicalTopics := GetSubscribedTopics(group)
	virtualTopics := make([]string, 0, len(physicalTopics))
	for _, topic := range physicalTopics {
		if vc.TopicPrefix != "" && strings.HasPrefix(topic, vc.TopicPrefix) {
			virtualTopics = append(virtualTopics, strings.TrimPrefix(topic, vc.TopicPrefix))
		} else if vc.TopicPrefix == "" {
			virtualTopics = append(virtualTopics, topic)
		}
	}

	// Get partition-level lag
	partitionLags, totalLag, err := s.getPartitionLags(ctx, kafkaClient, physicalGroupID, physicalTopics, vc.TopicPrefix)
	if err != nil {
		logrus.WithError(err).WithField("group", physicalGroupID).Warn("Failed to get partition lags")
	}

	return &gatewayv1.DescribeConsumerGroupResponse{
		Group: &gatewayv1.ConsumerGroupDetail{
			GroupId:     req.GroupId,
			State:       mapGroupState(group.State),
			MemberCount: int32(len(group.Members)),
			Topics:      virtualTopics,
			TotalLag:    totalLag,
			Partitions:  partitionLags,
		},
	}, nil
}

// ResetConsumerGroupOffsets resets offsets for a consumer group on a specific topic.
func (s *Service) ResetConsumerGroupOffsets(ctx context.Context, req *gatewayv1.ResetConsumerGroupOffsetsRequest) (*gatewayv1.ResetConsumerGroupOffsetsResponse, error) {
	vc, ok := s.vcStore.Get(req.VirtualClusterId)
	if !ok {
		return &gatewayv1.ResetConsumerGroupOffsetsResponse{
			Success: false,
			Error:   "virtual cluster not found",
		}, nil
	}

	// Add prefixes to get physical IDs
	physicalGroupID := vc.GroupPrefix + req.GroupId
	physicalTopic := vc.TopicPrefix + req.Topic

	logrus.WithFields(logrus.Fields{
		"virtual_cluster_id": req.VirtualClusterId,
		"virtual_group_id":   req.GroupId,
		"virtual_topic":      req.Topic,
		"reset_type":         req.ResetType.String(),
	}).Info("Resetting consumer group offsets")

	// Create Kafka admin client
	kafkaClient, err := NewKafkaAdminClient(vc.PhysicalBootstrapServers)
	if err != nil {
		return &gatewayv1.ResetConsumerGroupOffsetsResponse{
			Success: false,
			Error:   "failed to connect to Kafka: " + err.Error(),
		}, nil
	}
	defer kafkaClient.Close()

	// Verify group is empty or dead (can't reset active group)
	group, err := kafkaClient.DescribeGroup(ctx, physicalGroupID)
	if err != nil {
		return &gatewayv1.ResetConsumerGroupOffsetsResponse{
			Success: false,
			Error:   "failed to describe group: " + err.Error(),
		}, nil
	}

	if group.State != "Empty" && group.State != "Dead" && group.State != "" {
		return &gatewayv1.ResetConsumerGroupOffsetsResponse{
			Success: false,
			Error:   "cannot reset offsets for active group (state: " + group.State + "). Stop all consumers first.",
		}, nil
	}

	// Get target offsets based on reset type
	var targetOffsets kadm.ListedOffsets
	switch req.ResetType {
	case gatewayv1.OffsetResetType_OFFSET_RESET_TYPE_EARLIEST:
		targetOffsets, err = kafkaClient.FetchStartOffsets(ctx, physicalTopic)
	case gatewayv1.OffsetResetType_OFFSET_RESET_TYPE_LATEST:
		targetOffsets, err = kafkaClient.FetchEndOffsets(ctx, physicalTopic)
	case gatewayv1.OffsetResetType_OFFSET_RESET_TYPE_TIMESTAMP:
		targetOffsets, err = kafkaClient.FetchOffsetsForTimestamp(ctx, req.Timestamp, physicalTopic)
	default:
		return &gatewayv1.ResetConsumerGroupOffsetsResponse{
			Success: false,
			Error:   "invalid reset type",
		}, nil
	}

	if err != nil {
		return &gatewayv1.ResetConsumerGroupOffsetsResponse{
			Success: false,
			Error:   "failed to get target offsets: " + err.Error(),
		}, nil
	}

	// Convert to commit format
	toCommit := make(map[string]map[int32]kgo.EpochOffset)
	toCommit[physicalTopic] = make(map[int32]kgo.EpochOffset)

	for _, offset := range targetOffsets[physicalTopic] {
		toCommit[physicalTopic][offset.Partition] = kgo.EpochOffset{
			Epoch:  offset.LeaderEpoch,
			Offset: offset.Offset,
		}
	}

	// Commit the new offsets
	if err := kafkaClient.CommitOffsets(ctx, physicalGroupID, toCommit); err != nil {
		return &gatewayv1.ResetConsumerGroupOffsetsResponse{
			Success: false,
			Error:   "failed to commit new offsets: " + err.Error(),
		}, nil
	}

	// Build response with new offsets
	var newOffsets []*gatewayv1.PartitionLag
	for _, offset := range targetOffsets[physicalTopic] {
		newOffsets = append(newOffsets, &gatewayv1.PartitionLag{
			Topic:         req.Topic, // Virtual topic name
			Partition:     offset.Partition,
			CurrentOffset: offset.Offset,
			EndOffset:     offset.Offset, // After reset, current = end, so lag = 0
			Lag:           0,
		})
	}

	// Sort by partition
	sort.Slice(newOffsets, func(i, j int) bool {
		return newOffsets[i].Partition < newOffsets[j].Partition
	})

	return &gatewayv1.ResetConsumerGroupOffsetsResponse{
		Success:    true,
		NewOffsets: newOffsets,
	}, nil
}

// calculateGroupLag calculates total lag for a consumer group.
func (s *Service) calculateGroupLag(ctx context.Context, client *KafkaAdminClient, groupID string, topics []string) (int64, error) {
	if len(topics) == 0 {
		return 0, nil
	}

	// Get committed offsets
	committed, err := client.FetchGroupOffsets(ctx, groupID)
	if err != nil {
		return 0, err
	}

	// Get end offsets
	endOffsets, err := client.FetchEndOffsets(ctx, topics...)
	if err != nil {
		return 0, err
	}

	var totalLag int64
	for topic, partitions := range endOffsets {
		for _, endOffset := range partitions {
			committedOffset := int64(0)
			if topicCommitted, ok := committed[topic]; ok {
				if partCommitted, ok := topicCommitted[endOffset.Partition]; ok {
					committedOffset = partCommitted.Offset.At
				}
			}
			if endOffset.Offset > committedOffset {
				totalLag += endOffset.Offset - committedOffset
			}
		}
	}

	return totalLag, nil
}

// getPartitionLags returns partition-level lag information.
func (s *Service) getPartitionLags(ctx context.Context, client *KafkaAdminClient, groupID string, topics []string, topicPrefix string) ([]*gatewayv1.PartitionLag, int64, error) {
	if len(topics) == 0 {
		return nil, 0, nil
	}

	// Get committed offsets
	committed, err := client.FetchGroupOffsets(ctx, groupID)
	if err != nil {
		return nil, 0, err
	}

	// Get end offsets
	endOffsets, err := client.FetchEndOffsets(ctx, topics...)
	if err != nil {
		return nil, 0, err
	}

	var lags []*gatewayv1.PartitionLag
	var totalLag int64

	for topic, partitions := range endOffsets {
		// Unprefix topic name
		virtualTopic := topic
		if topicPrefix != "" && strings.HasPrefix(topic, topicPrefix) {
			virtualTopic = strings.TrimPrefix(topic, topicPrefix)
		}

		for _, endOffset := range partitions {
			committedOffset := int64(0)
			if topicCommitted, ok := committed[topic]; ok {
				if partCommitted, ok := topicCommitted[endOffset.Partition]; ok {
					committedOffset = partCommitted.Offset.At
				}
			}

			lag := int64(0)
			if endOffset.Offset > committedOffset {
				lag = endOffset.Offset - committedOffset
			}
			totalLag += lag

			lags = append(lags, &gatewayv1.PartitionLag{
				Topic:         virtualTopic,
				Partition:     endOffset.Partition,
				CurrentOffset: committedOffset,
				EndOffset:     endOffset.Offset,
				Lag:           lag,
			})
		}
	}

	// Sort by topic, then partition
	sort.Slice(lags, func(i, j int) bool {
		if lags[i].Topic != lags[j].Topic {
			return lags[i].Topic < lags[j].Topic
		}
		return lags[i].Partition < lags[j].Partition
	})

	return lags, totalLag, nil
}

// mapGroupState converts Kafka group state string to proto enum.
func mapGroupState(state string) gatewayv1.ConsumerGroupState {
	switch state {
	case "Stable":
		return gatewayv1.ConsumerGroupState_CONSUMER_GROUP_STATE_STABLE
	case "PreparingRebalance":
		return gatewayv1.ConsumerGroupState_CONSUMER_GROUP_STATE_PREPARING_REBALANCE
	case "CompletingRebalance":
		return gatewayv1.ConsumerGroupState_CONSUMER_GROUP_STATE_COMPLETING_REBALANCE
	case "Empty":
		return gatewayv1.ConsumerGroupState_CONSUMER_GROUP_STATE_EMPTY
	case "Dead":
		return gatewayv1.ConsumerGroupState_CONSUMER_GROUP_STATE_DEAD
	default:
		return gatewayv1.ConsumerGroupState_CONSUMER_GROUP_STATE_UNSPECIFIED
	}
}
