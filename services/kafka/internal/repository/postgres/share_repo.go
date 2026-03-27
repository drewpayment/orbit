package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/drewpayment/orbit/services/kafka/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ShareRepository implements service.ShareRepository with PostgreSQL.
type ShareRepository struct {
	db DBTX
}

func NewShareRepository(db DBTX) *ShareRepository {
	return &ShareRepository{db: db}
}

const shareColumns = `id, topic_id, shared_with_type, shared_with_workspace_id, shared_with_user_id,
	permission, status, requested_by, requested_at, justification,
	approved_by, approved_at, expires_at, created_at, updated_at`

func (r *ShareRepository) Create(ctx context.Context, share *domain.KafkaTopicShare) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO kafka_topic_shares (id, topic_id, shared_with_type, shared_with_workspace_id, shared_with_user_id,
			permission, status, requested_by, requested_at, justification,
			approved_by, approved_at, expires_at, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		share.ID, share.TopicID, string(share.SharedWithType),
		share.SharedWithWorkspaceID, share.SharedWithUserID,
		string(share.Permission), string(share.Status),
		share.RequestedBy, share.RequestedAt, share.Justification,
		share.ApprovedBy, share.ApprovedAt, share.ExpiresAt,
		share.CreatedAt, share.UpdatedAt)
	return err
}

func (r *ShareRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaTopicShare, error) {
	row := r.db.QueryRow(ctx, `SELECT `+shareColumns+` FROM kafka_topic_shares WHERE id = $1`, id)
	return scanShare(row)
}

func (r *ShareRepository) List(ctx context.Context, filter service.ShareFilter) ([]*domain.KafkaTopicShare, error) {
	where := []string{"1=1"}
	args := []any{}
	argIdx := 1

	if filter.TopicID != nil {
		where = append(where, fmt.Sprintf("topic_id = $%d", argIdx))
		args = append(args, *filter.TopicID)
		argIdx++
	}
	if filter.WorkspaceID != nil {
		where = append(where, fmt.Sprintf("shared_with_workspace_id = $%d", argIdx))
		args = append(args, *filter.WorkspaceID)
		argIdx++
	}
	if filter.Status != nil {
		where = append(where, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, string(*filter.Status))
		argIdx++
	}

	query := `SELECT ` + shareColumns + ` FROM kafka_topic_shares WHERE ` + strings.Join(where, " AND ") + ` ORDER BY created_at DESC`

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var shares []*domain.KafkaTopicShare
	for rows.Next() {
		s, err := scanShare(rows)
		if err != nil {
			return nil, err
		}
		shares = append(shares, s)
	}
	return shares, rows.Err()
}

func (r *ShareRepository) Update(ctx context.Context, share *domain.KafkaTopicShare) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE kafka_topic_shares SET topic_id=$2, shared_with_type=$3, shared_with_workspace_id=$4,
			shared_with_user_id=$5, permission=$6, status=$7, requested_by=$8, requested_at=$9,
			justification=$10, approved_by=$11, approved_at=$12, expires_at=$13, updated_at=$14
		 WHERE id=$1`,
		share.ID, share.TopicID, string(share.SharedWithType),
		share.SharedWithWorkspaceID, share.SharedWithUserID,
		string(share.Permission), string(share.Status),
		share.RequestedBy, share.RequestedAt, share.Justification,
		share.ApprovedBy, share.ApprovedAt, share.ExpiresAt, share.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrShareNotFound
	}
	return nil
}

func (r *ShareRepository) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM kafka_topic_shares WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrShareNotFound
	}
	return nil
}

func (r *ShareRepository) GetExisting(ctx context.Context, topicID, workspaceID uuid.UUID) (*domain.KafkaTopicShare, error) {
	row := r.db.QueryRow(ctx,
		`SELECT `+shareColumns+` FROM kafka_topic_shares
		 WHERE topic_id = $1 AND shared_with_workspace_id = $2 AND status NOT IN ('rejected', 'revoked')
		 LIMIT 1`, topicID, workspaceID)
	s, err := scanShare(row)
	if err != nil {
		return nil, err
	}
	if s == nil {
		return nil, domain.ErrShareNotFound
	}
	return s, nil
}

func scanShare(s scanner) (*domain.KafkaTopicShare, error) {
	var sh domain.KafkaTopicShare
	var sharedWithType, permission, status string
	err := s.Scan(&sh.ID, &sh.TopicID, &sharedWithType,
		&sh.SharedWithWorkspaceID, &sh.SharedWithUserID,
		&permission, &status,
		&sh.RequestedBy, &sh.RequestedAt, &sh.Justification,
		&sh.ApprovedBy, &sh.ApprovedAt, &sh.ExpiresAt,
		&sh.CreatedAt, &sh.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	sh.SharedWithType = domain.ShareWithType(sharedWithType)
	sh.Permission = domain.SharePermission(permission)
	sh.Status = domain.ShareStatus(status)
	return &sh, nil
}
