// Package protocol provides Kafka protocol encoding/decoding.
package protocol

import (
	"fmt"

	"github.com/sirupsen/logrus"
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
	schema, err := getProduceRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &produceRequestModifier{
		schema:        schema,
		topicPrefixer: cfg.TopicPrefixer,
	}, nil
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
	schema, err := getListOffsetsRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &listOffsetsRequestModifier{
		schema:        schema,
		topicPrefixer: cfg.TopicPrefixer,
	}, nil
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
		logrus.Debug("modifyMetadataRequest: topics field is nil, no modification needed")
		return nil
	}

	topicsArray, ok := topicsField.([]interface{})
	if !ok {
		// Null topics array - nothing to modify
		logrus.Debugf("modifyMetadataRequest: topics is not an array (%T), no modification needed", topicsField)
		return nil
	}

	// Empty array means "no topics" - nothing to modify
	if len(topicsArray) == 0 {
		logrus.Debug("modifyMetadataRequest: topics array is empty, no modification needed")
		return nil
	}

	logrus.Debugf("modifyMetadataRequest: processing %d topics", len(topicsArray))

	// Check if we need to rebuild the array (for string-based topics)
	var newTopicsArray []interface{}
	needsRebuild := false

	for i, topicElement := range topicsArray {
		switch topic := topicElement.(type) {
		case string:
			// Older versions (v0-v8): topics is array of strings
			// Prefix the topic name and mark for rebuild
			prefixedName := prefixer(topic)
			if !needsRebuild {
				// First modification - copy existing elements
				newTopicsArray = make([]interface{}, len(topicsArray))
				copy(newTopicsArray, topicsArray)
				needsRebuild = true
			}
			newTopicsArray[i] = prefixedName
		case *Struct:
			// Newer versions (v9+): topics is array of structs with "name" field
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

	// Replace the topics array if we rebuilt it
	if needsRebuild {
		if err := decoded.Replace("topics", newTopicsArray); err != nil {
			return err
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
	// Request header v1 (used for Metadata v0-v8): CorrelationID + ClientID
	// Note: The request body passed to Apply() starts AFTER ApiKey/ApiVersion
	// so it includes: CorrelationID (INT32), ClientID (NULLABLE_STRING), then request fields

	// Metadata v0-v3: topics is nullable array of strings
	metadataRequestV0 := NewSchema("metadata_request_v0",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Array{Name: "topics", Ty: TypeStr},
	)

	// Metadata v4+: adds allow_auto_topic_creation
	metadataRequestV4 := NewSchema("metadata_request_v4",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Array{Name: "topics", Ty: TypeStr},
		&Mfield{Name: "allow_auto_topic_creation", Ty: TypeBool},
	)

	// Metadata v8: adds include_cluster_authorized_operations, include_topic_authorized_operations
	metadataRequestV8 := NewSchema("metadata_request_v8",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Array{Name: "topics", Ty: TypeStr},
		&Mfield{Name: "allow_auto_topic_creation", Ty: TypeBool},
		&Mfield{Name: "include_cluster_authorized_operations", Ty: TypeBool},
		&Mfield{Name: "include_topic_authorized_operations", Ty: TypeBool},
	)

	// Metadata v9+: uses compact arrays, compact strings, and tagged fields
	// Request header v2: CorrelationID + ClientID (NULLABLE_STRING) + TAG_BUFFER
	topicV9 := NewSchema("topic_v9",
		&Mfield{Name: "topic_id", Ty: TypeUuid},
		&Mfield{Name: "name", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	metadataRequestV9 := NewSchema("metadata_request_v9",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&SchemaTaggedFields{Name: "header_tagged_fields"},
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

// produceRequestModifier rewrites topic names in Produce requests
type produceRequestModifier struct {
	schema        Schema
	topicPrefixer TopicPrefixer
}

func (m *produceRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode produce request: %w", err)
	}

	if err := modifyProduceRequest(decoded, m.topicPrefixer); err != nil {
		return nil, fmt.Errorf("modify produce request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyProduceRequest(decoded *Struct, prefixer TopicPrefixer) error {
	topicDataField := decoded.Get("topic_data")
	if topicDataField == nil {
		logrus.Debug("modifyProduceRequest: topic_data field is nil")
		return nil
	}

	topicDataArray, ok := topicDataField.([]interface{})
	if !ok {
		logrus.Debugf("modifyProduceRequest: topic_data is not an array (%T)", topicDataField)
		return nil
	}

	for _, topicElement := range topicDataArray {
		topic, ok := topicElement.(*Struct)
		if !ok {
			continue
		}
		nameField := topic.Get("name")
		if nameField == nil {
			continue
		}
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
			logrus.Debugf("modifyProduceRequest: prefixing topic %s -> %s", topicName, prefixedName)
			if err := topic.Replace("name", prefixedName); err != nil {
				return err
			}
		}
	}
	return nil
}

// Produce request schemas
var produceRequestSchemas []Schema

func init() {
	produceRequestSchemas = createProduceRequestSchemas()
}

func createProduceRequestSchemas() []Schema {
	// Partition data schema (common across versions)
	partitionDataV0 := NewSchema("partition_data_v0",
		&Mfield{Name: "index", Ty: TypeInt32},
		&Mfield{Name: "records", Ty: TypeBytes},
	)

	// Topic data schema for v0-v2 (no transactional_id)
	topicDataV0 := NewSchema("topic_data_v0",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partition_data", Ty: partitionDataV0},
	)

	// Produce v0-v2: no transactional_id
	produceRequestV0 := NewSchema("produce_request_v0",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "acks", Ty: TypeInt16},
		&Mfield{Name: "timeout_ms", Ty: TypeInt32},
		&Array{Name: "topic_data", Ty: topicDataV0},
	)

	// Produce v3+: adds transactional_id
	produceRequestV3 := NewSchema("produce_request_v3",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "transactional_id", Ty: TypeNullableStr},
		&Mfield{Name: "acks", Ty: TypeInt16},
		&Mfield{Name: "timeout_ms", Ty: TypeInt32},
		&Array{Name: "topic_data", Ty: topicDataV0},
	)

	// v9+ uses compact arrays (flexible version)
	partitionDataV9 := NewSchema("partition_data_v9",
		&Mfield{Name: "index", Ty: TypeInt32},
		&Mfield{Name: "records", Ty: TypeCompactBytes},
		&SchemaTaggedFields{Name: "partition_tagged_fields"},
	)

	topicDataV9 := NewSchema("topic_data_v9",
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&CompactArray{Name: "partition_data", Ty: partitionDataV9},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	produceRequestV9 := NewSchema("produce_request_v9",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&SchemaTaggedFields{Name: "header_tagged_fields"},
		&Mfield{Name: "transactional_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "acks", Ty: TypeInt16},
		&Mfield{Name: "timeout_ms", Ty: TypeInt32},
		&CompactArray{Name: "topic_data", Ty: topicDataV9},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		produceRequestV0, // v0
		produceRequestV0, // v1
		produceRequestV0, // v2
		produceRequestV3, // v3
		produceRequestV3, // v4
		produceRequestV3, // v5
		produceRequestV3, // v6
		produceRequestV3, // v7
		produceRequestV3, // v8
		produceRequestV9, // v9
		produceRequestV9, // v10
		produceRequestV9, // v11
	}
}

func getProduceRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(produceRequestSchemas) {
		return nil, fmt.Errorf("unsupported produce request version %d", apiVersion)
	}
	return produceRequestSchemas[apiVersion], nil
}

// listOffsetsRequestModifier rewrites topic names in ListOffsets requests
type listOffsetsRequestModifier struct {
	schema        Schema
	topicPrefixer TopicPrefixer
}

func (m *listOffsetsRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode list offsets request: %w", err)
	}

	if err := modifyListOffsetsRequest(decoded, m.topicPrefixer); err != nil {
		return nil, fmt.Errorf("modify list offsets request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyListOffsetsRequest(decoded *Struct, prefixer TopicPrefixer) error {
	topicsField := decoded.Get("topics")
	if topicsField == nil {
		logrus.Debug("modifyListOffsetsRequest: topics field is nil")
		return nil
	}

	topicsArray, ok := topicsField.([]interface{})
	if !ok {
		logrus.Debugf("modifyListOffsetsRequest: topics is not an array (%T)", topicsField)
		return nil
	}

	for _, topicElement := range topicsArray {
		topic, ok := topicElement.(*Struct)
		if !ok {
			continue
		}
		nameField := topic.Get("name")
		if nameField == nil {
			continue
		}
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
			logrus.Debugf("modifyListOffsetsRequest: prefixing topic %s -> %s", topicName, prefixedName)
			if err := topic.Replace("name", prefixedName); err != nil {
				return err
			}
		}
	}
	return nil
}

// ListOffsets request schemas
var listOffsetsRequestSchemas []Schema

func init() {
	listOffsetsRequestSchemas = createListOffsetsRequestSchemas()
}

func createListOffsetsRequestSchemas() []Schema {
	// Partition schema for v0
	partitionV0 := NewSchema("list_offsets_partition_v0",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "timestamp", Ty: TypeInt64},
		&Mfield{Name: "max_num_offsets", Ty: TypeInt32},
	)

	// Partition schema for v1+ (no max_num_offsets)
	partitionV1 := NewSchema("list_offsets_partition_v1",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "timestamp", Ty: TypeInt64},
	)

	// Partition schema for v4+ (adds current_leader_epoch)
	partitionV4 := NewSchema("list_offsets_partition_v4",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "current_leader_epoch", Ty: TypeInt32},
		&Mfield{Name: "timestamp", Ty: TypeInt64},
	)

	// Topic schema for v0
	topicV0 := NewSchema("list_offsets_topic_v0",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV0},
	)

	// Topic schema for v1-v3
	topicV1 := NewSchema("list_offsets_topic_v1",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV1},
	)

	// Topic schema for v4-v5
	topicV4 := NewSchema("list_offsets_topic_v4",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV4},
	)

	// ListOffsets v0
	listOffsetsV0 := NewSchema("list_offsets_request_v0",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "replica_id", Ty: TypeInt32},
		&Array{Name: "topics", Ty: topicV0},
	)

	// ListOffsets v1
	listOffsetsV1 := NewSchema("list_offsets_request_v1",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "replica_id", Ty: TypeInt32},
		&Array{Name: "topics", Ty: topicV1},
	)

	// ListOffsets v2+ adds isolation_level
	listOffsetsV2 := NewSchema("list_offsets_request_v2",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "replica_id", Ty: TypeInt32},
		&Mfield{Name: "isolation_level", Ty: TypeInt8},
		&Array{Name: "topics", Ty: topicV1},
	)

	// ListOffsets v4+
	listOffsetsV4 := NewSchema("list_offsets_request_v4",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "replica_id", Ty: TypeInt32},
		&Mfield{Name: "isolation_level", Ty: TypeInt8},
		&Array{Name: "topics", Ty: topicV4},
	)

	// ListOffsets v6+ uses compact encoding
	partitionV6 := NewSchema("list_offsets_partition_v6",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "current_leader_epoch", Ty: TypeInt32},
		&Mfield{Name: "timestamp", Ty: TypeInt64},
		&SchemaTaggedFields{Name: "partition_tagged_fields"},
	)

	topicV6 := NewSchema("list_offsets_topic_v6",
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&CompactArray{Name: "partitions", Ty: partitionV6},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	listOffsetsV6 := NewSchema("list_offsets_request_v6",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&SchemaTaggedFields{Name: "header_tagged_fields"},
		&Mfield{Name: "replica_id", Ty: TypeInt32},
		&Mfield{Name: "isolation_level", Ty: TypeInt8},
		&CompactArray{Name: "topics", Ty: topicV6},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		listOffsetsV0, // v0
		listOffsetsV1, // v1
		listOffsetsV2, // v2
		listOffsetsV2, // v3
		listOffsetsV4, // v4
		listOffsetsV4, // v5
		listOffsetsV6, // v6
		listOffsetsV6, // v7
		listOffsetsV6, // v8
	}
}

func getListOffsetsRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(listOffsetsRequestSchemas) {
		return nil, fmt.Errorf("unsupported list offsets request version %d", apiVersion)
	}
	return listOffsetsRequestSchemas[apiVersion], nil
}
