package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// PolicyRepository implements service.PolicyRepository with PostgreSQL.
type PolicyRepository struct {
	db DBTX
}

func NewPolicyRepository(db DBTX) *PolicyRepository {
	return &PolicyRepository{db: db}
}

// GetEffectivePolicy returns the most specific policy: workspace-scoped first, then platform.
func (r *PolicyRepository) GetEffectivePolicy(ctx context.Context, workspaceID uuid.UUID, environment string) (*domain.KafkaTopicPolicy, error) {
	// Try workspace-scoped policy first
	row := r.db.QueryRow(ctx,
		`SELECT id, scope, workspace_id, environment, naming_pattern, auto_approve_patterns,
			partition_limits, retention_limits, require_schema, require_approval_for, created_at, updated_at
		 FROM kafka_topic_policies
		 WHERE workspace_id = $1 AND environment = $2
		 LIMIT 1`, workspaceID, environment)

	p, err := scanPolicy(row)
	if err != nil {
		return nil, err
	}
	if p != nil {
		return p, nil
	}

	// Fall back to platform policy
	row = r.db.QueryRow(ctx,
		`SELECT id, scope, workspace_id, environment, naming_pattern, auto_approve_patterns,
			partition_limits, retention_limits, require_schema, require_approval_for, created_at, updated_at
		 FROM kafka_topic_policies
		 WHERE scope = 'platform' AND environment = $1
		 LIMIT 1`, environment)

	p, err = scanPolicy(row)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, domain.ErrPolicyNotFound
	}
	return p, nil
}

func scanPolicy(s scanner) (*domain.KafkaTopicPolicy, error) {
	var p domain.KafkaTopicPolicy
	var scope string
	var autoApproveJSON, partitionLimitsJSON, retentionLimitsJSON, requireApprovalJSON []byte
	err := s.Scan(&p.ID, &scope, &p.WorkspaceID, &p.Environment, &p.NamingPattern,
		&autoApproveJSON, &partitionLimitsJSON, &retentionLimitsJSON,
		&p.RequireSchema, &requireApprovalJSON, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.Scope = domain.PolicyScope(scope)
	if err := json.Unmarshal(autoApproveJSON, &p.AutoApprovePatterns); err != nil {
		return nil, err
	}
	if partitionLimitsJSON != nil {
		p.PartitionLimits = &domain.PartitionLimits{}
		if err := json.Unmarshal(partitionLimitsJSON, p.PartitionLimits); err != nil {
			return nil, err
		}
	}
	if retentionLimitsJSON != nil {
		p.RetentionLimits = &domain.RetentionLimits{}
		if err := json.Unmarshal(retentionLimitsJSON, p.RetentionLimits); err != nil {
			return nil, err
		}
	}
	if err := json.Unmarshal(requireApprovalJSON, &p.RequireApprovalFor); err != nil {
		return nil, err
	}
	return &p, nil
}
