package grpc

import (
	"context"

	kafkav1 "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/drewpayment/orbit/services/kafka/internal/service"
	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// SchemaHandler handles schema-related gRPC calls
type SchemaHandler struct {
	schemaService *service.SchemaService
}

// NewSchemaHandler creates a new SchemaHandler
func NewSchemaHandler(schemaService *service.SchemaService) *SchemaHandler {
	return &SchemaHandler{
		schemaService: schemaService,
	}
}

// RegisterSchema registers a new schema
func (h *SchemaHandler) RegisterSchema(ctx context.Context, req *kafkav1.RegisterSchemaRequest) (*kafkav1.RegisterSchemaResponse, error) {
	topicID, err := uuid.Parse(req.TopicId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid topic ID: %v", err)
	}

	schema, err := h.schemaService.RegisterSchema(ctx, service.RegisterSchemaRequest{
		TopicID:       topicID,
		Type:          req.Type,
		Format:        schemaFormatFromProto(req.Format),
		Content:       req.Content,
		Compatibility: schemaCompatibilityFromProto(req.Compatibility),
	})

	if err != nil {
		return &kafkav1.RegisterSchemaResponse{
			Error: err.Error(),
		}, nil
	}

	return &kafkav1.RegisterSchemaResponse{
		Schema: schemaToProto(schema),
	}, nil
}

// GetSchema retrieves a schema by ID
func (h *SchemaHandler) GetSchema(ctx context.Context, req *kafkav1.GetSchemaRequest) (*kafkav1.GetSchemaResponse, error) {
	schemaID, err := uuid.Parse(req.SchemaId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid schema ID: %v", err)
	}

	schema, err := h.schemaService.GetSchema(ctx, schemaID)
	if err != nil {
		if err == domain.ErrSchemaNotFound {
			return nil, status.Errorf(codes.NotFound, "schema not found")
		}
		return nil, status.Errorf(codes.Internal, "failed to get schema: %v", err)
	}

	return &kafkav1.GetSchemaResponse{
		Schema: schemaToProto(schema),
	}, nil
}

// ListSchemas returns schemas for a topic
func (h *SchemaHandler) ListSchemas(ctx context.Context, req *kafkav1.ListSchemasRequest) (*kafkav1.ListSchemasResponse, error) {
	topicID, err := uuid.Parse(req.TopicId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid topic ID: %v", err)
	}

	schemas, err := h.schemaService.ListSchemas(ctx, topicID)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list schemas: %v", err)
	}

	pbSchemas := make([]*kafkav1.KafkaSchema, len(schemas))
	for i, s := range schemas {
		pbSchemas[i] = schemaToProto(s)
	}

	return &kafkav1.ListSchemasResponse{
		Schemas: pbSchemas,
	}, nil
}

// CheckSchemaCompatibility checks if a schema is compatible
func (h *SchemaHandler) CheckSchemaCompatibility(ctx context.Context, req *kafkav1.CheckSchemaCompatibilityRequest) (*kafkav1.CheckSchemaCompatibilityResponse, error) {
	topicID, err := uuid.Parse(req.TopicId)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid topic ID: %v", err)
	}

	compatible, err := h.schemaService.CheckSchemaCompatibility(ctx, service.CheckCompatibilityRequest{
		TopicID: topicID,
		Type:    req.Type,
		Format:  string(schemaFormatFromProto(req.Format)),
		Content: req.Content,
	})

	if err != nil {
		return &kafkav1.CheckSchemaCompatibilityResponse{
			Compatible: false,
			Error:      err.Error(),
		}, nil
	}

	return &kafkav1.CheckSchemaCompatibilityResponse{
		Compatible: compatible,
	}, nil
}

// Helper functions for proto conversion

func schemaToProto(s *domain.KafkaSchema) *kafkav1.KafkaSchema {
	pb := &kafkav1.KafkaSchema{
		Id:            s.ID.String(),
		WorkspaceId:   s.WorkspaceID.String(),
		TopicId:       s.TopicID.String(),
		Type:          string(s.Type),
		Subject:       s.Subject,
		Format:        schemaFormatToProto(s.Format),
		Content:       s.Content,
		Version:       int32(s.Version),
		SchemaId:      int32(s.SchemaID),
		Compatibility: schemaCompatibilityToProto(s.Compatibility),
		Status:        string(s.Status),
	}
	if !s.CreatedAt.IsZero() {
		pb.CreatedAt = timestamppb.New(s.CreatedAt)
	}
	if !s.UpdatedAt.IsZero() {
		pb.UpdatedAt = timestamppb.New(s.UpdatedAt)
	}
	return pb
}

func schemaFormatToProto(f domain.SchemaFormat) kafkav1.SchemaFormat {
	switch f {
	case domain.SchemaFormatAvro:
		return kafkav1.SchemaFormat_SCHEMA_FORMAT_AVRO
	case domain.SchemaFormatProtobuf:
		return kafkav1.SchemaFormat_SCHEMA_FORMAT_PROTOBUF
	case domain.SchemaFormatJSON:
		return kafkav1.SchemaFormat_SCHEMA_FORMAT_JSON
	default:
		return kafkav1.SchemaFormat_SCHEMA_FORMAT_UNSPECIFIED
	}
}

func schemaFormatFromProto(f kafkav1.SchemaFormat) domain.SchemaFormat {
	switch f {
	case kafkav1.SchemaFormat_SCHEMA_FORMAT_AVRO:
		return domain.SchemaFormatAvro
	case kafkav1.SchemaFormat_SCHEMA_FORMAT_PROTOBUF:
		return domain.SchemaFormatProtobuf
	case kafkav1.SchemaFormat_SCHEMA_FORMAT_JSON:
		return domain.SchemaFormatJSON
	default:
		return domain.SchemaFormatJSON
	}
}

func schemaCompatibilityToProto(c domain.SchemaCompatibility) kafkav1.SchemaCompatibility {
	switch c {
	case domain.SchemaCompatibilityBackward:
		return kafkav1.SchemaCompatibility_SCHEMA_COMPATIBILITY_BACKWARD
	case domain.SchemaCompatibilityForward:
		return kafkav1.SchemaCompatibility_SCHEMA_COMPATIBILITY_FORWARD
	case domain.SchemaCompatibilityFull:
		return kafkav1.SchemaCompatibility_SCHEMA_COMPATIBILITY_FULL
	case domain.SchemaCompatibilityNone:
		return kafkav1.SchemaCompatibility_SCHEMA_COMPATIBILITY_NONE
	default:
		return kafkav1.SchemaCompatibility_SCHEMA_COMPATIBILITY_UNSPECIFIED
	}
}

func schemaCompatibilityFromProto(c kafkav1.SchemaCompatibility) domain.SchemaCompatibility {
	switch c {
	case kafkav1.SchemaCompatibility_SCHEMA_COMPATIBILITY_BACKWARD:
		return domain.SchemaCompatibilityBackward
	case kafkav1.SchemaCompatibility_SCHEMA_COMPATIBILITY_FORWARD:
		return domain.SchemaCompatibilityForward
	case kafkav1.SchemaCompatibility_SCHEMA_COMPATIBILITY_FULL:
		return domain.SchemaCompatibilityFull
	case kafkav1.SchemaCompatibility_SCHEMA_COMPATIBILITY_NONE:
		return domain.SchemaCompatibilityNone
	default:
		return domain.SchemaCompatibilityBackward
	}
}

