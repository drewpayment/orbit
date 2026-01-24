package protocol

import (
	"errors"
	"fmt"

	"github.com/drewpayment/orbit/services/bifrost/internal/kafkaconfig"
)

const (
	apiKeyMetadata        = 3
	apiKeyFindCoordinator = 10

	brokersKeyName = "brokers"
	hostKeyName    = "host"
	portKeyName    = "port"
	nodeKeyName    = "node_id"

	coordinatorKeyName  = "coordinator"
	coordinatorsKeyName = "coordinators"
)

var (
	metadataResponseSchemaVersions        = createMetadataResponseSchemaVersions()
	findCoordinatorResponseSchemaVersions = createFindCoordinatorResponseSchemaVersions()
)

func createMetadataResponseSchemaVersions() []Schema {
	metadataBrokerV0 := NewSchema("metadata_broker_v0",
		&Mfield{Name: nodeKeyName, Ty: TypeInt32},
		&Mfield{Name: hostKeyName, Ty: TypeStr},
		&Mfield{Name: portKeyName, Ty: TypeInt32},
	)

	partitionMetadataV0 := NewSchema("partition_metadata_v0",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "partition", Ty: TypeInt32},
		&Mfield{Name: "leader", Ty: TypeInt32},
		&Array{Name: "replicas", Ty: TypeInt32},
		&Array{Name: "isr", Ty: TypeInt32},
	)

	topicMetadataV0 := NewSchema("topic_metadata_v0",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "topic", Ty: TypeStr},
		&Array{Name: "partition_metadata", Ty: partitionMetadataV0},
	)

	metadataResponseV0 := NewSchema("metadata_response_v0",
		&Array{Name: brokersKeyName, Ty: metadataBrokerV0},
		&Array{Name: "topic_metadata", Ty: topicMetadataV0},
	)

	metadataBrokerV1 := NewSchema("metadata_broker_v1",
		&Mfield{Name: nodeKeyName, Ty: TypeInt32},
		&Mfield{Name: hostKeyName, Ty: TypeStr},
		&Mfield{Name: portKeyName, Ty: TypeInt32},
		&Mfield{Name: "rack", Ty: TypeNullableStr},
	)

	metadataBrokerSchema9 := NewSchema("metadata_broker_schema9",
		&Mfield{Name: nodeKeyName, Ty: TypeInt32},
		&Mfield{Name: hostKeyName, Ty: TypeCompactStr},
		&Mfield{Name: portKeyName, Ty: TypeInt32},
		&Mfield{Name: "rack", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{"broker_tagged_fields"},
	)

	partitionMetadataV1 := partitionMetadataV0

	partitionMetadataV2 := NewSchema("partition_metadata_v2",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "partition", Ty: TypeInt32},
		&Mfield{Name: "leader", Ty: TypeInt32},
		&Array{Name: "replicas", Ty: TypeInt32},
		&Array{Name: "isr", Ty: TypeInt32},
		&Array{Name: "offline_replicas", Ty: TypeInt32},
	)

	partitionMetadataV7 := NewSchema("partition_metadata_v7",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "partition", Ty: TypeInt32},
		&Mfield{Name: "leader", Ty: TypeInt32},
		&Mfield{Name: "leader_epoch", Ty: TypeInt32},
		&Array{Name: "replicas", Ty: TypeInt32},
		&Array{Name: "isr", Ty: TypeInt32},
		&Array{Name: "offline_replicas", Ty: TypeInt32},
	)

	partitionMetadataSchema9 := NewSchema("partition_metadata_schema9",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "partition", Ty: TypeInt32},
		&Mfield{Name: "leader", Ty: TypeInt32},
		&Mfield{Name: "leader_epoch", Ty: TypeInt32},
		&CompactArray{Name: "replicas", Ty: TypeInt32},
		&CompactArray{Name: "isr", Ty: TypeInt32},
		&CompactArray{Name: "offline_replicas", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "partition_metadata_tagged_fields"},
	)

	topicMetadataV1 := NewSchema("topic_metadata_v1",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "topic", Ty: TypeStr},
		&Mfield{Name: "is_internal", Ty: TypeBool},
		&Array{Name: "partition_metadata", Ty: partitionMetadataV1},
	)

	topicMetadataV2 := NewSchema("topic_metadata_v2",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "topic", Ty: TypeStr},
		&Mfield{Name: "is_internal", Ty: TypeBool},
		&Array{Name: "partition_metadata", Ty: partitionMetadataV2},
	)

	topicMetadataV7 := NewSchema("topic_metadata_v7",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "topic", Ty: TypeStr},
		&Mfield{Name: "is_internal", Ty: TypeBool},
		&Array{Name: "partition_metadata", Ty: partitionMetadataV7},
	)

	topicMetadataV8 := NewSchema("topic_metadata_v8",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "name", Ty: TypeStr},
		&Mfield{Name: "is_internal", Ty: TypeBool},
		&Array{Name: "partition_metadata", Ty: partitionMetadataV7},
		&Mfield{Name: "topic_authorized_operations", Ty: TypeInt32},
	)

	topicMetadataSchema9 := NewSchema("topic_metadata_schema9",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&Mfield{Name: "is_internal", Ty: TypeBool},
		&CompactArray{Name: "partition_metadata", Ty: partitionMetadataSchema9},
		&Mfield{Name: "topic_authorized_operations", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "topic_metadata_tagged_fields"},
	)

	topicMetadataSchema10 := NewSchema("topic_metadata_schema10",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&Mfield{Name: "topic_id", Ty: TypeUuid},
		&Mfield{Name: "is_internal", Ty: TypeBool},
		&CompactArray{Name: "partition_metadata", Ty: partitionMetadataSchema9},
		&Mfield{Name: "topic_authorized_operations", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "topic_metadata_tagged_fields"},
	)

	topicMetadataSchema12 := NewSchema("topic_metadata_schema12",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "name", Ty: TypeCompactNullableStr},
		&Mfield{Name: "topic_id", Ty: TypeUuid},
		&Mfield{Name: "is_internal", Ty: TypeBool},
		&CompactArray{Name: "partition_metadata", Ty: partitionMetadataSchema9},
		&Mfield{Name: "topic_authorized_operations", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "topic_metadata_tagged_fields"},
	)

	metadataResponseV1 := NewSchema("metadata_response_v1",
		&Array{Name: brokersKeyName, Ty: metadataBrokerV1},
		&Mfield{Name: "controller_id", Ty: TypeInt32},
		&Array{Name: "topic_metadata", Ty: topicMetadataV1},
	)

	metadataResponseV2 := NewSchema("metadata_response_v2",
		&Array{Name: brokersKeyName, Ty: metadataBrokerV1},
		&Mfield{Name: "cluster_id", Ty: TypeNullableStr},
		&Mfield{Name: "controller_id", Ty: TypeInt32},
		&Array{Name: "topic_metadata", Ty: topicMetadataV1},
	)

	metadataResponseV3 := NewSchema("metadata_response_v3",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: brokersKeyName, Ty: metadataBrokerV1},
		&Mfield{Name: "cluster_id", Ty: TypeNullableStr},
		&Mfield{Name: "controller_id", Ty: TypeInt32},
		&Array{Name: "topic_metadata", Ty: topicMetadataV1},
	)

	metadataResponseV4 := metadataResponseV3

	metadataResponseV5 := NewSchema("metadata_response_v5",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: brokersKeyName, Ty: metadataBrokerV1},
		&Mfield{Name: "cluster_id", Ty: TypeNullableStr},
		&Mfield{Name: "controller_id", Ty: TypeInt32},
		&Array{Name: "topic_metadata", Ty: topicMetadataV2},
	)

	metadataResponseV6 := metadataResponseV5

	metadataResponseV7 := NewSchema("metadata_response_v7",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: brokersKeyName, Ty: metadataBrokerV1},
		&Mfield{Name: "cluster_id", Ty: TypeNullableStr},
		&Mfield{Name: "controller_id", Ty: TypeInt32},
		&Array{Name: "topic_metadata", Ty: topicMetadataV7},
	)

	metadataResponseV8 := NewSchema("metadata_response_v8",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: brokersKeyName, Ty: metadataBrokerV1},
		&Mfield{Name: "cluster_id", Ty: TypeNullableStr},
		&Mfield{Name: "controller_id", Ty: TypeInt32},
		&Array{Name: "topic_metadata", Ty: topicMetadataV8},
		&Mfield{Name: "cluster_authorized_operations", Ty: TypeInt32},
	)

	metadataResponseV9 := NewSchema("metadata_response_v9",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: brokersKeyName, Ty: metadataBrokerSchema9},
		&Mfield{Name: "cluster_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "controller_id", Ty: TypeInt32},
		&CompactArray{Name: "topic_metadata", Ty: topicMetadataSchema9},
		&Mfield{Name: "cluster_authorized_operations", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	metadataResponseV10 := NewSchema("metadata_response_v10",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: brokersKeyName, Ty: metadataBrokerSchema9},
		&Mfield{Name: "cluster_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "controller_id", Ty: TypeInt32},
		&CompactArray{Name: "topic_metadata", Ty: topicMetadataSchema10},
		&Mfield{Name: "cluster_authorized_operations", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	metadataResponseV11 := NewSchema("metadata_response_v11",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: brokersKeyName, Ty: metadataBrokerSchema9},
		&Mfield{Name: "cluster_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "controller_id", Ty: TypeInt32},
		&CompactArray{Name: "topic_metadata", Ty: topicMetadataSchema10},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	metadataResponseV12 := NewSchema("metadata_response_v12",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: brokersKeyName, Ty: metadataBrokerSchema9},
		&Mfield{Name: "cluster_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "controller_id", Ty: TypeInt32},
		&CompactArray{Name: "topic_metadata", Ty: topicMetadataSchema12},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	metadataResponseV13 := NewSchema("metadata_response_v13",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: brokersKeyName, Ty: metadataBrokerSchema9},
		&Mfield{Name: "cluster_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "controller_id", Ty: TypeInt32},
		&CompactArray{Name: "topic_metadata", Ty: topicMetadataSchema12},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	return []Schema{
		metadataResponseV0,
		metadataResponseV1,
		metadataResponseV2,
		metadataResponseV3,
		metadataResponseV4,
		metadataResponseV5,
		metadataResponseV6,
		metadataResponseV7,
		metadataResponseV8,
		metadataResponseV9,
		metadataResponseV10,
		metadataResponseV11,
		metadataResponseV12,
		metadataResponseV13,
	}
}

func createFindCoordinatorResponseSchemaVersions() []Schema {
	findCoordinatorBrokerV0 := NewSchema("find_coordinator_broker_v0",
		&Mfield{Name: nodeKeyName, Ty: TypeInt32},
		&Mfield{Name: hostKeyName, Ty: TypeStr},
		&Mfield{Name: portKeyName, Ty: TypeInt32},
	)

	findCoordinatorBrokerSchema9 := NewSchema("find_coordinator_broker_schema9",
		&Mfield{Name: nodeKeyName, Ty: TypeInt32},
		&Mfield{Name: hostKeyName, Ty: TypeCompactStr},
		&Mfield{Name: portKeyName, Ty: TypeInt32},
	)

	findCoordinatorResponseV0 := NewSchema("find_coordinator_response_v0",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: coordinatorKeyName, Ty: findCoordinatorBrokerV0},
	)

	findCoordinatorResponseV1 := NewSchema("find_coordinator_response_v1",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "error_message", Ty: TypeNullableStr},
		&Mfield{Name: coordinatorKeyName, Ty: findCoordinatorBrokerV0},
	)

	findCoordinatorResponseV2 := findCoordinatorResponseV1

	findCoordinatorResponseV3 := NewSchema("find_coordinator_response_v3",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "error_message", Ty: TypeCompactNullableStr},
		&Mfield{Name: coordinatorKeyName, Ty: findCoordinatorBrokerSchema9},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	findCoordinatorCoordinatorsSchema4 := NewSchema("find_coordinator_coordinators_schema4",
		&Mfield{Name: "key", Ty: TypeCompactStr},
		&Mfield{Name: coordinatorKeyName, Ty: findCoordinatorBrokerSchema9},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "error_message", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{"coordinators_tagged_fields"},
	)
	findCoordinatorResponseV4 := NewSchema("find_coordinator_response_v4",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: coordinatorsKeyName, Ty: findCoordinatorCoordinatorsSchema4},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)
	findCoordinatorResponseV5 := findCoordinatorResponseV4
	findCoordinatorResponseV6 := findCoordinatorResponseV5

	return []Schema{findCoordinatorResponseV0, findCoordinatorResponseV1, findCoordinatorResponseV2, findCoordinatorResponseV3, findCoordinatorResponseV4, findCoordinatorResponseV5, findCoordinatorResponseV6}
}

func modifyMetadataResponse(decodedStruct *Struct, fn config.NetAddressMappingFunc) error {
	if decodedStruct == nil {
		return errors.New("decoded struct must not be nil")
	}
	if fn == nil {
		return errors.New("net address mapper must not be nil")
	}
	brokersArray, ok := decodedStruct.Get(brokersKeyName).([]interface{})
	if !ok {
		return errors.New("brokers list not found")
	}
	for _, brokerElement := range brokersArray {
		broker := brokerElement.(*Struct)
		host, ok := broker.Get(hostKeyName).(string)
		if !ok {
			return errors.New("broker.host not found")
		}
		port, ok := broker.Get(portKeyName).(int32)
		if !ok {
			return errors.New("broker.port not found")
		}
		nodeId, ok := broker.Get(nodeKeyName).(int32)
		if !ok {
			return errors.New("broker.node_id not found")
		}

		if host == "" && port <= 0 {
			continue
		}

		newHost, newPort, err := fn(host, port, nodeId)
		if err != nil {
			return err
		}
		if host != newHost {
			err := broker.Replace(hostKeyName, newHost)
			if err != nil {
				return err
			}
		}
		if port != newPort {
			err = broker.Replace(portKeyName, newPort)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func modifyFindCoordinatorResponse(decodedStruct *Struct, fn config.NetAddressMappingFunc) error {
	if decodedStruct == nil {
		return errors.New("decoded struct must not be nil")
	}
	if fn == nil {
		return errors.New("net address mapper must not be nil")
	}
	coordinators := decodedStruct.Get(coordinatorsKeyName)
	if coordinators != nil {
		coordinatorsArray, ok := coordinators.([]interface{})
		if !ok {
			return errors.New("coordinators list not found")
		}
		for _, coordinatorElement := range coordinatorsArray {
			coordinatorStruct := coordinatorElement.(*Struct)
			if err := modifyCoordinator(coordinatorStruct, fn); err != nil {
				return err
			}
		}
		return nil
	} else {
		return modifyCoordinator(decodedStruct, fn)
	}
}

func modifyCoordinator(decodedStruct *Struct, fn config.NetAddressMappingFunc) error {
	coordinator, ok := decodedStruct.Get(coordinatorKeyName).(*Struct)
	if !ok {
		return errors.New("coordinator not found")
	}
	host, ok := coordinator.Get(hostKeyName).(string)
	if !ok {
		return errors.New("coordinator.host not found")
	}
	port, ok := coordinator.Get(portKeyName).(int32)
	if !ok {
		return errors.New("coordinator.port not found")
	}
	nodeId, ok := coordinator.Get(nodeKeyName).(int32)
	if !ok {
		return errors.New("coordinator.node_id not found")
	}

	if host == "" && port <= 0 {
		return nil
	}

	newHost, newPort, err := fn(host, port, nodeId)
	if err != nil {
		return err
	}
	if host != newHost {
		err := coordinator.Replace(hostKeyName, newHost)
		if err != nil {
			return err
		}
	}
	if port != newPort {
		err = coordinator.Replace(portKeyName, int32(newPort))
		if err != nil {
			return err
		}
	}
	return nil
}

// modifyMetadataResponseWithConfig handles both broker address mapping and topic rewriting.
func modifyMetadataResponseWithConfig(decodedStruct *Struct, cfg ResponseModifierConfig) error {
	if decodedStruct == nil {
		return errors.New("decoded struct must not be nil")
	}

	// Handle broker address mapping
	if cfg.NetAddressMappingFunc != nil {
		brokersArray, ok := decodedStruct.Get(brokersKeyName).([]interface{})
		if !ok {
			return errors.New("brokers list not found")
		}
		for _, brokerElement := range brokersArray {
			broker := brokerElement.(*Struct)
			host, ok := broker.Get(hostKeyName).(string)
			if !ok {
				return errors.New("broker.host not found")
			}
			port, ok := broker.Get(portKeyName).(int32)
			if !ok {
				return errors.New("broker.port not found")
			}
			nodeId, ok := broker.Get(nodeKeyName).(int32)
			if !ok {
				return errors.New("broker.node_id not found")
			}

			if host == "" && port <= 0 {
				continue
			}

			newHost, newPort, err := cfg.NetAddressMappingFunc(host, port, nodeId)
			if err != nil {
				return err
			}
			if host != newHost {
				if err := broker.Replace(hostKeyName, newHost); err != nil {
					return err
				}
			}
			if port != newPort {
				if err := broker.Replace(portKeyName, newPort); err != nil {
					return err
				}
			}
		}
	}

	// Handle topic rewriting (unprefixing and filtering)
	if cfg.TopicUnprefixer != nil || cfg.TopicFilter != nil {
		if err := modifyTopicsInMetadataResponse(decodedStruct, cfg); err != nil {
			return err
		}
	}

	return nil
}

// modifyTopicsInMetadataResponse handles topic name unprefixing and filtering in metadata responses.
func modifyTopicsInMetadataResponse(decodedStruct *Struct, cfg ResponseModifierConfig) error {
	topicMetadata := decodedStruct.Get("topic_metadata")
	if topicMetadata == nil {
		return nil // No topics to modify
	}

	topicsArray, ok := topicMetadata.([]interface{})
	if !ok {
		return nil // Null or invalid topics array
	}

	// Build filtered list if TopicFilter is provided
	var filteredTopics []interface{}
	if cfg.TopicFilter != nil {
		filteredTopics = make([]interface{}, 0, len(topicsArray))
	}

	for _, topicElement := range topicsArray {
		topic := topicElement.(*Struct)

		// Get topic name - different field names for different versions
		// v0-v7: "topic", v8+: "name"
		topicName := getTopicNameFromStruct(topic)
		if topicName == "" {
			if cfg.TopicFilter == nil {
				continue // No filter, keep all topics
			}
			filteredTopics = append(filteredTopics, topicElement)
			continue
		}

		// Apply filter if provided
		if cfg.TopicFilter != nil && !cfg.TopicFilter(topicName) {
			continue // Topic doesn't belong to this tenant
		}

		// Apply unprefixer if provided
		if cfg.TopicUnprefixer != nil {
			newName := cfg.TopicUnprefixer(topicName)
			if newName != topicName {
				if err := setTopicNameInStruct(topic, newName); err != nil {
					return err
				}
			}
		}

		if cfg.TopicFilter != nil {
			filteredTopics = append(filteredTopics, topicElement)
		}
	}

	// Replace topics array if filtering was applied
	if cfg.TopicFilter != nil {
		if err := decodedStruct.Replace("topic_metadata", filteredTopics); err != nil {
			return err
		}
	}

	return nil
}

// getTopicNameFromStruct extracts the topic name from a topic metadata struct.
// It handles both "topic" (v0-v7) and "name" (v8+) field names.
func getTopicNameFromStruct(topic *Struct) string {
	// Try "name" first (v8+)
	if nameField := topic.Get("name"); nameField != nil {
		switch n := nameField.(type) {
		case string:
			return n
		case *string:
			if n != nil {
				return *n
			}
		}
	}

	// Try "topic" (v0-v7)
	if topicField := topic.Get("topic"); topicField != nil {
		if t, ok := topicField.(string); ok {
			return t
		}
	}

	return ""
}

// setTopicNameInStruct sets the topic name in a topic metadata struct.
// It handles both "topic" (v0-v7) and "name" (v8+) field names.
func setTopicNameInStruct(topic *Struct, newName string) error {
	// Try "name" first (v8+)
	if nameField := topic.Get("name"); nameField != nil {
		switch nameField.(type) {
		case string:
			return topic.Replace("name", newName)
		case *string:
			return topic.Replace("name", &newName)
		}
	}

	// Try "topic" (v0-v7)
	if topicField := topic.Get("topic"); topicField != nil {
		return topic.Replace("topic", newName)
	}

	return nil
}

// modifyFindCoordinatorResponseWithConfig handles broker address mapping in FindCoordinator responses.
func modifyFindCoordinatorResponseWithConfig(decodedStruct *Struct, cfg ResponseModifierConfig) error {
	if decodedStruct == nil {
		return errors.New("decoded struct must not be nil")
	}
	if cfg.NetAddressMappingFunc == nil {
		return nil // No address mapping needed
	}

	coordinators := decodedStruct.Get(coordinatorsKeyName)
	if coordinators != nil {
		coordinatorsArray, ok := coordinators.([]interface{})
		if !ok {
			return errors.New("coordinators list not found")
		}
		for _, coordinatorElement := range coordinatorsArray {
			coordinatorStruct := coordinatorElement.(*Struct)
			if err := modifyCoordinator(coordinatorStruct, cfg.NetAddressMappingFunc); err != nil {
				return err
			}
		}
		return nil
	}
	return modifyCoordinator(decodedStruct, cfg.NetAddressMappingFunc)
}

type ResponseModifier interface {
	Apply(resp []byte) ([]byte, error)
}

// TopicUnprefixer removes the tenant prefix from topic names in responses.
type TopicUnprefixer func(topic string) string

// TopicFilter determines whether a topic should be included in responses.
// Returns true if the topic belongs to the tenant and should be included.
type TopicFilter func(topic string) bool

// GroupUnprefixer removes the tenant prefix from consumer group IDs in responses.
type GroupUnprefixer func(groupId string) string

// GroupFilter determines whether a consumer group should be included in responses.
// Returns true if the group belongs to the tenant and should be included.
type GroupFilter func(groupId string) bool

// ResponseModifierConfig holds functions for response modification.
type ResponseModifierConfig struct {
	NetAddressMappingFunc config.NetAddressMappingFunc
	TopicUnprefixer       TopicUnprefixer
	TopicFilter           TopicFilter
	GroupUnprefixer       GroupUnprefixer
	GroupFilter           GroupFilter
}

type modifyResponseFunc func(decodedStruct *Struct, cfg ResponseModifierConfig) error

type responseModifier struct {
	schema             Schema
	modifyResponseFunc modifyResponseFunc
	cfg                ResponseModifierConfig
}

func (f *responseModifier) Apply(resp []byte) ([]byte, error) {
	decodedStruct, err := DecodeSchema(resp, f.schema)
	if err != nil {
		return nil, err
	}
	err = f.modifyResponseFunc(decodedStruct, f.cfg)
	if err != nil {
		return nil, err
	}
	return EncodeSchema(decodedStruct, f.schema)
}

// GetResponseModifier returns a ResponseModifier for the given API key and version.
// This is the legacy function that only supports address mapping.
// Use GetResponseModifierWithConfig for full topic rewriting support.
func GetResponseModifier(apiKey int16, apiVersion int16, addressMappingFunc config.NetAddressMappingFunc) (ResponseModifier, error) {
	cfg := ResponseModifierConfig{
		NetAddressMappingFunc: addressMappingFunc,
	}
	return GetResponseModifierWithConfig(apiKey, apiVersion, cfg)
}

// GetResponseModifierWithConfig returns a ResponseModifier with full configuration support.
func GetResponseModifierWithConfig(apiKey int16, apiVersion int16, cfg ResponseModifierConfig) (ResponseModifier, error) {
	switch apiKey {
	case apiKeyMetadata:
		return newResponseModifier(apiKey, apiVersion, cfg, metadataResponseSchemaVersions, modifyMetadataResponseWithConfig)
	case apiKeyFindCoordinator:
		return newResponseModifier(apiKey, apiVersion, cfg, findCoordinatorResponseSchemaVersions, modifyFindCoordinatorResponseWithConfig)
	case apiKeyProduce:
		if cfg.TopicUnprefixer == nil {
			return nil, nil
		}
		return newResponseModifier(apiKey, apiVersion, cfg, produceResponseSchemaVersions, modifyProduceResponse)
	case apiKeyListOffsets:
		if cfg.TopicUnprefixer == nil {
			return nil, nil
		}
		return newResponseModifier(apiKey, apiVersion, cfg, listOffsetsResponseSchemaVersions, modifyListOffsetsResponse)
	case apiKeyFetch:
		if cfg.TopicUnprefixer == nil {
			return nil, nil
		}
		return newResponseModifier(apiKey, apiVersion, cfg, fetchResponseSchemaVersions, modifyFetchResponse)
	case apiKeyOffsetCommit:
		if cfg.TopicUnprefixer == nil {
			return nil, nil
		}
		return newResponseModifier(apiKey, apiVersion, cfg, offsetCommitResponseSchemaVersions, modifyOffsetCommitResponse)
	case apiKeyOffsetFetch:
		if cfg.TopicUnprefixer == nil {
			return nil, nil
		}
		return newOffsetFetchResponseModifier(apiVersion, cfg)
	case apiKeyDescribeGroups:
		return newDescribeGroupsResponseModifier(apiVersion, cfg)
	default:
		return nil, nil
	}
}

func newResponseModifier(apiKey int16, apiVersion int16, cfg ResponseModifierConfig, schemas []Schema, modifyResponseFunc modifyResponseFunc) (ResponseModifier, error) {
	schema, err := getResponseSchema(apiKey, apiVersion, schemas)
	if err != nil {
		return nil, err
	}
	return &responseModifier{
		schema:             schema,
		modifyResponseFunc: modifyResponseFunc,
		cfg:                cfg,
	}, nil
}

func getResponseSchema(apiKey, apiVersion int16, schemas []Schema) (Schema, error) {
	if apiVersion < 0 || int(apiVersion) >= len(schemas) {
		return nil, fmt.Errorf("Unsupported response schema version %d for key %d ", apiVersion, apiKey)
	}
	return schemas[apiVersion], nil
}

// Produce response schemas
var produceResponseSchemaVersions = createProduceResponseSchemaVersions()

func createProduceResponseSchemaVersions() []Schema {
	// Partition response for v0-v1
	partitionV0 := NewSchema("produce_partition_v0",
		&Mfield{Name: "index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "base_offset", Ty: TypeInt64},
	)

	// Topic response for v0-v1
	topicV0 := NewSchema("produce_topic_v0",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partition_responses", Ty: partitionV0},
	)

	// Produce v0
	produceV0 := NewSchema("produce_response_v0",
		&Array{Name: "responses", Ty: topicV0},
	)

	// Produce v1 adds throttle_time
	produceV1 := NewSchema("produce_response_v1",
		&Array{Name: "responses", Ty: topicV0},
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
	)

	// Partition response for v2+ adds log_append_time
	partitionV2 := NewSchema("produce_partition_v2",
		&Mfield{Name: "index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "base_offset", Ty: TypeInt64},
		&Mfield{Name: "log_append_time_ms", Ty: TypeInt64},
	)

	topicV2 := NewSchema("produce_topic_v2",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partition_responses", Ty: partitionV2},
	)

	produceV2 := NewSchema("produce_response_v2",
		&Array{Name: "responses", Ty: topicV2},
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
	)

	// Partition response for v5+ adds log_start_offset
	partitionV5 := NewSchema("produce_partition_v5",
		&Mfield{Name: "index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "base_offset", Ty: TypeInt64},
		&Mfield{Name: "log_append_time_ms", Ty: TypeInt64},
		&Mfield{Name: "log_start_offset", Ty: TypeInt64},
	)

	topicV5 := NewSchema("produce_topic_v5",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partition_responses", Ty: partitionV5},
	)

	produceV5 := NewSchema("produce_response_v5",
		&Array{Name: "responses", Ty: topicV5},
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
	)

	// Partition response for v8+ adds record_errors, error_message
	recordErrorV8 := NewSchema("record_error_v8",
		&Mfield{Name: "batch_index", Ty: TypeInt32},
		&Mfield{Name: "batch_index_error_message", Ty: TypeNullableStr},
	)

	partitionV8 := NewSchema("produce_partition_v8",
		&Mfield{Name: "index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "base_offset", Ty: TypeInt64},
		&Mfield{Name: "log_append_time_ms", Ty: TypeInt64},
		&Mfield{Name: "log_start_offset", Ty: TypeInt64},
		&Array{Name: "record_errors", Ty: recordErrorV8},
		&Mfield{Name: "error_message", Ty: TypeNullableStr},
	)

	topicV8 := NewSchema("produce_topic_v8",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partition_responses", Ty: partitionV8},
	)

	produceV8 := NewSchema("produce_response_v8",
		&Array{Name: "responses", Ty: topicV8},
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
	)

	// v9+ uses compact arrays (flexible version)
	recordErrorV9 := NewSchema("record_error_v9",
		&Mfield{Name: "batch_index", Ty: TypeInt32},
		&Mfield{Name: "batch_index_error_message", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{Name: "record_error_tagged_fields"},
	)

	partitionV9 := NewSchema("produce_partition_v9",
		&Mfield{Name: "index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "base_offset", Ty: TypeInt64},
		&Mfield{Name: "log_append_time_ms", Ty: TypeInt64},
		&Mfield{Name: "log_start_offset", Ty: TypeInt64},
		&CompactArray{Name: "record_errors", Ty: recordErrorV9},
		&Mfield{Name: "error_message", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{Name: "partition_tagged_fields"},
	)

	topicV9 := NewSchema("produce_topic_v9",
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&CompactArray{Name: "partition_responses", Ty: partitionV9},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	produceV9 := NewSchema("produce_response_v9",
		&CompactArray{Name: "responses", Ty: topicV9},
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	return []Schema{
		produceV0,  // v0
		produceV1,  // v1
		produceV2,  // v2
		produceV2,  // v3
		produceV2,  // v4
		produceV5,  // v5
		produceV5,  // v6
		produceV5,  // v7
		produceV8,  // v8
		produceV9,  // v9
		produceV9,  // v10
		produceV9,  // v11
	}
}

// modifyProduceResponse unprefixes topic names in Produce responses.
func modifyProduceResponse(decodedStruct *Struct, cfg ResponseModifierConfig) error {
	if cfg.TopicUnprefixer == nil {
		return nil
	}

	responses := decodedStruct.Get("responses")
	if responses == nil {
		return nil
	}

	responsesArray, ok := responses.([]interface{})
	if !ok {
		return nil
	}

	for _, topicElement := range responsesArray {
		topic, ok := topicElement.(*Struct)
		if !ok {
			continue
		}
		topicName := getTopicNameFromStruct(topic)
		if topicName != "" {
			unprefixedName := cfg.TopicUnprefixer(topicName)
			if unprefixedName != topicName {
				if err := setTopicNameInStruct(topic, unprefixedName); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

// ListOffsets response schemas
var listOffsetsResponseSchemaVersions = createListOffsetsResponseSchemaVersions()

func createListOffsetsResponseSchemaVersions() []Schema {
	// Partition response for v0 (multiple offsets)
	partitionV0 := NewSchema("list_offsets_partition_v0",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Array{Name: "old_style_offsets", Ty: TypeInt64},
	)

	// Topic response
	topicV0 := NewSchema("list_offsets_topic_v0",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV0},
	)

	// ListOffsets v0
	listOffsetsV0 := NewSchema("list_offsets_response_v0",
		&Array{Name: "topics", Ty: topicV0},
	)

	// Partition response for v1+ (single offset + timestamp)
	partitionV1 := NewSchema("list_offsets_partition_v1",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "timestamp", Ty: TypeInt64},
		&Mfield{Name: "offset", Ty: TypeInt64},
	)

	topicV1 := NewSchema("list_offsets_topic_v1",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV1},
	)

	listOffsetsV1 := NewSchema("list_offsets_response_v1",
		&Array{Name: "topics", Ty: topicV1},
	)

	// v2 adds throttle_time_ms
	listOffsetsV2 := NewSchema("list_offsets_response_v2",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "topics", Ty: topicV1},
	)

	// Partition response for v4+ (adds leader_epoch)
	partitionV4 := NewSchema("list_offsets_partition_v4",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "timestamp", Ty: TypeInt64},
		&Mfield{Name: "offset", Ty: TypeInt64},
		&Mfield{Name: "leader_epoch", Ty: TypeInt32},
	)

	topicV4 := NewSchema("list_offsets_topic_v4",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV4},
	)

	listOffsetsV4 := NewSchema("list_offsets_response_v4",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "topics", Ty: topicV4},
	)

	// v6+ uses compact arrays (flexible version)
	partitionV6 := NewSchema("list_offsets_partition_v6",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "timestamp", Ty: TypeInt64},
		&Mfield{Name: "offset", Ty: TypeInt64},
		&Mfield{Name: "leader_epoch", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "partition_tagged_fields"},
	)

	topicV6 := NewSchema("list_offsets_topic_v6",
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&CompactArray{Name: "partitions", Ty: partitionV6},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	listOffsetsV6 := NewSchema("list_offsets_response_v6",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: "topics", Ty: topicV6},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
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

// modifyListOffsetsResponse unprefixes topic names in ListOffsets responses.
func modifyListOffsetsResponse(decodedStruct *Struct, cfg ResponseModifierConfig) error {
	if cfg.TopicUnprefixer == nil {
		return nil
	}

	topics := decodedStruct.Get("topics")
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
		topicName := getTopicNameFromStruct(topic)
		if topicName != "" {
			unprefixedName := cfg.TopicUnprefixer(topicName)
			if unprefixedName != topicName {
				if err := setTopicNameInStruct(topic, unprefixedName); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

// Fetch response schemas
var fetchResponseSchemaVersions = createFetchResponseSchemaVersions()

func createFetchResponseSchemaVersions() []Schema {
	// Record batch is opaque bytes - we don't need to parse it for topic rewriting
	// The topic name is in the response header, not in record batches

	// Aborted transaction for v4+
	abortedTxnV4 := NewSchema("aborted_txn_v4",
		&Mfield{Name: "producer_id", Ty: TypeInt64},
		&Mfield{Name: "first_offset", Ty: TypeInt64},
	)

	// Partition response v0
	partitionV0 := NewSchema("fetch_partition_v0",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "high_watermark", Ty: TypeInt64},
		&Mfield{Name: "records", Ty: TypeBytes},
	)

	// Topic response v0
	topicV0 := NewSchema("fetch_topic_v0",
		&Mfield{Name: "topic", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV0},
	)

	// Fetch v0
	fetchV0 := NewSchema("fetch_response_v0",
		&Array{Name: "responses", Ty: topicV0},
	)

	// Fetch v1 adds throttle_time_ms
	fetchV1 := NewSchema("fetch_response_v1",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "responses", Ty: topicV0},
	)

	// Partition response v4 adds last_stable_offset, aborted_transactions
	partitionV4 := NewSchema("fetch_partition_v4",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "high_watermark", Ty: TypeInt64},
		&Mfield{Name: "last_stable_offset", Ty: TypeInt64},
		&Array{Name: "aborted_transactions", Ty: abortedTxnV4},
		&Mfield{Name: "records", Ty: TypeBytes},
	)

	topicV4 := NewSchema("fetch_topic_v4",
		&Mfield{Name: "topic", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV4},
	)

	fetchV4 := NewSchema("fetch_response_v4",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "responses", Ty: topicV4},
	)

	// Partition response v5 adds log_start_offset
	partitionV5 := NewSchema("fetch_partition_v5",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "high_watermark", Ty: TypeInt64},
		&Mfield{Name: "last_stable_offset", Ty: TypeInt64},
		&Mfield{Name: "log_start_offset", Ty: TypeInt64},
		&Array{Name: "aborted_transactions", Ty: abortedTxnV4},
		&Mfield{Name: "records", Ty: TypeBytes},
	)

	topicV5 := NewSchema("fetch_topic_v5",
		&Mfield{Name: "topic", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV5},
	)

	fetchV5 := NewSchema("fetch_response_v5",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "responses", Ty: topicV5},
	)

	// Fetch v7 adds error_code and session_id at top level
	fetchV7 := NewSchema("fetch_response_v7",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "session_id", Ty: TypeInt32},
		&Array{Name: "responses", Ty: topicV5},
	)

	// Partition response v11 adds preferred_read_replica
	partitionV11 := NewSchema("fetch_partition_v11",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "high_watermark", Ty: TypeInt64},
		&Mfield{Name: "last_stable_offset", Ty: TypeInt64},
		&Mfield{Name: "log_start_offset", Ty: TypeInt64},
		&Array{Name: "aborted_transactions", Ty: abortedTxnV4},
		&Mfield{Name: "preferred_read_replica", Ty: TypeInt32},
		&Mfield{Name: "records", Ty: TypeBytes},
	)

	topicV11 := NewSchema("fetch_topic_v11",
		&Mfield{Name: "topic", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV11},
	)

	fetchV11 := NewSchema("fetch_response_v11",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "session_id", Ty: TypeInt32},
		&Array{Name: "responses", Ty: topicV11},
	)

	// v12+ uses compact arrays (flexible version)
	abortedTxnV12 := NewSchema("aborted_txn_v12",
		&Mfield{Name: "producer_id", Ty: TypeInt64},
		&Mfield{Name: "first_offset", Ty: TypeInt64},
		&SchemaTaggedFields{Name: "aborted_txn_tagged_fields"},
	)

	partitionV12 := NewSchema("fetch_partition_v12",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "high_watermark", Ty: TypeInt64},
		&Mfield{Name: "last_stable_offset", Ty: TypeInt64},
		&Mfield{Name: "log_start_offset", Ty: TypeInt64},
		&CompactArray{Name: "aborted_transactions", Ty: abortedTxnV12},
		&Mfield{Name: "preferred_read_replica", Ty: TypeInt32},
		&Mfield{Name: "records", Ty: TypeCompactBytes},
		&SchemaTaggedFields{Name: "partition_tagged_fields"},
	)

	topicV12 := NewSchema("fetch_topic_v12",
		&Mfield{Name: "topic", Ty: TypeCompactStr},
		&CompactArray{Name: "partitions", Ty: partitionV12},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	fetchV12 := NewSchema("fetch_response_v12",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "session_id", Ty: TypeInt32},
		&CompactArray{Name: "responses", Ty: topicV12},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	// v13+ adds topic_id
	topicV13 := NewSchema("fetch_topic_v13",
		&Mfield{Name: "topic_id", Ty: TypeUuid},
		&CompactArray{Name: "partitions", Ty: partitionV12},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	fetchV13 := NewSchema("fetch_response_v13",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "session_id", Ty: TypeInt32},
		&CompactArray{Name: "responses", Ty: topicV13},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	// v16 adds diverging_epoch and current_leader to partition
	// and Node struct for current_leader
	currentLeaderV16 := NewSchema("current_leader_v16",
		&Mfield{Name: "leader_id", Ty: TypeInt32},
		&Mfield{Name: "leader_epoch", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "leader_tagged_fields"},
	)

	// Snapshot info for v16
	snapshotV16 := NewSchema("snapshot_v16",
		&Mfield{Name: "end_offset", Ty: TypeInt64},
		&Mfield{Name: "epoch", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "snapshot_tagged_fields"},
	)

	// Epoch info for diverging epoch
	epochV16 := NewSchema("epoch_v16",
		&Mfield{Name: "epoch", Ty: TypeInt32},
		&Mfield{Name: "end_offset", Ty: TypeInt64},
		&SchemaTaggedFields{Name: "epoch_tagged_fields"},
	)

	partitionV16 := NewSchema("fetch_partition_v16",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "high_watermark", Ty: TypeInt64},
		&Mfield{Name: "last_stable_offset", Ty: TypeInt64},
		&Mfield{Name: "log_start_offset", Ty: TypeInt64},
		&Mfield{Name: "diverging_epoch", Ty: epochV16},
		&Mfield{Name: "current_leader", Ty: currentLeaderV16},
		&Mfield{Name: "snapshot_id", Ty: snapshotV16},
		&CompactArray{Name: "aborted_transactions", Ty: abortedTxnV12},
		&Mfield{Name: "preferred_read_replica", Ty: TypeInt32},
		&Mfield{Name: "records", Ty: TypeCompactBytes},
		&SchemaTaggedFields{Name: "partition_tagged_fields"},
	)

	topicV16 := NewSchema("fetch_topic_v16",
		&Mfield{Name: "topic_id", Ty: TypeUuid},
		&CompactArray{Name: "partitions", Ty: partitionV16},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	fetchV16 := NewSchema("fetch_response_v16",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "session_id", Ty: TypeInt32},
		&CompactArray{Name: "responses", Ty: topicV16},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	return []Schema{
		fetchV0,  // v0
		fetchV1,  // v1
		fetchV1,  // v2
		fetchV1,  // v3
		fetchV4,  // v4
		fetchV5,  // v5
		fetchV5,  // v6
		fetchV7,  // v7
		fetchV7,  // v8
		fetchV7,  // v9
		fetchV7,  // v10
		fetchV11, // v11
		fetchV12, // v12
		fetchV13, // v13
		fetchV13, // v14
		fetchV13, // v15
		fetchV16, // v16
	}
}

// modifyFetchResponse unprefixes topic names in Fetch responses.
func modifyFetchResponse(decodedStruct *Struct, cfg ResponseModifierConfig) error {
	if cfg.TopicUnprefixer == nil {
		return nil
	}

	responses := decodedStruct.Get("responses")
	if responses == nil {
		return nil
	}

	responsesArray, ok := responses.([]interface{})
	if !ok {
		return nil
	}

	for _, topicElement := range responsesArray {
		topic, ok := topicElement.(*Struct)
		if !ok {
			continue
		}
		// v0-v12 uses "topic" field, v13+ uses topic_id (UUID) instead
		// For v13+, the topic name is not present in the response
		topicName := topic.Get("topic")
		if topicName == nil {
			// v13+ uses topic_id instead - no topic name to rewrite
			continue
		}

		if name, ok := topicName.(string); ok && name != "" {
			unprefixedName := cfg.TopicUnprefixer(name)
			if unprefixedName != name {
				if err := topic.Replace("topic", unprefixedName); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

// OffsetCommit response schemas
var offsetCommitResponseSchemaVersions = createOffsetCommitResponseSchemaVersions()

func createOffsetCommitResponseSchemaVersions() []Schema {
	// Partition response for v0-v7
	partitionV0 := NewSchema("offset_commit_partition_response_v0",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
	)

	// Topic response for v0-v7
	topicV0 := NewSchema("offset_commit_topic_response_v0",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV0},
	)

	// v0-v2: just topics array
	offsetCommitV0 := NewSchema("offset_commit_response_v0",
		&Array{Name: "topics", Ty: topicV0},
	)

	// v3-v7: adds throttle_time_ms
	offsetCommitV3 := NewSchema("offset_commit_response_v3",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "topics", Ty: topicV0},
	)

	// v8+ uses compact arrays (flexible version)
	partitionV8 := NewSchema("offset_commit_partition_response_v8",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&SchemaTaggedFields{Name: "partition_tagged_fields"},
	)

	topicV8 := NewSchema("offset_commit_topic_response_v8",
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&CompactArray{Name: "partitions", Ty: partitionV8},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	offsetCommitV8 := NewSchema("offset_commit_response_v8",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: "topics", Ty: topicV8},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	return []Schema{
		offsetCommitV0, // v0
		offsetCommitV0, // v1
		offsetCommitV0, // v2
		offsetCommitV3, // v3
		offsetCommitV3, // v4
		offsetCommitV3, // v5
		offsetCommitV3, // v6
		offsetCommitV3, // v7
		offsetCommitV8, // v8
		offsetCommitV8, // v9
	}
}

// modifyOffsetCommitResponse unprefixes topic names in OffsetCommit responses.
func modifyOffsetCommitResponse(decodedStruct *Struct, cfg ResponseModifierConfig) error {
	if cfg.TopicUnprefixer == nil {
		return nil
	}

	topics := decodedStruct.Get("topics")
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
		if name, ok := nameField.(string); ok && name != "" {
			unprefixedName := cfg.TopicUnprefixer(name)
			if unprefixedName != name {
				if err := topic.Replace("name", unprefixedName); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

// OffsetFetch response schemas
var offsetFetchResponseSchemaVersions = createOffsetFetchResponseSchemaVersions()

func createOffsetFetchResponseSchemaVersions() []Schema {
	// Partition for v0-v1
	partitionV0 := NewSchema("offset_fetch_partition_response_v0",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "committed_offset", Ty: TypeInt64},
		&Mfield{Name: "metadata", Ty: TypeNullableStr},
		&Mfield{Name: "error_code", Ty: TypeInt16},
	)

	topicV0 := NewSchema("offset_fetch_topic_response_v0",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV0},
	)

	// v0-v1
	offsetFetchV0 := NewSchema("offset_fetch_response_v0",
		&Array{Name: "topics", Ty: topicV0},
	)

	// v2 adds error_code at top level
	offsetFetchV2 := NewSchema("offset_fetch_response_v2",
		&Array{Name: "topics", Ty: topicV0},
		&Mfield{Name: "error_code", Ty: TypeInt16},
	)

	// v3+ adds throttle_time_ms
	offsetFetchV3 := NewSchema("offset_fetch_response_v3",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "topics", Ty: topicV0},
		&Mfield{Name: "error_code", Ty: TypeInt16},
	)

	// v5 adds committed_leader_epoch to partition
	partitionV5 := NewSchema("offset_fetch_partition_response_v5",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "committed_offset", Ty: TypeInt64},
		&Mfield{Name: "committed_leader_epoch", Ty: TypeInt32},
		&Mfield{Name: "metadata", Ty: TypeNullableStr},
		&Mfield{Name: "error_code", Ty: TypeInt16},
	)

	topicV5 := NewSchema("offset_fetch_topic_response_v5",
		&Mfield{Name: "name", Ty: TypeStr},
		&Array{Name: "partitions", Ty: partitionV5},
	)

	offsetFetchV5 := NewSchema("offset_fetch_response_v5",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "topics", Ty: topicV5},
		&Mfield{Name: "error_code", Ty: TypeInt16},
	)

	// v6+ flexible
	partitionV6 := NewSchema("offset_fetch_partition_response_v6",
		&Mfield{Name: "partition_index", Ty: TypeInt32},
		&Mfield{Name: "committed_offset", Ty: TypeInt64},
		&Mfield{Name: "committed_leader_epoch", Ty: TypeInt32},
		&Mfield{Name: "metadata", Ty: TypeCompactNullableStr},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&SchemaTaggedFields{Name: "partition_tagged_fields"},
	)

	topicV6 := NewSchema("offset_fetch_topic_response_v6",
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&CompactArray{Name: "partitions", Ty: partitionV6},
		&SchemaTaggedFields{Name: "topic_tagged_fields"},
	)

	offsetFetchV6 := NewSchema("offset_fetch_response_v6",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: "topics", Ty: topicV6},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	// v8+ uses groups array (batch response)
	groupV8 := NewSchema("offset_fetch_group_response_v8",
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&CompactArray{Name: "topics", Ty: topicV6},
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&SchemaTaggedFields{Name: "group_tagged_fields"},
	)

	offsetFetchV8 := NewSchema("offset_fetch_response_v8",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: "groups", Ty: groupV8},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	return []Schema{
		offsetFetchV0, // v0
		offsetFetchV0, // v1
		offsetFetchV2, // v2
		offsetFetchV3, // v3
		offsetFetchV3, // v4
		offsetFetchV5, // v5
		offsetFetchV6, // v6
		offsetFetchV6, // v7
		offsetFetchV8, // v8
		offsetFetchV8, // v9
	}
}

// modifyOffsetFetchResponse unprefixes topic names in OffsetFetch responses.
func modifyOffsetFetchResponse(decodedStruct *Struct, cfg ResponseModifierConfig, apiVersion int16) error {
	if cfg.TopicUnprefixer == nil {
		return nil
	}

	// v8+ uses groups array
	if apiVersion >= 8 {
		return modifyOffsetFetchResponseV8(decodedStruct, cfg.TopicUnprefixer)
	}

	// v0-v7 uses flat topics array
	topics := decodedStruct.Get("topics")
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
		if name, ok := nameField.(string); ok && name != "" {
			unprefixedName := cfg.TopicUnprefixer(name)
			if unprefixedName != name {
				if err := topic.Replace("name", unprefixedName); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

func modifyOffsetFetchResponseV8(decodedStruct *Struct, topicUnprefixer TopicUnprefixer) error {
	groups := decodedStruct.Get("groups")
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

		topics := group.Get("topics")
		if topics == nil {
			continue
		}

		topicsArray, ok := topics.([]interface{})
		if !ok {
			continue
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
			if name, ok := nameField.(string); ok && name != "" {
				unprefixedName := topicUnprefixer(name)
				if unprefixedName != name {
					if err := topic.Replace("name", unprefixedName); err != nil {
						return err
					}
				}
			}
		}
	}

	return nil
}

// offsetFetchResponseModifier unprefixes topic names in OffsetFetch responses.
type offsetFetchResponseModifier struct {
	schema     Schema
	apiVersion int16
	cfg        ResponseModifierConfig
}

func (m *offsetFetchResponseModifier) Apply(responseBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(responseBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode offset fetch response: %w", err)
	}

	if err := modifyOffsetFetchResponse(decoded, m.cfg, m.apiVersion); err != nil {
		return nil, fmt.Errorf("modify offset fetch response: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func newOffsetFetchResponseModifier(apiVersion int16, cfg ResponseModifierConfig) (ResponseModifier, error) {
	if apiVersion < 0 || int(apiVersion) >= len(offsetFetchResponseSchemaVersions) {
		return nil, fmt.Errorf("unsupported OffsetFetch response version %d", apiVersion)
	}
	schema := offsetFetchResponseSchemaVersions[apiVersion]
	return &offsetFetchResponseModifier{
		schema:     schema,
		apiVersion: apiVersion,
		cfg:        cfg,
	}, nil
}

// DescribeGroups response schemas
var describeGroupsResponseSchemas = createDescribeGroupsResponseSchemas()

func createDescribeGroupsResponseSchemas() []Schema {
	// Member for v0-v3 (member_assignment is opaque bytes - we don't decode it per YAGNI)
	memberV0 := NewSchema("describe_groups_member_v0",
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "client_id", Ty: TypeStr},
		&Mfield{Name: "client_host", Ty: TypeStr},
		&Mfield{Name: "member_metadata", Ty: TypeBytes},
		&Mfield{Name: "member_assignment", Ty: TypeBytes},
	)

	groupV0 := NewSchema("describe_groups_group_v0",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "group_state", Ty: TypeStr},
		&Mfield{Name: "protocol_type", Ty: TypeStr},
		&Mfield{Name: "protocol_data", Ty: TypeStr},
		&Array{Name: "members", Ty: memberV0},
	)

	// v0
	describeGroupsV0 := NewSchema("describe_groups_response_v0",
		&Array{Name: "groups", Ty: groupV0},
	)

	// v1+ adds throttle_time_ms
	describeGroupsV1 := NewSchema("describe_groups_response_v1",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "groups", Ty: groupV0},
	)

	// v3 adds authorized_operations to group
	groupV3 := NewSchema("describe_groups_group_v3",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "group_state", Ty: TypeStr},
		&Mfield{Name: "protocol_type", Ty: TypeStr},
		&Mfield{Name: "protocol_data", Ty: TypeStr},
		&Array{Name: "members", Ty: memberV0},
		&Mfield{Name: "authorized_operations", Ty: TypeInt32},
	)

	describeGroupsV3 := NewSchema("describe_groups_response_v3",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "groups", Ty: groupV3},
	)

	// v4 adds group_instance_id to member
	memberV4 := NewSchema("describe_groups_member_v4",
		&Mfield{Name: "member_id", Ty: TypeStr},
		&Mfield{Name: "group_instance_id", Ty: TypeNullableStr},
		&Mfield{Name: "client_id", Ty: TypeStr},
		&Mfield{Name: "client_host", Ty: TypeStr},
		&Mfield{Name: "member_metadata", Ty: TypeBytes},
		&Mfield{Name: "member_assignment", Ty: TypeBytes},
	)

	groupV4 := NewSchema("describe_groups_group_v4",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "group_id", Ty: TypeStr},
		&Mfield{Name: "group_state", Ty: TypeStr},
		&Mfield{Name: "protocol_type", Ty: TypeStr},
		&Mfield{Name: "protocol_data", Ty: TypeStr},
		&Array{Name: "members", Ty: memberV4},
		&Mfield{Name: "authorized_operations", Ty: TypeInt32},
	)

	describeGroupsV4 := NewSchema("describe_groups_response_v4",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&Array{Name: "groups", Ty: groupV4},
	)

	// v5+ flexible
	memberV5 := NewSchema("describe_groups_member_v5",
		&Mfield{Name: "member_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_instance_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "client_id", Ty: TypeCompactStr},
		&Mfield{Name: "client_host", Ty: TypeCompactStr},
		&Mfield{Name: "member_metadata", Ty: TypeCompactBytes},
		&Mfield{Name: "member_assignment", Ty: TypeCompactBytes},
		&SchemaTaggedFields{Name: "member_tagged_fields"},
	)

	groupV5 := NewSchema("describe_groups_group_v5",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "group_id", Ty: TypeCompactStr},
		&Mfield{Name: "group_state", Ty: TypeCompactStr},
		&Mfield{Name: "protocol_type", Ty: TypeCompactStr},
		&Mfield{Name: "protocol_data", Ty: TypeCompactStr},
		&CompactArray{Name: "members", Ty: memberV5},
		&Mfield{Name: "authorized_operations", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "group_tagged_fields"},
	)

	describeGroupsV5 := NewSchema("describe_groups_response_v5",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: "groups", Ty: groupV5},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	return []Schema{
		describeGroupsV0, // v0
		describeGroupsV1, // v1
		describeGroupsV1, // v2
		describeGroupsV3, // v3
		describeGroupsV4, // v4
		describeGroupsV5, // v5
	}
}

// describeGroupsResponseModifier unprefixes group_ids in DescribeGroups responses
type describeGroupsResponseModifier struct {
	schema          Schema
	groupUnprefixer GroupUnprefixer
}

func (m *describeGroupsResponseModifier) Apply(responseBytes []byte) ([]byte, error) {
	decoded, err := DecodeSchema(responseBytes, m.schema)
	if err != nil {
		return nil, fmt.Errorf("decode describe groups response: %w", err)
	}

	if err := modifyDescribeGroupsResponse(decoded, m.groupUnprefixer); err != nil {
		return nil, fmt.Errorf("modify describe groups response: %w", err)
	}

	return EncodeSchema(decoded, m.schema)
}

func modifyDescribeGroupsResponse(decoded *Struct, groupUnprefixer GroupUnprefixer) error {
	if groupUnprefixer == nil {
		return nil
	}

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
		groupId := group.Get("group_id")
		if groupId == nil {
			continue
		}
		if gid, ok := groupId.(string); ok && gid != "" {
			unprefixedId := groupUnprefixer(gid)
			if unprefixedId != gid {
				if err := group.Replace("group_id", unprefixedId); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

func newDescribeGroupsResponseModifier(apiVersion int16, cfg ResponseModifierConfig) (ResponseModifier, error) {
	if cfg.GroupUnprefixer == nil {
		return nil, nil
	}
	if apiVersion < 0 || int(apiVersion) >= len(describeGroupsResponseSchemas) {
		return nil, fmt.Errorf("unsupported DescribeGroups response version %d", apiVersion)
	}
	schema := describeGroupsResponseSchemas[apiVersion]
	return &describeGroupsResponseModifier{
		schema:          schema,
		groupUnprefixer: cfg.GroupUnprefixer,
	}, nil
}
