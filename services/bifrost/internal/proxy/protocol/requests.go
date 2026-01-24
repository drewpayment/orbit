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
	schema, err := getFetchRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &fetchRequestModifier{
		schema:        schema,
		topicPrefixer: cfg.TopicPrefixer,
	}, nil
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
	schema, err := getOffsetCommitRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &offsetCommitRequestModifier{
		schema:        schema,
		groupPrefixer: cfg.GroupPrefixer,
		topicPrefixer: cfg.TopicPrefixer,
	}, nil
}

func newOffsetFetchRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil && cfg.TopicPrefixer == nil {
		return nil, nil
	}
	schema, err := getOffsetFetchRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &offsetFetchRequestModifier{
		schema:        schema,
		apiVersion:    apiVersion,
		groupPrefixer: cfg.GroupPrefixer,
		topicPrefixer: cfg.TopicPrefixer,
	}, nil
}

func newFindCoordinatorRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil && cfg.TxnIDPrefixer == nil {
		return nil, nil
	}
	schema, err := getFindCoordinatorRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &findCoordinatorRequestModifier{
		schema:        schema,
		groupPrefixer: cfg.GroupPrefixer,
		txnIDPrefixer: cfg.TxnIDPrefixer,
		apiVersion:    apiVersion,
	}, nil
}

func newJoinGroupRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil {
		return nil, nil
	}
	schema, err := getJoinGroupRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &joinGroupRequestModifier{
		schema:        schema,
		groupPrefixer: cfg.GroupPrefixer,
	}, nil
}

func newHeartbeatRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil {
		return nil, nil
	}
	schema, err := getHeartbeatRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &heartbeatRequestModifier{
		schema:        schema,
		groupPrefixer: cfg.GroupPrefixer,
	}, nil
}

func newLeaveGroupRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil {
		return nil, nil
	}
	schema, err := getLeaveGroupRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &leaveGroupRequestModifier{
		schema:        schema,
		groupPrefixer: cfg.GroupPrefixer,
	}, nil
}

func newSyncGroupRequestModifier(apiVersion int16, cfg RequestModifierConfig) (RequestModifier, error) {
	if cfg.GroupPrefixer == nil {
		return nil, nil
	}
	schema, err := getSyncGroupRequestSchema(apiVersion)
	if err != nil {
		return nil, err
	}
	return &syncGroupRequestModifier{
		schema:        schema,
		groupPrefixer: cfg.GroupPrefixer,
	}, nil
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

// joinGroupRequestModifier prefixes group_id in JoinGroup requests
type joinGroupRequestModifier struct {
	schema        Schema
	groupPrefixer GroupPrefixer
}

func (m *joinGroupRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode join group request: %w", err)
	}

	if err := modifyJoinGroupRequest(decoded, m.groupPrefixer); err != nil {
		return nil, fmt.Errorf("modify join group request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyJoinGroupRequest(decoded *Struct, prefixer GroupPrefixer) error {
	groupId := decoded.Get("group_id")
	if groupId == nil {
		return nil
	}
	if gid, ok := groupId.(string); ok && gid != "" {
		return decoded.Replace("group_id", prefixer(gid))
	}
	return nil
}

var joinGroupRequestSchemas []Schema

func init() {
	joinGroupRequestSchemas = createJoinGroupRequestSchemas()
}

func createJoinGroupRequestSchemas() []Schema {
	// Protocol metadata is opaque bytes
	groupProtocolV0 := NewSchema("group_protocol_v0",
		&Mfield{Name: "name", Ty: TypeStr},
		&Mfield{Name: "metadata", Ty: TypeBytes},
	)

	// v0: non-flexible
	joinGroupV0 := NewSchema("join_group_request_v0",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "session_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "protocol_type", Ty: TypeStr},
		&Array{Name: "protocols", Ty: groupProtocolV0},
	)

	// v1+ adds rebalance_timeout_ms
	joinGroupV1 := NewSchema("join_group_request_v1",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "session_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "rebalance_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "protocol_type", Ty: TypeStr},
		&Array{Name: "protocols", Ty: groupProtocolV0},
	)

	// v5 adds group_instance_id
	joinGroupV5 := NewSchema("join_group_request_v5",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "session_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "rebalance_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "group_instance_id", Ty: TypeNullableStr},
		&Mfield{Name: "protocol_type", Ty: TypeStr},
		&Array{Name: "protocols", Ty: groupProtocolV0},
	)

	// v6+ flexible
	groupProtocolV6 := NewSchema("group_protocol_v6",
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&Mfield{Name: "metadata", Ty: TypeCompactBytes},
		&SchemaTaggedFields{Name: "protocol_tagged_fields"},
	)

	joinGroupV6 := NewSchema("join_group_request_v6",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&SchemaTaggedFields{Name: "header_tagged_fields"},
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "session_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "rebalance_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "protocol_type", Ty: TypeCompactStr},
		&CompactArray{Name: "protocols", Ty: groupProtocolV6},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	// v8 adds reason
	joinGroupV8 := NewSchema("join_group_request_v8",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&SchemaTaggedFields{Name: "header_tagged_fields"},
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "session_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "rebalance_timeout_ms", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "protocol_type", Ty: TypeCompactStr},
		&CompactArray{Name: "protocols", Ty: groupProtocolV6},
		&Mfield{Name: "reason", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		joinGroupV0, // v0
		joinGroupV1, // v1
		joinGroupV1, // v2
		joinGroupV1, // v3
		joinGroupV1, // v4
		joinGroupV5, // v5
		joinGroupV6, // v6
		joinGroupV6, // v7
		joinGroupV8, // v8
		joinGroupV8, // v9
	}
}

func getJoinGroupRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(joinGroupRequestSchemas) {
		return nil, fmt.Errorf("unsupported JoinGroup request version %d", apiVersion)
	}
	return joinGroupRequestSchemas[apiVersion], nil
}

