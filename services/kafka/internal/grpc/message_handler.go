package grpc

import (
	"context"

	kafkav1 "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// MessageHandler handles message browse and produce gRPC calls.
// The server action layer resolves topic IDs to virtual cluster IDs and topic names
// before calling these handlers. The handler passes them directly to Bifrost.
type MessageHandler struct {
	adapter adapters.KafkaAdapter
}

// NewMessageHandler creates a new MessageHandler.
func NewMessageHandler(adapter adapters.KafkaAdapter) *MessageHandler {
	return &MessageHandler{adapter: adapter}
}

// BrowseTopicMessages fetches messages from a topic.
// The request's TopicId field carries the virtual topic name and
// WorkspaceId carries the virtual cluster ID (resolved by server action).
func (h *MessageHandler) BrowseTopicMessages(ctx context.Context, req *kafkav1.BrowseTopicMessagesRequest) (*kafkav1.BrowseTopicMessagesResponse, error) {
	if req.TopicId == "" || req.WorkspaceId == "" {
		return nil, status.Errorf(codes.InvalidArgument, "topic name and virtual cluster ID are required")
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

	// Access control is enforced at the server action layer (Next.js) which
	// verifies workspace membership and share permissions before calling this
	// gRPC endpoint. TopicId = virtual topic name, WorkspaceId = virtual cluster ID.

	result, err := h.adapter.BrowseMessages(ctx, req.WorkspaceId, req.TopicId, req.Partitions, seekType, req.StartOffset, limit, req.Cursor)
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
// TopicId = virtual topic name, WorkspaceId = virtual cluster ID.
func (h *MessageHandler) ProduceTopicMessage(ctx context.Context, req *kafkav1.ProduceTopicMessageRequest) (*kafkav1.ProduceTopicMessageResponse, error) {
	if req.TopicId == "" || req.WorkspaceId == "" {
		return nil, status.Errorf(codes.InvalidArgument, "topic name and virtual cluster ID are required")
	}

	// Access control enforced at server action layer.

	var partition *int32
	if req.Partition != nil {
		p := *req.Partition
		partition = &p
	}

	result, err := h.adapter.ProduceMessage(ctx, req.WorkspaceId, req.TopicId, partition, req.Key, req.Value, req.Headers)
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
