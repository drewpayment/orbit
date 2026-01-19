package protocol

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetResponseModifierWithConfig_ReturnsNilForUnhandledApis(t *testing.T) {
	cfg := ResponseModifierConfig{
		TopicUnprefixer: func(topic string) string { return strings.TrimPrefix(topic, "tenant:") },
	}

	// ApiVersions (18) should return nil
	mod, err := GetResponseModifierWithConfig(18, 0, cfg)
	require.NoError(t, err)
	assert.Nil(t, mod)

	// Unknown API key should return nil
	mod, err = GetResponseModifierWithConfig(999, 0, cfg)
	require.NoError(t, err)
	assert.Nil(t, mod)
}

func TestGetResponseModifierWithConfig_ReturnsMetadataModifier(t *testing.T) {
	cfg := ResponseModifierConfig{
		TopicUnprefixer: func(topic string) string { return strings.TrimPrefix(topic, "tenant:") },
	}

	// Metadata v0-v12 should return a modifier
	for version := int16(0); version <= 12; version++ {
		mod, err := GetResponseModifierWithConfig(apiKeyMetadata, version, cfg)
		require.NoError(t, err, "version %d", version)
		assert.NotNil(t, mod, "version %d should return modifier", version)
	}
}

func TestModifyTopicsInMetadataResponse_V0_Unprefixing(t *testing.T) {
	// Create v0 topic metadata schema
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

	metadataBrokerV0 := NewSchema("metadata_broker_v0",
		&Mfield{Name: "node_id", Ty: TypeInt32},
		&Mfield{Name: "host", Ty: TypeStr},
		&Mfield{Name: "port", Ty: TypeInt32},
	)

	metadataResponseV0 := NewSchema("metadata_response_v0",
		&Array{Name: "brokers", Ty: metadataBrokerV0},
		&Array{Name: "topic_metadata", Ty: topicMetadataV0},
	)

	// Create a topic with prefixed name
	topic := &Struct{
		Schema: topicMetadataV0,
		Values: []interface{}{
			int16(0),          // error_code
			"tenant:my-topic", // topic (prefixed)
			[]interface{}{},   // partition_metadata (empty)
		},
	}

	// Create broker
	broker := &Struct{
		Schema: metadataBrokerV0,
		Values: []interface{}{
			int32(0),   // node_id
			"localhost", // host
			int32(9092), // port
		},
	}

	decoded := &Struct{
		Schema: metadataResponseV0,
		Values: []interface{}{
			[]interface{}{broker},
			[]interface{}{topic},
		},
	}

	cfg := ResponseModifierConfig{
		TopicUnprefixer: func(t string) string { return strings.TrimPrefix(t, "tenant:") },
	}

	err := modifyTopicsInMetadataResponse(decoded, cfg)
	require.NoError(t, err)

	// Verify topic was unprefixed
	topics := decoded.Get("topic_metadata").([]interface{})
	require.Len(t, topics, 1)
	topicStruct := topics[0].(*Struct)
	assert.Equal(t, "my-topic", topicStruct.Get("topic"))
}

func TestModifyTopicsInMetadataResponse_V9_Unprefixing(t *testing.T) {
	// Create v9 topic metadata schema (uses "name" field with CompactStr)
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

	topicMetadataSchema9 := NewSchema("topic_metadata_schema9",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "name", Ty: TypeCompactStr},
		&Mfield{Name: "is_internal", Ty: TypeBool},
		&CompactArray{Name: "partition_metadata", Ty: partitionMetadataSchema9},
		&Mfield{Name: "topic_authorized_operations", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "topic_metadata_tagged_fields"},
	)

	metadataBrokerSchema9 := NewSchema("metadata_broker_schema9",
		&Mfield{Name: "node_id", Ty: TypeInt32},
		&Mfield{Name: "host", Ty: TypeCompactStr},
		&Mfield{Name: "port", Ty: TypeInt32},
		&Mfield{Name: "rack", Ty: TypeCompactNullableStr},
		&SchemaTaggedFields{Name: "broker_tagged_fields"},
	)

	metadataResponseV9 := NewSchema("metadata_response_v9",
		&Mfield{Name: "throttle_time_ms", Ty: TypeInt32},
		&CompactArray{Name: "brokers", Ty: metadataBrokerSchema9},
		&Mfield{Name: "cluster_id", Ty: TypeCompactNullableStr},
		&Mfield{Name: "controller_id", Ty: TypeInt32},
		&CompactArray{Name: "topic_metadata", Ty: topicMetadataSchema9},
		&Mfield{Name: "cluster_authorized_operations", Ty: TypeInt32},
		&SchemaTaggedFields{Name: "response_tagged_fields"},
	)

	// Create a topic with prefixed name
	topic := &Struct{
		Schema: topicMetadataSchema9,
		Values: []interface{}{
			int16(0),           // error_code
			"tenant:my-topic",  // name (prefixed, TypeCompactStr = string)
			false,              // is_internal
			[]interface{}{},    // partition_metadata (empty)
			int32(-2147483648), // topic_authorized_operations
			[]interface{}{},    // tagged_fields
		},
	}

	// Create broker
	var nullRack *string
	broker := &Struct{
		Schema: metadataBrokerSchema9,
		Values: []interface{}{
			int32(0),    // node_id
			"localhost", // host (CompactStr = string)
			int32(9092), // port
			nullRack,    // rack (nullable)
			[]interface{}{}, // tagged_fields
		},
	}

	var nullClusterId *string
	decoded := &Struct{
		Schema: metadataResponseV9,
		Values: []interface{}{
			int32(0),            // throttle_time_ms
			[]interface{}{broker}, // brokers
			nullClusterId,       // cluster_id (nullable)
			int32(0),            // controller_id
			[]interface{}{topic}, // topic_metadata
			int32(-2147483648),  // cluster_authorized_operations
			[]interface{}{},     // tagged_fields
		},
	}

	cfg := ResponseModifierConfig{
		TopicUnprefixer: func(t string) string { return strings.TrimPrefix(t, "tenant:") },
	}

	err := modifyTopicsInMetadataResponse(decoded, cfg)
	require.NoError(t, err)

	// Verify topic was unprefixed
	topics := decoded.Get("topic_metadata").([]interface{})
	require.Len(t, topics, 1)
	topicStruct := topics[0].(*Struct)
	assert.Equal(t, "my-topic", topicStruct.Get("name"))
}

