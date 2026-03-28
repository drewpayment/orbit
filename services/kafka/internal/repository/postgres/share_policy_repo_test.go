//go:build integration

package postgres_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/drewpayment/orbit/services/kafka/internal/repository/postgres"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func insertSharePolicy(t *testing.T, tx postgres.DBTX, p *domain.KafkaTopicSharePolicy) {
	t.Helper()
	var autoApproveJSON []byte
	if p.AutoApprove != nil {
		autoApproveJSON, _ = json.Marshal(p.AutoApprove)
	}
	_, err := tx.Exec(context.Background(),
		`INSERT INTO kafka_topic_share_policies (id, workspace_id, scope, topic_pattern, topic_id, environment,
			visibility, auto_approve, default_permission, require_justification, access_ttl_days, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		p.ID, p.WorkspaceID, string(p.Scope), p.TopicPattern, p.TopicID, p.Environment,
		string(p.Visibility), autoApproveJSON, string(p.DefaultPermission),
		p.RequireJustification, p.AccessTTLDays, p.CreatedAt, p.UpdatedAt)
	require.NoError(t, err)
}

func TestSharePolicyRepository_GetEffectivePolicy_SpecificTopic(t *testing.T) {
	tx := setupTestTx(t)
	topic := createTestTopic(t, tx)
	repo := postgres.NewSharePolicyRepository(tx)
	ctx := context.Background()

	wsID := uuid.New()
	policy := domain.NewTopicSharePolicy(wsID, domain.SharePolicyScopeSpecificTopic)
	policy.TopicID = &topic.ID
	policy.Visibility = domain.TopicVisibilityDiscoverable
	policy.DefaultPermission = domain.SharePermissionRead
	policy.RequireJustification = true
	insertSharePolicy(t, tx, policy)

	got, err := repo.GetEffectivePolicy(ctx, wsID, topic.ID)
	require.NoError(t, err)
	require.NotNil(t, got)

	assert.Equal(t, policy.ID, got.ID)
	assert.Equal(t, domain.SharePolicyScopeSpecificTopic, got.Scope)
	assert.Equal(t, domain.TopicVisibilityDiscoverable, got.Visibility)
	assert.True(t, got.RequireJustification)
}

func TestSharePolicyRepository_GetEffectivePolicy_AllTopicsFallback(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewSharePolicyRepository(tx)
	ctx := context.Background()

	wsID := uuid.New()
	policy := domain.NewTopicSharePolicy(wsID, domain.SharePolicyScopeAllTopics)
	policy.Visibility = domain.TopicVisibilityPublic
	policy.DefaultPermission = domain.SharePermissionReadWrite
	insertSharePolicy(t, tx, policy)

	// Query with a topic that has no specific policy — should fall back to all-topics
	got, err := repo.GetEffectivePolicy(ctx, wsID, uuid.New())
	require.NoError(t, err)
	require.NotNil(t, got)

	assert.Equal(t, policy.ID, got.ID)
	assert.Equal(t, domain.SharePolicyScopeAllTopics, got.Scope)
	assert.Equal(t, domain.TopicVisibilityPublic, got.Visibility)
}

func TestSharePolicyRepository_GetEffectivePolicy_WithAutoApprove(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewSharePolicyRepository(tx)
	ctx := context.Background()

	wsID := uuid.New()
	policy := domain.NewTopicSharePolicy(wsID, domain.SharePolicyScopeAllTopics)
	policy.AutoApprove = &domain.AutoApproveConfig{
		Environments: []string{"development"},
		Permissions:  []domain.SharePermission{domain.SharePermissionRead},
	}
	policy.DefaultPermission = domain.SharePermissionRead
	insertSharePolicy(t, tx, policy)

	got, err := repo.GetEffectivePolicy(ctx, wsID, uuid.New())
	require.NoError(t, err)
	require.NotNil(t, got.AutoApprove)
	assert.Equal(t, []string{"development"}, got.AutoApprove.Environments)
	assert.Equal(t, []domain.SharePermission{domain.SharePermissionRead}, got.AutoApprove.Permissions)
}

func TestSharePolicyRepository_GetEffectivePolicy_NotFound(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewSharePolicyRepository(tx)
	ctx := context.Background()

	_, err := repo.GetEffectivePolicy(ctx, uuid.New(), uuid.New())
	assert.ErrorIs(t, err, domain.ErrPolicyNotFound)
}
