// services/bifrost/internal/admin/topic_handlers.go
// Topic management, metrics, and message browse/produce handlers.
package admin

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"

	gatewayv1 "github.com/drewpayment/orbit/proto/gen/go/idp/gateway/v1"
)

// ============================================================================
// Topic CRUD Handlers
// ============================================================================

func (s *Service) CreateTopic(ctx context.Context, req *gatewayv1.BifrostCreateTopicRequest) (*gatewayv1.BifrostCreateTopicResponse, error) {
	vc, ok := s.vcStore.Get(req.VirtualClusterId)
	if !ok {
		return &gatewayv1.BifrostCreateTopicResponse{Error: "virtual cluster not found"}, nil
	}

	physicalTopic := vc.TopicPrefix + req.TopicName

	logrus.WithFields(logrus.Fields{
		"virtual_cluster_id": req.VirtualClusterId,
		"virtual_topic":      req.TopicName,
		"physical_topic":     physicalTopic,
		"partitions":         req.Partitions,
	}).Info("Creating topic")

	kafkaClient, err := NewKafkaAdminClient(vc.PhysicalBootstrapServers)
	if err != nil {
		return &gatewayv1.BifrostCreateTopicResponse{Error: "failed to connect to Kafka: " + err.Error()}, nil
	}
	defer kafkaClient.Close()

	// kadm.CreateTopic expects map[string]*string for configs
	configPtrs := make(map[string]*string, len(req.Config))
	for k, v := range req.Config {
		v := v
		configPtrs[k] = &v
	}
	resp, err := kafkaClient.admin.CreateTopic(ctx, int32(req.Partitions), int16(req.ReplicationFactor), configPtrs, physicalTopic)
	if err != nil {
		return &gatewayv1.BifrostCreateTopicResponse{Error: "failed to create topic: " + err.Error()}, nil
	}
	if resp.Err != nil {
		return &gatewayv1.BifrostCreateTopicResponse{Error: "broker error: " + resp.Err.Error()}, nil
	}

	return &gatewayv1.BifrostCreateTopicResponse{Success: true}, nil
}

func (s *Service) DeleteTopic(ctx context.Context, req *gatewayv1.BifrostDeleteTopicRequest) (*gatewayv1.BifrostDeleteTopicResponse, error) {
	vc, ok := s.vcStore.Get(req.VirtualClusterId)
	if !ok {
		return &gatewayv1.BifrostDeleteTopicResponse{Error: "virtual cluster not found"}, nil
	}

	physicalTopic := vc.TopicPrefix + req.TopicName

	logrus.WithFields(logrus.Fields{
		"virtual_cluster_id": req.VirtualClusterId,
		"physical_topic":     physicalTopic,
	}).Info("Deleting topic")

	kafkaClient, err := NewKafkaAdminClient(vc.PhysicalBootstrapServers)
	if err != nil {
		return &gatewayv1.BifrostDeleteTopicResponse{Error: "failed to connect to Kafka: " + err.Error()}, nil
	}
	defer kafkaClient.Close()

	resp, err := kafkaClient.admin.DeleteTopics(ctx, physicalTopic)
	if err != nil {
		return &gatewayv1.BifrostDeleteTopicResponse{Error: "failed to delete topic: " + err.Error()}, nil
	}
	for _, r := range resp {
		if r.Err != nil {
			return &gatewayv1.BifrostDeleteTopicResponse{Error: "broker error: " + r.Err.Error()}, nil
		}
	}

	return &gatewayv1.BifrostDeleteTopicResponse{Success: true}, nil
}