// syncGroupRequestModifier prefixes group_id in SyncGroup requests
type syncGroupRequestModifier struct {
	schema        Schema
	groupPrefixer GroupPrefixer
}

func (m *syncGroupRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode sync group request: %w", err)
	}

	if err := modifySyncGroupRequest(decoded, m.groupPrefixer); err != nil {
		return nil, fmt.Errorf("modify sync group request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifySyncGroupRequest(decoded *Struct, prefixer GroupPrefixer) error {
	groupId := decoded.Get("group_id")
	if groupId == nil {
		return nil
	}
	if gid, ok := groupId.(string); ok && gid != "" {
		return decoded.Replace("group_id", prefixer(gid))
	}
	return nil
}

var syncGroupRequestSchemas []Schema

func init() {
	syncGroupRequestSchemas = createSyncGroupRequestSchemas()
}

func createSyncGroupRequestSchemas() []Schema {
	assignmentV0 := NewSchema("sync_group_assignment_v0",
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "assignment", Ty: TypeBytes},
	)

	// v0-v2: non-flexible
	syncGroupV0 := NewSchema("sync_group_request_v0",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Array{Name: "assignments", Ty: assignmentV0},
	)

	// v3 adds group_instance_id
	syncGroupV3 := NewSchema("sync_group_request_v3",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "group_instance_id", Ty: TypeNullableStr},
		&Array{Name: "assignments", Ty: assignmentV0},
	)

	// v4+ flexible
	assignmentV4 := NewSchema("sync_group_assignment_v4",
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "assignment", Ty: TypeCompactBytes},
		&SchemaTaggedFields{Name: "assignment_tagged_fields"},
	)

	syncGroupV4 := NewSchema("sync_group_request_v4",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&SchemaTaggedFields{Name: "header_tagged_fields"},
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&CompactArray{Name: "assignments", Ty: assignmentV4},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	// v5 adds protocol_type and protocol_name
	syncGroupV5 := NewSchema("sync_group_request_v5",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&SchemaTaggedFields{Name: "header_tagged_fields"},
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "protocol_type", Ty: TypeCompactNullableStr},
		&Mfield{Name: "protocol_name", Ty: TypeCompactNullableStr},
		&CompactArray{Name: "assignments", Ty: assignmentV4},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		syncGroupV0, // v0
		syncGroupV0, // v1
		syncGroupV0, // v2
		syncGroupV3, // v3
		syncGroupV4, // v4
		syncGroupV5, // v5
	}
}

func getSyncGroupRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(syncGroupRequestSchemas) {
		return nil, fmt.Errorf("unsupported SyncGroup request version %d", apiVersion)
	}
	return syncGroupRequestSchemas[apiVersion], nil
}

// offsetCommitRequestModifier prefixes group_id and topics in OffsetCommit requests
type offsetCommitRequestModifier struct {
	schema        Schema
	groupPrefixer GroupPrefixer
	topicPrefixer TopicPrefixer
}

func (m *offsetCommitRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode offset commit request: %w", err)
	}

	if err := modifyOffsetCommitRequest(decoded, m.groupPrefixer, m.topicPrefixer); err != nil {
		return nil, fmt.Errorf("modify offset commit request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyOffsetCommitRequest(decoded *Struct, groupPrefixer GroupPrefixer, topicPrefixer TopicPrefixer) error {
	// Prefix group_id
	if groupPrefixer != nil {
		groupId := decoded.Get("group_id")
		if groupId != nil {
			if gid, ok := groupId.(string); ok && gid != "" {
				if err := decoded.Replace("group_id", groupPrefixer(gid)); err != nil {
					return err
				}
			}
		}
	}

	// Prefix topics
	if topicPrefixer != nil {
		topics := decoded.Get("topics")
		if topics != nil {
			topicsArray, ok := topics.([]interface{})
			if ok {
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
						if err := topic.Replace("name", topicPrefixer(topicName)); err != nil {
							return err
						}
					}
				}
			}
		}
	}

	return nil
}

