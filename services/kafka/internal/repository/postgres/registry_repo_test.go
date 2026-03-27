//go:build integration

package postgres_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/drewpayment/orbit/services/kafka/internal/repository/postgres"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRegistryRepository_GetByClusterID(t *testing.T) {
	tx := setupTestTx(t)
	cluster := createTestCluster(t, tx)
	repo := postgres.NewRegistryRepository(tx)
	ctx := context.Background()

	// Insert a registry directly via SQL
	regID := uuid.New()
	now := time.Now()
	overrides := []domain.EnvironmentCompatibilityOverride{
		{Environment: "production", Compatibility: domain.SchemaCompatibilityFull},
	}
	overridesJSON, _ := json.Marshal(overrides)
	_, err := tx.Exec(ctx,
		`INSERT INTO kafka_schema_registries (id, cluster_id, url, subject_naming_template, default_compatibility, environment_overrides, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		regID, cluster.ID, "http://schema-registry:8081", "{env}.{workspace}.{topic}-{type}",
		"backward", overridesJSON, now, now)
	require.NoError(t, err)

	got, err := repo.GetByClusterID(ctx, cluster.ID)
	require.NoError(t, err)
	require.NotNil(t, got)

	assert.Equal(t, regID, got.ID)
	assert.Equal(t, "http://schema-registry:8081", got.URL)
	assert.Equal(t, domain.SchemaCompatibilityBackward, got.DefaultCompatibility)
	assert.Len(t, got.EnvironmentOverrides, 1)
	assert.Equal(t, "production", got.EnvironmentOverrides[0].Environment)
}

func TestRegistryRepository_GetByClusterID_NotFound(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewRegistryRepository(tx)
	ctx := context.Background()

	got, err := repo.GetByClusterID(ctx, uuid.New())
	require.NoError(t, err)
	assert.Nil(t, got)
}