func (s *Service) DescribeTopic(ctx context.Context, req *gatewayv1.BifrostDescribeTopicRequest) (*gatewayv1.BifrostDescribeTopicResponse, error) {
	vc, ok := s.vcStore.Get(req.VirtualClusterId)
	if !ok {
		return &gatewayv1.BifrostDescribeTopicResponse{Error: "virtual cluster not found"}, nil
	}

	physicalTopic := vc.TopicPrefix + req.TopicName

	kafkaClient, err := NewKafkaAdminClient(vc.PhysicalBootstrapServers)
	if err != nil {
		return &gatewayv1.BifrostDescribeTopicResponse{Error: "failed to connect to Kafka: " + err.Error()}, nil
	}
	defer kafkaClient.Close()

	// Get topic configs
	configs, err := kafkaClient.admin.DescribeTopicConfigs(ctx, physicalTopic)
	if err != nil {
		return &gatewayv1.BifrostDescribeTopicResponse{Error: "failed to describe topic: " + err.Error()}, nil
	}

	configMap := make(map[string]string)
	for _, rc := range configs {
		if rc.Err != nil {
			continue
		}
		for _, entry := range rc.Configs {
			if entry.Value != nil {
				configMap[entry.Key] = *entry.Value
			}
		}
	}

	// Get partition offsets
	startOffsets, err := kafkaClient.FetchStartOffsets(ctx, physicalTopic)
	if err != nil {
		return &gatewayv1.BifrostDescribeTopicResponse{Error: "failed to get start offsets: " + err.Error()}, nil
	}

	endOffsets, err := kafkaClient.FetchEndOffsets(ctx, physicalTopic)
	if err != nil {
		return &gatewayv1.BifrostDescribeTopicResponse{Error: "failed to get end offsets: " + err.Error()}, nil
	}

	// Build partition info
	var partitions []*gatewayv1.BifrostPartitionInfo
	endOffsets.Each(func(lo kadm.ListedOffset) {
		pi := &gatewayv1.BifrostPartitionInfo{
			PartitionId: lo.Partition,
			EndOffset:   lo.Offset,
		}
		// Match start offset
		startOffsets.Each(func(so kadm.ListedOffset) {
			if so.Partition == lo.Partition && so.Topic == lo.Topic {
				pi.StartOffset = so.Offset
			}
		})
		partitions = append(partitions, pi)
	})

	return &gatewayv1.BifrostDescribeTopicResponse{
		PartitionCount:    int32(len(partitions)),
		ReplicationFactor: 1, // TODO: get from topic metadata
		Config:            configMap,
		Partitions:        partitions,
	}, nil
}

func (s *Service) UpdateTopicConfig(ctx context.Context, req *gatewayv1.BifrostUpdateTopicConfigRequest) (*gatewayv1.BifrostUpdateTopicConfigResponse, error) {
	vc, ok := s.vcStore.Get(req.VirtualClusterId)
	if !ok {
		return &gatewayv1.BifrostUpdateTopicConfigResponse{Error: "virtual cluster not found"}, nil
	}

	physicalTopic := vc.TopicPrefix + req.TopicName

	logrus.WithFields(logrus.Fields{
		"virtual_cluster_id": req.VirtualClusterId,
		"physical_topic":     physicalTopic,
	}).Info("Updating topic config")

	kafkaClient, err := NewKafkaAdminClient(vc.PhysicalBootstrapServers)
	if err != nil {
		return &gatewayv1.BifrostUpdateTopicConfigResponse{Error: "failed to connect to Kafka: " + err.Error()}, nil
	}
	defer kafkaClient.Close()

	// Build alter config entries
	alterConfigs := make([]kadm.AlterConfig, 0, len(req.ConfigEntries))
	for k, v := range req.ConfigEntries {
		alterConfigs = append(alterConfigs, kadm.AlterConfig{
			Name:  k,
			Value: kadm.StringPtr(v),
			Op:    kadm.SetConfig,
		})
	}

	resp, err := kafkaClient.admin.AlterTopicConfigs(ctx, alterConfigs, physicalTopic)
	if err != nil {
		return &gatewayv1.BifrostUpdateTopicConfigResponse{Error: "failed to update config: " + err.Error()}, nil
	}
	for _, r := range resp {
		if r.Err != nil {
			return &gatewayv1.BifrostUpdateTopicConfigResponse{Error: "broker error: " + r.Err.Error()}, nil
		}
	}

	return &gatewayv1.BifrostUpdateTopicConfigResponse{Success: true}, nil
}

