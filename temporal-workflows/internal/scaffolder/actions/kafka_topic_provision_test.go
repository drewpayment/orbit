package actions

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/drewpayment/orbit/temporal-workflows/internal/scaffolder"
	"github.com/drewpayment/orbit/temporal-workflows/internal/services"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- fakes -------------------------------------------------------------------

type fakeKafkaTopicClient struct {
	doc services.KafkaTopicDoc
	err error

	gotInput services.KafkaTopicCreateInput
	calls    int
}

func (f *fakeKafkaTopicClient) CreateTopic(_ context.Context, in services.KafkaTopicCreateInput) (services.KafkaTopicDoc, error) {
	f.calls++
	f.gotInput = in
	if f.err != nil {
		return services.KafkaTopicDoc{}, f.err
	}
	return f.doc, nil
}

type fakeKafkaProvisioner struct {
	provisionOut *activities.KafkaTopicProvisionOutput
	provisionErr error

	gotProvisionInput activities.KafkaTopicProvisionInput
	provisionCalls    int

	updateCalls []activities.KafkaUpdateTopicStatusInput
	updateErr   error
}

func (f *fakeKafkaProvisioner) ProvisionTopic(_ context.Context, input activities.KafkaTopicProvisionInput) (*activities.KafkaTopicProvisionOutput, error) {
	f.provisionCalls++
	f.gotProvisionInput = input
	if f.provisionErr != nil {
		return nil, f.provisionErr
	}
	return f.provisionOut, nil
}

func (f *fakeKafkaProvisioner) UpdateTopicStatus(_ context.Context, input activities.KafkaUpdateTopicStatusInput) error {
	f.updateCalls = append(f.updateCalls, input)
	return f.updateErr
}

// --- tests ---------------------------------------------------------------------

func TestKafkaTopicProvision_Execute_Success(t *testing.T) {
	topics := &fakeKafkaTopicClient{doc: services.KafkaTopicDoc{ID: "topic-1", Status: "provisioning"}}
	provisioner := &fakeKafkaProvisioner{provisionOut: &activities.KafkaTopicProvisionOutput{
		TopicID:      "topic-1",
		PhysicalName: "dev.acme.orders",
	}}
	a := NewKafkaTopicProvision(topics, provisioner)

	rc := runCtx()
	rc.WorkspaceID = "ws-1"

	raw, err := a.Execute(context.Background(), rc, json.RawMessage(`{"name":"orders","virtualClusterId":"vc-1","owner":"team-payments"}`))
	require.NoError(t, err)

	var out kafkaTopicProvisionOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, "topic-1", out.TopicID)
	assert.Equal(t, "orders", out.TopicName)
	assert.Equal(t, "dev.acme.orders", out.PhysicalName)
	assert.Equal(t, "vc-1", out.ClusterID)

	// Workspace comes from rc, never from input.
	assert.Equal(t, "ws-1", topics.gotInput.WorkspaceID)
	assert.Equal(t, "vc-1", topics.gotInput.VirtualClusterID)
	assert.Equal(t, "orders", topics.gotInput.Name)
	assert.Equal(t, "team-payments", topics.gotInput.Owner)
	assert.Equal(t, 3, topics.gotInput.Partitions) // default

	assert.Equal(t, "topic-1", provisioner.gotProvisionInput.TopicID)
	assert.Equal(t, "vc-1", provisioner.gotProvisionInput.VirtualClusterID)
	assert.Equal(t, "orders", provisioner.gotProvisionInput.TopicName)
	assert.Equal(t, 3, provisioner.gotProvisionInput.Partitions)

	// Marked active with the physical name on success.
	require.Len(t, provisioner.updateCalls, 1)
	assert.Equal(t, "active", provisioner.updateCalls[0].Status)
	assert.Equal(t, "dev.acme.orders", provisioner.updateCalls[0].PhysicalName)
}

func TestKafkaTopicProvision_Execute_CustomPartitionsAndRetention(t *testing.T) {
	topics := &fakeKafkaTopicClient{doc: services.KafkaTopicDoc{ID: "topic-1", Status: "provisioning"}}
	provisioner := &fakeKafkaProvisioner{provisionOut: &activities.KafkaTopicProvisionOutput{PhysicalName: "dev.acme.orders"}}
	a := NewKafkaTopicProvision(topics, provisioner)

	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(
		`{"name":"orders","virtualClusterId":"vc-1","owner":"team-payments","partitions":12,"retentionMs":86400000}`))
	require.NoError(t, err)

	assert.Equal(t, 12, topics.gotInput.Partitions)
	assert.Equal(t, int64(86400000), topics.gotInput.RetentionMs)
	assert.Equal(t, 12, provisioner.gotProvisionInput.Partitions)
	assert.Equal(t, int64(86400000), provisioner.gotProvisionInput.RetentionMs)
}

