package adapters

import (
	"context"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
)

// KafkaAdapter defines the interface for Kafka cluster operations
type KafkaAdapter interface {
	// Connection
	ValidateConnection(ctx context.Context) error
	Close() error

	// Topic operations
	CreateTopic(ctx context.Context, spec TopicSpec) error
	DeleteTopic(ctx context.Context, topicName string) error
	DescribeTopic(ctx context.Context, topicName string) (*TopicInfo, error)
	UpdateTopicConfig(ctx context.Context, topicName string, config map[string]string) error
	ListTopics(ctx context.Context) ([]string, error)

	// ACL operations
	CreateACL(ctx context.Context, acl ACLSpec) error
	DeleteACL(ctx context.Context, acl ACLSpec) error
	ListACLs(ctx context.Context) ([]ACLInfo, error)

	// Metrics (optional - check capabilities first)
	GetTopicMetrics(ctx context.Context, topicName string) (*TopicMetrics, error)
	GetConsumerGroupLag(ctx context.Context, groupID string) (*ConsumerGroupLag, error)
	ListConsumerGroups(ctx context.Context) ([]ConsumerGroupInfo, error)
}

// SchemaRegistryAdapter defines the interface for schema registry operations
type SchemaRegistryAdapter interface {
	// Schema operations
	RegisterSchema(ctx context.Context, subject string, schema SchemaSpec) (SchemaResult, error)
	GetSchema(ctx context.Context, subject string, version int) (*SchemaInfo, error)
	GetLatestSchema(ctx context.Context, subject string) (*SchemaInfo, error)
	ListVersions(ctx context.Context, subject string) ([]int, error)
	CheckCompatibility(ctx context.Context, subject string, schema SchemaSpec) (bool, error)
	DeleteSubject(ctx context.Context, subject string) error
	ListSubjects(ctx context.Context) ([]string, error)

	// Configuration
	GetCompatibility(ctx context.Context, subject string) (domain.SchemaCompatibility, error)
	SetCompatibility(ctx context.Context, subject string, compatibility domain.SchemaCompatibility) error
}

// AdapterFactory creates adapters for different providers
type AdapterFactory interface {
	CreateKafkaAdapter(cluster *domain.KafkaCluster, credentials map[string]string) (KafkaAdapter, error)
	CreateSchemaRegistryAdapter(registry *domain.SchemaRegistry, credentials map[string]string) (SchemaRegistryAdapter, error)
}