func (s *Service) ListTopics(ctx context.Context, req *gatewayv1.BifrostListTopicsRequest) (*gatewayv1.BifrostListTopicsResponse, error) {
	vc, ok := s.vcStore.Get(req.VirtualClusterId)
	if !ok {
		return &gatewayv1.BifrostListTopicsResponse{Error: "virtual cluster not found"}, nil
	}

	kafkaClient, err := NewKafkaAdminClient(vc.PhysicalBootstrapServers)
	if err != nil {
		return &gatewayv1.BifrostListTopicsResponse{Error: "failed to connect to Kafka: " + err.Error()}, nil
	}
	defer kafkaClient.Close()

	topics, err := kafkaClient.admin.ListTopics(ctx)
	if err != nil {
		return &gatewayv1.BifrostListTopicsResponse{Error: "failed to list topics: " + err.Error()}, nil
	}

	var virtualNames []string
	for _, topic := range topics.Sorted() {
		if strings.HasPrefix(topic.Topic, "__") {
			continue // skip internal topics
		}
		if vc.TopicPrefix != "" {
			if strings.HasPrefix(topic.Topic, vc.TopicPrefix) {
				virtualNames = append(virtualNames, strings.TrimPrefix(topic.Topic, vc.TopicPrefix))
			}
		} else {
			virtualNames = append(virtualNames, topic.Topic)
		}
	}

	return &gatewayv1.BifrostListTopicsResponse{TopicNames: virtualNames}, nil
}

// ============================================================================
// Topic Metrics Handler
// ============================================================================

func (s *Service) GetTopicMetrics(ctx context.Context, req *gatewayv1.BifrostGetTopicMetricsRequest) (*gatewayv1.BifrostGetTopicMetricsResponse, error) {
	vc, ok := s.vcStore.Get(req.VirtualClusterId)
	if !ok {
		return &gatewayv1.BifrostGetTopicMetricsResponse{Error: "virtual cluster not found"}, nil
	}

	physicalTopic := vc.TopicPrefix + req.TopicName

	kafkaClient, err := NewKafkaAdminClient(vc.PhysicalBootstrapServers)
	if err != nil {
		return &gatewayv1.BifrostGetTopicMetricsResponse{Error: "failed to connect to Kafka: " + err.Error()}, nil
	}
	defer kafkaClient.Close()

	startOffsets, err := kafkaClient.FetchStartOffsets(ctx, physicalTopic)
	if err != nil {
		return &gatewayv1.BifrostGetTopicMetricsResponse{Error: "failed to get start offsets: " + err.Error()}, nil
	}

	endOffsets, err := kafkaClient.FetchEndOffsets(ctx, physicalTopic)
	if err != nil {
		return &gatewayv1.BifrostGetTopicMetricsResponse{Error: "failed to get end offsets: " + err.Error()}, nil
	}

	var totalMessages int64
	var partitions []*gatewayv1.BifrostPartitionInfo

	endOffsets.Each(func(lo kadm.ListedOffset) {
		pi := &gatewayv1.BifrostPartitionInfo{
			PartitionId: lo.Partition,
			EndOffset:   lo.Offset,
		}
		startOffsets.Each(func(so kadm.ListedOffset) {
			if so.Partition == lo.Partition && so.Topic == lo.Topic {
				pi.StartOffset = so.Offset
				totalMessages += lo.Offset - so.Offset
			}
		})
		partitions = append(partitions, pi)
	})

	return &gatewayv1.BifrostGetTopicMetricsResponse{
		MessageCount: totalMessages,
		Partitions:   partitions,
	}, nil
}

