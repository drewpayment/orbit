package service

import (
	"context"

	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/google/uuid"
)

// SchemaRepository defines persistence operations for schemas
type SchemaRepository interface {
	Create(ctx context.Context, schema *domain.KafkaSchema) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaSchema, error)
	GetBySubject(ctx context.Context, topicID uuid.UUID, schemaType string) (*domain.KafkaSchema, error)
	List(ctx context.Context, topicID uuid.UUID) ([]*domain.KafkaSchema, error)
	Update(ctx context.Context, schema *domain.KafkaSchema) error
	Delete(ctx context.Context, id uuid.UUID) error
}

// SchemaRegistryRepository defines persistence for schema registry configs
type SchemaRegistryRepository interface {
	GetByClusterID(ctx context.Context, clusterID uuid.UUID) (*domain.SchemaRegistry, error)
}

// SchemaService handles schema management operations
type SchemaService struct {
	schemaRepo         SchemaRepository
	registryRepo       SchemaRegistryRepository
	topicService       *TopicService
	adapterFactory     adapters.AdapterFactory
}

// NewSchemaService creates a new SchemaService
func NewSchemaService(
	schemaRepo SchemaRepository,
	registryRepo SchemaRegistryRepository,
	topicService *TopicService,
	adapterFactory adapters.AdapterFactory,
) *SchemaService {
	return &SchemaService{
		schemaRepo:     schemaRepo,
		registryRepo:   registryRepo,
		topicService:   topicService,
		adapterFactory: adapterFactory,
	}
}

// RegisterSchema registers a new schema
func (s *SchemaService) RegisterSchema(ctx context.Context, req RegisterSchemaRequest) (*domain.KafkaSchema, error) {
	// Get topic to validate ownership and get cluster info
	topic, err := s.topicService.GetTopic(ctx, req.TopicID)
	if err != nil {
		return nil, err
	}

	// Check if schema already exists for this type
	existing, err := s.schemaRepo.GetBySubject(ctx, req.TopicID, req.Type)
	if err != nil && err != domain.ErrSchemaNotFound {
		return nil, err
	}

	// Generate subject name: {env}.{workspace}.{topic}-{type}
	subject := generateSubjectName(topic, req.Type)

	schema := &domain.KafkaSchema{
		ID:            uuid.New(),
		WorkspaceID:   topic.WorkspaceID,
		TopicID:       req.TopicID,
		Type:          domain.SchemaType(req.Type),
		Subject:       subject,
		Format:        req.Format,
		Content:       req.Content,
		Compatibility: req.Compatibility,
		Status:        domain.SchemaStatusPending,
	}

	if existing != nil {
		// Evolving existing schema
		schema.ID = existing.ID
		schema.Version = existing.Version // Will be updated after registration
	}

	// Validate schema content is provided
	if schema.Content == "" {
		return nil, domain.ErrSchemaContentRequired
	}

	// Store schema (initially pending)
	if existing == nil {
		if err := s.schemaRepo.Create(ctx, schema); err != nil {
			return nil, err
		}
	} else {
		if err := s.schemaRepo.Update(ctx, schema); err != nil {
			return nil, err
		}
	}

	return schema, nil
}

// SyncSchema registers a schema with the schema registry
func (s *SchemaService) SyncSchema(ctx context.Context, schemaID uuid.UUID, credentials map[string]string) error {
	schema, err := s.schemaRepo.GetByID(ctx, schemaID)
	if err != nil {
		return err
	}
	if schema == nil {
		return domain.ErrSchemaNotFound
	}

	topic, err := s.topicService.GetTopic(ctx, schema.TopicID)
	if err != nil {
		return err
	}

	if topic.ClusterID == uuid.Nil {
		return domain.ErrTopicNotFound
	}

	// Get schema registry for cluster
	registry, err := s.registryRepo.GetByClusterID(ctx, topic.ClusterID)
	if err != nil {
		return err
	}

	// Create schema registry adapter
	adapter, err := s.adapterFactory.CreateSchemaRegistryAdapter(registry, credentials)
	if err != nil {
		schema.Status = domain.SchemaStatusFailed
		s.schemaRepo.Update(ctx, schema)
		return err
	}

	// Check compatibility first
	compatible, err := adapter.CheckCompatibility(ctx, schema.Subject, adapters.SchemaSpec{
		Schema:     schema.Content,
		SchemaType: string(schema.Format),
	})
	if err != nil {
		return err
	}
	if !compatible {
		schema.Status = domain.SchemaStatusFailed
		s.schemaRepo.Update(ctx, schema)
		return domain.ErrSchemaIncompatible
	}

	// Register schema
	result, err := adapter.RegisterSchema(ctx, schema.Subject, adapters.SchemaSpec{
		Schema:     schema.Content,
		SchemaType: string(schema.Format),
	})
	if err != nil {
		schema.Status = domain.SchemaStatusFailed
		s.schemaRepo.Update(ctx, schema)
		return err
	}

	schema.SchemaID = result.ID
	schema.Version = result.Version
	schema.Status = domain.SchemaStatusRegistered

	if err := s.schemaRepo.Update(ctx, schema); err != nil {
		return err
	}

	return nil
}

// GetSchema retrieves a schema by ID
func (s *SchemaService) GetSchema(ctx context.Context, schemaID uuid.UUID) (*domain.KafkaSchema, error) {
	schema, err := s.schemaRepo.GetByID(ctx, schemaID)
	if err != nil {
		return nil, err
	}
	if schema == nil {
		return nil, domain.ErrSchemaNotFound
	}
	return schema, nil
}

// ListSchemas returns schemas for a topic
func (s *SchemaService) ListSchemas(ctx context.Context, topicID uuid.UUID) ([]*domain.KafkaSchema, error) {
	return s.schemaRepo.List(ctx, topicID)
}

// CheckSchemaCompatibility checks if a schema is compatible with existing versions
func (s *SchemaService) CheckSchemaCompatibility(ctx context.Context, req CheckCompatibilityRequest) (bool, error) {
	topic, err := s.topicService.GetTopic(ctx, req.TopicID)
	if err != nil {
		return false, err
	}

	if topic.ClusterID == uuid.Nil {
		// No cluster yet, assume compatible
		return true, nil
	}

	registry, err := s.registryRepo.GetByClusterID(ctx, topic.ClusterID)
	if err != nil {
		return false, err
	}

	adapter, err := s.adapterFactory.CreateSchemaRegistryAdapter(registry, req.Credentials)
	if err != nil {
		return false, err
	}

	subject := generateSubjectName(topic, req.Type)
	return adapter.CheckCompatibility(ctx, subject, adapters.SchemaSpec{
		Schema:     req.Content,
		SchemaType: req.Format,
	})
}

// generateSubjectName creates a schema registry subject name
func generateSubjectName(topic *domain.KafkaTopic, schemaType string) string {
	return topic.Environment + "." + topic.WorkspaceID.String()[:8] + "." + topic.Name + "-" + schemaType
}

// RegisterSchemaRequest contains parameters for schema registration
type RegisterSchemaRequest struct {
	TopicID       uuid.UUID
	Type          string // "key" or "value"
	Format        domain.SchemaFormat
	Content       string
	Compatibility domain.SchemaCompatibility
}

// CheckCompatibilityRequest contains parameters for compatibility check
type CheckCompatibilityRequest struct {
	TopicID     uuid.UUID
	Type        string
	Format      string
	Content     string
	Credentials map[string]string
}
