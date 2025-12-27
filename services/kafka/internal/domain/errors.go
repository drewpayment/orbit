package domain

import "errors"

// Cluster errors
var (
	ErrClusterNotFound        = errors.New("cluster not found")
	ErrClusterNameRequired    = errors.New("cluster name is required")
	ErrClusterProviderRequired = errors.New("cluster provider is required")
	ErrClusterInvalidConfig   = errors.New("cluster configuration is invalid")
	ErrClusterConnectionFailed = errors.New("cluster connection failed")
)

// Topic errors
var (
	ErrTopicNotFound           = errors.New("topic not found")
	ErrTopicNameRequired       = errors.New("topic name is required")
	ErrTopicWorkspaceRequired  = errors.New("topic workspace is required")
	ErrTopicEnvironmentRequired = errors.New("topic environment is required")
	ErrTopicPartitionsInvalid  = errors.New("topic partitions must be at least 1")
	ErrTopicReplicationInvalid = errors.New("topic replication factor must be at least 1")
	ErrTopicAlreadyExists      = errors.New("topic already exists")
	ErrTopicCannotBeDeleted    = errors.New("topic cannot be deleted in current state")
	ErrTopicPendingApproval    = errors.New("topic is pending approval")
)

// Schema errors
var (
	ErrSchemaNotFound           = errors.New("schema not found")
	ErrSchemaContentRequired    = errors.New("schema content is required")
	ErrSchemaInvalidFormat      = errors.New("invalid schema format")
	ErrSchemaIncompatible       = errors.New("schema is incompatible with existing version")
	ErrSchemaRegistrationFailed = errors.New("schema registration failed")
)

// Service account errors
var (
	ErrServiceAccountNotFound          = errors.New("service account not found")
	ErrServiceAccountNameRequired      = errors.New("service account name is required")
	ErrServiceAccountWorkspaceRequired = errors.New("service account workspace is required")
	ErrServiceAccountRevoked           = errors.New("service account has been revoked")
)

// Share errors
var (
	ErrShareNotFound         = errors.New("share not found")
	ErrShareAlreadyExists    = errors.New("share already exists")
	ErrShareNotPending       = errors.New("share is not in pending state")
	ErrShareNotApproved      = errors.New("share is not approved")
	ErrShareExpired          = errors.New("share has expired")
	ErrShareSelfShare        = errors.New("cannot share topic with owning workspace")
)

// Policy errors
var (
	ErrPolicyNotFound       = errors.New("policy not found")
	ErrPolicyViolation      = errors.New("request violates policy")
	ErrPolicyNamingViolation = errors.New("topic name violates naming policy")
	ErrPolicyPartitionLimit = errors.New("partition count exceeds policy limit")
	ErrPolicyRetentionLimit = errors.New("retention period exceeds policy limit")
	ErrPolicySchemaRequired = errors.New("schema is required by policy")
	ErrPolicyApprovalRequired = errors.New("approval is required by policy")
)

// Environment mapping errors
var (
	ErrEnvironmentMappingNotFound = errors.New("environment mapping not found")
	ErrEnvironmentNotMapped       = errors.New("environment is not mapped to any cluster")
	ErrNoDefaultCluster           = errors.New("no default cluster for environment")
)

// Permission errors
var (
	ErrUnauthorized          = errors.New("unauthorized")
	ErrForbidden             = errors.New("forbidden")
	ErrNotWorkspaceMember    = errors.New("not a member of the workspace")
	ErrNotWorkspaceAdmin     = errors.New("not an admin of the workspace")
	ErrPlatformAdminRequired = errors.New("platform admin access required")
)
