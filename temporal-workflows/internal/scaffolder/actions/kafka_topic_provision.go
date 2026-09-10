package actions

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
)

//go:embed kafka_topic_provision.input.schema.json
var kafkaTopicProvisionInputSchema []byte

//go:embed kafka_topic_provision.output.schema.json
var kafkaTopicProvisionOutputSchema []byte

const (
	kafkaTopicDefaultPartitions        = 3
	kafkaTopicDefaultReplicationFactor = 3
	kafkaTopicDefaultEnvironment       = "dev"
	kafkaTopicStatusActive             = "active"
	kafkaTopicStatusFailed             = "failed"
)

// KafkaTopicProvision creates a governed kafka-topics row and provisions the
// physical topic in one step: it wraps KafkaTopicClient.CreateTopic
// (idempotent on workspace+cluster+name) followed by
// KafkaProvisioner.ProvisionTopic (a plain method call against
// activities.KafkaActivitiesImpl, not a nested Temporal activity dispatch).
type KafkaTopicProvision struct {
	topics      KafkaTopicClient
	provisioner KafkaProvisioner
}

// NewKafkaTopicProvision constructs the kafka:topic:provision action.
func NewKafkaTopicProvision(topics KafkaTopicClient, provisioner KafkaProvisioner) *KafkaTopicProvision {
	return &KafkaTopicProvision{topics: topics, provisioner: provisioner}
}

type kafkaTopicProvisionInput struct {
	Name             string `json:"name"`
	VirtualClusterID string `json:"virtualClusterId"`
	Owner            string `json:"owner"`
	Partitions       int    `json:"partitions"`
	RetentionMs      int64  `json:"retentionMs"`
	Description      string `json:"description"`
	Environment      string `json:"environment"`
}

type kafkaTopicProvisionOutput struct {
	TopicID      string `json:"topicId"`
	TopicName    string `json:"topicName"`
	PhysicalName string `json:"physicalName,omitempty"`
	ClusterID    string `json:"clusterId"`
}

// Name implements scaffolder.Action.
func (a *KafkaTopicProvision) Name() string { return "kafka:topic:provision" }

// InputSchema implements scaffolder.Action.
func (a *KafkaTopicProvision) InputSchema() json.RawMessage { return kafkaTopicProvisionInputSchema }

// OutputSchema implements scaffolder.Action.
func (a *KafkaTopicProvision) OutputSchema() json.RawMessage {
	return kafkaTopicProvisionOutputSchema
}

// Plan describes the topic that would be provisioned, without creating a
// Payload row or calling the Kafka cluster.
func (a *KafkaTopicProvision) Plan(_ context.Context, _ scaffolder.ActionRunContext, input json.RawMessage) ([]scaffolder.PlannedChange, error) {
	in, err := parseKafkaTopicProvisionInput(input)
	if err != nil {
		return nil, err
	}
	return []scaffolder.PlannedChange{{
		Kind:        "topic",
		Name:        in.Name,
		Description: fmt.Sprintf("would provision a governed Kafka topic %q on cluster %s owned by %s", in.Name, in.VirtualClusterID, in.Owner),
	}}, nil
}