// ============================================================================
// Message Browse & Produce Handlers
// ============================================================================

const (
	maxBrowseLimit     = 50
	maxMessageValueLen = 1 << 20 // 1MB
	maxMessageKeyLen   = 10 << 10 // 10KB
	browseTimeout      = 10 * time.Second
)

// browseCursor encodes partition→offset positions for pagination.
type browseCursor struct {
	Partitions map[int32]int64 `json:"p"`
}

func encodeCursor(c browseCursor) string {
	b, _ := json.Marshal(c)
	return base64.StdEncoding.EncodeToString(b)
}

func decodeCursor(s string) (browseCursor, error) {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return browseCursor{}, fmt.Errorf("invalid cursor: %w", err)
	}
	var c browseCursor
	if err := json.Unmarshal(b, &c); err != nil {
		return browseCursor{}, fmt.Errorf("invalid cursor data: %w", err)
	}
	return c, nil
}

func (s *Service) BrowseMessages(ctx context.Context, req *gatewayv1.BrowseMessagesRequest) (*gatewayv1.BrowseMessagesResponse, error) {
	vc, ok := s.vcStore.Get(req.VirtualClusterId)
	if !ok {
		return &gatewayv1.BrowseMessagesResponse{Error: "virtual cluster not found"}, nil
	}

	physicalTopic := vc.TopicPrefix + req.TopicName
	limit := int(req.Limit)
	if limit <= 0 || limit > maxBrowseLimit {
		limit = maxBrowseLimit
	}

	logrus.WithFields(logrus.Fields{
		"virtual_cluster_id": req.VirtualClusterId,
		"topic":              req.TopicName,
		"seek_type":          req.SeekType.String(),
		"limit":              limit,
	}).Debug("Browsing messages")

	// Determine starting offset
	var startOffset kgo.Offset
	switch req.SeekType {
	case gatewayv1.SeekType_SEEK_TYPE_OLDEST:
		startOffset = kgo.NewOffset().AtStart()
	case gatewayv1.SeekType_SEEK_TYPE_OFFSET:
		startOffset = kgo.NewOffset().At(req.StartOffset)
	default: // NEWEST / UNSPECIFIED
		startOffset = kgo.NewOffset().AtStart() // Fetch all, sort by offset desc later
	}

	// Build client options
	clientOpts := []kgo.Opt{
		kgo.SeedBrokers(vc.PhysicalBootstrapServers),
	}

	if req.Cursor != "" {
		// Resume from cursor — use explicit partition offsets
		cursor, err := decodeCursor(req.Cursor)
		if err != nil {
			return &gatewayv1.BrowseMessagesResponse{Error: err.Error()}, nil
		}
		partitionOffsets := make(map[int32]kgo.Offset)
		for p, o := range cursor.Partitions {
			partitionOffsets[p] = kgo.NewOffset().At(o)
		}
		clientOpts = append(clientOpts, kgo.ConsumePartitions(map[string]map[int32]kgo.Offset{
			physicalTopic: partitionOffsets,
		}))
	} else if len(req.Partitions) > 0 {
		// Specific partitions requested
		partitionOffsets := make(map[int32]kgo.Offset)
		for _, p := range req.Partitions {
			partitionOffsets[p] = startOffset
		}
		clientOpts = append(clientOpts, kgo.ConsumePartitions(map[string]map[int32]kgo.Offset{
			physicalTopic: partitionOffsets,
		}))
	} else {
		// All partitions — use ConsumeTopics with reset offset
		clientOpts = append(clientOpts,
			kgo.ConsumeTopics(physicalTopic),
			kgo.ConsumeResetOffset(startOffset),
		)
	}

	// Create temporary consumer
	client, err := kgo.NewClient(clientOpts...)
	if err != nil {
		return &gatewayv1.BrowseMessagesResponse{Error: "failed to create consumer: " + err.Error()}, nil
	}
	defer client.Close()

	// Fetch messages with a short poll. PollRecords blocks until `limit`
	// records or context deadline. Use 2s to return quickly.
	pollCtx, pollCancel := context.WithTimeout(ctx, 2*time.Second)
	defer pollCancel()
	fetches := client.PollRecords(pollCtx, limit)

	// Build response
	var messages []*gatewayv1.BifrostKafkaMessage
	nextCursorData := browseCursor{Partitions: make(map[int32]int64)}

	fetches.EachRecord(func(r *kgo.Record) {
		msg := &gatewayv1.BifrostKafkaMessage{
			Partition: r.Partition,
			Offset:    r.Offset,
			Timestamp: r.Timestamp.UnixMilli(),
			KeySize:   int32(len(r.Key)),
			ValueSize: int32(len(r.Value)),
		}

		// Apply size limits with truncation
		if len(r.Key) > maxMessageKeyLen {
			msg.Key = r.Key[:maxMessageKeyLen]
			msg.Truncated = true
		} else {
			msg.Key = r.Key
		}

		if len(r.Value) > maxMessageValueLen {
			msg.Value = r.Value[:maxMessageValueLen]
			msg.Truncated = true
		} else {
			msg.Value = r.Value
		}

		// Convert headers
		if len(r.Headers) > 0 {
			msg.Headers = make(map[string][]byte, len(r.Headers))
			for _, h := range r.Headers {
				msg.Headers[h.Key] = h.Value
			}
		}

		messages = append(messages, msg)

		// Track highest offset per partition for cursor
		if r.Offset+1 > nextCursorData.Partitions[r.Partition] {
			nextCursorData.Partitions[r.Partition] = r.Offset + 1
		}
	})

	var nextCursor string
	if len(messages) >= limit {
		nextCursor = encodeCursor(nextCursorData)
	}

	return &gatewayv1.BrowseMessagesResponse{
		Messages:   messages,
		NextCursor: nextCursor,
		HasMore:    len(messages) >= limit,
	}, nil
}

