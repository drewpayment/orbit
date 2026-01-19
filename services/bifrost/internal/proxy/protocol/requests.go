// Package protocol provides Kafka protocol encoding/decoding.
package protocol

import (
	"fmt"
)

// RequestModifier modifies Kafka requests before forwarding to broker.
type RequestModifier interface {
	// Apply modifies the request bytes and returns the modified version.
	Apply(requestBytes []byte) ([]byte, error)
}

// TopicPrefixer is a function that adds a tenant prefix to topic names.
type TopicPrefixer func(topic string) string

// GroupPrefixer is a function that adds a tenant prefix to group IDs.
type GroupPrefixer func(group string) string

// TxnIDPrefixer is a function that adds a tenant prefix to transaction IDs.
type TxnIDPrefixer func(txnID string) string

// RequestModifierConfig holds functions for request modification.
type RequestModifierConfig struct {
	TopicPrefixer TopicPrefixer
	GroupPrefixer GroupPrefixer
	TxnIDPrefixer TxnIDPrefixer
}

// GetRequestModifier returns a RequestModifier for the given API key and version.
// Returns nil if no modification is needed for this request type.
func GetRequestModifier(apiKey int16, apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	switch apiKey {
	case apiKeyProduce:
		return newProduceRequestModifier(apiVersion, cfg)
	case apiKeyFetch:
		return newFetchRequestModifier(apiVersion, cfg)
	case apiKeyListOffsets:
		return newListOffsetsRequestModifier(apiVersion, cfg)
	case apiKeyMetadata:
		return newMetadataRequestModifier(apiVersion, cfg)
	case apiKeyOffsetCommit:
		return newOffsetCommitRequestModifier(apiVersion, cfg)
	case apiKeyOffsetFetch:
		return newOffsetFetchRequestModifier(apiVersion, cfg)
	case apiKeyFindCoordinator:
		return newFindCoordinatorRequestModifier(apiVersion, cfg)
	case apiKeyJoinGroup:
		return newJoinGroupRequestModifier(apiVersion, cfg)
	case apiKeyHeartbeat:
		return newHeartbeatRequestModifier(apiVersion, cfg)
	case apiKeyLeaveGroup:
		return newLeaveGroupRequestModifier(apiVersion, cfg)
	case apiKeySyncGroup:
		return newSyncGroupRequestModifier(apiVersion, cfg)
	case apiKeyDescribeGroups:
		return newDescribeGroupsRequestModifier(apiVersion, cfg)
	case apiKeyListGroups:
		// ListGroups request has no topics/groups to modify
		return nil, nil
	case apiKeyCreateTopics:
		return newCreateTopicsRequestModifier(apiVersion, cfg)
	case apiKeyDeleteTopics:
		return newDeleteTopicsRequestModifier(apiVersion, cfg)
	default:
		// No modification needed for this API
		return nil, nil
	}
}

// API key constants (additional ones not in responses.go)
const (
	apiKeyProduce        = int16(0)
	apiKeyFetch          = int16(1)
	apiKeyListOffsets    = int16(2)
	apiKeyOffsetCommit   = int16(8)
	apiKeyOffsetFetch    = int16(9)
	apiKeyJoinGroup      = int16(11)
	apiKeyHeartbeat      = int16(12)
	apiKeyLeaveGroup     = int16(13)
	apiKeySyncGroup      = int16(14)
	apiKeyDescribeGroups = int16(15)
	apiKeyListGroups     = int16(16)
	apiKeyCreateTopics   = int16(19)
	apiKeyDeleteTopics   = int16(20)
)

// Placeholder modifiers - Phase 1 implementations
// These will be expanded as we implement each API

func newProduceRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.TopicPrefixer == nil {
		return nil, nil
	}
	// TODO: Implement produce request topic rewriting
	return nil, nil
}

func newFetchRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.TopicPrefixer == nil {
		return nil, nil
	}
	// TODO: Implement fetch request topic rewriting
	return nil, nil
}

func newListOffsetsRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.TopicPrefixer == nil {
		return nil, nil
	}
	// TODO: Implement list offsets request topic rewriting
	return nil, nil
}

func newMetadataRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.TopicPrefixer == nil {
		return nil, nil
	}
	schema, err := getMetadataRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &metadataRequestModifier{
		schema:        schema,
		topicPrefixer: cfg.TopicPrefixer,
	}, nil
}

func newOffsetCommitRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil && cfg.TopicPrefixer == nil {
		return nil, nil
	}
	// TODO: Implement offset commit request rewriting
	return nil, nil
}

func newOffsetFetchRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil && cfg.TopicPrefixer == nil {
		return nil, nil
	}
	// TODO: Implement offset fetch request rewriting
	return nil, nil
}

func newFindCoordinatorRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil && cfg.TxnIDPrefixer == nil {
		return nil, nil
	}
	// TODO: Implement find coordinator request rewriting
	return nil, nil
}

func newJoinGroupRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil {
		return nil, nil
	}
	// TODO: Implement join group request rewriting
	return nil, nil
}

func newHeartbeatRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil {
		return nil, nil
	}
	// TODO: Implement heartbeat request rewriting
	return nil, nil
}

func newLeaveGroupRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil {
		return nil, nil
	}
	// TODO: Implement leave group request rewriting
	return nil, nil
}

func newSyncGroupRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil {
		return nil, nil
	}
	// TODO: Implement sync group request rewriting
	return nil, nil
}

func newDescribeGroupsRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil {
		return nil, nil
	}
	// TODO: Implement describe groups request rewriting
	return nil, nil
}

func newCreateTopicsRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.TopicPrefixer == nil {
		return nil, nil
	}
	// TODO: Implement create topics request rewriting
	return nil, nil
}

func newDeleteTopicsRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.TopicPrefixer == nil {
		return nil, nil
	}
	// TODO: Implement delete topics request rewriting
	return nil, nil
}

// metadataRequestModifier rewrites topic names in Metadata requests
type metadataRequestModifier struct {
	schema        Schema
	topicPrefixer TopicPrefixer
}

func (m *metadataRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode metadata request: %w", err)
	}

	if err := modifyMetadataRequest(decoded, m.topicPrefixer); err != nil {
		return nil, fmt.Errorf("modify metadata request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyMetadataRequest(decoded *Struct, prefixer TopicPrefixer) error {
	topicsField := decoded.Get("topics")
	if topicsField == nil {
		// No topics specified (means "all topics") - nothing to modify
		return nil
	}

	topicsArray, ok := topicsField.([]interface{})
	if !ok {
		// Null topics array - nothing to modify
		return nil
	}

	for _, topicElement := range topicsArray {
		switch topic := topicElement.(type) {
		case string:
			// Older versions: topics is array of strings
			// We can't modify in place for strings, need different approach
			// For now, skip - this is a limitation
		case *Struct:
			// Newer versions: topics is array of structs with "name" field
			nameField := topic.Get("name")
			var topicName string
			switch n := nameField.(type) {
			case string:
				topicName = n
			case *string:
				if n != nil {
					topicName = *n
				}
			}
			if topicName != "" {
				prefixedName := prefixer(topicName)
				if err := topic.Replace("name", &prefixedName); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

// Metadata request schemas for different versions
var metadataRequestSchemas []Schema

func init() {
	metadataRequestSchemas = createMetadataRequestSchemas()
}

func createMetadataRequestSchemas() []Schema {
	// Metadata v0-v3: topics is nullable array of strings
	metadataRequestV0 := NewSchema("metadata_request_v0",
		&Array{Name: "topics", Ty: TypeStr},
	)

	// Metadata v4+: adds allow_auto_topic_creation
	metadataRequestV4 := NewSchema("metadata_request_v4",
		&Array{Name: "topics", Ty: TypeStr},
		&Mfield{Name: "allow_auto_topic_creation", Ty: TypeBool},
	)

	// Metadata v8+: adds include_cluster_authorized_operations, include_topic_authorized_operations
	metadataRequestV8 := NewSchema("metadata_request_v8",
		&Array{Name: "topics", Ty: TypeStr},
		&Mfield{Name: "allow_auto_topic_creation", Ty: TypeBool},
		&Mfield{Name: "include_cluster_authorized_operations", Ty: TypeBool},
		&Mfield{Name: "include_topic_authorized_operations", Ty: TypeBool},
	)

	// Metadata v9+: uses compact arrays and includes tagged fields
	topicV9 := NewSchema("topic_v9",
		&Mfield{Name: "topic_id", Ty: TypeUuid},
		&Mfield{Name: "name", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	metadataRequestV9 := NewSchema("metadata_request_v9",
		&CompactArray{Name: "topics", Ty: topicV9},
		&Mfield{Name: "allow_auto_topic_creation", Ty: TypeBool},
		&Mfield{Name: "include_cluster_authorized_operations", Ty: TypeBool},
		&Mfield{Name: "include_topic_authorized_operations", Ty: TypeBool},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	// v10-v12 are similar to v9 with minor changes
	metadataRequestV10 := metadataRequestV9
	metadataRequestV11 := metadataRequestV9
	metadataRequestV12 := metadataRequestV9

	return []Schema{
		metadataRequestV0, // v0
		metadataRequestV0, // v1
		metadataRequestV0, // v2
		metadataRequestV0, // v3
		metadataRequestV4, // v4
		metadataRequestV4, // v5
		metadataRequestV4, // v6
		metadataRequestV4, // v7
		metadataRequestV8, // v8
		metadataRequestV9, // v9
		metadataRequestV10, // v10
		metadataRequestV11, // v11
		metadataRequestV12, // v12
	}
}

func getMetadataRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(metadataRequestSchemas) {
		return nil, fmt.Errorf("unsupported metadata request version %d", apiVersion)
	}
	return metadataRequestSchemas[apiVersion], nil
}
