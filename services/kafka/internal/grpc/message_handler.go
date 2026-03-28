package grpc

import (
	"context"
	"fmt"

	kafkav1 "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"github.com/drewpayment/orbit/services/kafka/internal/service"
	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// MessageHandler handles message browse and produce gRPC calls.
// It resolves topic IDs to virtual cluster IDs and topic names,
// then delegates broker operations to the KafkaAdapter (Bifrost).
type MessageHandler struct {
	adapter      adapters.KafkaAdapter
	topicService *service.TopicService
}

// NewMessageHandler creates a new MessageHandler.
func NewMessageHandler(adapter adapters.KafkaAdapter, topicService *service.TopicService) *MessageHandler {
	return &MessageHandler{adapter: adapter, topicService: topicService}
}

// resolveTopicInfo looks up a topic by ID and returns its virtual cluster ID and name.
func (h *MessageHandler) resolveTopicInfo(ctx context.Context, topicID string) (virtualClusterID, topicName string, err error) {
	id, err := uuid.Parse(topicID)
	if err != nil {
		return "", "", fmt.Errorf("invalid topic ID: %w", err)
	}

	topic, err := h.topicService.GetTopic(ctx, id)
	if err != nil {
		return "", "", fmt.Errorf("topic not found: %w", err)
	}

	// The topic's ClusterID field stores the virtual cluster ID in the Bifrost model
	vcID := topic.ClusterID.String()
	if vcID == "00000000-0000-0000-0000-000000000000" {
		return "", "", fmt.Errorf("topic has no virtual cluster assigned")
	}

	return vcID, topic.Name, nil
}

// BrowseTopicMessages fetches messages from a topic.
func (h *MessageHandler) BrowseTopicMessages(ctx context.Context, req *kafkav1.BrowseTopicMessagesRequest) (*kafkav1.BrowseTopicMessagesResponse, error) {
	if req.TopicId == "" {
		return nil, status.Errorf(codes.InvalidArgument, "topic_id is required")
	}

	seekType := "NEWEST"
	switch req.SeekType {
	case kafkav1.MessageSeekType_MESSAGE_SEEK_TYPE_OLDEST:
		seekType = "OLDEST"
	case kafkav1.MessageSeekType_MESSAGE_SEEK_TYPE_OFFSET:
		seekType = "OFFSET"
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 50
	}

	// Resolve topic ID → virtual cluster ID + topic name
	vcID, topicName, err := h.resolveTopicInfo(ctx, req.TopicId)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "resolve topic: %v", err)
	}

	// Access control is enforced at the server action layer (Next.js) which
	// verifies workspace membership and share permissions before calling this
	// gRPC endpoint.

	result, err := h.adapter.BrowseMessages(ctx, vcID, topicName, req.Partitions, seekType, req.StartOffset, limit, req.Cursor)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "browse messages: %v", err)
	}

	messages := make([]*kafkav1.KafkaMessage, len(result.Messages))
	for i, m := range result.Messages {
		messages[i] = &kafkav1.KafkaMessage{
			Partition: m.Partition,
			Offset:    m.Offset,
			Timestamp: m.Timestamp,
			Key:       m.Key,
			Value:     m.Value,
			Headers:   m.Headers,
			KeySize:   m.KeySize,
			ValueSize: m.ValueSize,
			Truncated: m.Truncated,
		}
	}

	return &kafkav1.BrowseTopicMessagesResponse{
		Messages:   messages,
		NextCursor: result.NextCursor,
		HasMore:    result.HasMore,
		CanProduce: true, // Determined by server action layer based on share permissions
	}, nil
}

// ProduceTopicMessage produces a message to a topic.
func (h *MessageHandler) ProduceTopicMessage(ctx context.Context, req *kafkav1.ProduceTopicMessageRequest) (*kafkav1.ProduceTopicMessageResponse, error) {
	if req.TopicId == "" {
		return nil, status.Errorf(codes.InvalidArgument, "topic_id is required")
	}

	// Resolve topic ID → virtual cluster ID + topic name
	vcID, topicName, err := h.resolveTopicInfo(ctx, req.TopicId)
	if err != nil {
		return nil, status.Errorf(codes.NotFound, "resolve topic: %v", err)
	}

	// Access control enforced at server action layer (workspace membership + share check).

	var partition *int32
	if req.Partition != nil {
		p := *req.Partition
		partition = &p
	}

	result, err := h.adapter.ProduceMessage(ctx, vcID, topicName, partition, req.Key, req.Value, req.Headers)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "produce message: %v", err)
	}

	return &kafkav1.ProduceTopicMessageResponse{
		Success:   true,
		Partition: result.Partition,
		Offset:    result.Offset,
		Timestamp: result.Timestamp,
	}, nil
}
