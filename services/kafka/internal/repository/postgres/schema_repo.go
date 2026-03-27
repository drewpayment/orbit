package postgres

import (
	"context"
	"errors"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// SchemaRepository implements service.SchemaRepository with PostgreSQL.
type SchemaRepository struct {
	db DBTX
}

func NewSchemaRepository(db DBTX) *SchemaRepository {
	return &SchemaRepository{db: db}
}

const schemaColumns = `id, workspace_id, topic_id, type, subject, format, content, version, schema_id, compatibility, status, created_at, updated_at`

func (r *SchemaRepository) Create(ctx context.Context, schema *domain.KafkaSchema) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO kafka_schemas (id, workspace_id, topic_id, type, subject, format, content, version, schema_id, compatibility, status, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		schema.ID, schema.WorkspaceID, schema.TopicID, string(schema.Type), schema.Subject,
		string(schema.Format), schema.Content, schema.Version, schema.SchemaID,
		string(schema.Compatibility), string(schema.Status), schema.CreatedAt, schema.UpdatedAt)
	return err
}

func (r *SchemaRepository) GetByID(ctx context.Context, id uuid.UUID) (*domain.KafkaSchema, error) {
	row := r.db.QueryRow(ctx, `SELECT `+schemaColumns+` FROM kafka_schemas WHERE id = $1`, id)
	return scanSchema(row)
}

func (r *SchemaRepository) GetBySubject(ctx context.Context, topicID uuid.UUID, schemaType string) (*domain.KafkaSchema, error) {
	row := r.db.QueryRow(ctx,
		`SELECT `+schemaColumns+` FROM kafka_schemas WHERE topic_id = $1 AND type = $2`, topicID, schemaType)
	s, err := scanSchema(row)
	if err != nil {
		return nil, err
	}
	if s == nil {
		return nil, domain.ErrSchemaNotFound
	}
	return s, nil
}

func (r *SchemaRepository) List(ctx context.Context, topicID uuid.UUID) ([]*domain.KafkaSchema, error) {
	rows, err := r.db.Query(ctx,
		`SELECT `+schemaColumns+` FROM kafka_schemas WHERE topic_id = $1 ORDER BY created_at DESC`, topicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var schemas []*domain.KafkaSchema
	for rows.Next() {
		s, err := scanSchema(rows)
		if err != nil {
			return nil, err
		}
		schemas = append(schemas, s)
	}
	return schemas, rows.Err()
}

func (r *SchemaRepository) Update(ctx context.Context, schema *domain.KafkaSchema) error {
	tag, err := r.db.Exec(ctx,
		`UPDATE kafka_schemas SET workspace_id=$2, topic_id=$3, type=$4, subject=$5, format=$6, content=$7,
			version=$8, schema_id=$9, compatibility=$10, status=$11, updated_at=$12
		 WHERE id=$1`,
		schema.ID, schema.WorkspaceID, schema.TopicID, string(schema.Type), schema.Subject,
		string(schema.Format), schema.Content, schema.Version, schema.SchemaID,
		string(schema.Compatibility), string(schema.Status), schema.UpdatedAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrSchemaNotFound
	}
	return nil
}

func (r *SchemaRepository) Delete(ctx context.Context, id uuid.UUID) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM kafka_schemas WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrSchemaNotFound
	}
	return nil
}

func scanSchema(s scanner) (*domain.KafkaSchema, error) {
	var sch domain.KafkaSchema
	var schemaType, format, compatibility, status string
	err := s.Scan(&sch.ID, &sch.WorkspaceID, &sch.TopicID, &schemaType, &sch.Subject,
		&format, &sch.Content, &sch.Version, &sch.SchemaID,
		&compatibility, &status, &sch.CreatedAt, &sch.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	sch.Type = domain.SchemaType(schemaType)
	sch.Format = domain.SchemaFormat(format)
	sch.Compatibility = domain.SchemaCompatibility(compatibility)
	sch.Status = domain.SchemaStatus(status)
	return &sch, nil
}
