package contract

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	kafkapb "github.com/drewpayment/orbit/proto/gen/go/idp/kafka/v1"
)

const testAvroSchema = `{
	"type": "record",
	"name": "TestEvent",
	"namespace": "com.example",
	"fields": [
		{"name": "id", "type": "string"},
		{"name": "timestamp", "type": "long"},
		{"name": "payload", "type": "string"}
	]
}`

const testAvroSchemaV2 = `{
	"type": "record",
	"name": "TestEvent",
	"namespace": "com.example",
	"fields": [
		{"name": "id", "type": "string"},
		{"name": "timestamp", "type": "long"},
		{"name": "payload", "type": "string"},
		{"name": "version", "type": ["null", "int"], "default": null}
	]
}`

// TestRegisterSchema_Success tests successful schema registration
func TestRegisterSchema_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Create a topic first
	topicReq := &kafkapb.CreateTopicRequest{
		WorkspaceId: uuid.New().String(),
		Name:        "schema-test-topic-" + uuid.New().String()[:8],
		Environment: "development",
		Partitions:  1,
	}
	topicResp, err := client.CreateTopic(ctx, topicReq)
	require.NoError(t, err)

	// Register a schema
	req := &kafkapb.RegisterSchemaRequest{
		TopicId:       topicResp.Topic.Id,
		Type:          "value",
		Format:        kafkapb.SchemaFormat_SCHEMA_FORMAT_AVRO,
		Content:       testAvroSchema,
		Compatibility: kafkapb.SchemaCompatibility_SCHEMA_COMPATIBILITY_BACKWARD,
	}

	resp, err := client.RegisterSchema(ctx, req)
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Schema)

	assert.NotEmpty(t, resp.Schema.Id)
	assert.Equal(t, topicResp.Topic.Id, resp.Schema.TopicId)
	assert.Equal(t, "value", resp.Schema.Type)
	assert.Equal(t, kafkapb.SchemaFormat_SCHEMA_FORMAT_AVRO, resp.Schema.Format)
	assert.Equal(t, int32(1), resp.Schema.Version)
	assert.NotEmpty(t, resp.Schema.Subject)
}

// TestRegisterSchema_ValidationErrors tests schema validation
func TestRegisterSchema_ValidationErrors(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	testCases := []struct {
		name     string
		req      *kafkapb.RegisterSchemaRequest
		wantCode codes.Code
	}{
		{
			name: "missing topic ID",
			req: &kafkapb.RegisterSchemaRequest{
				Type:    "value",
				Format:  kafkapb.SchemaFormat_SCHEMA_FORMAT_AVRO,
				Content: testAvroSchema,
			},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "missing content",
			req: &kafkapb.RegisterSchemaRequest{
				TopicId: uuid.New().String(),
				Type:    "value",
				Format:  kafkapb.SchemaFormat_SCHEMA_FORMAT_AVRO,
			},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "invalid schema content",
			req: &kafkapb.RegisterSchemaRequest{
				TopicId: uuid.New().String(),
				Type:    "value",
				Format:  kafkapb.SchemaFormat_SCHEMA_FORMAT_AVRO,
				Content: "not valid avro",
			},
			wantCode: codes.InvalidArgument,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := client.RegisterSchema(ctx, tc.req)
			require.Error(t, err)
			assert.Nil(t, resp)

			st, ok := status.FromError(err)
			require.True(t, ok)
			assert.Equal(t, tc.wantCode, st.Code())
		})
	}
}

