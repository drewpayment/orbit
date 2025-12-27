package domain

import (
	"regexp"
	"time"

	"github.com/google/uuid"
)

// PolicyScope represents whether a policy is platform-wide or workspace-scoped
type PolicyScope string

const (
	PolicyScopePlatform  PolicyScope = "platform"
	PolicyScopeWorkspace PolicyScope = "workspace"
)

// TopicVisibility represents topic discoverability
type TopicVisibility string

const (
	TopicVisibilityPrivate      TopicVisibility = "private"
	TopicVisibilityDiscoverable TopicVisibility = "discoverable"
	TopicVisibilityPublic       TopicVisibility = "public"
)

// SharePolicyScope represents the scope of a share policy
type SharePolicyScope string

const (
	SharePolicyScopeAllTopics     SharePolicyScope = "all-topics"
	SharePolicyScopeTopicPattern  SharePolicyScope = "topic-pattern"
	SharePolicyScopeSpecificTopic SharePolicyScope = "specific-topic"
)

// PartitionLimits defines min/max partitions
type PartitionLimits struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

// RetentionLimits defines min/max retention in milliseconds
type RetentionLimits struct {
	MinMs int64 `json:"minMs"`
	MaxMs int64 `json:"maxMs"`
}

// KafkaTopicPolicy represents guardrails for topic creation
type KafkaTopicPolicy struct {
	ID                  uuid.UUID        `json:"id"`
	Scope               PolicyScope      `json:"scope"`
	WorkspaceID         *uuid.UUID       `json:"workspaceId"`
	Environment         string           `json:"environment"`
	NamingPattern       string           `json:"namingPattern"`
	AutoApprovePatterns []string         `json:"autoApprovePatterns"`
	PartitionLimits     *PartitionLimits `json:"partitionLimits"`
	RetentionLimits     *RetentionLimits `json:"retentionLimits"`
	RequireSchema       bool             `json:"requireSchema"`
	RequireApprovalFor  []string         `json:"requireApprovalFor"`
	CreatedAt           time.Time        `json:"createdAt"`
	UpdatedAt           time.Time        `json:"updatedAt"`
}

// NewPlatformPolicy creates a new platform-wide policy
func NewPlatformPolicy(environment string) *KafkaTopicPolicy {
	now := time.Now()
	return &KafkaTopicPolicy{
		ID:                  uuid.New(),
		Scope:               PolicyScopePlatform,
		Environment:         environment,
		AutoApprovePatterns: []string{},
		RequireApprovalFor:  []string{},
		CreatedAt:           now,
		UpdatedAt:           now,
	}
}

// NewWorkspacePolicy creates a new workspace-scoped policy
func NewWorkspacePolicy(workspaceID uuid.UUID, environment string) *KafkaTopicPolicy {
	now := time.Now()
	return &KafkaTopicPolicy{
		ID:                  uuid.New(),
		Scope:               PolicyScopeWorkspace,
		WorkspaceID:         &workspaceID,
		Environment:         environment,
		AutoApprovePatterns: []string{},
		RequireApprovalFor:  []string{},
		CreatedAt:           now,
		UpdatedAt:           now,
	}
}

// ValidateTopicName checks if a topic name matches the naming pattern
func (p *KafkaTopicPolicy) ValidateTopicName(name string) bool {
	if p.NamingPattern == "" {
		return true
	}
	re, err := regexp.Compile(p.NamingPattern)
	if err != nil {
		return false
	}
	return re.MatchString(name)
}

// ValidatePartitions checks if partition count is within limits
func (p *KafkaTopicPolicy) ValidatePartitions(partitions int) bool {
	if p.PartitionLimits == nil {
		return true
	}
	return partitions >= p.PartitionLimits.Min && partitions <= p.PartitionLimits.Max
}

// ValidateRetention checks if retention is within limits
func (p *KafkaTopicPolicy) ValidateRetention(retentionMs int64) bool {
	if p.RetentionLimits == nil {
		return true
	}
	return retentionMs >= p.RetentionLimits.MinMs && retentionMs <= p.RetentionLimits.MaxMs
}