// Execute creates the kafka-topics row (idempotently) and provisions the
// physical topic. On a provisioning failure the row is marked failed rather
// than left orphaned in pending/provisioning.
func (a *KafkaTopicProvision) Execute(ctx context.Context, rc scaffolder.ActionRunContext, input json.RawMessage) (json.RawMessage, error) {
	in, err := parseKafkaTopicProvisionInput(input)
	if err != nil {
		return nil, err
	}
	if a.topics == nil {
		return nil, fmt.Errorf("kafka:topic:provision: no kafka topic client configured")
	}
	if a.provisioner == nil {
		return nil, fmt.Errorf("kafka:topic:provision: no kafka provisioner configured")
	}

	rc.Heartbeat("kafka:topic:provision", in.Name)

	doc, err := a.topics.CreateTopic(ctx, services.KafkaTopicCreateInput{
		WorkspaceID:      rc.WorkspaceID,
		VirtualClusterID: in.VirtualClusterID,
		Name:             in.Name,
		Description:      in.Description,
		Environment:      in.Environment,
		Partitions:       in.Partitions,
		RetentionMs:      in.RetentionMs,
		Owner:            in.Owner,
	})
	if err != nil {
		if errors.Is(err, services.ErrKafkaVirtualClusterNotFound) {
			return nil, fmt.Errorf("kafka:topic:provision: %w: virtual cluster %q not found", scaffolder.ErrInvalidInput, in.VirtualClusterID)
		}
		return nil, fmt.Errorf("kafka:topic:provision: create topic record: %w", err)
	}

	// Idempotent short-circuit: a topic already active (provisioned by a
	// prior run, or a retried step that got this far last time) is returned
	// as-is without re-provisioning or touching its status.
	if doc.Status == kafkaTopicStatusActive {
		return json.Marshal(kafkaTopicProvisionOutput{
			TopicID:      doc.ID,
			TopicName:    in.Name,
			PhysicalName: doc.FullTopicName,
			ClusterID:    in.VirtualClusterID,
		})
	}

	provisionOutput, err := a.provisioner.ProvisionTopic(ctx, activities.KafkaTopicProvisionInput{
		TopicID:           doc.ID,
		VirtualClusterID:  in.VirtualClusterID,
		TopicName:         in.Name,
		Partitions:        in.Partitions,
		ReplicationFactor: kafkaTopicDefaultReplicationFactor,
		RetentionMs:       in.RetentionMs,
	})
	if err != nil {
		// Mark the row failed so a broken provisioning attempt never lingers
		// as an orphaned pending/provisioning row a human has to notice and
		// clean up by hand.
		if updateErr := a.provisioner.UpdateTopicStatus(ctx, activities.KafkaUpdateTopicStatusInput{
			TopicID: doc.ID,
			Status:  kafkaTopicStatusFailed,
			Error:   err.Error(),
		}); updateErr != nil {
			rc.Logger.Error("kafka:topic:provision: failed to mark topic row failed after a provisioning error",
				"topicId", doc.ID, "provisionErr", err, "updateErr", updateErr)
		}
		return nil, fmt.Errorf("kafka:topic:provision: provision topic: %w", err)
	}

	if err := a.provisioner.UpdateTopicStatus(ctx, activities.KafkaUpdateTopicStatusInput{
		TopicID:      doc.ID,
		Status:       kafkaTopicStatusActive,
		PhysicalName: provisionOutput.PhysicalName,
	}); err != nil {
		return nil, fmt.Errorf("kafka:topic:provision: mark topic active: %w", err)
	}

	return json.Marshal(kafkaTopicProvisionOutput{
		TopicID:      doc.ID,
		TopicName:    in.Name,
		PhysicalName: provisionOutput.PhysicalName,
		ClusterID:    in.VirtualClusterID,
	})
}

func parseKafkaTopicProvisionInput(raw json.RawMessage) (kafkaTopicProvisionInput, error) {
	in := kafkaTopicProvisionInput{
		Partitions:  kafkaTopicDefaultPartitions,
		Environment: kafkaTopicDefaultEnvironment,
	}
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return in, fmt.Errorf("kafka:topic:provision: %w: decode input: %v", scaffolder.ErrInvalidInput, err)
		}
	}
	if in.Partitions <= 0 {
		in.Partitions = kafkaTopicDefaultPartitions
	}
	if strings.TrimSpace(in.Environment) == "" {
		in.Environment = kafkaTopicDefaultEnvironment
	}
	for _, field := range []struct {
		name  string
		value string
	}{
		{"name", in.Name},
		{"virtualClusterId", in.VirtualClusterID},
		{"owner", in.Owner},
	} {
		if strings.TrimSpace(field.value) == "" {
			return in, fmt.Errorf("kafka:topic:provision: %w: `%s` is required", scaffolder.ErrInvalidInput, field.name)
		}
	}
	return in, nil
}