// TestCheckSchemaCompatibility_Compatible tests compatibility check for compatible schema
func TestCheckSchemaCompatibility_Compatible(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Create topic and register initial schema
	topicReq := &kafkapb.CreateTopicRequest{
		WorkspaceId: uuid.New().String(),
		Name:        "compat-test-topic-" + uuid.New().String()[:8],
		Environment: "development",
		Partitions:  1,
	}
	topicResp, err := client.CreateTopic(ctx, topicReq)
	require.NoError(t, err)

	// Register initial schema
	registerReq := &kafkapb.RegisterSchemaRequest{
		TopicId:       topicResp.Topic.Id,
		Type:          "value",
		Format:        kafkapb.SchemaFormat_SCHEMA_FORMAT_AVRO,
		Content:       testAvroSchema,
		Compatibility: kafkapb.SchemaCompatibility_SCHEMA_COMPATIBILITY_BACKWARD,
	}
	_, err = client.RegisterSchema(ctx, registerReq)
	require.NoError(t, err)

	// Check compatibility with backward compatible schema (added optional field)
	checkReq := &kafkapb.CheckSchemaCompatibilityRequest{
		TopicId: topicResp.Topic.Id,
		Type:    "value",
		Format:  kafkapb.SchemaFormat_SCHEMA_FORMAT_AVRO,
		Content: testAvroSchemaV2,
	}

	resp, err := client.CheckSchemaCompatibility(ctx, checkReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.True(t, resp.Compatible)
}

// TestCheckSchemaCompatibility_Incompatible tests compatibility check for incompatible schema
func TestCheckSchemaCompatibility_Incompatible(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Create topic and register initial schema
	topicReq := &kafkapb.CreateTopicRequest{
		WorkspaceId: uuid.New().String(),
		Name:        "incompat-test-topic-" + uuid.New().String()[:8],
		Environment: "development",
		Partitions:  1,
	}
	topicResp, err := client.CreateTopic(ctx, topicReq)
	require.NoError(t, err)

	// Register initial schema
	registerReq := &kafkapb.RegisterSchemaRequest{
		TopicId:       topicResp.Topic.Id,
		Type:          "value",
		Format:        kafkapb.SchemaFormat_SCHEMA_FORMAT_AVRO,
		Content:       testAvroSchema,
		Compatibility: kafkapb.SchemaCompatibility_SCHEMA_COMPATIBILITY_BACKWARD,
	}
	_, err = client.RegisterSchema(ctx, registerReq)
	require.NoError(t, err)

	// Check compatibility with incompatible schema (removed required field)
	incompatibleSchema := `{
		"type": "record",
		"name": "TestEvent",
		"namespace": "com.example",
		"fields": [
			{"name": "id", "type": "string"}
		]
	}`

	checkReq := &kafkapb.CheckSchemaCompatibilityRequest{
		TopicId: topicResp.Topic.Id,
		Type:    "value",
		Format:  kafkapb.SchemaFormat_SCHEMA_FORMAT_AVRO,
		Content: incompatibleSchema,
	}

	resp, err := client.CheckSchemaCompatibility(ctx, checkReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.False(t, resp.Compatible)
}

// TestListSchemas_Success tests listing schemas for a topic
func TestListSchemas_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Create topic
	topicReq := &kafkapb.CreateTopicRequest{
		WorkspaceId: uuid.New().String(),
		Name:        "list-schema-topic-" + uuid.New().String()[:8],
		Environment: "development",
		Partitions:  1,
	}
	topicResp, err := client.CreateTopic(ctx, topicReq)
	require.NoError(t, err)

	// Register key and value schemas
	for _, schemaType := range []string{"key", "value"} {
		registerReq := &kafkapb.RegisterSchemaRequest{
			TopicId: topicResp.Topic.Id,
			Type:    schemaType,
			Format:  kafkapb.SchemaFormat_SCHEMA_FORMAT_AVRO,
			Content: testAvroSchema,
		}
		_, err = client.RegisterSchema(ctx, registerReq)
		require.NoError(t, err)
	}

	// List schemas
	listReq := &kafkapb.ListSchemasRequest{
		TopicId: topicResp.Topic.Id,
	}

	resp, err := client.ListSchemas(ctx, listReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Len(t, resp.Schemas, 2)

	// Verify we have both key and value schemas
	types := make(map[string]bool)
	for _, schema := range resp.Schemas {
		types[schema.Type] = true
	}
	assert.True(t, types["key"])
	assert.True(t, types["value"])
}

// TestGetSchema_Success tests getting a specific schema
func TestGetSchema_Success(t *testing.T) {
	ctx := context.Background()
	client := getTestClient(t)

	// Create topic and register schema
	topicReq := &kafkapb.CreateTopicRequest{
		WorkspaceId: uuid.New().String(),
		Name:        "get-schema-topic-" + uuid.New().String()[:8],
		Environment: "development",
		Partitions:  1,
	}
	topicResp, err := client.CreateTopic(ctx, topicReq)
	require.NoError(t, err)

	registerReq := &kafkapb.RegisterSchemaRequest{
		TopicId: topicResp.Topic.Id,
		Type:    "value",
		Format:  kafkapb.SchemaFormat_SCHEMA_FORMAT_AVRO,
		Content: testAvroSchema,
	}
	registerResp, err := client.RegisterSchema(ctx, registerReq)
	require.NoError(t, err)

	// Get the schema
	getReq := &kafkapb.GetSchemaRequest{
		SchemaId: registerResp.Schema.Id,
	}

	resp, err := client.GetSchema(ctx, getReq)
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Schema)

	assert.Equal(t, registerResp.Schema.Id, resp.Schema.Id)
	assert.Equal(t, topicResp.Topic.Id, resp.Schema.TopicId)
	assert.Equal(t, kafkapb.SchemaFormat_SCHEMA_FORMAT_AVRO, resp.Schema.Format)
}
