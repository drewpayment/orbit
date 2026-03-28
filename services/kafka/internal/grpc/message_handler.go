package grpc

import (
	"context"

	kafkav1 "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// MessageHandler handles message browse and produce gRPC calls.
// It delegates broker operations to the KafkaAdapter (which routes through Bifrost).
type MessageHandler struct {
	adapter adapters.KafkaAdapter
}

// NewMessageHandler creates a new MessageHandler.
func NewMessageHandler(adapter adapters.KafkaAdapter) *MessageHandler {
	return &MessageHandler{adapter: adapter}
}

// BrowseTopicMessages fetches messages from a topic.
func (h *MessageHandler) BrowseTopicMessages(ctx context.Context, req *kafkav1.BrowseTopicMessagesRequest) (*kafkav1.BrowseTopicMessagesResponse, error) {
	if req.TopicId == "" {
		return nil, status.Errorf(codes.InvalidArgument, "topic_id is required")
	}

	// Map seek type
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

	// TODO: Access control — verify user owns topic or has share access.
	// For now, pass through to adapter. Access control is enforced at the
	// server action layer (getPayloadUserFromSession + workspace/share check).

	result, err := h.adapter.BrowseMessages(ctx, req.TopicId, req.Partitions, seekType, req.StartOffset, limit, req.Cursor)
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
		CanProduce: true, // TODO: determine from access control
	}, nil
}

// ProduceTopicMessage produces a message to a topic.
func (h *MessageHandler) ProduceTopicMessage(ctx context.Context, req *kafkav1.ProduceTopicMessageRequest) (*kafkav1.ProduceTopicMessageResponse, error) {
	if req.TopicId == "" {
		return nil, status.Errorf(codes.InvalidArgument, "topic_id is required")
	}

	// TODO: Access control — verify user has write permission.

	var partition *int32
	if req.Partition != nil {
		p := *req.Partition
		partition = &p
	}

	result, err := h.adapter.ProduceMessage(ctx, req.TopicId, partition, req.Key, req.Value, req.Headers)
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
