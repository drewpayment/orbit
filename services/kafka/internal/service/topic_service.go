package service

import (
	"context"
	"fmt"

	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/google/uuid"
)

// TopicRepository defines persistence operations for topics
type TopicRepository interface {
	Create(ctx context.Context, topic *domain.KafkaTopic) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaTopic, error)
	GetByName(ctx context.Context, workspaceID uuid.UUID, environment, name string) (*domain.KafkaTopic, error)
	List(ctx context.Context, workspaceID uuid.UUID, environment string) ([]*domain.KafkaTopic, error)
	Update(ctx context.Context, topic *domain.KafkaTopic) error
	Delete(ctx context.Context, id uuid.UUID) error
}

// PolicyRepository defines persistence operations for topic policies
type PolicyRepository interface {
	GetEffectivePolicy(ctx context.Context, workspaceID uuid.UUID, environment string) (*domain.KafkaTopicPolicy, error)
}

// TopicService handles topic management operations
type TopicService struct {
	topicRepo      TopicRepository
	policyRepo     PolicyRepository
	clusterService *ClusterService
	adapterFactory adapters.AdapterFactory
}

// NewTopicService creates a new TopicService
func NewTopicService(
	topicRepo TopicRepository,
	policyRepo PolicyRepository,
	clusterService *ClusterService,
	adapterFactory adapters.AdapterFactory,
) *TopicService {
	return &TopicService{
		topicRepo:      topicRepo,
		policyRepo:     policyRepo,
		clusterService: clusterService,
		adapterFactory: adapterFactory,
	}
}

// CreateTopic creates a new topic request
func (s *TopicService) CreateTopic(ctx context.Context, req CreateTopicRequest) (*domain.KafkaTopic, error) {
	// Check for existing topic
	existing, err := s.topicRepo.GetByName(ctx, req.WorkspaceID, req.Environment, req.Name)
	if err != nil && err != domain.ErrTopicNotFound {
		return nil, err
	}
	if existing != nil {
		return nil, domain.ErrTopicAlreadyExists
	}

	// Get effective policy
	policy, err := s.policyRepo.GetEffectivePolicy(ctx, req.WorkspaceID, req.Environment)
	if err != nil && err != domain.ErrPolicyNotFound {
		return nil, err
	}

	// Create topic domain object using constructor
	topic := domain.NewKafkaTopic(req.WorkspaceID, req.Name, req.Environment)
	topic.Description = req.Description

	// Apply request values or defaults
	if req.Partitions > 0 {
		topic.Partitions = req.Partitions
	}
	if req.ReplicationFactor > 0 {
		topic.ReplicationFactor = req.ReplicationFactor
	}
	if req.RetentionMs > 0 {
		topic.RetentionMs = req.RetentionMs
	}
	if req.CleanupPolicy != "" {
		topic.CleanupPolicy = domain.CleanupPolicy(req.CleanupPolicy)
	}
	if req.Compression != "" {
		topic.Compression = domain.CompressionType(req.Compression)
	}
	if req.Config != nil {
		topic.Config = req.Config
	}
	topic.ApprovalRequired = true

	// Validate against policy
	if policy != nil {
		if !policy.ValidateTopicName(topic.Name) {
			return nil, domain.ErrPolicyNamingViolation
		}
		if !policy.ValidatePartitions(topic.Partitions) {
			return nil, domain.ErrPolicyPartitionLimit
		}
		if !policy.ValidateRetention(topic.RetentionMs) {
			return nil, domain.ErrPolicyRetentionLimit
		}
		topic.ApprovalRequired = policy.RequiresApproval(topic.Environment)

		// Check if auto-approve applies
		if policy.CanAutoApprove(topic.Name) {
			topic.ApprovalRequired = false
		}
	}

	if err := topic.Validate(); err != nil {
		return nil, err
	}

	// If no approval required, auto-approve
	if !topic.ApprovalRequired {
		topic.Status = domain.TopicStatusProvisioning
	}

	// Store topic
	if err := s.topicRepo.Create(ctx, topic); err != nil {
		return nil, err
	}

	return topic, nil
}

// GetTopic retrieves a topic by ID
func (s *TopicService) GetTopic(ctx context.Context, topicID uuid.UUID) (*domain.KafkaTopic, error) {
	topic, err := s.topicRepo.GetByID(ctx, topicID)
	if err != nil {
		return nil, err
	}
	if topic == nil {
		return nil, domain.ErrTopicNotFound
	}
	return topic, nil
}

