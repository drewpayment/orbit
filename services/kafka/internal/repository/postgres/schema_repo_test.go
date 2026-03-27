//go:build integration

package postgres_test

import (
	"context"
	"testing"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/drewpayment/orbit/services/kafka/internal/repository/postgres"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSchemaRepository_CreateAndGetByID(t *testing.T) {
	tx := setupTestTx(t)
	topic := createTestTopic(t, tx)
	repo := postgres.NewSchemaRepository(tx)
	ctx := context.Background()

	schema := domain.NewKafkaSchema(topic.WorkspaceID, topic.ID, domain.SchemaTypeValue, domain.SchemaFormatAvro, `{"type":"record","name":"Event","fields":[]}`)
	schema.Subject = "dev.ws.my-events-value"

	err := repo.Create(ctx, schema)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, schema.ID)
	require.NoError(t, err)
	require.NotNil(t, got)

	assert.Equal(t, schema.ID, got.ID)
	assert.Equal(t, domain.SchemaTypeValue, got.Type)
	assert.Equal(t, domain.SchemaFormatAvro, got.Format)
	assert.Equal(t, domain.SchemaStatusPending, got.Status)
	assert.Equal(t, "dev.ws.my-events-value", got.Subject)
}

func TestSchemaRepository_GetBySubject(t *testing.T) {
	tx := setupTestTx(t)
	topic := createTestTopic(t, tx)
	repo := postgres.NewSchemaRepository(tx)
	ctx := context.Background()

	schema := domain.NewKafkaSchema(topic.WorkspaceID, topic.ID, domain.SchemaTypeKey, domain.SchemaFormatJSON, `{"type":"string"}`)
	schema.Subject = "dev.ws.my-events-key"
	require.NoError(t, repo.Create(ctx, schema))

	got, err := repo.GetBySubject(ctx, topic.ID, string(domain.SchemaTypeKey))
	require.NoError(t, err)
	assert.Equal(t, schema.ID, got.ID)
}

func TestSchemaRepository_GetBySubject_NotFound(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewSchemaRepository(tx)
	ctx := context.Background()

	_, err := repo.GetBySubject(ctx, uuid.New(), "value")
	assert.ErrorIs(t, err, domain.ErrSchemaNotFound)
}

func TestSchemaRepository_List(t *testing.T) {
	tx := setupTestTx(t)
	topic := createTestTopic(t, tx)
	repo := postgres.NewSchemaRepository(tx)
	ctx := context.Background()

	s1 := domain.NewKafkaSchema(topic.WorkspaceID, topic.ID, domain.SchemaTypeKey, domain.SchemaFormatJSON, `{"type":"string"}`)
	s1.Subject = "key-subject"
	s2 := domain.NewKafkaSchema(topic.WorkspaceID, topic.ID, domain.SchemaTypeValue, domain.SchemaFormatAvro, `{"type":"record"}`)
	s2.Subject = "value-subject"

	require.NoError(t, repo.Create(ctx, s1))
	require.NoError(t, repo.Create(ctx, s2))

	schemas, err := repo.List(ctx, topic.ID)
	require.NoError(t, err)
	assert.Len(t, schemas, 2)
}

func TestSchemaRepository_Update(t *testing.T) {
	tx := setupTestTx(t)
	topic := createTestTopic(t, tx)
	repo := postgres.NewSchemaRepository(tx)
	ctx := context.Background()

	schema := domain.NewKafkaSchema(topic.WorkspaceID, topic.ID, domain.SchemaTypeValue, domain.SchemaFormatAvro, `{}`)
	schema.Subject = "test-subject"
	require.NoError(t, repo.Create(ctx, schema))

	schema.MarkRegistered(42, 3)
	err := repo.Update(ctx, schema)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, schema.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.SchemaStatusRegistered, got.Status)
	assert.Equal(t, 42, got.SchemaID)
	assert.Equal(t, 3, got.Version)
}

func TestSchemaRepository_Delete(t *testing.T) {
	tx := setupTestTx(t)
	topic := createTestTopic(t, tx)
	repo := postgres.NewSchemaRepository(tx)
	ctx := context.Background()

	schema := domain.NewKafkaSchema(topic.WorkspaceID, topic.ID, domain.SchemaTypeValue, domain.SchemaFormatJSON, `{}`)
	schema.Subject = "delete-subject"
	require.NoError(t, repo.Create(ctx, schema))

	err := repo.Delete(ctx, schema.ID)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, schema.ID)
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestSchemaRepository_Delete_NotFound(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewSchemaRepository(tx)
	ctx := context.Background()

	err := repo.Delete(ctx, uuid.New())
	assert.ErrorIs(t, err, domain.ErrSchemaNotFound)
}
