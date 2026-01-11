package workflows

import (
	"testing"
	"time"

	"github.com/drewpayment/orbit/temporal-workflows/internal/activities"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

type TopicShareWorkflowTestSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
	env *testsuite.TestWorkflowEnvironment
}

func (s *TopicShareWorkflowTestSuite) SetupTest() {
	s.env = s.NewTestWorkflowEnvironment()
}

func (s *TopicShareWorkflowTestSuite) AfterTest(suiteName, testName string) {
	s.env.AssertExpectations(s.T())
}

func TestTopicShareWorkflowTestSuite(t *testing.T) {
	suite.Run(t, new(TopicShareWorkflowTestSuite))
}

// TestTopicShareApprovedWorkflow_Success tests successful topic share approval workflow
func (s *TopicShareWorkflowTestSuite) TestTopicShareApprovedWorkflow_Success() {
	expiresAt := time.Now().Add(24 * time.Hour)
	input := TopicShareApprovedInput{
		ShareID:           "share-123",
		TopicPhysicalName: "vc123_my-topic",
		CredentialID:      "cred-456",
		Permissions:       []string{"read", "write"},
		ExpiresAt:         &expiresAt,
		ApprovedBy:        "user-789",
		TopicOwnerEmail:   "owner@example.com",
		RequesterEmail:    "requester@example.com",
	}

	var topicShareActivities *activities.TopicShareActivitiesImpl

	// Step 1: Mock UpdateShareStatus to "provisioning"
	s.env.OnActivity(topicShareActivities.UpdateShareStatus, mock.Anything, mock.MatchedBy(func(in activities.UpdateShareStatusInput) bool {
		return in.ShareID == "share-123" && in.Status == "provisioning"
	})).Return(nil).Once()

	// Step 2: Mock UpsertTopicACL
	s.env.OnActivity(topicShareActivities.UpsertTopicACL, mock.Anything, mock.MatchedBy(func(in activities.UpsertTopicACLInput) bool {
		return in.TopicPhysicalName == "vc123_my-topic" &&
			in.CredentialID == "cred-456" &&
			len(in.Permissions) == 2
	})).Return(activities.UpsertTopicACLOutput{Success: true}, nil).Once()

	// Step 3: Mock UpdateShareStatus to "approved"
	s.env.OnActivity(topicShareActivities.UpdateShareStatus, mock.Anything, mock.MatchedBy(func(in activities.UpdateShareStatusInput) bool {
		return in.ShareID == "share-123" && in.Status == "approved"
	})).Return(nil).Once()

	// Step 4: Mock SendShareApprovedNotification (non-blocking)
	s.env.OnActivity(topicShareActivities.SendShareApprovedNotification, mock.Anything, mock.MatchedBy(func(in activities.SendShareApprovedNotificationInput) bool {
		return in.ShareID == "share-123" &&
			in.TopicOwnerEmail == "owner@example.com" &&
			in.RequesterEmail == "requester@example.com"
	})).Return(nil).Once()

	s.env.ExecuteWorkflow(TopicShareApprovedWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result TopicShareApprovedResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.True(result.Success)
	s.Equal("share-123", result.ShareID)
	s.Empty(result.Error)
}

// TestTopicShareApprovedWorkflow_ACLFailure tests workflow behavior when ACL upsert fails
func (s *TopicShareWorkflowTestSuite) TestTopicShareApprovedWorkflow_ACLFailure() {
	input := TopicShareApprovedInput{
		ShareID:           "share-fail",
		TopicPhysicalName: "vc123_fail-topic",
		CredentialID:      "cred-fail",
		Permissions:       []string{"read"},
		ApprovedBy:        "user-fail",
		TopicOwnerEmail:   "owner@example.com",
		RequesterEmail:    "requester@example.com",
	}

	var topicShareActivities *activities.TopicShareActivitiesImpl

	// Step 1: Mock UpdateShareStatus to "provisioning"
	s.env.OnActivity(topicShareActivities.UpdateShareStatus, mock.Anything, mock.MatchedBy(func(in activities.UpdateShareStatusInput) bool {
		return in.ShareID == "share-fail" && in.Status == "provisioning"
	})).Return(nil).Once()

	// Step 2: Mock UpsertTopicACL failure with non-retryable error to prevent retries in test
	s.env.OnActivity(topicShareActivities.UpsertTopicACL, mock.Anything, mock.Anything).
		Return(activities.UpsertTopicACLOutput{}, temporal.NewNonRetryableApplicationError("ACL upsert failed: connection timeout", "ACL_UPSERT_FAILED", nil)).Once()

	// Rollback: Mock UpdateShareStatus to "failed"
	s.env.OnActivity(topicShareActivities.UpdateShareStatus, mock.Anything, mock.MatchedBy(func(in activities.UpdateShareStatusInput) bool {
		return in.ShareID == "share-fail" && in.Status == "failed"
	})).Return(nil).Once()

	s.env.ExecuteWorkflow(TopicShareApprovedWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result TopicShareApprovedResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.False(result.Success)
	s.Equal("share-fail", result.ShareID)
	s.Contains(result.Error, "ACL upsert failed")
}

// TestTopicShareApprovedWorkflow_NotificationFailureIgnored tests that notification failures don't break the workflow
func (s *TopicShareWorkflowTestSuite) TestTopicShareApprovedWorkflow_NotificationFailureIgnored() {
	input := TopicShareApprovedInput{
		ShareID:           "share-notify-fail",
		TopicPhysicalName: "vc123_notify-topic",
		CredentialID:      "cred-notify",
		Permissions:       []string{"read"},
		ApprovedBy:        "user-notify",
		TopicOwnerEmail:   "owner@example.com",
		RequesterEmail:    "requester@example.com",
	}

	var topicShareActivities *activities.TopicShareActivitiesImpl

	// Step 1: Mock UpdateShareStatus to "provisioning"
	s.env.OnActivity(topicShareActivities.UpdateShareStatus, mock.Anything, mock.MatchedBy(func(in activities.UpdateShareStatusInput) bool {
		return in.ShareID == "share-notify-fail" && in.Status == "provisioning"
	})).Return(nil).Once()

	// Step 2: Mock UpsertTopicACL
	s.env.OnActivity(topicShareActivities.UpsertTopicACL, mock.Anything, mock.Anything).
		Return(activities.UpsertTopicACLOutput{Success: true}, nil).Once()

	// Step 3: Mock UpdateShareStatus to "approved"
	s.env.OnActivity(topicShareActivities.UpdateShareStatus, mock.Anything, mock.MatchedBy(func(in activities.UpdateShareStatusInput) bool {
		return in.ShareID == "share-notify-fail" && in.Status == "approved"
	})).Return(nil).Once()

	// Step 4: Mock SendShareApprovedNotification failure (should be ignored)
	// Use non-retryable error to prevent retries in test
	s.env.OnActivity(topicShareActivities.SendShareApprovedNotification, mock.Anything, mock.Anything).
		Return(temporal.NewNonRetryableApplicationError("email service unavailable", "NOTIFICATION_FAILED", nil)).Once()

	s.env.ExecuteWorkflow(TopicShareApprovedWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result TopicShareApprovedResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.True(result.Success)
	s.Equal("share-notify-fail", result.ShareID)
	s.Empty(result.Error)
}

// TestTopicShareRevokedWorkflow_Success tests successful topic share revocation workflow
func (s *TopicShareWorkflowTestSuite) TestTopicShareRevokedWorkflow_Success() {
	input := TopicShareRevokedInput{
		ShareID: "share-revoke-123",
	}

	var topicShareActivities *activities.TopicShareActivitiesImpl

	// Step 1: Mock RevokeTopicACL
	s.env.OnActivity(topicShareActivities.RevokeTopicACL, mock.Anything, mock.MatchedBy(func(in activities.RevokeTopicACLInput) bool {
		return in.ShareID == "share-revoke-123"
	})).Return(nil).Once()

	// Step 2: Mock UpdateShareStatus to "revoked"
	s.env.OnActivity(topicShareActivities.UpdateShareStatus, mock.Anything, mock.MatchedBy(func(in activities.UpdateShareStatusInput) bool {
		return in.ShareID == "share-revoke-123" && in.Status == "revoked"
	})).Return(nil).Once()

	s.env.ExecuteWorkflow(TopicShareRevokedWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result TopicShareRevokedResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.True(result.Success)
	s.Empty(result.Error)
}

// TestTopicShareRevokedWorkflow_RevokeACLFailure tests workflow behavior when ACL revocation fails
func (s *TopicShareWorkflowTestSuite) TestTopicShareRevokedWorkflow_RevokeACLFailure() {
	input := TopicShareRevokedInput{
		ShareID: "share-revoke-fail",
	}

	var topicShareActivities *activities.TopicShareActivitiesImpl

	// Step 1: Mock RevokeTopicACL failure with non-retryable error to prevent retries in test
	s.env.OnActivity(topicShareActivities.RevokeTopicACL, mock.Anything, mock.Anything).
		Return(temporal.NewNonRetryableApplicationError("failed to revoke ACL: resource not found", "REVOKE_FAILED", nil)).Once()

	s.env.ExecuteWorkflow(TopicShareRevokedWorkflow, input)

	s.True(s.env.IsWorkflowCompleted())
	s.NoError(s.env.GetWorkflowError())

	var result TopicShareRevokedResult
	err := s.env.GetWorkflowResult(&result)
	s.NoError(err)
	s.False(result.Success)
	s.Contains(result.Error, "failed to revoke ACL")
}