// RequiresApproval checks if this environment requires approval
func (p *KafkaTopicPolicy) RequiresApproval(environment string) bool {
	for _, env := range p.RequireApprovalFor {
		if env == environment {
			return true
		}
	}
	return false
}

// CanAutoApprove checks if a topic name matches auto-approve patterns
func (p *KafkaTopicPolicy) CanAutoApprove(topicName string) bool {
	for _, pattern := range p.AutoApprovePatterns {
		re, err := regexp.Compile(pattern)
		if err != nil {
			continue
		}
		if re.MatchString(topicName) {
			return true
		}
	}
	return false
}

// AutoApproveConfig defines conditions for automatic share approval
type AutoApproveConfig struct {
	Environments       []string          `json:"environments"`
	Permissions        []SharePermission `json:"permissions"`
	WorkspaceWhitelist []uuid.UUID       `json:"workspaceWhitelist"`
	SameTenantOnly     bool              `json:"sameTenantOnly"`
}

// KafkaTopicSharePolicy represents rules for topic visibility and sharing
type KafkaTopicSharePolicy struct {
	ID                   uuid.UUID         `json:"id"`
	WorkspaceID          uuid.UUID         `json:"workspaceId"`
	Scope                SharePolicyScope  `json:"scope"`
	TopicPattern         string            `json:"topicPattern"`
	TopicID              *uuid.UUID        `json:"topicId"`
	Environment          string            `json:"environment"`
	Visibility           TopicVisibility   `json:"visibility"`
	AutoApprove          *AutoApproveConfig `json:"autoApprove"`
	DefaultPermission    SharePermission   `json:"defaultPermission"`
	RequireJustification bool              `json:"requireJustification"`
	AccessTTLDays        int               `json:"accessTtlDays"`
	CreatedAt            time.Time         `json:"createdAt"`
	UpdatedAt            time.Time         `json:"updatedAt"`
}

// NewTopicSharePolicy creates a new share policy for a workspace
func NewTopicSharePolicy(workspaceID uuid.UUID, scope SharePolicyScope) *KafkaTopicSharePolicy {
	now := time.Now()
	return &KafkaTopicSharePolicy{
		ID:          uuid.New(),
		WorkspaceID: workspaceID,
		Scope:       scope,
		Visibility:  TopicVisibilityPrivate,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
}

// MatchesTopic checks if this policy applies to a given topic
func (p *KafkaTopicSharePolicy) MatchesTopic(topicID uuid.UUID, topicName string) bool {
	switch p.Scope {
	case SharePolicyScopeAllTopics:
		return true
	case SharePolicyScopeSpecificTopic:
		return p.TopicID != nil && *p.TopicID == topicID
	case SharePolicyScopeTopicPattern:
		if p.TopicPattern == "" {
			return false
		}
		re, err := regexp.Compile(p.TopicPattern)
		if err != nil {
			return false
		}
		return re.MatchString(topicName)
	default:
		return false
	}
}

// ShouldAutoApprove checks if a share request should be auto-approved
func (p *KafkaTopicSharePolicy) ShouldAutoApprove(requestingWorkspaceID uuid.UUID, environment string, permission SharePermission) bool {
	if p.AutoApprove == nil {
		return false
	}

	// Check environment
	envMatch := len(p.AutoApprove.Environments) == 0
	for _, env := range p.AutoApprove.Environments {
		if env == environment {
			envMatch = true
			break
		}
	}
	if !envMatch {
		return false
	}

	// Check permission level
	permMatch := len(p.AutoApprove.Permissions) == 0
	for _, perm := range p.AutoApprove.Permissions {
		if perm == permission {
			permMatch = true
			break
		}
	}
	if !permMatch {
		return false
	}

	// Check workspace whitelist
	if len(p.AutoApprove.WorkspaceWhitelist) > 0 {
		found := false
		for _, ws := range p.AutoApprove.WorkspaceWhitelist {
			if ws == requestingWorkspaceID {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	return true
}
