package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// RegistryRepository implements service.SchemaRegistryRepository with PostgreSQL.
type RegistryRepository struct {
	db DBTX
}

func NewRegistryRepository(db DBTX) *RegistryRepository {
	return &RegistryRepository{db: db}
}

func (r *RegistryRepository) GetByClusterID(ctx context.Context, clusterID uuid.UUID) (*domain.SchemaRegistry, error) {
	row := r.db.QueryRow(ctx,
		`SELECT id, url, subject_naming_template, default_compatibility, environment_overrides, created_at, updated_at
		 FROM kafka_schema_registries WHERE cluster_id = $1`, clusterID)

	var reg domain.SchemaRegistry
	var compatibility string
	var overridesJSON []byte
	err := row.Scan(&reg.ID, &reg.URL, &reg.SubjectNamingTemplate,
		&compatibility, &overridesJSON, &reg.CreatedAt, &reg.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	reg.DefaultCompatibility = domain.SchemaCompatibility(compatibility)
	if err := json.Unmarshal(overridesJSON, &reg.EnvironmentOverrides); err != nil {
		return nil, err
	}
	return &reg, nil
}
