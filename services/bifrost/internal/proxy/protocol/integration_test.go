package protocol

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestConsumerGroupFlowIntegration tests the full request/response flow for consumer group APIs.
// It verifies that:
// 1. Group IDs are properly prefixed in requests
// 2. Group IDs are properly unprefixed in responses
// 3. Topics are properly prefixed/unprefixed in OffsetCommit/OffsetFetch
// 4. ListGroups properly filters groups by tenant
func TestConsumerGroupFlowIntegration(t *testing.T) {
	prefix := "tenant1:"

	requestCfg := RequestModifierConfig{
		GroupPrefixer: func(group string) string { return prefix + group },
		TopicPrefixer: func(topic string) string { return prefix + topic },
	}

	responseCfg := ResponseModifierConfig{
		GroupUnprefixer: func(group string) string {
			return strings.TrimPrefix(group, prefix)
		},
		TopicUnprefixer: func(topic string) string {
			return strings.TrimPrefix(topic, prefix)
		},
		GroupFilter: func(group string) bool {
			return strings.HasPrefix(group, prefix)
		},
	}

	t.Run("JoinGroup prefixes group_id", func(t *testing.T) {
		mod, err := GetRequestModifier(apiKeyJoinGroup, 0, requestCfg)
		require.NoError(t, err)
		require.NotNil(t, mod)

		// Build a JoinGroup v0 request
		var requestBytes []byte
		// correlation_id: 1
		requestBytes = append(requestBytes, 0, 0, 0, 1)
		// client_id: "test-client"
		clientId := "test-client"
		requestBytes = append(requestBytes, 0, byte(len(clientId)))
		requestBytes = append(requestBytes, []byte(clientId)...)
		// group_id: "my-group"
		groupId := "my-group"
		requestBytes = append(requestBytes, 0, byte(len(groupId)))
		requestBytes = append(requestBytes, []byte(groupId)...)
		// session_timeout_ms: 30000
		requestBytes = append(requestBytes, 0, 0, 0x75, 0x30)
		// member_id: ""
		requestBytes = append(requestBytes, 0, 0)
		// protocol_type: "consumer"
		protocolType := "consumer"
		requestBytes = append(requestBytes, 0, byte(len(protocolType)))
		requestBytes = append(requestBytes, []byte(protocolType)...)
		// protocols: empty array
		requestBytes = append(requestBytes, 0, 0, 0, 0)

		result, err := mod.Apply(requestBytes)
		require.NoError(t, err)

		// Decode result to verify group is prefixed
		schema, err := getJoinGroupRequestSchema(0)
		require.NoError(t, err)
		decoded, err := DecodeSchema(result, schema)
		require.NoError(t, err)

		resultGroupId := decoded.Get("group_id").(string)
		assert.Equal(t, "tenant1:my-group", resultGroupId)
	})

	t.Run("SyncGroup prefixes group_id", func(t *testing.T) {
		mod, err := GetRequestModifier(apiKeySyncGroup, 0, requestCfg)
		require.NoError(t, err)
		require.NotNil(t, mod)

		// Build a SyncGroup v0 request
		var requestBytes []byte
		// correlation_id: 1
		requestBytes = append(requestBytes, 0, 0, 0, 1)
		// client_id: "test-client"
		clientId := "test-client"
		requestBytes = append(requestBytes, 0, byte(len(clientId)))
		requestBytes = append(requestBytes, []byte(clientId)...)
		// group_id: "my-group"
		groupId := "my-group"
		requestBytes = append(requestBytes, 0, byte(len(groupId)))
		requestBytes = append(requestBytes, []byte(groupId)...)
		// generation_id: 1
		requestBytes = append(requestBytes, 0, 0, 0, 1)
		// member_id: "member-1"
		memberId := "member-1"
		requestBytes = append(requestBytes, 0, byte(len(memberId)))
		requestBytes = append(requestBytes, []byte(memberId)...)
		// assignments: empty array
		requestBytes = append(requestBytes, 0, 0, 0, 0)

		result, err := mod.Apply(requestBytes)
		require.NoError(t, err)

		// Decode result to verify group is prefixed
		schema, err := getSyncGroupRequestSchema(0)
		require.NoError(t, err)
		decoded, err := DecodeSchema(result, schema)
		require.NoError(t, err)

		resultGroupId := decoded.Get("group_id").(string)
		assert.Equal(t, "tenant1:my-group", resultGroupId)
	})

	t.Run("OffsetCommit prefixes group and topics", func(t *testing.T) {
		mod, err := GetRequestModifier(apiKeyOffsetCommit, 0, requestCfg)
		require.NoError(t, err)
		require.NotNil(t, mod)

		// Build OffsetCommit v0 request with group and topics
		var requestBytes []byte
		// correlation_id: 1
		requestBytes = append(requestBytes, 0, 0, 0, 1)
		// client_id: "test-client"
		clientId := "test-client"
		requestBytes = append(requestBytes, 0, byte(len(clientId)))
		requestBytes = append(requestBytes, []byte(clientId)...)
		// group_id: "my-group"
		groupId := "my-group"
		requestBytes = append(requestBytes, 0, byte(len(groupId)))
		requestBytes = append(requestBytes, []byte(groupId)...)
		// topics array: 1 element
		requestBytes = append(requestBytes, 0, 0, 0, 1)
		// topic name: "my-topic"
		topicName := "my-topic"
		requestBytes = append(requestBytes, 0, byte(len(topicName)))
		requestBytes = append(requestBytes, []byte(topicName)...)
		// partitions array: 1 element
		requestBytes = append(requestBytes, 0, 0, 0, 1)
		// partition_index: 0
		requestBytes = append(requestBytes, 0, 0, 0, 0)
		// committed_offset: 100
		requestBytes = append(requestBytes, 0, 0, 0, 0, 0, 0, 0, 100)
		// committed_metadata: ""
		requestBytes = append(requestBytes, 0, 0)

		result, err := mod.Apply(requestBytes)
		require.NoError(t, err)

		// Decode result to verify both group and topics are prefixed
		schema, err := getOffsetCommitRequestSchema(0)
		require.NoError(t, err)
		decoded, err := DecodeSchema(result, schema)
		require.NoError(t, err)

		// Verify group is prefixed
		resultGroupId := decoded.Get("group_id").(string)
		assert.Equal(t, "tenant1:my-group", resultGroupId)

		// Verify topic is prefixed
		topics := decoded.Get("topics").([]interface{})
		require.Len(t, topics, 1)
		topicStruct := topics[0].(*Struct)
		resultTopic := topicStruct.Get("name").(string)
		assert.Equal(t, "tenant1:my-topic", resultTopic)
	})

	t.Run("OffsetFetch response unprefixes topics", func(t *testing.T) {
		mod, err := GetResponseModifierWithConfig(apiKeyOffsetFetch, 0, responseCfg)
		require.NoError(t, err)
		require.NotNil(t, mod)

		// Build OffsetFetch v0 response with prefixed topics
		var responseBytes []byte
		// topics array: 1 element
		responseBytes = append(responseBytes, 0, 0, 0, 1)
		// topic name: "tenant1:my-topic" (prefixed)
		topicName := "tenant1:my-topic"
		responseBytes = append(responseBytes, 0, byte(len(topicName)))
		responseBytes = append(responseBytes, []byte(topicName)...)
		// partitions array: 1 element
		responseBytes = append(responseBytes, 0, 0, 0, 1)
		// partition_index: 0
		responseBytes = append(responseBytes, 0, 0, 0, 0)
		// committed_offset: 100
		responseBytes = append(responseBytes, 0, 0, 0, 0, 0, 0, 0, 100)
		// metadata: "" (null)
		responseBytes = append(responseBytes, 0xff, 0xff)
		// error_code: 0
		responseBytes = append(responseBytes, 0, 0)

		result, err := mod.Apply(responseBytes)
		require.NoError(t, err)

		// Decode result to verify topics are unprefixed
		schema := offsetFetchResponseSchemaVersions[0]
		decoded, err := DecodeSchema(result, schema)
		require.NoError(t, err)

		topics := decoded.Get("topics").([]interface{})
		require.Len(t, topics, 1)
		topicStruct := topics[0].(*Struct)
		resultTopic := topicStruct.Get("name").(string)
		assert.Equal(t, "my-topic", resultTopic)
	})

	t.Run("ListGroups filters and unprefixes groups", func(t *testing.T) {
		mod, err := GetResponseModifierWithConfig(apiKeyListGroups, 0, responseCfg)
		require.NoError(t, err)
		require.NotNil(t, mod)

		// Build ListGroups v0 response with mixed groups (some tenant's, some not)
		var responseBytes []byte
		// error_code: 0
		responseBytes = append(responseBytes, 0, 0)
		// groups array: 3 elements
		responseBytes = append(responseBytes, 0, 0, 0, 3)
		// group 1: "tenant1:my-group" (should be included and unprefixed)
		group1 := "tenant1:my-group"
		responseBytes = append(responseBytes, 0, byte(len(group1)))
		responseBytes = append(responseBytes, []byte(group1)...)
		protocolType1 := "consumer"
		responseBytes = append(responseBytes, 0, byte(len(protocolType1)))
		responseBytes = append(responseBytes, []byte(protocolType1)...)
		// group 2: "other-tenant:their-group" (should be filtered out)
		group2 := "other-tenant:their-group"
		responseBytes = append(responseBytes, 0, byte(len(group2)))
		responseBytes = append(responseBytes, []byte(group2)...)
		protocolType2 := "consumer"
		responseBytes = append(responseBytes, 0, byte(len(protocolType2)))
		responseBytes = append(responseBytes, []byte(protocolType2)...)
		// group 3: "tenant1:another-group" (should be included and unprefixed)
		group3 := "tenant1:another-group"
		responseBytes = append(responseBytes, 0, byte(len(group3)))
		responseBytes = append(responseBytes, []byte(group3)...)
		protocolType3 := "consumer"
		responseBytes = append(responseBytes, 0, byte(len(protocolType3)))
		responseBytes = append(responseBytes, []byte(protocolType3)...)

		result, err := mod.Apply(responseBytes)
		require.NoError(t, err)

		// Decode result to verify filtering and unprefixing
		schema := listGroupsResponseSchemas[0]
		decoded, err := DecodeSchema(result, schema)
		require.NoError(t, err)

		groups := decoded.Get("groups").([]interface{})
		require.Len(t, groups, 2, "should filter out non-tenant groups")

		// First group should be unprefixed
		group1Struct := groups[0].(*Struct)
		resultGroup1 := group1Struct.Get("group_id").(string)
		assert.Equal(t, "my-group", resultGroup1)

		// Second group should be unprefixed
		group2Struct := groups[1].(*Struct)
		resultGroup2 := group2Struct.Get("group_id").(string)
		assert.Equal(t, "another-group", resultGroup2)
	})

	t.Run("DescribeGroups unprefixes group_id", func(t *testing.T) {
		mod, err := GetResponseModifierWithConfig(apiKeyDescribeGroups, 0, responseCfg)
		require.NoError(t, err)
		require.NotNil(t, mod)

		// Build DescribeGroups v0 response with prefixed group_id
		var responseBytes []byte
		// groups array: 1 element
		responseBytes = append(responseBytes, 0, 0, 0, 1)
		// error_code: 0
		responseBytes = append(responseBytes, 0, 0)
		// group_id: "tenant1:my-group" (prefixed)
		groupId := "tenant1:my-group"
		responseBytes = append(responseBytes, 0, byte(len(groupId)))
		responseBytes = append(responseBytes, []byte(groupId)...)
		// group_state: "Stable"
		groupState := "Stable"
		responseBytes = append(responseBytes, 0, byte(len(groupState)))
		responseBytes = append(responseBytes, []byte(groupState)...)
		// protocol_type: "consumer"
		protocolType := "consumer"
		responseBytes = append(responseBytes, 0, byte(len(protocolType)))
		responseBytes = append(responseBytes, []byte(protocolType)...)
		// protocol_data: "range"
		protocolData := "range"
		responseBytes = append(responseBytes, 0, byte(len(protocolData)))
		responseBytes = append(responseBytes, []byte(protocolData)...)
		// members: empty array
		responseBytes = append(responseBytes, 0, 0, 0, 0)

		result, err := mod.Apply(responseBytes)
		require.NoError(t, err)

		// Decode result to verify group_id is unprefixed
		schema := describeGroupsResponseSchemas[0]
		decoded, err := DecodeSchema(result, schema)
		require.NoError(t, err)

		groups := decoded.Get("groups").([]interface{})
		require.Len(t, groups, 1)
		groupStruct := groups[0].(*Struct)
		resultGroupId := groupStruct.Get("group_id").(string)
		assert.Equal(t, "my-group", resultGroupId)
	})
}

