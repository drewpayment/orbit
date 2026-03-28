//go:build integration

package postgres_test

import (
	"context"
	"testing"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/drewpayment/orbit/services/kafka/internal/repository/postgres"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMappingRepository_CreateAndGetByID(t *testing.T) {
	tx := setupTestTx(t)
	cluster := createTestCluster(t, tx)
	repo := postgres.NewMappingRepository(tx)
	ctx := context.Background()

	mapping := domain.NewEnvironmentMapping("development", cluster.ID, true)

	err := repo.Create(ctx, mapping)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, mapping.ID)
	require.NoError(t, err)
	require.NotNil(t, got)

	assert.Equal(t, mapping.ID, got.ID)
	assert.Equal(t, "development", got.Environment)
	assert.Equal(t, cluster.ID, got.ClusterID)
	assert.True(t, got.IsDefault)
}

func TestMappingRepository_List(t *testing.T) {
	tx := setupTestTx(t)
	c1 := createTestCluster(t, tx)
	c2 := createTestCluster(t, tx)
	repo := postgres.NewMappingRepository(tx)
	ctx := context.Background()

	m1 := domain.NewEnvironmentMapping("staging", c1.ID, true)
	m2 := domain.NewEnvironmentMapping("staging", c2.ID, false)
	m3 := domain.NewEnvironmentMapping("production", c1.ID, true)
	require.NoError(t, repo.Create(ctx, m1))
	require.NoError(t, repo.Create(ctx, m2))
	require.NoError(t, repo.Create(ctx, m3))

	mappings, err := repo.List(ctx, "staging")
	require.NoError(t, err)
	assert.Len(t, mappings, 2)
}

func TestMappingRepository_GetDefaultForEnvironment(t *testing.T) {
	tx := setupTestTx(t)
	cluster := createTestCluster(t, tx)
	repo := postgres.NewMappingRepository(tx)
	ctx := context.Background()

	mapping := domain.NewEnvironmentMapping("production", cluster.ID, true)
	require.NoError(t, repo.Create(ctx, mapping))

	got, err := repo.GetDefaultForEnvironment(ctx, "production")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, mapping.ID, got.ID)
	assert.True(t, got.IsDefault)
}

func TestMappingRepository_GetDefaultForEnvironment_NotFound(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewMappingRepository(tx)
	ctx := context.Background()

	got, err := repo.GetDefaultForEnvironment(ctx, "nonexistent")
	assert.ErrorIs(t, err, domain.ErrNoDefaultCluster)
	assert.Nil(t, got)
}

func TestMappingRepository_Delete(t *testing.T) {
	tx := setupTestTx(t)
	cluster := createTestCluster(t, tx)
	repo := postgres.NewMappingRepository(tx)
	ctx := context.Background()

	mapping := domain.NewEnvironmentMapping("dev", cluster.ID, false)
	require.NoError(t, repo.Create(ctx, mapping))

	err := repo.Delete(ctx, mapping.ID)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, mapping.ID)
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestMappingRepository_Delete_NotFound(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewMappingRepository(tx)
	ctx := context.Background()

	err := repo.Delete(ctx, domain.NewEnvironmentMapping("x", [16]byte{}, false).ID)
	assert.ErrorIs(t, err, domain.ErrEnvironmentMappingNotFound)
}