// ListTopics returns topics for a workspace
func (s *TopicService) ListTopics(ctx context.Context, workspaceID uuid.UUID, environment string) ([]*domain.KafkaTopic, error) {
	return s.topicRepo.List(ctx, workspaceID, environment)
}

// UpdateTopic updates topic configuration
func (s *TopicService) UpdateTopic(ctx context.Context, topicID uuid.UUID, req UpdateTopicRequest) (*domain.KafkaTopic, error) {
	topic, err := s.topicRepo.GetByID(ctx, topicID)
	if err != nil {
		return nil, err
	}
	if topic == nil {
		return nil, domain.ErrTopicNotFound
	}

	// Only certain fields can be updated
	if req.Description != nil {
		topic.Description = *req.Description
	}
	if req.RetentionMs != nil {
		topic.RetentionMs = *req.RetentionMs
	}
	if req.Config != nil {
		topic.Config = req.Config
	}

	if err := s.topicRepo.Update(ctx, topic); err != nil {
		return nil, err
	}

	return topic, nil
}

// DeleteTopic initiates topic deletion
func (s *TopicService) DeleteTopic(ctx context.Context, topicID uuid.UUID) error {
	topic, err := s.topicRepo.GetByID(ctx, topicID)
	if err != nil {
		return err
	}
	if topic == nil {
		return domain.ErrTopicNotFound
	}

	if !topic.CanBeDeleted() {
		return domain.ErrTopicCannotBeDeleted
	}

	topic.Status = domain.TopicStatusDeleting
	if err := s.topicRepo.Update(ctx, topic); err != nil {
		return err
	}

	return nil
}

// ApproveTopic approves a pending topic
func (s *TopicService) ApproveTopic(ctx context.Context, topicID uuid.UUID, approverID uuid.UUID) (*domain.KafkaTopic, error) {
	topic, err := s.topicRepo.GetByID(ctx, topicID)
	if err != nil {
		return nil, err
	}
	if topic == nil {
		return nil, domain.ErrTopicNotFound
	}

	topic.Approve(approverID)

	if err := s.topicRepo.Update(ctx, topic); err != nil {
		return nil, err
	}

	return topic, nil
}

// ProvisionTopic provisions a topic on the Kafka cluster
func (s *TopicService) ProvisionTopic(ctx context.Context, topicID uuid.UUID, credentials map[string]string) error {
	topic, err := s.topicRepo.GetByID(ctx, topicID)
	if err != nil {
		return err
	}
	if topic == nil {
		return domain.ErrTopicNotFound
	}

	if topic.Status != domain.TopicStatusProvisioning {
		return fmt.Errorf("topic is not in provisioning state")
	}

	// Get cluster for environment
	cluster, err := s.clusterService.GetClusterForEnvironment(ctx, topic.Environment, topic.WorkspaceID)
	if err != nil {
		return err
	}

	// Create adapter
	adapter, err := s.adapterFactory.CreateKafkaAdapter(cluster, credentials)
	if err != nil {
		topic.Status = domain.TopicStatusFailed
		s.topicRepo.Update(ctx, topic)
		return err
	}
	defer adapter.Close()

	// Build full topic name with namespace
	fullTopicName := fmt.Sprintf("%s.%s.%s", topic.Environment, topic.WorkspaceID.String()[:8], topic.Name)

	// Create topic on cluster
	spec := adapters.TopicSpec{
		Name:              fullTopicName,
		Partitions:        topic.Partitions,
		ReplicationFactor: topic.ReplicationFactor,
		Config: map[string]string{
			"retention.ms":     fmt.Sprintf("%d", topic.RetentionMs),
			"cleanup.policy":   string(topic.CleanupPolicy),
			"compression.type": string(topic.Compression),
		},
	}

	// Merge additional config
	for k, v := range topic.Config {
		spec.Config[k] = v
	}

	if err := adapter.CreateTopic(ctx, spec); err != nil {
		topic.Status = domain.TopicStatusFailed
		s.topicRepo.Update(ctx, topic)
		return err
	}

	topic.Status = domain.TopicStatusActive
	topic.ClusterID = cluster.ID
	if err := s.topicRepo.Update(ctx, topic); err != nil {
		return err
	}

	return nil
}

// CreateTopicRequest contains parameters for topic creation
type CreateTopicRequest struct {
	WorkspaceID       uuid.UUID
	Name              string
	Description       string
	Environment       string
	Partitions        int
	ReplicationFactor int
	RetentionMs       int64
	CleanupPolicy     string
	Compression       string
	Config            map[string]string
}

// UpdateTopicRequest contains parameters for topic updates
type UpdateTopicRequest struct {
	Description *string
	RetentionMs *int64
	Config      map[string]string
}