func TestModifyTopicsInMetadataResponse_Filtering(t *testing.T) {
	// Create v0 topic metadata schema
	topicMetadataV0 := NewSchema("topic_metadata_v0",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "topic", Ty: TypeStr},
		&Array{Name: "partition_metadata", Ty: TypeInt32}, // Simplified for test
	)

	metadataBrokerV0 := NewSchema("metadata_broker_v0",
		&Mfield{Name: "node_id", Ty: TypeInt32},
		&Mfield{Name: "host", Ty: TypeStr},
		&Mfield{Name: "port", Ty: TypeInt32},
	)

	metadataResponseV0 := NewSchema("metadata_response_v0",
		&Array{Name: "brokers", Ty: metadataBrokerV0},
		&Array{Name: "topic_metadata", Ty: topicMetadataV0},
	)

	// Create topics: 2 tenant topics, 1 other tenant topic
	tenantTopic1 := &Struct{
		Schema: topicMetadataV0,
		Values: []interface{}{int16(0), "tenant-a:topic1", []interface{}{}},
	}
	tenantTopic2 := &Struct{
		Schema: topicMetadataV0,
		Values: []interface{}{int16(0), "tenant-a:topic2", []interface{}{}},
	}
	otherTopic := &Struct{
		Schema: topicMetadataV0,
		Values: []interface{}{int16(0), "tenant-b:secret", []interface{}{}},
	}

	broker := &Struct{
		Schema: metadataBrokerV0,
		Values: []interface{}{int32(0), "localhost", int32(9092)},
	}

	decoded := &Struct{
		Schema: metadataResponseV0,
		Values: []interface{}{
			[]interface{}{broker},
			[]interface{}{tenantTopic1, tenantTopic2, otherTopic},
		},
	}

	cfg := ResponseModifierConfig{
		TopicFilter: func(topic string) bool {
			return strings.HasPrefix(topic, "tenant-a:")
		},
		TopicUnprefixer: func(topic string) string {
			return strings.TrimPrefix(topic, "tenant-a:")
		},
	}

	err := modifyTopicsInMetadataResponse(decoded, cfg)
	require.NoError(t, err)

	// Verify only tenant-a topics remain, and they're unprefixed
	topics := decoded.Get("topic_metadata").([]interface{})
	require.Len(t, topics, 2, "should only have 2 tenant-a topics")

	names := []string{}
	for _, t := range topics {
		names = append(names, t.(*Struct).Get("topic").(string))
	}
	assert.Contains(t, names, "topic1")
	assert.Contains(t, names, "topic2")
	assert.NotContains(t, names, "tenant-b:secret")
}

func TestModifyMetadataResponseWithConfig_BrokerAddressOnly(t *testing.T) {
	// Test that broker address mapping still works without topic rewriting
	metadataBrokerV0 := NewSchema("metadata_broker_v0",
		&Mfield{Name: "node_id", Ty: TypeInt32},
		&Mfield{Name: "host", Ty: TypeStr},
		&Mfield{Name: "port", Ty: TypeInt32},
	)

	topicMetadataV0 := NewSchema("topic_metadata_v0",
		&Mfield{Name: "error_code", Ty: TypeInt16},
		&Mfield{Name: "topic", Ty: TypeStr},
		&Array{Name: "partition_metadata", Ty: TypeInt32},
	)

	metadataResponseV0 := NewSchema("metadata_response_v0",
		&Array{Name: "brokers", Ty: metadataBrokerV0},
		&Array{Name: "topic_metadata", Ty: topicMetadataV0},
	)

	broker := &Struct{
		Schema: metadataBrokerV0,
		Values: []interface{}{int32(0), "internal-host", int32(9092)},
	}

	topic := &Struct{
		Schema: topicMetadataV0,
		Values: []interface{}{int16(0), "my-topic", []interface{}{}},
	}

	decoded := &Struct{
		Schema: metadataResponseV0,
		Values: []interface{}{
			[]interface{}{broker},
			[]interface{}{topic},
		},
	}

	cfg := ResponseModifierConfig{
		NetAddressMappingFunc: func(host string, port int32, nodeId int32) (string, int32, error) {
			return "external-host", 19092, nil
		},
		// No TopicUnprefixer or TopicFilter
	}

	err := modifyMetadataResponseWithConfig(decoded, cfg)
	require.NoError(t, err)

	// Verify broker was remapped
	brokers := decoded.Get("brokers").([]interface{})
	require.Len(t, brokers, 1)
	brokerStruct := brokers[0].(*Struct)
	assert.Equal(t, "external-host", brokerStruct.Get("host"))
	assert.Equal(t, int32(19092), brokerStruct.Get("port"))

	// Verify topic was NOT modified (no unprefixer)
	topics := decoded.Get("topic_metadata").([]interface{})
	topicStruct := topics[0].(*Struct)
	assert.Equal(t, "my-topic", topicStruct.Get("topic"))
}
