// Package bifrost implements the KafkaAdapter interface by routing all broker
// operations through Bifrost's admin gRPC API. This eliminates direct
// connections from the Kafka service to Redpanda.
package bifrost

import (
	"context"
	"fmt"

	"github.com/drewpayment/orbit/services/kafka/internal/adapters"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// Client implements adapters.KafkaAdapter via Bifrost admin gRPC.
type Client struct {
	conn     *grpc.ClientConn
	client   gatewayv1.BifrostAdminServiceClient
	vcID     string // virtual cluster ID for this adapter instance
}

// NewClient creates a new Bifrost adapter for the given virtual cluster.
func NewClient(bifrostAddr string, virtualClusterID string) (*Client, error) {
	conn, err := grpc.NewClient(bifrostAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("connect to bifrost: %w", err)
	}

	return &Client{
		conn:   conn,
		client: gatewayv1.NewBifrostAdminServiceClient(conn),
		vcID:   virtualClusterID,
	}, nil
}

// Ensure Client implements KafkaAdapter
var _ adapters.KafkaAdapter = (*Client)(nil)

// ============================================================================
// Connection
// ============================================================================

func (c *Client) ValidateConnection(ctx context.Context) error {
	resp, err := c.client.GetStatus(ctx, &gatewayv1.GetStatusRequest{})
	if err != nil {
		return fmt.Errorf("bifrost status check: %w", err)
	}
	if resp.Status != "ok" && resp.Status != "healthy" {
		return fmt.Errorf("bifrost unhealthy: %s", resp.Status)
	}
	return nil
}

func (c *Client) Close() error {
	return c.conn.Close()
}

// ============================================================================
// Topic Operations
// ============================================================================

func (c *Client) CreateTopic(ctx context.Context, spec adapters.TopicSpec) error {
	resp, err := c.client.CreateTopic(ctx, &gatewayv1.BifrostCreateTopicRequest{
		VirtualClusterId:  c.vcID,
		TopicName:         spec.Name,
		Partitions:        int32(spec.Partitions),
		ReplicationFactor: int32(spec.ReplicationFactor),
		Config:            spec.Config,
	})
	if err != nil {
		return fmt.Errorf("create topic via bifrost: %w", err)
	}
	if resp.Error != "" {
		return fmt.Errorf("create topic: %s", resp.Error)
	}
	return nil
}

func (c *Client) DeleteTopic(ctx context.Context, topicName string) error {
	resp, err := c.client.DeleteTopic(ctx, &gatewayv1.BifrostDeleteTopicRequest{
		VirtualClusterId: c.vcID,
		TopicName:        topicName,
	})
	if err != nil {
		return fmt.Errorf("delete topic via bifrost: %w", err)
	}
	if resp.Error != "" {
		return fmt.Errorf("delete topic: %s", resp.Error)
	}
	return nil
}

func (c *Client) DescribeTopic(ctx context.Context, topicName string) (*adapters.TopicInfo, error) {
	resp, err := c.client.DescribeTopic(ctx, &gatewayv1.BifrostDescribeTopicRequest{
		VirtualClusterId: c.vcID,
		TopicName:        topicName,
	})
	if err != nil {
		return nil, fmt.Errorf("describe topic via bifrost: %w", err)
	}
	if resp.Error != "" {
		return nil, fmt.Errorf("describe topic: %s", resp.Error)
	}

	return &adapters.TopicInfo{
		Name:              topicName,
		Partitions:        int(resp.PartitionCount),
		ReplicationFactor: int(resp.ReplicationFactor),
		Config:            resp.Config,
	}, nil
}

func (c *Client) UpdateTopicConfig(ctx context.Context, topicName string, config map[string]string) error {
	resp, err := c.client.UpdateTopicConfig(ctx, &gatewayv1.BifrostUpdateTopicConfigRequest{
		VirtualClusterId: c.vcID,
		TopicName:        topicName,
		ConfigEntries:    config,
	})
	if err != nil {
		return fmt.Errorf("update topic config via bifrost: %w", err)
	}
	if resp.Error != "" {
		return fmt.Errorf("update topic config: %s", resp.Error)
	}
	return nil
}

func (c *Client) ListTopics(ctx context.Context) ([]string, error) {
	resp, err := c.client.ListTopics(ctx, &gatewayv1.BifrostListTopicsRequest{
		VirtualClusterId: c.vcID,
	})
	if err != nil {
		return nil, fmt.Errorf("list topics via bifrost: %w", err)
	}
	if resp.Error != "" {
		return nil, fmt.Errorf("list topics: %s", resp.Error)
	}
	return resp.TopicNames, nil
}

// ============================================================================
// ACL Operations (use existing Bifrost RPCs)
// ============================================================================

func (c *Client) CreateACL(ctx context.Context, acl adapters.ACLSpec) error {
	// ACL operations go through Bifrost's existing UpsertTopicACL
	// For now, delegate to the existing implementation
	// TODO: Map ACLSpec to UpsertTopicACLRequest
	return fmt.Errorf("ACL operations via bifrost not yet implemented — use direct adapter")
}

func (c *Client) DeleteACL(ctx context.Context, acl adapters.ACLSpec) error {
	return fmt.Errorf("ACL operations via bifrost not yet implemented — use direct adapter")
}

func (c *Client) ListACLs(ctx context.Context) ([]adapters.ACLInfo, error) {
	return nil, fmt.Errorf("ACL operations via bifrost not yet implemented — use direct adapter")
}

// ============================================================================
// Metrics
// ============================================================================

func (c *Client) GetTopicMetrics(ctx context.Context, topicName string) (*adapters.TopicMetrics, error) {
	resp, err := c.client.GetTopicMetrics(ctx, &gatewayv1.BifrostGetTopicMetricsRequest{
		VirtualClusterId: c.vcID,
		TopicName:        topicName,
	})
	if err != nil {
		return nil, fmt.Errorf("get topic metrics via bifrost: %w", err)
	}
	if resp.Error != "" {
		return nil, fmt.Errorf("get topic metrics: %s", resp.Error)
	}

	return &adapters.TopicMetrics{
		TopicName:      topicName,
		PartitionCount: int(len(resp.Partitions)),
		LogSizeBytes:   resp.TotalBytes,
	}, nil
}

func (c *Client) GetConsumerGroupLag(ctx context.Context, groupID string) (*adapters.ConsumerGroupLag, error) {
	resp, err := c.client.DescribeConsumerGroup(ctx, &gatewayv1.DescribeConsumerGroupRequest{
		VirtualClusterId: c.vcID,
		GroupId:          groupID,
	})
	if err != nil {
		return nil, fmt.Errorf("describe consumer group via bifrost: %w", err)
	}
	if resp.Error != "" {
		return nil, fmt.Errorf("describe consumer group: %s", resp.Error)
	}

	g := resp.Group
	topicLags := make(map[string]int64)
	for _, p := range g.Partitions {
		topicLags[p.Topic] += p.Lag
	}

	return &adapters.ConsumerGroupLag{
		GroupID:   g.GroupId,
		State:     g.State.String(),
		Members:   int(g.MemberCount),
		TopicLags: topicLags,
		TotalLag:  g.TotalLag,
	}, nil
}

func (c *Client) ListConsumerGroups(ctx context.Context) ([]adapters.ConsumerGroupInfo, error) {
	resp, err := c.client.ListConsumerGroups(ctx, &gatewayv1.ListConsumerGroupsRequest{
		VirtualClusterId: c.vcID,
	})
	if err != nil {
		return nil, fmt.Errorf("list consumer groups via bifrost: %w", err)
	}
	if resp.Error != "" {
		return nil, fmt.Errorf("list consumer groups: %s", resp.Error)
	}

	groups := make([]adapters.ConsumerGroupInfo, len(resp.Groups))
	for i, g := range resp.Groups {
		groups[i] = adapters.ConsumerGroupInfo{
			GroupID: g.GroupId,
			State:   g.State.String(),
			Members: int(g.MemberCount),
		}
	}
	return groups, nil
}

// ============================================================================
// Message Operations
// ============================================================================

func (c *Client) BrowseMessages(ctx context.Context, virtualClusterID, topicName string, partitions []int32, seekType string, startOffset int64, limit int32, cursor string) (*adapters.BrowseResult, error) {
	st := gatewayv1.SeekType_SEEK_TYPE_NEWEST
	switch seekType {
	case "OLDEST":
		st = gatewayv1.SeekType_SEEK_TYPE_OLDEST
	case "OFFSET":
		st = gatewayv1.SeekType_SEEK_TYPE_OFFSET
	}

	resp, err := c.client.BrowseMessages(ctx, &gatewayv1.BrowseMessagesRequest{
		VirtualClusterId: virtualClusterID,
		TopicName:        topicName,
		Partitions:       partitions,
		SeekType:         st,
		StartOffset:      startOffset,
		Limit:            limit,
		Cursor:           cursor,
	})
	if err != nil {
		return nil, fmt.Errorf("browse messages via bifrost: %w", err)
	}
	if resp.Error != "" {
		return nil, fmt.Errorf("browse messages: %s", resp.Error)
	}

	messages := make([]adapters.MessageRecord, len(resp.Messages))
	for i, m := range resp.Messages {
		headers := make(map[string][]byte, len(m.Headers))
		for k, v := range m.Headers {
			headers[k] = v
		}
		messages[i] = adapters.MessageRecord{
			Partition: m.Partition,
			Offset:    m.Offset,
			Timestamp: m.Timestamp,
			Key:       m.Key,
			Value:     m.Value,
			Headers:   headers,
			KeySize:   m.KeySize,
			ValueSize: m.ValueSize,
			Truncated: m.Truncated,
		}
	}

	return &adapters.BrowseResult{
		Messages:   messages,
		NextCursor: resp.NextCursor,
		HasMore:    resp.HasMore,
	}, nil
}

func (c *Client) ProduceMessage(ctx context.Context, virtualClusterID, topicName string, partition *int32, key, value []byte, headers map[string][]byte) (*adapters.ProduceResult, error) {
	req := &gatewayv1.ProduceMessageRequest{
		VirtualClusterId: virtualClusterID,
		TopicName:        topicName,
		Key:              key,
		Value:            value,
	}
	if partition != nil {
		req.Partition = partition
	}
	if len(headers) > 0 {
		req.Headers = headers
	}

	resp, err := c.client.ProduceMessage(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("produce message via bifrost: %w", err)
	}
	if resp.Error != "" {
		return nil, fmt.Errorf("produce message: %s", resp.Error)
	}

	return &adapters.ProduceResult{
		Partition: resp.Partition,
		Offset:    resp.Offset,
		Timestamp: resp.Timestamp,
	}, nil
}
