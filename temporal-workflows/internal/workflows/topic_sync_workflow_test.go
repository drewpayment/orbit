package workflows

import (
	"testing"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/testsuite"
)

type TopicSyncWorkflowTestSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
	env *testsuite.TestWorkflowEnvironment
}

func (s *TopicSyncWorkflowTestSuite) SetupTest() {
	s.env = s.NewTestWorkflowEnvironment()

	// Register stub activities for testing - using the same stubs defined in the workflow file
	s.env.RegisterActivity(createTopicRecordActivityStub)
	s.env.RegisterActivity(markTopicDeletedActivityStub)
	s.env.RegisterActivity(updateTopicConfigActivityStub)
}

func (s *TopicSyncWorkflowTestSuite) AfterTest(suiteName, testName string) {
	s.env.AssertExpectations(s.T())
}

func TestTopicSyncWorkflowTestSuite(t *testing.T) {
	suite.Run(t, new(TopicSyncWorkflowTestSuite))
}

// TestTopicCreatedSyncWorkflow_Success tests successful topic creation sync
func (s *TopicSyncWorkflowTestSuite) TestTopicCreatedSyncWorkflow_Success() {
	input := TopicCreatedSyncInput{
		VirtualClusterID:      "vc-123",
		VirtualName:           "my-topic",
		PhysicalName:          "vc123_my-topic",
		Partitions:            3,
		ReplicationFactor:     2,
		Config:                map[string]string{"retention.ms": "86400000"},
		CreatedByCredentialID: "cred-456",
	}

	expectedOutput := activities.CreateTopicRecordOutput{
		TopicID: "topic-789",
		Status:  "active",
	}

	// Mock CreateTopicRecord activity
	s.env.OnActivity(createTopicRecordActivityStub, mock.Anything, mock.MatchedBy(func(in activities.CreateTopicRecordInput) bool {
		return in.VirtualClusterID == "vc-123" &&
			in.VirtualName == "my-topic" &&
			in.PhysicalName == "vc123_my-topic" &&
			in.Partitions == 3 &&
			in.ReplicationFactor == 2
	})).Return(&expectedOutput, nil)

	s.env.ExecuteWorkflow(TopicCreatedSyncWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result TopicCreatedSyncResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.Equal("topic-789", result.TopicID)
	s.Equal("active", result.Status)
	s.Empty(result.Error)
}

// TestTopicCreatedSyncWorkflow_WithConfig tests topic creation with configuration
func (s *TopicSyncWorkflowTestSuite) TestTopicCreatedSyncWorkflow_WithConfig() {
	input := TopicCreatedSyncInput{
		VirtualClusterID:      "vc-123",
		VirtualName:           "configured-topic",
		PhysicalName:          "vc123_configured-topic",
		Partitions:            6,
		ReplicationFactor:     3,
		Config: map[string]string{
			"retention.ms":      "604800000",
			"cleanup.policy":    "compact",
			"compression.type":  "lz4",
			"max.message.bytes": "1048576",
		},
		CreatedByCredentialID: "cred-789",
	}

	expectedOutput := activities.CreateTopicRecordOutput{
		TopicID: "topic-configured",
		Status:  "active",
	}

	// Mock CreateTopicRecord activity
	s.env.OnActivity(createTopicRecordActivityStub, mock.Anything, mock.MatchedBy(func(in activities.CreateTopicRecordInput) bool {
		return in.VirtualClusterID == "vc-123" &&
			in.VirtualName == "configured-topic" &&
			len(in.Config) == 4
	})).Return(&expectedOutput, nil)

	s.env.ExecuteWorkflow(TopicCreatedSyncWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result TopicCreatedSyncResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.Equal("topic-configured", result.TopicID)
	s.Equal("active", result.Status)
}

// TestTopicDeletedSyncWorkflow_Success tests successful topic deletion sync
func (s *TopicSyncWorkflowTestSuite) TestTopicDeletedSyncWorkflow_Success() {
	input := TopicDeletedSyncInput{
		VirtualClusterID:      "vc-123",
		VirtualName:           "deleted-topic",
		PhysicalName:          "vc123_deleted-topic",
		DeletedByCredentialID: "cred-delete",
	}

	// Mock MarkTopicDeleted activity
	s.env.OnActivity(markTopicDeletedActivityStub, mock.Anything, mock.MatchedBy(func(in activities.MarkTopicDeletedInput) bool {
		return in.VirtualClusterID == "vc-123" &&
			in.VirtualName == "deleted-topic" &&
			in.DeletedByCredentialID == "cred-delete"
	})).Return(nil)

	s.env.ExecuteWorkflow(TopicDeletedSyncWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result TopicDeletedSyncResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.True(result.Success)
	s.Empty(result.Error)
}

// TestTopicConfigSyncWorkflow_Success tests successful topic config sync
func (s *TopicSyncWorkflowTestSuite) TestTopicConfigSyncWorkflow_Success() {
	input := TopicConfigSyncInput{
		VirtualClusterID: "vc-123",
		VirtualName:      "config-topic",
		Config: map[string]string{
			"retention.ms":   "172800000",
			"cleanup.policy": "delete",
		},
		UpdatedByCredentialID: "cred-update",
	}

	// Mock UpdateTopicConfig activity
	s.env.OnActivity(updateTopicConfigActivityStub, mock.Anything, mock.MatchedBy(func(in activities.UpdateTopicConfigInput) bool {
		return in.VirtualClusterID == "vc-123" &&
			in.VirtualName == "config-topic" &&
			in.Config["retention.ms"] == "172800000"
	})).Return(nil)

	s.env.ExecuteWorkflow(TopicConfigSyncWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())
}

// TestTopicConfigSyncWorkflow_MultipleConfigChanges tests config sync with multiple changes
func (s *TopicSyncWorkflowTestSuite) TestTopicConfigSyncWorkflow_MultipleConfigChanges() {
	input := TopicConfigSyncInput{
		VirtualClusterID: "vc-456",
		VirtualName:      "multi-config-topic",
		Config: map[string]string{
			"retention.ms":        "259200000",
			"cleanup.policy":      "compact,delete",
			"compression.type":    "zstd",
			"max.message.bytes":   "2097152",
			"min.insync.replicas": "2",
		},
		UpdatedByCredentialID: "cred-multi",
	}

	// Mock UpdateTopicConfig activity
	s.env.OnActivity(updateTopicConfigActivityStub, mock.Anything, mock.MatchedBy(func(in activities.UpdateTopicConfigInput) bool {
		return in.VirtualClusterID == "vc-456" &&
			len(in.Config) == 5
	})).Return(nil)

	s.env.ExecuteWorkflow(TopicConfigSyncWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())
}