var offsetCommitRequestSchemas []Schema

func init() {
	offsetCommitRequestSchemas = createOffsetCommitRequestSchemas()
}

func createOffsetCommitRequestSchemas() []Schema {
	// Partition for v0: partition_index, committed_offset, committed_metadata
	partitionV0 := NewSchema("offset_commit_partition_v0",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "committed_offset", Ty: TypeInt64},
		&Mfield{Name: "committed_metadata", Ty: TypeNullableStr},
	)

	topicV0 := NewSchema("offset_commit_topic_v0",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV0},
	)

	// v0: correlation_id, client_id, group_id, topics[]
	offsetCommitV0 := NewSchema("offset_commit_request_v0",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Array{Name: "topics", Ty: topicV0},
	)

	// v1 adds generation_id, member_id, and commit_timestamp in partition
	partitionV1 := NewSchema("offset_commit_partition_v1",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "committed_offset", Ty: TypeInt64},
		&Mfield{Name: "commit_timestamp", Ty: TypeInt64},
		&Mfield{Name: "committed_metadata", Ty: TypeNullableStr},
	)

	topicV1 := NewSchema("offset_commit_topic_v1",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV1},
	)

	offsetCommitV1 := NewSchema("offset_commit_request_v1",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Array{Name: "topics", Ty: topicV1},
	)

	// v2 adds retention_time_ms, removes commit_timestamp from partition
	offsetCommitV2 := NewSchema("offset_commit_request_v2",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "retention_time_ms", Ty: TypeInt64},
		&Array{Name: "topics", Ty: topicV0},
	)

	// v5 drops retention_time_ms, adds committed_leader_epoch in partition
	partitionV5 := NewSchema("offset_commit_partition_v5",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "committed_offset", Ty: TypeInt64},
		&Mfield{Name: "committed_leader_epoch", Ty: TypeInt32},
		&Mfield{Name: "committed_metadata", Ty: TypeNullableStr},
	)

	topicV5 := NewSchema("offset_commit_topic_v5",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV5},
	)

	offsetCommitV5 := NewSchema("offset_commit_request_v5",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Array{Name: "topics", Ty: topicV5},
	)

	// v7 adds group_instance_id
	offsetCommitV7 := NewSchema("offset_commit_request_v7",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "group_instance_id", Ty: TypeNullableStr},
		&Array{Name: "topics", Ty: topicV5},
	)

	// v8+ flexible
	partitionV8 := NewSchema("offset_commit_partition_v8",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "committed_offset", Ty: TypeInt64},
		&Mfield{Name: "committed_leader_epoch", Ty: TypeInt32},
		&Mfield{Name: "committed_metadata", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{Name: "partition_tagged_fields"},
	)

	topicV8 := NewSchema("offset_commit_topic_v8",
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&CompactArray{Name: "partitions", Ty: partitionV8},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	offsetCommitV8 := NewSchema("offset_commit_request_v8",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&SchemaTaggedFields{Name: "header_tagged_fields"},
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&CompactArray{Name: "topics", Ty: topicV8},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	// v9 adds generation_id_or_member_epoch semantics but same schema
	offsetCommitV9 := offsetCommitV8

	return []Schema{
		offsetCommitV0, // v0
		offsetCommitV1, // v1
		offsetCommitV2, // v2
		offsetCommitV2, // v3
		offsetCommitV2, // v4
		offsetCommitV5, // v5
		offsetCommitV5, // v6
		offsetCommitV7, // v7
		offsetCommitV8, // v8
		offsetCommitV9, // v9
	}
}

func getOffsetCommitRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(offsetCommitRequestSchemas) {
		return nil, fmt.Errorf("unsupported OffsetCommit request version %d", apiVersion)
	}
	return offsetCommitRequestSchemas[apiVersion], nil
}

// offsetFetchRequestModifier prefixes group_id and topics in OffsetFetch requests
type offsetFetchRequestModifier struct {
	schema        Schema
	apiVersion    int16
	groupPrefixer GroupPrefixer
	topicPrefixer TopicPrefixer
}

