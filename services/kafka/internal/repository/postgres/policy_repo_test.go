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

// insertPolicy is a test helper that inserts a policy directly via SQL.
func insertPolicy(t *testing.T, tx postgres.DBTX, policy *domain.KafkaTopicPolicy) {
	t.Helper()
	autoApproveJSON, _ := json.Marshal(policy.AutoApprovePatterns)
	var partLimJSON, retLimJSON []byte
	if policy.PartitionLimits != nil {
		partLimJSON, _ = json.Marshal(policy.PartitionLimits)
	}
	if policy.RetentionLimits != nil {
		retLimJSON, _ = json.Marshal(policy.RetentionLimits)
	}
	requireApprovalJSON, _ := json.Marshal(policy.RequireApprovalFor)
	_, err := tx.Exec(context.Background(),
		`INSERT INTO kafka_topic_policies (id, scope, workspace_id, environment, naming_pattern,
			auto_approve_patterns, partition_limits, retention_limits, require_schema, require_approval_for,
			created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		policy.ID, string(policy.Scope), policy.WorkspaceID, policy.Environment, policy.NamingPattern,
		autoApproveJSON, partLimJSON, retLimJSON,
		policy.RequireSchema, requireApprovalJSON, policy.CreatedAt, policy.UpdatedAt)
	require.NoError(t, err)
}

func TestPolicyRepository_GetEffectivePolicy_WorkspaceScoped(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewPolicyRepository(tx)
	ctx := context.Background()

	wsID := uuid.New()
	policy := domain.NewWorkspacePolicy(wsID, "production")
	policy.NamingPattern = "^prod-.*"
	policy.RequireSchema = true
	insertPolicy(t, tx, policy)

	got, err := repo.GetEffectivePolicy(ctx, wsID, "production")
	require.NoError(t, err)
	require.NotNil(t, got)

	assert.Equal(t, policy.ID, got.ID)
	assert.Equal(t, domain.PolicyScopeWorkspace, got.Scope)
	assert.Equal(t, "^prod-.*", got.NamingPattern)
	assert.True(t, got.RequireSchema)
}

func TestPolicyRepository_GetEffectivePolicy_PlatformFallback(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewPolicyRepository(tx)
	ctx := context.Background()

	platformPolicy := domain.NewPlatformPolicy("staging")
	platformPolicy.NamingPattern = "^stg-.*"
	insertPolicy(t, tx, platformPolicy)

	// Query with a workspace that has no policy — should fall back to platform
	got, err := repo.GetEffectivePolicy(ctx, uuid.New(), "staging")
	require.NoError(t, err)
	require.NotNil(t, got)

	assert.Equal(t, platformPolicy.ID, got.ID)
	assert.Equal(t, domain.PolicyScopePlatform, got.Scope)
}

func TestPolicyRepository_GetEffectivePolicy_NotFound(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewPolicyRepository(tx)
	ctx := context.Background()

	_, err := repo.GetEffectivePolicy(ctx, uuid.New(), "nonexistent")
	assert.ErrorIs(t, err, domain.ErrPolicyNotFound)
}

func TestPolicyRepository_GetEffectivePolicy_WithLimits(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewPolicyRepository(tx)
	ctx := context.Background()

	wsID := uuid.New()
	policy := domain.NewWorkspacePolicy(wsID, "dev")
	policy.PartitionLimits = &domain.PartitionLimits{Min: 1, Max: 12}
	policy.RetentionLimits = &domain.RetentionLimits{MinMs: 3600000, MaxMs: 604800000}
	insertPolicy(t, tx, policy)

	got, err := repo.GetEffectivePolicy(ctx, wsID, "dev")
	require.NoError(t, err)
	require.NotNil(t, got.PartitionLimits)
	require.NotNil(t, got.RetentionLimits)

	assert.Equal(t, 1, got.PartitionLimits.Min)
	assert.Equal(t, 12, got.PartitionLimits.Max)
	assert.Equal(t, int64(3600000), got.RetentionLimits.MinMs)
}
