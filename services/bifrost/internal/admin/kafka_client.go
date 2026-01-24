// services/bifrost/internal/admin/kafka_client.go
package admin

import (
	"context"
	"fmt"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
)

// KafkaAdminClient wraps franz-go admin client for consumer group operations.
type KafkaAdminClient struct {
	client *kgo.Client
	admin  *kadm.Client
}

// NewKafkaAdminClient creates a client connected to the physical Kafka cluster.
func NewKafkaAdminClient(bootstrapServers string) (*KafkaAdminClient, error) {
	client, err := kgo.NewClient(
		kgo.SeedBrokers(bootstrapServers),
		kgo.RequestTimeoutOverhead(30*time.Second),
	)
	if err != nil {
		return nil, fmt.Errorf("create kafka client: %w", err)
	}

	admin := kadm.NewClient(client)

	return &KafkaAdminClient{
		client: client,
		admin:  admin,
	}, nil
}

// Close closes the underlying Kafka client.
func (k *KafkaAdminClient) Close() {
	k.client.Close()
}

// ListGroups returns all consumer groups on the cluster.
func (k *KafkaAdminClient) ListGroups(ctx context.Context) (kadm.DescribedGroups, error) {
	// List all groups first
	listed, err := k.admin.ListGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("list groups: %w", err)
	}

	// Get all group names
	groupNames := listed.Groups()
	if len(groupNames) == 0 {
		return kadm.DescribedGroups{}, nil
	}

	// Describe all groups to get full details
	described, err := k.admin.DescribeGroups(ctx, groupNames...)
	if err != nil {
		return nil, fmt.Errorf("describe groups: %w", err)
	}

	return described, nil
}

// DescribeGroup returns detailed info about a specific group.
func (k *KafkaAdminClient) DescribeGroup(ctx context.Context, groupID string) (kadm.DescribedGroup, error) {
	described, err := k.admin.DescribeGroups(ctx, groupID)
	if err != nil {
		return kadm.DescribedGroup{}, fmt.Errorf("describe group %s: %w", groupID, err)
	}

	group, ok := described[groupID]
	if !ok {
		return kadm.DescribedGroup{}, fmt.Errorf("group %s not found", groupID)
	}

	return group, nil
}

// FetchGroupOffsets returns committed offsets for a group.
func (k *KafkaAdminClient) FetchGroupOffsets(ctx context.Context, groupID string) (kadm.OffsetResponses, error) {
	offsets, err := k.admin.FetchOffsets(ctx, groupID)
	if err != nil {
		return nil, fmt.Errorf("fetch offsets for group %s: %w", groupID, err)
	}
	return offsets, nil
}

// FetchEndOffsets returns end offsets (latest) for the given topics.
func (k *KafkaAdminClient) FetchEndOffsets(ctx context.Context, topics ...string) (kadm.ListedOffsets, error) {
	offsets, err := k.admin.ListEndOffsets(ctx, topics...)
	if err != nil {
		return nil, fmt.Errorf("list end offsets: %w", err)
	}
	return offsets, nil
}

// FetchStartOffsets returns start offsets (earliest) for the given topics.
func (k *KafkaAdminClient) FetchStartOffsets(ctx context.Context, topics ...string) (kadm.ListedOffsets, error) {
	offsets, err := k.admin.ListStartOffsets(ctx, topics...)
	if err != nil {
		return nil, fmt.Errorf("list start offsets: %w", err)
	}
	return offsets, nil
}

// FetchOffsetsForTimestamp returns offsets for the given timestamp.
func (k *KafkaAdminClient) FetchOffsetsForTimestamp(ctx context.Context, timestamp int64, topics ...string) (kadm.ListedOffsets, error) {
	offsets, err := k.admin.ListOffsetsAfterMilli(ctx, timestamp, topics...)
	if err != nil {
		return nil, fmt.Errorf("list offsets for timestamp: %w", err)
	}
	return offsets, nil
}

// CommitOffsets commits new offsets for a group.
func (k *KafkaAdminClient) CommitOffsets(ctx context.Context, groupID string, offsets map[string]map[int32]kgo.EpochOffset) error {
	// Convert to kadm format
	toCommit := make(kadm.Offsets)
	for topic, partitions := range offsets {
		for partition, epochOffset := range partitions {
			toCommit.Add(kadm.Offset{
				Topic:       topic,
				Partition:   partition,
				At:          epochOffset.Offset,
				LeaderEpoch: epochOffset.Epoch,
			})
		}
	}

	resp, err := k.admin.CommitOffsets(ctx, groupID, toCommit)
	if err != nil {
		return fmt.Errorf("commit offsets for group %s: %w", groupID, err)
	}

	// Check for any errors in the response
	for _, topicResp := range resp {
		for _, partResp := range topicResp {
			if partResp.Err != nil {
				return fmt.Errorf("commit offset error for %s[%d]: %w",
					partResp.Topic, partResp.Partition, partResp.Err)
			}
		}
	}

	return nil
}

// GetSubscribedTopics extracts the list of topics a group is consuming from.
func GetSubscribedTopics(group kadm.DescribedGroup) []string {
	// Use AssignedPartitions to get topics from the group's partition assignments
	assigned := group.AssignedPartitions()
	topics := make([]string, 0, len(assigned))
	for topic := range assigned {
		topics = append(topics, topic)
	}
	return topics
}