func (m *offsetFetchRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode offset fetch request: %w", err)
	}

	if err := modifyOffsetFetchRequest(decoded, m.groupPrefixer, m.topicPrefixer, m.apiVersion); err != nil {
		return nil, fmt.Errorf("modify offset fetch request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyOffsetFetchRequest(decoded *Struct, groupPrefixer GroupPrefixer, topicPrefixer TopicPrefixer, apiVersion int16) error {
	// v8+ uses groups array instead of single group_id
	if apiVersion >= 8 {
		return modifyOffsetFetchRequestV8(decoded, groupPrefixer, topicPrefixer)
	}

	// Prefix group_id
	if groupPrefixer != nil {
		groupId := decoded.Get("group_id")
		if groupId != nil {
			if gid, ok := groupId.(string); ok && gid != "" {
				if err := decoded.Replace("group_id", groupPrefixer(gid)); err != nil {
					return err
				}
			}
		}
	}

	// Prefix topics (if present - can be null for "all topics" in v2+)
	if topicPrefixer != nil {
		prefixOffsetFetchTopics(decoded, topicPrefixer)
	}

	return nil
}

// modifyOffsetFetchRequestV8 handles v8+ OffsetFetch requests that use groups array
func modifyOffsetFetchRequestV8(decoded *Struct, groupPrefixer GroupPrefixer, topicPrefixer TopicPrefixer) error {
	groups := decoded.Get("groups")
	if groups == nil {
		return nil
	}

	groupsArray, ok := groups.([]interface{})
	if !ok {
		return nil
	}

	for _, groupElement := range groupsArray {
		group, ok := groupElement.(*Struct)
		if !ok {
			continue
		}

		// Prefix group_id
		if groupPrefixer != nil {
			groupId := group.Get("group_id")
			if groupId != nil {
				if gid, ok := groupId.(string); ok && gid != "" {
					if err := group.Replace("group_id", groupPrefixer(gid)); err != nil {
						return err
					}
				}
			}
		}

		// Prefix topics within this group
		if topicPrefixer != nil {
			prefixOffsetFetchTopics(group, topicPrefixer)
		}
	}

	return nil
}

func prefixOffsetFetchTopics(s *Struct, topicPrefixer TopicPrefixer) error {
	topics := s.Get("topics")
	if topics == nil {
		return nil
	}

	topicsArray, ok := topics.([]interface{})
	if !ok {
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
			if err := topic.Replace("name", topicPrefixer(topicName)); err != nil {
				return err
			}
		}
	}
	return nil
}

var offsetFetchRequestSchemas []Schema

func init() {
	offsetFetchRequestSchemas = createOffsetFetchRequestSchemas()
}

func createOffsetFetchRequestSchemas() []Schema {
	// Topic for v0-v7: name, partition_indexes[]
	topicV0 := NewSchema("offset_fetch_topic_v0",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partition_indexes", Ty: TypeInt32},
	)

	// v0-v1: group_id + topics array
	offsetFetchV0 := NewSchema("offset_fetch_request_v0",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Array{Name: "topics", Ty: topicV0},
	)

	// v2+: topics can be null (meaning all topics) - same schema, logic handles null

	// v7 adds require_stable
	offsetFetchV7 := NewSchema("offset_fetch_request_v7",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Array{Name: "topics", Ty: topicV0},
		&Mfield{Name: "require_stable", Ty: TypeBool},
	)

	// v8+ flexible - uses groups array for batch lookup
	topicV8 := NewSchema("offset_fetch_topic_v8",
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&CompactArray{Name: "partition_indexes", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	groupV8 := NewSchema("offset_fetch_group_v8",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&CompactArray{Name: "topics", Ty: topicV8},
		&SchemaTaggedFields{Name: "group_tagged_fields"},
	)

	offsetFetchV8 := NewSchema("offset_fetch_request_v8",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&SchemaTaggedFields{Name: "header_tagged_fields"},
		&CompactArray{Name: "groups", Ty: groupV8},
		&Mfield{Name: "require_stable", Ty: TypeBool},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	// v9 is same as v8
	offsetFetchV9 := offsetFetchV8

	return []Schema{
		offsetFetchV0, // v0
		offsetFetchV0, // v1
		offsetFetchV0, // v2 (topics can be null but use same schema)
		offsetFetchV0, // v3
		offsetFetchV0, // v4
		offsetFetchV0, // v5
		offsetFetchV0, // v6
		offsetFetchV7, // v7
		offsetFetchV8, // v8
		offsetFetchV9, // v9
	}
}

func getOffsetFetchRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(offsetFetchRequestSchemas) {
		return nil, fmt.Errorf("unsupported OffsetFetch request version %d", apiVersion)
	}
	return offsetFetchRequestSchemas[apiVersion], nil
}

// heartbeatRequestModifier prefixes group_id in Heartbeat requests
type heartbeatRequestModifier struct {
	schema        Schema
	groupPrefixer GroupPrefixer
}

func (m *heartbeatRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode heartbeat request: %w", err)
	}

	if err := modifyHeartbeatRequest(decoded, m.groupPrefixer); err != nil {
		return nil, fmt.Errorf("modify heartbeat request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyHeartbeatRequest(decoded *Struct, prefixer GroupPrefixer) error {
	groupId := decoded.Get("group_id")
	if groupId == nil {
		return nil
	}
	if gid, ok := groupId.(string); ok && gid != "" {
		return decoded.Replace("group_id", prefixer(gid))
	}
	return nil
}

var heartbeatRequestSchemas []Schema

func init() {
	heartbeatRequestSchemas = createHeartbeatRequestSchemas()
}

func createHeartbeatRequestSchemas() []Schema {
	heartbeatV0 := NewSchema("heartbeat_request_v0",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
	)

	// v3 adds group_instance_id
	heartbeatV3 := NewSchema("heartbeat_request_v3",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "group_instance_id", Ty: TypeNullableStr},
	)

	// v4+ flexible
	heartbeatV4 := NewSchema("heartbeat_request_v4",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&SchemaTaggedFields{Name: "header_tagged_fields"},
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "generation_id", Ty: TypeInt32},
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		heartbeatV0, // v0
		heartbeatV0, // v1
		heartbeatV0, // v2
		heartbeatV3, // v3
		heartbeatV4, // v4
	}
}

func getHeartbeatRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(heartbeatRequestSchemas) {
		return nil, fmt.Errorf("unsupported Heartbeat request version %d", apiVersion)
	}
	return heartbeatRequestSchemas[apiVersion], nil
}