// TestConsumerGroupRoundTrip tests that a group_id round-trips correctly:
// 1. Client sends "my-group"
// 2. Request modifier adds prefix -> "tenant1:my-group"
// 3. Kafka sees prefixed group
// 4. Response modifier removes prefix -> "my-group"
// 5. Client sees original group name
func TestConsumerGroupRoundTrip(t *testing.T) {
	prefix := "tenant1:"
	originalGroup := "my-group"

	requestCfg := RequestModifierConfig{
		GroupPrefixer: func(group string) string { return prefix + group },
	}

	responseCfg := ResponseModifierConfig{
		GroupUnprefixer: func(group string) string {
			return strings.TrimPrefix(group, prefix)
		},
	}

	t.Run("DescribeGroups round trip", func(t *testing.T) {
		// Step 1: Build request with original group name
		reqMod, err := GetRequestModifier(apiKeyDescribeGroups, 0, requestCfg)
		require.NoError(t, err)
		require.NotNil(t, reqMod)

		var requestBytes []byte
		// correlation_id: 1
		requestBytes = append(requestBytes, 0, 0, 0, 1)
		// client_id: "test-client"
		clientId := "test-client"
		requestBytes = append(requestBytes, 0, byte(len(clientId)))
		requestBytes = append(requestBytes, []byte(clientId)...)
		// groups array: 1 element
		requestBytes = append(requestBytes, 0, 0, 0, 1)
		// group: "my-group"
		requestBytes = append(requestBytes, 0, byte(len(originalGroup)))
		requestBytes = append(requestBytes, []byte(originalGroup)...)

		modifiedRequest, err := reqMod.Apply(requestBytes)
		require.NoError(t, err)

		// Step 2: Verify request contains prefixed group
		reqSchema, err := getDescribeGroupsRequestSchema(0)
		require.NoError(t, err)
		decodedReq, err := DecodeSchema(modifiedRequest, reqSchema)
		require.NoError(t, err)

		groups := decodedReq.Get("groups").([]interface{})
		require.Len(t, groups, 1)
		prefixedGroup := groups[0].(string)
		assert.Equal(t, prefix+originalGroup, prefixedGroup, "request should contain prefixed group")

		// Step 3: Build response with what Kafka would return (prefixed group)
		respMod, err := GetResponseModifierWithConfig(apiKeyDescribeGroups, 0, responseCfg)
		require.NoError(t, err)
		require.NotNil(t, respMod)

		var responseBytes []byte
		// groups array: 1 element
		responseBytes = append(responseBytes, 0, 0, 0, 1)
		// error_code: 0
		responseBytes = append(responseBytes, 0, 0)
		// group_id: prefixed group (what Kafka returns)
		responseBytes = append(responseBytes, 0, byte(len(prefixedGroup)))
		responseBytes = append(responseBytes, []byte(prefixedGroup)...)
		// group_state: "Stable"
		groupState := "Stable"
		responseBytes = append(responseBytes, 0, byte(len(groupState)))
		responseBytes = append(responseBytes, []byte(groupState)...)
		// protocol_type: "consumer"
		protocolType := "consumer"
		responseBytes = append(responseBytes, 0, byte(len(protocolType)))
		responseBytes = append(responseBytes, []byte(protocolType)...)
		// protocol_data: "range"
		protocolData := "range"
		responseBytes = append(responseBytes, 0, byte(len(protocolData)))
		responseBytes = append(responseBytes, []byte(protocolData)...)
		// members: empty array
		responseBytes = append(responseBytes, 0, 0, 0, 0)

		modifiedResponse, err := respMod.Apply(responseBytes)
		require.NoError(t, err)

		// Step 4: Verify response contains original (unprefixed) group
		respSchema := describeGroupsResponseSchemas[0]
		decodedResp, err := DecodeSchema(modifiedResponse, respSchema)
		require.NoError(t, err)

		respGroups := decodedResp.Get("groups").([]interface{})
		require.Len(t, respGroups, 1)
		groupStruct := respGroups[0].(*Struct)
		resultGroupId := groupStruct.Get("group_id").(string)
		assert.Equal(t, originalGroup, resultGroupId, "response should contain original (unprefixed) group")
	})

	t.Run("Heartbeat request prefixes correctly", func(t *testing.T) {
		reqMod, err := GetRequestModifier(apiKeyHeartbeat, 0, requestCfg)
		require.NoError(t, err)
		require.NotNil(t, reqMod)

		var requestBytes []byte
		// correlation_id: 1
		requestBytes = append(requestBytes, 0, 0, 0, 1)
		// client_id: "test-client"
		clientId := "test-client"
		requestBytes = append(requestBytes, 0, byte(len(clientId)))
		requestBytes = append(requestBytes, []byte(clientId)...)
		// group_id: "my-group"
		requestBytes = append(requestBytes, 0, byte(len(originalGroup)))
		requestBytes = append(requestBytes, []byte(originalGroup)...)
		// generation_id: 1
		requestBytes = append(requestBytes, 0, 0, 0, 1)
		// member_id: "member-1"
		memberId := "member-1"
		requestBytes = append(requestBytes, 0, byte(len(memberId)))
		requestBytes = append(requestBytes, []byte(memberId)...)

		modifiedRequest, err := reqMod.Apply(requestBytes)
		require.NoError(t, err)

		// Verify request contains prefixed group
		reqSchema, err := getHeartbeatRequestSchema(0)
		require.NoError(t, err)
		decodedReq, err := DecodeSchema(modifiedRequest, reqSchema)
		require.NoError(t, err)

		resultGroupId := decodedReq.Get("group_id").(string)
		assert.Equal(t, prefix+originalGroup, resultGroupId)
	})

	t.Run("LeaveGroup request prefixes correctly", func(t *testing.T) {
		reqMod, err := GetRequestModifier(apiKeyLeaveGroup, 0, requestCfg)
		require.NoError(t, err)
		require.NotNil(t, reqMod)

		var requestBytes []byte
		// correlation_id: 1
		requestBytes = append(requestBytes, 0, 0, 0, 1)
		// client_id: "test-client"
		clientId := "test-client"
		requestBytes = append(requestBytes, 0, byte(len(clientId)))
		requestBytes = append(requestBytes, []byte(clientId)...)
		// group_id: "my-group"
		requestBytes = append(requestBytes, 0, byte(len(originalGroup)))
		requestBytes = append(requestBytes, []byte(originalGroup)...)
		// member_id: "member-1"
		memberId := "member-1"
		requestBytes = append(requestBytes, 0, byte(len(memberId)))
		requestBytes = append(requestBytes, []byte(memberId)...)

		modifiedRequest, err := reqMod.Apply(requestBytes)
		require.NoError(t, err)

		// Verify request contains prefixed group
		reqSchema, err := getLeaveGroupRequestSchema(0)
		require.NoError(t, err)
		decodedReq, err := DecodeSchema(modifiedRequest, reqSchema)
		require.NoError(t, err)

		resultGroupId := decodedReq.Get("group_id").(string)
		assert.Equal(t, prefix+originalGroup, resultGroupId)
	})
}

