package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TopicRepository implements service.TopicRepository with PostgreSQL.
type TopicRepository struct {
	db DBTX
}

func NewTopicRepository(db DBTX) *TopicRepository {
	return &TopicRepository{db: db}
}

const topicColumns = `id, workspace_id, name, description, environment, cluster_id, partitions, replication_factor,
	retention_ms, cleanup_policy, compression, config, status, workflow_id, approval_required,
	approved_by, approved_at, created_at, updated_at`

func (r *TopicRepository) Create(ctx context.Context, topic *domain.KafkaTopic) error {
	configJSON, err := json.Marshal(topic.Config)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(ctx,
		`INSERT INTO kafka_topics (id, workspace_id, name, description, environment, cluster_id, partitions, replication_factor,
			retention_ms, cleanup_policy, compression, config, status, workflow_id, approval_required,
			approved_by, approved_at, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
		topic.ID, topic.WorkspaceID, topic.Name, topic.Description, topic.Environment,
		nullUUID(topic.ClusterID), topic.Partitions, topic.ReplicationFactor,
		topic.RetentionMs, string(topic.CleanupPolicy), string(topic.Compression), configJSON,
		string(topic.Status), topic.WorkflowID, topic.ApprovalRequired,
		topic.ApprovedBy, topic.ApprovedAt, topic.CreatedAt, topic.UpdatedAt)
	return err
}

func (r *TopicRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaTopic, error) {
	row := r.db.QueryRow(ctx,
		`SELECT `+topicColumns+` FROM kafka_topics WHERE id = $1`, id)
	return scanTopic(row)
}

func (r *TopicRepository) GetByName(ctx context.Context, workspaceID uuid.UUID, environment, name string) (*domain.KafkaTopic, error) {
	row := r.db.QueryRow(ctx,
		`SELECT `+topicColumns+` FROM kafka_topics WHERE workspace_id = $1 AND environment = $2 AND name = $3`,
		workspaceID, environment, name)
	t, err := scanTopic(row)
	if err != nil {
		return nil, err
	}
	if t == nil {
		return nil, domain.ErrTopicNotFound
	}
	return t, nil
}

func (r *TopicRepository) List(ctx context.Context, workspaceID uuid.UUID, environment string) ([]*domain.KafkaTopic, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+topicColumns+` FROM kafka_topics WHERE workspace_id = $1 AND environment = $2 ORDER BY created_at DESC`,
		workspaceID, environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var topics []*domain.KafkaTopic
	for rows.Next() {
		t, err := scanTopic(rows)
		if err != nil {
			return nil, err
		}
		topics = append(topics, t)
	}
	return topics, rows.Err()
}

func (r *TopicRepository) Update(ctx context.Context, topic *domain.KafkaTopic) error {
	configJSON, err := json.Marshal(topic.Config)
	if err != nil {
		return err
	}
	tag, err := r.db.Exec(ctx,
		`UPDATE kafka_topics SET workspace_id=$2, name=$3, description=$4, environment=$5, cluster_id=$6,
			partitions=$7, replication_factor=$8, retention_ms=$9, cleanup_policy=$10, compression=$11,
			config=$12, status=$13, workflow_id=$14, approval_required=$15, approved_by=$16, approved_at=$17,
			updated_at=$18
		 WHERE id=$1`,
		topic.ID, topic.WorkspaceID, topic.Name, topic.Description, topic.Environment,
		nullUUID(topic.ClusterID), topic.Partitions, topic.ReplicationFactor,
		topic.RetentionMs, string(topic.CleanupPolicy), string(topic.Compression), configJSON,
		string(topic.Status), topic.WorkflowID, topic.ApprovalRequired,
		topic.ApprovedBy, topic.ApprovedAt, topic.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrTopicNotFound
	}
	return nil
}

func (r *TopicRepository) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM kafka_topics WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrTopicNotFound
	}
	return nil
}

func scanTopic(s scanner) (*domain.KafkaTopic, error) {
	var t domain.KafkaTopic
	var configJSON []byte
	var clusterID *uuid.UUID
	var status, cleanupPolicy, compression string
	err := s.Scan(&t.ID, &t.WorkspaceID, &t.Name, &t.Description, &t.Environment,
		&clusterID, &t.Partitions, &t.ReplicationFactor,
		&t.RetentionMs, &cleanupPolicy, &compression, &configJSON,
		&status, &t.WorkflowID, &t.ApprovalRequired,
		&t.ApprovedBy, &t.ApprovedAt, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	t.Status = domain.TopicStatus(status)
	t.CleanupPolicy = domain.CleanupPolicy(cleanupPolicy)
	t.Compression = domain.CompressionType(compression)
	if clusterID != nil {
		t.ClusterID = *clusterID
	}
	if err := json.Unmarshal(configJSON, &t.Config); err != nil {
		return nil, err
	}
	return &t, nil
}

// nullUUID returns nil if the UUID is zero, otherwise a pointer to it.
func nullUUID(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}