func TestKafkaTopicProvision_Execute_MissingRequiredFields(t *testing.T) {
	a := NewKafkaTopicProvision(&fakeKafkaTopicClient{}, &fakeKafkaProvisioner{})
	for _, input := range []string{
		`{"virtualClusterId":"vc-1","owner":"team-payments"}`,
		`{"name":"orders","owner":"team-payments"}`,
		`{"name":"orders","virtualClusterId":"vc-1"}`,
		`{}`,
	} {
		_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(input))
		require.Error(t, err, input)
		assert.True(t, errors.Is(err, scaffolder.ErrInvalidInput), "expected ErrInvalidInput for %s, got %v", input, err)
	}
}

func TestKafkaTopicProvision_Execute_ClusterNotFound(t *testing.T) {
	topics := &fakeKafkaTopicClient{err: services.ErrKafkaVirtualClusterNotFound}
	provisioner := &fakeKafkaProvisioner{}
	a := NewKafkaTopicProvision(topics, provisioner)

	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(`{"name":"orders","virtualClusterId":"missing","owner":"team-payments"}`))
	require.Error(t, err)
	assert.True(t, errors.Is(err, scaffolder.ErrInvalidInput))
	assert.Equal(t, 0, provisioner.provisionCalls, "must not attempt to provision when the topic row could not be created")
}

func TestKafkaTopicProvision_Execute_ProvisioningFailureMarksRowFailed(t *testing.T) {
	topics := &fakeKafkaTopicClient{doc: services.KafkaTopicDoc{ID: "topic-1", Status: "provisioning"}}
	provisioner := &fakeKafkaProvisioner{provisionErr: errors.New("kafka unreachable")}
	a := NewKafkaTopicProvision(topics, provisioner)

	_, err := a.Execute(context.Background(), runCtx(), json.RawMessage(`{"name":"orders","virtualClusterId":"vc-1","owner":"team-payments"}`))
	require.Error(t, err)
	assert.False(t, errors.Is(err, scaffolder.ErrInvalidInput), "a transient provisioning failure must stay retryable")

	require.Len(t, provisioner.updateCalls, 1)
	assert.Equal(t, "topic-1", provisioner.updateCalls[0].TopicID)
	assert.Equal(t, "failed", provisioner.updateCalls[0].Status)
	assert.Contains(t, provisioner.updateCalls[0].Error, "kafka unreachable")
}

func TestKafkaTopicProvision_Execute_IdempotentWhenAlreadyActive(t *testing.T) {
	topics := &fakeKafkaTopicClient{doc: services.KafkaTopicDoc{ID: "topic-1", Status: "active", FullTopicName: "dev.acme.orders"}}
	provisioner := &fakeKafkaProvisioner{}
	a := NewKafkaTopicProvision(topics, provisioner)

	raw, err := a.Execute(context.Background(), runCtx(), json.RawMessage(`{"name":"orders","virtualClusterId":"vc-1","owner":"team-payments"}`))
	require.NoError(t, err)

	var out kafkaTopicProvisionOutput
	require.NoError(t, json.Unmarshal(raw, &out))
	assert.Equal(t, "dev.acme.orders", out.PhysicalName)
	assert.Equal(t, 0, provisioner.provisionCalls, "must not re-provision an already-active topic")
	assert.Empty(t, provisioner.updateCalls)
}

func TestKafkaTopicProvision_Plan_NoIO(t *testing.T) {
	topics := &fakeKafkaTopicClient{}
	provisioner := &fakeKafkaProvisioner{}
	a := NewKafkaTopicProvision(topics, provisioner)

	changes, err := a.Plan(context.Background(), runCtx(), json.RawMessage(`{"name":"orders","virtualClusterId":"vc-1","owner":"team-payments"}`))
	require.NoError(t, err)
	require.Len(t, changes, 1)
	assert.Equal(t, "topic", changes[0].Kind)
	assert.Equal(t, "orders", changes[0].Name)

	assert.Equal(t, 0, topics.calls)
	assert.Equal(t, 0, provisioner.provisionCalls)
}

func TestKafkaTopicProvision_Plan_MissingRequiredFields(t *testing.T) {
	a := NewKafkaTopicProvision(&fakeKafkaTopicClient{}, &fakeKafkaProvisioner{})
	_, err := a.Plan(context.Background(), runCtx(), json.RawMessage(`{"name":"orders"}`))
	require.Error(t, err)
	assert.True(t, errors.Is(err, scaffolder.ErrInvalidInput))
}

func TestKafkaTopicProvision_Descriptor(t *testing.T) {
	a := NewKafkaTopicProvision(nil, nil)
	assert.Equal(t, "kafka:topic:provision", a.Name())
	assert.NotEmpty(t, a.InputSchema())
	assert.NotEmpty(t, a.OutputSchema())
}
