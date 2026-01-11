package activities

import (
	"context"
	"time"
)

// UpdateShareStatusInput defines input for updating share status
type UpdateShareStatusInput struct {
	ShareID string `json:"shareId"`
	Status  string `json:"status"`
	Error   string `json:"error,omitempty"`
}

// UpsertTopicACLInput defines input for upserting topic ACLs to Bifrost gateway
type UpsertTopicACLInput struct {
	ShareID           string     `json:"shareId"`
	TopicPhysicalName string     `json:"topicPhysicalName"`
	CredentialID      string     `json:"credentialId"`
	Permissions       []string   `json:"permissions"`
	ExpiresAt         *time.Time `json:"expiresAt,omitempty"`
}

// UpsertTopicACLOutput defines output from upserting topic ACLs
type UpsertTopicACLOutput struct {
	Success     bool     `json:"success"`
	ACLsCreated []string `json:"aclsCreated,omitempty"`
}

// SendShareApprovedNotificationInput defines input for sending share approval notifications
type SendShareApprovedNotificationInput struct {
	ShareID         string `json:"shareId"`
	TopicOwnerEmail string `json:"topicOwnerEmail"`
	RequesterEmail  string `json:"requesterEmail"`
}

// RevokeTopicACLInput defines input for revoking topic ACLs from Bifrost gateway
type RevokeTopicACLInput struct {
	ShareID string `json:"shareId"`
}

// TopicShareActivities defines the interface for topic sharing activities
type TopicShareActivities interface {
	// UpdateShareStatus updates the share status in the database
	UpdateShareStatus(ctx context.Context, input UpdateShareStatusInput) error

	// UpsertTopicACL pushes an ACL to the Bifrost gateway for cross-app access
	UpsertTopicACL(ctx context.Context, input UpsertTopicACLInput) (UpsertTopicACLOutput, error)

	// SendShareApprovedNotification sends email/in-app notifications for approved shares
	SendShareApprovedNotification(ctx context.Context, input SendShareApprovedNotificationInput) error

	// RevokeTopicACL removes an ACL from the Bifrost gateway
	RevokeTopicACL(ctx context.Context, input RevokeTopicACLInput) error
}

// TopicShareActivitiesImpl implements TopicShareActivities
type TopicShareActivitiesImpl struct {
	// Dependencies will be added in Task 7
	// bifrostClient  *bifrost.Client
	// payloadClient  *payload.Client
	// emailService   *email.Service
}

// NewTopicShareActivities creates a new TopicShareActivities implementation
func NewTopicShareActivities() *TopicShareActivitiesImpl {
	return &TopicShareActivitiesImpl{}
}

// UpdateShareStatus updates the share status in Payload CMS
func (a *TopicShareActivitiesImpl) UpdateShareStatus(ctx context.Context, input UpdateShareStatusInput) error {
	// TODO: Implement in Task 7
	// This would call the Payload CMS API to update KafkaTopicShares status
	return nil
}

// UpsertTopicACL pushes an ACL to the Bifrost gateway
func (a *TopicShareActivitiesImpl) UpsertTopicACL(ctx context.Context, input UpsertTopicACLInput) (UpsertTopicACLOutput, error) {
	// TODO: Implement in Task 7
	// This would call the Bifrost admin gRPC API to upsert the ACL
	return UpsertTopicACLOutput{
		Success:     true,
		ACLsCreated: []string{input.ShareID},
	}, nil
}

// SendShareApprovedNotification sends notifications for approved shares
func (a *TopicShareActivitiesImpl) SendShareApprovedNotification(ctx context.Context, input SendShareApprovedNotificationInput) error {
	// TODO: Implement in Task 7
	// This would send email and/or in-app notifications
	return nil
}

// RevokeTopicACL removes an ACL from the Bifrost gateway
func (a *TopicShareActivitiesImpl) RevokeTopicACL(ctx context.Context, input RevokeTopicACLInput) error {
	// TODO: Implement in Task 7
	// This would call the Bifrost admin gRPC API to revoke the ACL
	return nil
}