// TestOffsetManagementIntegration tests the OffsetCommit and OffsetFetch round trip
func TestOffsetManagementIntegration(t *testing.T) {
	prefix := "tenant1:"

	requestCfg := RequestModifierConfig{
		GroupPrefixer: func(group string) string { return prefix + group },
		TopicPrefixer: func(topic string) string { return prefix + topic },
	}

	responseCfg := ResponseModifierConfig{
		TopicUnprefixer: func(topic string) string {
			return strings.TrimPrefix(topic, prefix)
		},
	}

	t.Run("OffsetCommit/OffsetFetch round trip", func(t *testing.T) {
		// Step 1: Client sends OffsetCommit with original group and topic names
		originalGroup := "my-consumer-group"
		originalTopic := "events"

		// Build OffsetCommit request
		commitMod, err := GetRequestModifier(apiKeyOffsetCommit, 0, requestCfg)
		require.NoError(t, err)
		require.NotNil(t, commitMod)

		var commitRequest []byte
		// correlation_id: 1
		commitRequest = append(commitRequest, 0, 0, 0, 1)
		// client_id: "test-client"
		clientId := "test-client"
		commitRequest = append(commitRequest, 0, byte(len(clientId)))
		commitRequest = append(commitRequest, []byte(clientId)...)
		// group_id: originalGroup
		commitRequest = append(commitRequest, 0, byte(len(originalGroup)))
		commitRequest = append(commitRequest, []byte(originalGroup)...)
		// topics array: 1 element
		commitRequest = append(commitRequest, 0, 0, 0, 1)
		// topic name: originalTopic
		commitRequest = append(commitRequest, 0, byte(len(originalTopic)))
		commitRequest = append(commitRequest, []byte(originalTopic)...)
		// partitions array: 1 element
		commitRequest = append(commitRequest, 0, 0, 0, 1)
		// partition_index: 0
		commitRequest = append(commitRequest, 0, 0, 0, 0)
		// committed_offset: 42
		commitRequest = append(commitRequest, 0, 0, 0, 0, 0, 0, 0, 42)
		// committed_metadata: ""
		commitRequest = append(commitRequest, 0, 0)

		modifiedCommitRequest, err := commitMod.Apply(commitRequest)
		require.NoError(t, err)

		// Verify OffsetCommit request has prefixed group and topic
		commitSchema, err := getOffsetCommitRequestSchema(0)
		require.NoError(t, err)
		decodedCommit, err := DecodeSchema(modifiedCommitRequest, commitSchema)
		require.NoError(t, err)

		assert.Equal(t, prefix+originalGroup, decodedCommit.Get("group_id").(string))
		topics := decodedCommit.Get("topics").([]interface{})
		require.Len(t, topics, 1)
		topicStruct := topics[0].(*Struct)
		assert.Equal(t, prefix+originalTopic, topicStruct.Get("name").(string))

		// Step 2: Build OffsetCommit response (Kafka returns prefixed topic)
		commitRespMod, err := GetResponseModifierWithConfig(apiKeyOffsetCommit, 0, responseCfg)
		require.NoError(t, err)
		require.NotNil(t, commitRespMod)

		var commitResponse []byte
		// topics array: 1 element
		commitResponse = append(commitResponse, 0, 0, 0, 1)
		// topic name: prefixed
		prefixedTopic := prefix + originalTopic
		commitResponse = append(commitResponse, 0, byte(len(prefixedTopic)))
		commitResponse = append(commitResponse, []byte(prefixedTopic)...)
		// partitions array: 1 element
		commitResponse = append(commitResponse, 0, 0, 0, 1)
		// partition_index: 0
		commitResponse = append(commitResponse, 0, 0, 0, 0)
		// error_code: 0
		commitResponse = append(commitResponse, 0, 0)

		modifiedCommitResponse, err := commitRespMod.Apply(commitResponse)
		require.NoError(t, err)

		// Verify OffsetCommit response has unprefixed topic
		commitRespSchema := offsetCommitResponseSchemaVersions[0]
		decodedCommitResp, err := DecodeSchema(modifiedCommitResponse, commitRespSchema)
		require.NoError(t, err)

		respTopics := decodedCommitResp.Get("topics").([]interface{})
		require.Len(t, respTopics, 1)
		respTopicStruct := respTopics[0].(*Struct)
		assert.Equal(t, originalTopic, respTopicStruct.Get("name").(string))

		// Step 3: Client sends OffsetFetch to retrieve committed offset
		fetchMod, err := GetRequestModifier(apiKeyOffsetFetch, 0, requestCfg)
		require.NoError(t, err)
		require.NotNil(t, fetchMod)

		var fetchRequest []byte
		// correlation_id: 2
		fetchRequest = append(fetchRequest, 0, 0, 0, 2)
		// client_id: "test-client"
		fetchRequest = append(fetchRequest, 0, byte(len(clientId)))
		fetchRequest = append(fetchRequest, []byte(clientId)...)
		// group_id: originalGroup
		fetchRequest = append(fetchRequest, 0, byte(len(originalGroup)))
		fetchRequest = append(fetchRequest, []byte(originalGroup)...)
		// topics array: 1 element
		fetchRequest = append(fetchRequest, 0, 0, 0, 1)
		// topic name: originalTopic
		fetchRequest = append(fetchRequest, 0, byte(len(originalTopic)))
		fetchRequest = append(fetchRequest, []byte(originalTopic)...)
		// partitions array: 1 element
		fetchRequest = append(fetchRequest, 0, 0, 0, 1)
		// partition_index: 0
		fetchRequest = append(fetchRequest, 0, 0, 0, 0)

		modifiedFetchRequest, err := fetchMod.Apply(fetchRequest)
		require.NoError(t, err)

		// Verify OffsetFetch request has prefixed group and topic
		fetchSchema, err := getOffsetFetchRequestSchema(0)
		require.NoError(t, err)
		decodedFetch, err := DecodeSchema(modifiedFetchRequest, fetchSchema)
		require.NoError(t, err)

		assert.Equal(t, prefix+originalGroup, decodedFetch.Get("group_id").(string))
		fetchTopics := decodedFetch.Get("topics").([]interface{})
		require.Len(t, fetchTopics, 1)
		fetchTopicStruct := fetchTopics[0].(*Struct)
		assert.Equal(t, prefix+originalTopic, fetchTopicStruct.Get("name").(string))

		// Step 4: Build OffsetFetch response (Kafka returns prefixed topic and committed offset)
		fetchRespMod, err := GetResponseModifierWithConfig(apiKeyOffsetFetch, 0, responseCfg)
		require.NoError(t, err)
		require.NotNil(t, fetchRespMod)

		var fetchResponse []byte
		// topics array: 1 element
		fetchResponse = append(fetchResponse, 0, 0, 0, 1)
		// topic name: prefixed
		fetchResponse = append(fetchResponse, 0, byte(len(prefixedTopic)))
		fetchResponse = append(fetchResponse, []byte(prefixedTopic)...)
		// partitions array: 1 element
		fetchResponse = append(fetchResponse, 0, 0, 0, 1)
		// partition_index: 0
		fetchResponse = append(fetchResponse, 0, 0, 0, 0)
		// committed_offset: 42 (what we committed)
		fetchResponse = append(fetchResponse, 0, 0, 0, 0, 0, 0, 0, 42)
		// metadata: null
		fetchResponse = append(fetchResponse, 0xff, 0xff)
		// error_code: 0
		fetchResponse = append(fetchResponse, 0, 0)

		modifiedFetchResponse, err := fetchRespMod.Apply(fetchResponse)
		require.NoError(t, err)

		// Verify OffsetFetch response has unprefixed topic
		fetchRespSchema := offsetFetchResponseSchemaVersions[0]
		decodedFetchResp, err := DecodeSchema(modifiedFetchResponse, fetchRespSchema)
		require.NoError(t, err)

		fetchRespTopics := decodedFetchResp.Get("topics").([]interface{})
		require.Len(t, fetchRespTopics, 1)
		fetchRespTopicStruct := fetchRespTopics[0].(*Struct)
		assert.Equal(t, originalTopic, fetchRespTopicStruct.Get("name").(string))

		// Verify the committed offset is preserved
		partitions := fetchRespTopicStruct.Get("partitions").([]interface{})
		require.Len(t, partitions, 1)
		partitionStruct := partitions[0].(*Struct)
		committedOffset := partitionStruct.Get("committed_offset").(int64)
		assert.Equal(t, int64(42), committedOffset)
	})
}

