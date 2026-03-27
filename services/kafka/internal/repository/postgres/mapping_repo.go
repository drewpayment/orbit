package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// MappingRepository implements service.EnvironmentMappingRepository with PostgreSQL.
type MappingRepository struct {
	db DBTX
}

func NewMappingRepository(db DBTX) *MappingRepository {
	return &MappingRepository{db: db}
}

func (r *MappingRepository) Create(ctx context.Context, mapping *domain.KafkaEnvironmentMapping) error {
	ruleJSON, err := json.Marshal(mapping.RoutingRule)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(ctx,
		`INSERT INTO kafka_environment_mappings (id, environment, cluster_id, routing_rule, priority, is_default, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		mapping.ID, mapping.Environment, mapping.ClusterID, ruleJSON,
		mapping.Priority, mapping.IsDefault, mapping.CreatedAt)
	return err
}

func (r *MappingRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaEnvironmentMapping, error) {
	row := r.db.QueryRow(ctx,
		`SELECT id, environment, cluster_id, routing_rule, priority, is_default, created_at
		 FROM kafka_environment_mappings WHERE id = $1`, id)
	return scanMapping(row)
}

func (r *MappingRepository) List(ctx context.Context, environment string) ([]*domain.KafkaEnvironmentMapping, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, environment, cluster_id, routing_rule, priority, is_default, created_at
		 FROM kafka_environment_mappings WHERE environment = $1 ORDER BY priority DESC`, environment)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var mappings []*domain.KafkaEnvironmentMapping
	for rows.Next() {
		m, err := scanMapping(rows)
		if err != nil {
			return nil, err
		}
		mappings = append(mappings, m)
	}
	return mappings, rows.Err()
}

func (r *MappingRepository) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM kafka_environment_mappings WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrEnvironmentMappingNotFound
	}
	return nil
}

func (r *MappingRepository) GetDefaultForEnvironment(ctx context.Context, environment string) (*domain.KafkaEnvironmentMapping, error) {
	row := r.db.QueryRow(ctx,
		`SELECT id, environment, cluster_id, routing_rule, priority, is_default, created_at
		 FROM kafka_environment_mappings WHERE environment = $1 AND is_default = true
		 ORDER BY priority DESC LIMIT 1`, environment)
	m, err := scanMapping(row)
	if err != nil {
		return nil, err
	}
	if m == nil {
		return nil, domain.ErrNoDefaultCluster
	}
	return m, nil
}

func scanMapping(s scanner) (*domain.KafkaEnvironmentMapping, error) {
	var m domain.KafkaEnvironmentMapping
	var ruleJSON []byte
	err := s.Scan(&m.ID, &m.Environment, &m.ClusterID, &ruleJSON, &m.Priority, &m.IsDefault, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(ruleJSON, &m.RoutingRule); err != nil {
		return nil, err
	}
	return &m, nil
}
