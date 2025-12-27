package adapters

import (
	"errors"
	"time"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
)

// Adapter errors
var (
	ErrTopicNotFound  = errors.New("topic not found")
	ErrSchemaNotFound = errors.New("schema not found")
)

// TopicSpec defines the specification for creating a topic
type TopicSpec struct {
	Name              string
	Partitions        int
	ReplicationFactor int
	Config            map[string]string
}

// TopicInfo contains information about an existing topic
type TopicInfo struct {
	Name              string
	Partitions        int
	ReplicationFactor int
	Config            map[string]string
	Internal          bool
}

// ACLSpec defines an ACL entry
type ACLSpec struct {
	ResourceType   ResourceType
	ResourceName   string
	PatternType    PatternType
	Principal      string
	Host           string
	Operation      ACLOperation
	PermissionType ACLPermissionType
}

// ResourceType for ACLs
type ResourceType string

const (
	ResourceTypeTopic         ResourceType = "TOPIC"
	ResourceTypeGroup         ResourceType = "GROUP"
	ResourceTypeCluster       ResourceType = "CLUSTER"
	ResourceTypeTransactional ResourceType = "TRANSACTIONAL_ID"
)

// PatternType for ACL resource patterns
type PatternType string

const (
	PatternTypeLiteral  PatternType = "LITERAL"
	PatternTypePrefixed PatternType = "PREFIXED"
)

// ACLOperation defines Kafka operations
type ACLOperation string

const (
	ACLOperationAll             ACLOperation = "ALL"
	ACLOperationRead            ACLOperation = "READ"
	ACLOperationWrite           ACLOperation = "WRITE"
	ACLOperationCreate          ACLOperation = "CREATE"
	ACLOperationDelete          ACLOperation = "DELETE"
	ACLOperationAlter           ACLOperation = "ALTER"
	ACLOperationDescribe        ACLOperation = "DESCRIBE"
	ACLOperationClusterAction   ACLOperation = "CLUSTER_ACTION"
	ACLOperationDescribeConfigs ACLOperation = "DESCRIBE_CONFIGS"
	ACLOperationAlterConfigs    ACLOperation = "ALTER_CONFIGS"
	ACLOperationIdempotentWrite ACLOperation = "IDEMPOTENT_WRITE"
)

// ACLPermissionType defines allow/deny
type ACLPermissionType string

const (
	ACLPermissionAllow ACLPermissionType = "ALLOW"
	ACLPermissionDeny  ACLPermissionType = "DENY"
)

// ACLInfo contains information about an existing ACL
type ACLInfo struct {
	ResourceType   ResourceType
	ResourceName   string
	PatternType    PatternType
	Principal      string
	Host           string
	Operation      ACLOperation
	PermissionType ACLPermissionType
}

// TopicMetrics contains usage metrics for a topic
type TopicMetrics struct {
	TopicName        string
	BytesInPerSec    float64
	BytesOutPerSec   float64
	MessagesInPerSec float64
	PartitionCount   int
	ReplicaCount     int
	LogSizeBytes     int64
}

// ConsumerGroupLag contains lag information for a consumer group
type ConsumerGroupLag struct {
	GroupID      string
	State        string
	Members      int
	TopicLags    map[string]int64 // topic -> total lag
	TotalLag     int64
	LastActivity time.Time
}

// ConsumerGroupInfo contains basic info about a consumer group
type ConsumerGroupInfo struct {
	GroupID      string
	State        string
	Protocol     string
	ProtocolType string
	Members      int
}

// SchemaSpec defines a schema to register
type SchemaSpec struct {
	Schema     string
	SchemaType string // AVRO, PROTOBUF, JSON
	References []SchemaReference
}

// SchemaReference for schema dependencies
type SchemaReference struct {
	Name    string
	Subject string
	Version int
}

// SchemaResult is returned after successful registration
type SchemaResult struct {
	ID      int
	Version int
}

// SchemaInfo contains information about a registered schema
type SchemaInfo struct {
	Subject    string
	Version    int
	ID         int
	SchemaType string
	Schema     string
}

// ACLsForServiceAccount generates the ACLs needed for a service account
func ACLsForServiceAccount(account *domain.KafkaServiceAccount, topicName, consumerGroup string) []ACLSpec {
	principal := "User:" + account.Name
	var acls []ACLSpec

	// Common: describe topic
	acls = append(acls, ACLSpec{
		ResourceType:   ResourceTypeTopic,
		ResourceName:   topicName,
		PatternType:    PatternTypeLiteral,
		Principal:      principal,
		Host:           "*",
		Operation:      ACLOperationDescribe,
		PermissionType: ACLPermissionAllow,
	})

	// Producer ACLs
	if account.CanProduce() {
		acls = append(acls, ACLSpec{
			ResourceType:   ResourceTypeTopic,
			ResourceName:   topicName,
			PatternType:    PatternTypeLiteral,
			Principal:      principal,
			Host:           "*",
			Operation:      ACLOperationWrite,
			PermissionType: ACLPermissionAllow,
		})
	}

	// Consumer ACLs
	if account.CanConsume() {
		acls = append(acls, ACLSpec{
			ResourceType:   ResourceTypeTopic,
			ResourceName:   topicName,
			PatternType:    PatternTypeLiteral,
			Principal:      principal,
			Host:           "*",
			Operation:      ACLOperationRead,
			PermissionType: ACLPermissionAllow,
		})

		if consumerGroup != "" {
			acls = append(acls, ACLSpec{
				ResourceType:   ResourceTypeGroup,
				ResourceName:   consumerGroup,
				PatternType:    PatternTypeLiteral,
				Principal:      principal,
				Host:           "*",
				Operation:      ACLOperationRead,
				PermissionType: ACLPermissionAllow,
			})
		}
	}

	return acls
}
