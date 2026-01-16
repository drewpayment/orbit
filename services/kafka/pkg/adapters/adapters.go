// Package adapters provides public access to Kafka adapter interfaces and constructors.
// This package re-exports types from the internal adapters package for cross-module use.
package adapters

import (
	"github.com/drewpayment/orbit/services/kafka/internal/adapters"
	"github.com/drewpayment/orbit/services/kafka/internal/adapters/apache"
	"github.com/drewpayment/orbit/services/kafka/internal/adapters/schema"
)

// Re-export interfaces
type (
	// KafkaAdapter defines the interface for Kafka cluster operations
	KafkaAdapter = adapters.KafkaAdapter
	// SchemaRegistryAdapter defines the interface for schema registry operations
	SchemaRegistryAdapter = adapters.SchemaRegistryAdapter
)

// Re-export types
type (
	// TopicSpec defines the specification for creating a topic
	TopicSpec = adapters.TopicSpec
	// TopicInfo contains information about an existing topic
	TopicInfo = adapters.TopicInfo
	// TopicMetrics contains usage metrics for a topic
	TopicMetrics = adapters.TopicMetrics
	// ACLSpec defines an ACL entry
	ACLSpec = adapters.ACLSpec
	// ACLInfo contains information about an existing ACL
	ACLInfo = adapters.ACLInfo
	// ConsumerGroupLag contains lag information for a consumer group
	ConsumerGroupLag = adapters.ConsumerGroupLag
	// ConsumerGroupInfo contains basic info about a consumer group
	ConsumerGroupInfo = adapters.ConsumerGroupInfo
	// SchemaSpec defines a schema to register
	SchemaSpec = adapters.SchemaSpec
	// SchemaReference for schema dependencies
	SchemaReference = adapters.SchemaReference
	// SchemaResult is returned after successful registration
	SchemaResult = adapters.SchemaResult
	// SchemaInfo contains information about a registered schema
	SchemaInfo = adapters.SchemaInfo
	// ResourceType for ACLs
	ResourceType = adapters.ResourceType
	// PatternType for ACL resource patterns
	PatternType = adapters.PatternType
	// ACLOperation defines Kafka operations
	ACLOperation = adapters.ACLOperation
	// ACLPermissionType defines allow/deny
	ACLPermissionType = adapters.ACLPermissionType
)

// Re-export constants
const (
	ResourceTypeTopic         = adapters.ResourceTypeTopic
	ResourceTypeGroup         = adapters.ResourceTypeGroup
	ResourceTypeCluster       = adapters.ResourceTypeCluster
	ResourceTypeTransactional = adapters.ResourceTypeTransactional

	PatternTypeLiteral  = adapters.PatternTypeLiteral
	PatternTypePrefixed = adapters.PatternTypePrefixed

	ACLOperationAll             = adapters.ACLOperationAll
	ACLOperationRead            = adapters.ACLOperationRead
	ACLOperationWrite           = adapters.ACLOperationWrite
	ACLOperationCreate          = adapters.ACLOperationCreate
	ACLOperationDelete          = adapters.ACLOperationDelete
	ACLOperationAlter           = adapters.ACLOperationAlter
	ACLOperationDescribe        = adapters.ACLOperationDescribe
	ACLOperationClusterAction   = adapters.ACLOperationClusterAction
	ACLOperationDescribeConfigs = adapters.ACLOperationDescribeConfigs
	ACLOperationAlterConfigs    = adapters.ACLOperationAlterConfigs
	ACLOperationIdempotentWrite = adapters.ACLOperationIdempotentWrite

	ACLPermissionAllow = adapters.ACLPermissionAllow
	ACLPermissionDeny  = adapters.ACLPermissionDeny
)

// Re-export errors
var (
	ErrTopicNotFound  = adapters.ErrTopicNotFound
	ErrSchemaNotFound = adapters.ErrSchemaNotFound
)

// ApacheClientConfig holds the connection configuration for Apache Kafka
type ApacheClientConfig = apache.Config

// SchemaRegistryConfig holds the connection configuration for Schema Registry
type SchemaRegistryConfig = schema.Config

// NewApacheClient creates a new Apache Kafka client from config
func NewApacheClient(config ApacheClientConfig) (KafkaAdapter, error) {
	return apache.NewClient(config)
}

// NewApacheClientFromCluster creates a client from a connection config map and credentials
func NewApacheClientFromCluster(connectionConfig, credentials map[string]string) (KafkaAdapter, error) {
	return apache.NewClientFromCluster(connectionConfig, credentials)
}

// NewSchemaRegistryClient creates a new Schema Registry client
func NewSchemaRegistryClient(config SchemaRegistryConfig) (SchemaRegistryAdapter, error) {
	return schema.NewClient(config)
}