// leaveGroupRequestModifier prefixes group_id in LeaveGroup requests
type leaveGroupRequestModifier struct {
	schema        Schema
	groupPrefixer GroupPrefixer
}

func (m *leaveGroupRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode leave group request: %w", err)
	}

	if err := modifyLeaveGroupRequest(decoded, m.groupPrefixer); err != nil {
		return nil, fmt.Errorf("modify leave group request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyLeaveGroupRequest(decoded *Struct, prefixer GroupPrefixer) error {
	groupId := decoded.Get("group_id")
	if groupId == nil {
		return nil
	}
	if gid, ok := groupId.(string); ok && gid != "" {
		return decoded.Replace("group_id", prefixer(gid))
	}
	return nil
}

var leaveGroupRequestSchemas []Schema

func init() {
	leaveGroupRequestSchemas = createLeaveGroupRequestSchemas()
}

func createLeaveGroupRequestSchemas() []Schema {
	// v0-v2: simple format with single member
	leaveGroupV0 := NewSchema("leave_group_request_v0",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "member_id", Ty: TypeStr},
	)

	// v3+: multiple members can leave at once
	memberV3 := NewSchema("leave_group_member_v3",
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "group_instance_id", Ty: TypeNullableStr},
	)

	leaveGroupV3 := NewSchema("leave_group_request_v3",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Array{Name: "members", Ty: memberV3},
	)

	// v4+ flexible
	memberV4 := NewSchema("leave_group_member_v4",
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{Name: "member_tagged_fields"},
	)

	leaveGroupV4 := NewSchema("leave_group_request_v4",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&SchemaTaggedFields{Name: "header_tagged_fields"},
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&CompactArray{Name: "members", Ty: memberV4},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	// v5 adds reason
	memberV5 := NewSchema("leave_group_member_v5",
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "reason", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{Name: "member_tagged_fields"},
	)

	leaveGroupV5 := NewSchema("leave_group_request_v5",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&SchemaTaggedFields{Name: "header_tagged_fields"},
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&CompactArray{Name: "members", Ty: memberV5},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		leaveGroupV0, // v0
		leaveGroupV0, // v1
		leaveGroupV0, // v2
		leaveGroupV3, // v3
		leaveGroupV4, // v4
		leaveGroupV5, // v5
	}
}

func getLeaveGroupRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(leaveGroupRequestSchemas) {
		return nil, fmt.Errorf("unsupported LeaveGroup request version %d", apiVersion)
	}
	return leaveGroupRequestSchemas[apiVersion], nil
}

// findCoordinatorRequestModifier prefixes key in FindCoordinator requests
type findCoordinatorRequestModifier struct {
	schema        Schema
	groupPrefixer GroupPrefixer
	txnIDPrefixer TxnIDPrefixer
	apiVersion    int16
}

