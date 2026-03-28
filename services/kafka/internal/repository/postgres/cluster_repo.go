package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ClusterRepository implements service.ClusterRepository with PostgreSQL.
type ClusterRepository struct {
	db DBTX
}

func NewClusterRepository(db DBTX) *ClusterRepository {
	return &ClusterRepository{db: db}
}

func (r *ClusterRepository) Create(ctx context.Context, cluster *domain.KafkaCluster) error {
	configJSON, err := json.Marshal(cluster.ConnectionConfig)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(ctx,
		`INSERT INTO kafka_clusters (id, name, provider_id, connection_config, validation_status, last_validated_at, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		cluster.ID, cluster.Name, cluster.ProviderID, configJSON,
		string(cluster.ValidationStatus), cluster.LastValidatedAt, cluster.CreatedAt, cluster.UpdatedAt)
	return err
}

func (r *ClusterRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaCluster, error) {
	row := r.db.QueryRow(ctx,
		`SELECT id, name, provider_id, connection_config, validation_status, last_validated_at, created_at, updated_at
		 FROM kafka_clusters WHERE id = $1`, id)
	return scanCluster(row)
}

func (r *ClusterRepository) List(ctx context.Context) ([]*domain.KafkaCluster, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, name, provider_id, connection_config, validation_status, last_validated_at, created_at, updated_at
		 FROM kafka_clusters ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var clusters []*domain.KafkaCluster
	for rows.Next() {
		c, err := scanCluster(rows)
		if err != nil {
			return nil, err
		}
		clusters = append(clusters, c)
	}
	return clusters, rows.Err()
}

func (r *ClusterRepository) Update(ctx context.Context, cluster *domain.KafkaCluster) error {
	configJSON, err := json.Marshal(cluster.ConnectionConfig)
	if err != nil {
		return err
	}
	tag, err := r.db.Exec(ctx,
		`UPDATE kafka_clusters SET name=$2, provider_id=$3, connection_config=$4, validation_status=$5, last_validated_at=$6, updated_at=$7
		 WHERE id=$1`,
		cluster.ID, cluster.Name, cluster.ProviderID, configJSON,
		string(cluster.ValidationStatus), cluster.LastValidatedAt, cluster.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrClusterNotFound
	}
	return nil
}

func (r *ClusterRepository) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM kafka_clusters WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrClusterNotFound
	}
	return nil
}

// scanner is satisfied by both pgx.Row and pgx.Rows
type scanner interface {
	Scan(dest ...any) error
}

func scanCluster(s scanner) (*domain.KafkaCluster, error) {
	var c domain.KafkaCluster
	var configJSON []byte
	var status string
	err := s.Scan(&c.ID, &c.Name, &c.ProviderID, &configJSON, &status, &c.LastValidatedAt, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.ValidationStatus = domain.ClusterValidationStatus(status)
	if err := json.Unmarshal(configJSON, &c.ConnectionConfig); err != nil {
		return nil, err
	}
	return &c, nil
}