// TestFindCoordinatorIntegration tests FindCoordinator request handling
func TestFindCoordinatorIntegration(t *testing.T) {
	prefix := "tenant1:"

	requestCfg := RequestModifierConfig{
		GroupPrefixer: func(group string) string { return prefix + group },
		TxnIDPrefixer: func(txn string) string { return "txn:" + txn },
	}

	t.Run("FindCoordinator v0 prefixes group key", func(t *testing.T) {
		mod, err := GetRequestModifier(apiKeyFindCoordinator, 0, requestCfg)
		require.NoError(t, err)
		require.NotNil(t, mod)

		var requestBytes []byte
		// correlation_id: 1
		requestBytes = append(requestBytes, 0, 0, 0, 1)
		// client_id: "test-client"
		clientId := "test-client"
		requestBytes = append(requestBytes, 0, byte(len(clientId)))
		requestBytes = append(requestBytes, []byte(clientId)...)
		// key: "my-group"
		key := "my-group"
		requestBytes = append(requestBytes, 0, byte(len(key)))
		requestBytes = append(requestBytes, []byte(key)...)

		result, err := mod.Apply(requestBytes)
		require.NoError(t, err)

		// Decode and verify
		schema, err := getFindCoordinatorRequestSchema(0)
		require.NoError(t, err)
		decoded, err := DecodeSchema(result, schema)
		require.NoError(t, err)

		resultKey := decoded.Get("key").(string)
		assert.Equal(t, prefix+"my-group", resultKey)
	})

	t.Run("FindCoordinator v1 with group key_type", func(t *testing.T) {
		mod, err := GetRequestModifier(apiKeyFindCoordinator, 1, requestCfg)
		require.NoError(t, err)
		require.NotNil(t, mod)

		var requestBytes []byte
		// correlation_id: 1
		requestBytes = append(requestBytes, 0, 0, 0, 1)
		// client_id: "test-client"
		clientId := "test-client"
		requestBytes = append(requestBytes, 0, byte(len(clientId)))
		requestBytes = append(requestBytes, []byte(clientId)...)
		// key: "my-group"
		key := "my-group"
		requestBytes = append(requestBytes, 0, byte(len(key)))
		requestBytes = append(requestBytes, []byte(key)...)
		// key_type: 0 (group)
		requestBytes = append(requestBytes, 0)

		result, err := mod.Apply(requestBytes)
		require.NoError(t, err)

		// Decode and verify
		schema, err := getFindCoordinatorRequestSchema(1)
		require.NoError(t, err)
		decoded, err := DecodeSchema(result, schema)
		require.NoError(t, err)

		resultKey := decoded.Get("key").(string)
		assert.Equal(t, prefix+"my-group", resultKey)
	})

	t.Run("FindCoordinator v1 with transaction key_type", func(t *testing.T) {
		mod, err := GetRequestModifier(apiKeyFindCoordinator, 1, requestCfg)
		require.NoError(t, err)
		require.NotNil(t, mod)

		var requestBytes []byte
		// correlation_id: 1
		requestBytes = append(requestBytes, 0, 0, 0, 1)
		// client_id: "test-client"
		clientId := "test-client"
		requestBytes = append(requestBytes, 0, byte(len(clientId)))
		requestBytes = append(requestBytes, []byte(clientId)...)
		// key: "my-txn"
		key := "my-txn"
		requestBytes = append(requestBytes, 0, byte(len(key)))
		requestBytes = append(requestBytes, []byte(key)...)
		// key_type: 1 (transaction)
		requestBytes = append(requestBytes, 1)

		result, err := mod.Apply(requestBytes)
		require.NoError(t, err)

		// Decode and verify
		schema, err := getFindCoordinatorRequestSchema(1)
		require.NoError(t, err)
		decoded, err := DecodeSchema(result, schema)
		require.NoError(t, err)

		resultKey := decoded.Get("key").(string)
		assert.Equal(t, "txn:my-txn", resultKey)
	})
}