func (m *findCoordinatorRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode find coordinator request: %w", err)
	}

	if err := modifyFindCoordinatorRequest(decoded, m.apiVersion, m.groupPrefixer, m.txnIDPrefixer); err != nil {
		return nil, fmt.Errorf("modify find coordinator request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyFindCoordinatorRequest(decoded *Struct, apiVersion int16, groupPrefixer GroupPrefixer, txnIDPrefixer TxnIDPrefixer) error {
	// v4+ uses coordinator_keys array instead of single key
	if apiVersion >= 4 {
		return modifyFindCoordinatorRequestV4(decoded, groupPrefixer, txnIDPrefixer)
	}

	key := decoded.Get("key")
	if key == nil {
		return nil
	}
	keyStr, ok := key.(string)
	if !ok || keyStr == "" {
		return nil
	}

	// v0 doesn't have key_type, always use group prefixer
	if apiVersion == 0 {
		if groupPrefixer != nil {
			return decoded.Replace("key", groupPrefixer(keyStr))
		}
		return nil
	}

	// v1+ has key_type field
	keyTypeField := decoded.Get("key_type")
	if keyTypeField == nil {
		// Default to group coordinator
		if groupPrefixer != nil {
			return decoded.Replace("key", groupPrefixer(keyStr))
		}
		return nil
	}

	keyType, ok := keyTypeField.(int8)
	if !ok {
		// Try int32 in case it was decoded differently
		if kt, ok := keyTypeField.(int32); ok {
			keyType = int8(kt)
		}
	}

	switch keyType {
	case 0: // GROUP coordinator
		if groupPrefixer != nil {
			return decoded.Replace("key", groupPrefixer(keyStr))
		}
	case 1: // TRANSACTION coordinator
		if txnIDPrefixer != nil {
			return decoded.Replace("key", txnIDPrefixer(keyStr))
		}
	}

	return nil
}

// modifyFindCoordinatorRequestV4 handles v4+ FindCoordinator requests that use coordinator_keys array
func modifyFindCoordinatorRequestV4(decoded *Struct, groupPrefixer GroupPrefixer, txnIDPrefixer TxnIDPrefixer) error {
	// Get key_type to determine which prefixer to use
	keyType := int8(0) // default to group
	if kt := decoded.Get("key_type"); kt != nil {
		if ktVal, ok := kt.(int8); ok {
			keyType = ktVal
		}
	}

	// Select appropriate prefixer based on key_type
	var prefixer func(string) string
	if keyType == 0 && groupPrefixer != nil {
		prefixer = groupPrefixer
	} else if keyType == 1 && txnIDPrefixer != nil {
		prefixer = txnIDPrefixer
	}

	if prefixer == nil {
		return nil // No applicable prefixer
	}

	// Get coordinator_keys array
	keys := decoded.Get("coordinator_keys")
	if keys == nil {
		return nil
	}

	keysArray, ok := keys.([]interface{})
	if !ok {
		return nil
	}

	// Prefix each key in the array
	newKeys := make([]interface{}, len(keysArray))
	for i, k := range keysArray {
		if keyStr, ok := k.(string); ok && keyStr != "" {
			newKeys[i] = prefixer(keyStr)
		} else {
			newKeys[i] = k
		}
	}

	return decoded.Replace("coordinator_keys", newKeys)
}

var findCoordinatorRequestSchemas []Schema

func init() {
	findCoordinatorRequestSchemas = createFindCoordinatorRequestSchemas()
}

func createFindCoordinatorRequestSchemas() []Schema {
	// v0: no key_type
	findCoordinatorV0 := NewSchema("find_coordinator_request_v0",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "key", Ty: TypeStr},
	)

	// v1-v2: adds key_type
	findCoordinatorV1 := NewSchema("find_coordinator_request_v1",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "key", Ty: TypeStr},
		&Mfield{Name: "key_type", Ty: TypeInt8},
	)

	// v3+ flexible
	findCoordinatorV3 := NewSchema("find_coordinator_request_v3",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&SchemaTaggedFields{Name: "header_tagged_fields"},
		&Mfield{Name: "key", Ty: TypeCompactStr},
		&Mfield{Name: "key_type", Ty: TypeInt8},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	// v4+ adds coordinator_keys array for batch lookup
	findCoordinatorV4 := NewSchema("find_coordinator_request_v4",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&SchemaTaggedFields{Name: "header_tagged_fields"},
		&Mfield{Name: "key_type", Ty: TypeInt8},
		&CompactArray{Name: "coordinator_keys", Ty: TypeCompactStr},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		findCoordinatorV0, // v0
		findCoordinatorV1, // v1
		findCoordinatorV1, // v2
		findCoordinatorV3, // v3
		findCoordinatorV4, // v4
		findCoordinatorV4, // v5
	}
}

func getFindCoordinatorRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(findCoordinatorRequestSchemas) {
		return nil, fmt.Errorf("unsupported FindCoordinator request version %d", apiVersion)
	}
	return findCoordinatorRequestSchemas[apiVersion], nil
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

// fetchRequestModifier rewrites topic names in Fetch requests
type fetchRequestModifier struct {
	schema        Schema
	topicPrefixer TopicPrefixer
}

