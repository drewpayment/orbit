package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// SharePolicyRepository implements service.SharePolicyRepository with PostgreSQL.
type SharePolicyRepository struct {
	db DBTX
}

func NewSharePolicyRepository(db DBTX) *SharePolicyRepository {
	return &SharePolicyRepository{db: db}
}

// GetEffectivePolicy returns the most specific share policy: specific-topic > topic-pattern > all-topics.
func (r *SharePolicyRepository) GetEffectivePolicy(ctx context.Context, workspaceID uuid.UUID, topicID uuid.UUID) (*domain.KafkaTopicSharePolicy, error) {
	// Try specific topic first
	row := r.db.QueryRow(ctx,
		`SELECT id, workspace_id, scope, topic_pattern, topic_id, environment, visibility,
			auto_approve, default_permission, require_justification, access_ttl_days, created_at, updated_at
		 FROM kafka_topic_share_policies
		 WHERE workspace_id = $1 AND topic_id = $2 AND scope = 'specific-topic'
		 LIMIT 1`, workspaceID, topicID)

	p, err := scanSharePolicy(row)
	if err != nil {
		return nil, err
	}
	if p != nil {
		return p, nil
	}

	// Fall back to all-topics scope
	row = r.db.QueryRow(ctx,
		`SELECT id, workspace_id, scope, topic_pattern, topic_id, environment, visibility,
			auto_approve, default_permission, require_justification, access_ttl_days, created_at, updated_at
		 FROM kafka_topic_share_policies
		 WHERE workspace_id = $1 AND scope = 'all-topics'
		 LIMIT 1`, workspaceID)

	p, err = scanSharePolicy(row)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, domain.ErrPolicyNotFound
	}
	return p, nil
}

func scanSharePolicy(s scanner) (*domain.KafkaTopicSharePolicy, error) {
	var p domain.KafkaTopicSharePolicy
	var scope, visibility, defaultPerm string
	var autoApproveJSON []byte
	err := s.Scan(&p.ID, &p.WorkspaceID, &scope, &p.TopicPattern, &p.TopicID,
		&p.Environment, &visibility, &autoApproveJSON,
		&defaultPerm, &p.RequireJustification, &p.AccessTTLDays,
		&p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	p.Scope = domain.SharePolicyScope(scope)
	p.Visibility = domain.TopicVisibility(visibility)
	p.DefaultPermission = domain.SharePermission(defaultPerm)
	if autoApproveJSON != nil {
		p.AutoApprove = &domain.AutoApproveConfig{}
		if err := json.Unmarshal(autoApproveJSON, p.AutoApprove); err != nil {
			return nil, err
		}
	}
	return &p, nil
}