func (s *Service) ProduceMessage(ctx context.Context, req *gatewayv1.ProduceMessageRequest) (*gatewayv1.ProduceMessageResponse, error) {
	vc, ok := s.vcStore.Get(req.VirtualClusterId)
	if !ok {
		return &gatewayv1.ProduceMessageResponse{Error: "virtual cluster not found"}, nil
	}

	if vc.ReadOnly {
		return &gatewayv1.ProduceMessageResponse{Error: "virtual cluster is read-only"}, nil
	}

	physicalTopic := vc.TopicPrefix + req.TopicName

	logrus.WithFields(logrus.Fields{
		"virtual_cluster_id": req.VirtualClusterId,
		"topic":              req.TopicName,
	}).Debug("Producing message")

	client, err := kgo.NewClient(kgo.SeedBrokers(vc.PhysicalBootstrapServers))
	if err != nil {
		return &gatewayv1.ProduceMessageResponse{Error: "failed to create producer: " + err.Error()}, nil
	}
	defer client.Close()

	record := &kgo.Record{
		Topic: physicalTopic,
		Key:   req.Key,
		Value: req.Value,
	}

	if req.Partition != nil {
		record.Partition = *req.Partition
	}

	for k, v := range req.Headers {
		record.Headers = append(record.Headers, kgo.RecordHeader{Key: k, Value: v})
	}

	results := client.ProduceSync(ctx, record)
	if len(results) == 0 {
		return &gatewayv1.ProduceMessageResponse{Error: "no produce result"}, nil
	}

	r := results[0]
	if r.Err != nil {
		return &gatewayv1.ProduceMessageResponse{Error: "produce failed: " + r.Err.Error()}, nil
	}

	return &gatewayv1.ProduceMessageResponse{
		Partition: r.Record.Partition,
		Offset:    r.Record.Offset,
		Timestamp: r.Record.Timestamp.UnixMilli(),
	}, nil
}
