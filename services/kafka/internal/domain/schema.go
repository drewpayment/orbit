package domain

import (
	"time"

	"github.com/google/uuid"
)

// SchemaFormat represents the schema serialization format
type SchemaFormat string

const (
	SchemaFormatAvro     SchemaFormat = "avro"
	SchemaFormatProtobuf SchemaFormat = "protobuf"
	SchemaFormatJSON     SchemaFormat = "json"
)

// SchemaCompatibility represents schema evolution compatibility
type SchemaCompatibility string

const (
	SchemaCompatibilityBackward SchemaCompatibility = "backward"
	SchemaCompatibilityForward  SchemaCompatibility = "forward"
	SchemaCompatibilityFull     SchemaCompatibility = "full"
	SchemaCompatibilityNone     SchemaCompatibility = "none"
)

// SchemaType represents whether this is a key or value schema
type SchemaType string

const (
	SchemaTypeKey   SchemaType = "key"
	SchemaTypeValue SchemaType = "value"
)

// SchemaStatus represents the registration state
type SchemaStatus string

const (
	SchemaStatusPending    SchemaStatus = "pending"
	SchemaStatusRegistered SchemaStatus = "registered"
	SchemaStatusFailed     SchemaStatus = "failed"
)

// KafkaSchema represents a schema registered for a topic
type KafkaSchema struct {
	ID            uuid.UUID           `json:"id"`
	WorkspaceID   uuid.UUID           `json:"workspaceId"`
	TopicID       uuid.UUID           `json:"topicId"`
	Type          SchemaType          `json:"type"`
	Subject       string              `json:"subject"`
	Format        SchemaFormat        `json:"format"`
	Content       string              `json:"content"`
	Version       int                 `json:"version"`
	SchemaID      int                 `json:"schemaId"`
	Compatibility SchemaCompatibility `json:"compatibility"`
	Status        SchemaStatus        `json:"status"`
	CreatedAt     time.Time           `json:"createdAt"`
	UpdatedAt     time.Time           `json:"updatedAt"`
}

// NewKafkaSchema creates a new schema
func NewKafkaSchema(workspaceID, topicID uuid.UUID, schemaType SchemaType, format SchemaFormat, content string) *KafkaSchema {
	now := time.Now()
	return &KafkaSchema{
		ID:            uuid.New(),
		WorkspaceID:   workspaceID,
		TopicID:       topicID,
		Type:          schemaType,
		Format:        format,
		Content:       content,
		Compatibility: SchemaCompatibilityBackward,
		Status:        SchemaStatusPending,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
}

// GenerateSubject creates the subject name from template
func (s *KafkaSchema) GenerateSubject(environment, workspaceName, topicName string) string {
	// Format: {env}.{workspace}.{topic}-{key|value}
	return environment + "." + workspaceName + "." + topicName + "-" + string(s.Type)
}

// MarkRegistered marks the schema as successfully registered
func (s *KafkaSchema) MarkRegistered(schemaID, version int) {
	s.SchemaID = schemaID
	s.Version = version
	s.Status = SchemaStatusRegistered
	s.UpdatedAt = time.Now()
}

// MarkFailed marks the schema registration as failed
func (s *KafkaSchema) MarkFailed() {
	s.Status = SchemaStatusFailed
	s.UpdatedAt = time.Now()
}

// SchemaRegistry represents the centralized schema registry config
type SchemaRegistry struct {
	ID                    uuid.UUID                          `json:"id"`
	URL                   string                             `json:"url"`
	SubjectNamingTemplate string                             `json:"subjectNamingTemplate"`
	DefaultCompatibility  SchemaCompatibility                `json:"defaultCompatibility"`
	EnvironmentOverrides  []EnvironmentCompatibilityOverride `json:"environmentOverrides"`
	CreatedAt             time.Time                          `json:"createdAt"`
	UpdatedAt             time.Time                          `json:"updatedAt"`
}

// EnvironmentCompatibilityOverride allows per-env compatibility settings
type EnvironmentCompatibilityOverride struct {
	Environment   string              `json:"environment"`
	Compatibility SchemaCompatibility `json:"compatibility"`
}