func (m *fetchRequestModifier) Apply(requestBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(requestBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode fetch request: %w", err)
	}

	if err := modifyFetchRequest(decoded, m.topicPrefixer); err != nil {
		return nil, fmt.Errorf("modify fetch request: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyFetchRequest(decoded *Struct, prefixer TopicPrefixer) error {
	topicsField := decoded.Get("topics")
	if topicsField == nil {
		logrus.Debug("modifyFetchRequest: topics field is nil")
		return nil
	}

	topicsArray, ok := topicsField.([]interface{})
	if !ok {
		logrus.Debugf("modifyFetchRequest: topics is not an array (%T)", topicsField)
		return nil
	}

	for _, topicElement := range topicsArray {
		topic, ok := topicElement.(*Struct)
		if !ok {
			continue
		}
		// Try "topic" field (v0-v12) then "topic_id" for UUID-based (v13+)
		nameField := topic.Get("topic")
		if nameField == nil {
			// For v13+, topic name might be empty if using topic_id
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
			logrus.Debugf("modifyFetchRequest: prefixing topic %s -> %s", topicName, prefixedName)
			if err := topic.Replace("topic", prefixedName); err != nil {
				return err
			}
		}
	}
	return nil
}

// Fetch request schemas
var fetchRequestSchemas []Schema

func init() {
	fetchRequestSchemas = createFetchRequestSchemas()
}

func createFetchRequestSchemas() []Schema {
	// Partition schema for v0-v4
	partitionV0 := NewSchema("fetch_partition_v0",
		&Mfield{Name: "partition", Ty: TypeInt32},
		&Mfield{Name: "fetch_offset", Ty: TypeInt64},
		&Mfield{Name: "partition_max_bytes", Ty: TypeInt32},
	)

	// Topic schema for v0-v4
	topicV0 := NewSchema("fetch_topic_v0",
		&Mfield{Name: "topic", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV0},
	)

	// Fetch v0
	fetchV0 := NewSchema("fetch_request_v0",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "replica_id", Ty: TypeInt32},
		&Mfield{Name: "max_wait_ms", Ty: TypeInt32},
		&Mfield{Name: "min_bytes", Ty: TypeInt32},
		&Array{Name: "topics", Ty: topicV0},
	)

	// Fetch v3 adds max_bytes
	fetchV3 := NewSchema("fetch_request_v3",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "replica_id", Ty: TypeInt32},
		&Mfield{Name: "max_wait_ms", Ty: TypeInt32},
		&Mfield{Name: "min_bytes", Ty: TypeInt32},
		&Mfield{Name: "max_bytes", Ty: TypeInt32},
		&Array{Name: "topics", Ty: topicV0},
	)

	// Fetch v4 adds isolation_level
	fetchV4 := NewSchema("fetch_request_v4",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "replica_id", Ty: TypeInt32},
		&Mfield{Name: "max_wait_ms", Ty: TypeInt32},
		&Mfield{Name: "min_bytes", Ty: TypeInt32},
		&Mfield{Name: "max_bytes", Ty: TypeInt32},
		&Mfield{Name: "isolation_level", Ty: TypeInt8},
		&Array{Name: "topics", Ty: topicV0},
	)

	// Partition schema for v5+ adds log_start_offset in response, but request adds current_leader_epoch
	partitionV5 := NewSchema("fetch_partition_v5",
		&Mfield{Name: "partition", Ty: TypeInt32},
		&Mfield{Name: "fetch_offset", Ty: TypeInt64},
		&Mfield{Name: "log_start_offset", Ty: TypeInt64},
		&Mfield{Name: "partition_max_bytes", Ty: TypeInt32},
	)

	topicV5 := NewSchema("fetch_topic_v5",
		&Mfield{Name: "topic", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV5},
	)

	fetchV5 := NewSchema("fetch_request_v5",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "replica_id", Ty: TypeInt32},
		&Mfield{Name: "max_wait_ms", Ty: TypeInt32},
		&Mfield{Name: "min_bytes", Ty: TypeInt32},
		&Mfield{Name: "max_bytes", Ty: TypeInt32},
		&Mfield{Name: "isolation_level", Ty: TypeInt8},
		&Array{Name: "topics", Ty: topicV5},
	)

	// Fetch v7 adds session_id, session_epoch, forgotten_topics_data
	forgottenTopicV7 := NewSchema("forgotten_topic_v7",
		&Mfield{Name: "topic", Ty: TypeStr},
		&Array{Name: "partitions", Ty: TypeInt32},
	)

	fetchV7 := NewSchema("fetch_request_v7",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "replica_id", Ty: TypeInt32},
		&Mfield{Name: "max_wait_ms", Ty: TypeInt32},
		&Mfield{Name: "min_bytes", Ty: TypeInt32},
		&Mfield{Name: "max_bytes", Ty: TypeInt32},
		&Mfield{Name: "isolation_level", Ty: TypeInt8},
		&Mfield{Name: "session_id", Ty: TypeInt32},
		&Mfield{Name: "session_epoch", Ty: TypeInt32},
		&Array{Name: "topics", Ty: topicV5},
		&Array{Name: "forgotten_topics_data", Ty: forgottenTopicV7},
	)

	// Partition schema for v9+ adds current_leader_epoch
	partitionV9 := NewSchema("fetch_partition_v9",
		&Mfield{Name: "partition", Ty: TypeInt32},
		&Mfield{Name: "current_leader_epoch", Ty: TypeInt32},
		&Mfield{Name: "fetch_offset", Ty: TypeInt64},
		&Mfield{Name: "log_start_offset", Ty: TypeInt64},
		&Mfield{Name: "partition_max_bytes", Ty: TypeInt32},
	)

	topicV9 := NewSchema("fetch_topic_v9",
		&Mfield{Name: "topic", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV9},
	)

	fetchV9 := NewSchema("fetch_request_v9",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "replica_id", Ty: TypeInt32},
		&Mfield{Name: "max_wait_ms", Ty: TypeInt32},
		&Mfield{Name: "min_bytes", Ty: TypeInt32},
		&Mfield{Name: "max_bytes", Ty: TypeInt32},
		&Mfield{Name: "isolation_level", Ty: TypeInt8},
		&Mfield{Name: "session_id", Ty: TypeInt32},
		&Mfield{Name: "session_epoch", Ty: TypeInt32},
		&Array{Name: "topics", Ty: topicV9},
		&Array{Name: "forgotten_topics_data", Ty: forgottenTopicV7},
	)

	// Fetch v11 adds rack_id
	fetchV11 := NewSchema("fetch_request_v11",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&Mfield{Name: "replica_id", Ty: TypeInt32},
		&Mfield{Name: "max_wait_ms", Ty: TypeInt32},
		&Mfield{Name: "min_bytes", Ty: TypeInt32},
		&Mfield{Name: "max_bytes", Ty: TypeInt32},
		&Mfield{Name: "isolation_level", Ty: TypeInt8},
		&Mfield{Name: "session_id", Ty: TypeInt32},
		&Mfield{Name: "session_epoch", Ty: TypeInt32},
		&Array{Name: "topics", Ty: topicV9},
		&Array{Name: "forgotten_topics_data", Ty: forgottenTopicV7},
		&Mfield{Name: "rack_id", Ty: TypeStr},
	)

	// Fetch v12+ uses compact arrays (flexible version)
	partitionV12 := NewSchema("fetch_partition_v12",
		&Mfield{Name: "partition", Ty: TypeInt32},
		&Mfield{Name: "current_leader_epoch", Ty: TypeInt32},
		&Mfield{Name: "fetch_offset", Ty: TypeInt64},
		&Mfield{Name: "last_fetched_epoch", Ty: TypeInt32},
		&Mfield{Name: "log_start_offset", Ty: TypeInt64},
		&Mfield{Name: "partition_max_bytes", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "partition_tagged_fields"},
	)

	topicV12 := NewSchema("fetch_topic_v12",
		&Mfield{Name: "topic", Ty: TypeCompactStr},
		&CompactArray{Name: "partitions", Ty: partitionV12},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	forgottenTopicV12 := NewSchema("forgotten_topic_v12",
		&Mfield{Name: "topic", Ty: TypeCompactStr},
		&CompactArray{Name: "partitions", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "forgotten_topic_tagged_fields"},
	)

	fetchV12 := NewSchema("fetch_request_v12",
		&Mfield{Name: "correlation_id", Ty: TypeInt32},
		&Mfield{Name: "client_id", Ty: TypeNullableStr},
		&SchemaTaggedFields{Name: "header_tagged_fields"},
		&Mfield{Name: "replica_id", Ty: TypeInt32},
		&Mfield{Name: "max_wait_ms", Ty: TypeInt32},
		&Mfield{Name: "min_bytes", Ty: TypeInt32},
		&Mfield{Name: "max_bytes", Ty: TypeInt32},
		&Mfield{Name: "isolation_level", Ty: TypeInt8},
		&Mfield{Name: "session_id", Ty: TypeInt32},
		&Mfield{Name: "session_epoch", Ty: TypeInt32},
		&CompactArray{Name: "topics", Ty: topicV12},
		&CompactArray{Name: "forgotten_topics_data", Ty: forgottenTopicV12},
		&Mfield{Name: "rack_id", Ty: TypeCompactStr},
		&SchemaTaggedFields{Name: "request_tagged_fields"},
	)

	return []Schema{
		fetchV0,  // v0
		fetchV0,  // v1
		fetchV0,  // v2
		fetchV3,  // v3
		fetchV4,  // v4
		fetchV5,  // v5
		fetchV5,  // v6
		fetchV7,  // v7
		fetchV7,  // v8
		fetchV9,  // v9
		fetchV9,  // v10
		fetchV11, // v11
		fetchV12, // v12
		fetchV12, // v13 (uses topic_id but we still need topic field)
		fetchV12, // v14
		fetchV12, // v15
		fetchV12, // v16
	}
}

func getFetchRequestSchema(apiVersion int16) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(fetchRequestSchemas) {
		return nil, fmt.Errorf("unsupported fetch request version %d", apiVersion)
	}
	return fetchRequestSchemas[apiVersion], nil
}