// TestMultiTenantIsolation verifies that group filtering properly isolates tenants
func TestMultiTenantIsolation(t *testing.T) {
	tenant1Prefix := "tenant1:"
	tenant2Prefix := "tenant2:"

	tenant1ResponseCfg := ResponseModifierConfig{
		GroupUnprefixer: func(group string) string {
			return strings.TrimPrefix(group, tenant1Prefix)
		},
		GroupFilter: func(group string) bool {
			return strings.HasPrefix(group, tenant1Prefix)
		},
	}

	t.Run("Tenant1 only sees their groups in ListGroups", func(t *testing.T) {
		mod, err := GetResponseModifierWithConfig(apiKeyListGroups, 0, tenant1ResponseCfg)
		require.NoError(t, err)
		require.NotNil(t, mod)

		// Build ListGroups response with groups from both tenants
		var responseBytes []byte
		// error_code: 0
		responseBytes = append(responseBytes, 0, 0)
		// groups array: 4 elements
		responseBytes = append(responseBytes, 0, 0, 0, 4)

		// Add groups from both tenants
		groups := []struct {
			id           string
			protocolType string
		}{
			{tenant1Prefix + "group-a", "consumer"},
			{tenant2Prefix + "group-b", "consumer"},
			{tenant1Prefix + "group-c", "consumer"},
			{tenant2Prefix + "group-d", "consumer"},
		}

		for _, g := range groups {
			responseBytes = append(responseBytes, 0, byte(len(g.id)))
			responseBytes = append(responseBytes, []byte(g.id)...)
			responseBytes = append(responseBytes, 0, byte(len(g.protocolType)))
			responseBytes = append(responseBytes, []byte(g.protocolType)...)
		}

		result, err := mod.Apply(responseBytes)
		require.NoError(t, err)

		// Decode and verify only tenant1's groups are visible
		schema := listGroupsResponseSchemas[0]
		decoded, err := DecodeSchema(result, schema)
		require.NoError(t, err)

		resultGroups := decoded.Get("groups").([]interface{})
		require.Len(t, resultGroups, 2, "tenant1 should only see 2 groups")

		// Verify the groups are unprefixed
		group1 := resultGroups[0].(*Struct).Get("group_id").(string)
		group2 := resultGroups[1].(*Struct).Get("group_id").(string)
		assert.Equal(t, "group-a", group1)
		assert.Equal(t, "group-c", group2)

		// Verify tenant2's groups are NOT visible
		for _, g := range resultGroups {
			groupId := g.(*Struct).Get("group_id").(string)
			assert.False(t, strings.HasPrefix(groupId, tenant2Prefix), "tenant2's groups should not be visible")
			assert.False(t, strings.Contains(groupId, "group-b"), "tenant2's group-b should not be visible")
			assert.False(t, strings.Contains(groupId, "group-d"), "tenant2's group-d should not be visible")
		}
	})
}
