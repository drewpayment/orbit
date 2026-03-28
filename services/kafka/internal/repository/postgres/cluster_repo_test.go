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

func TestClusterRepository_CreateAndGetByID(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewClusterRepository(tx)
	ctx := context.Background()

	cluster := domain.NewKafkaCluster("test-cluster", "apache-kafka", map[string]string{
		"bootstrap.servers": "localhost:9092",
	})

	err := repo.Create(ctx, cluster)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, cluster.ID)
	require.NoError(t, err)
	require.NotNil(t, got)

	assert.Equal(t, cluster.ID, got.ID)
	assert.Equal(t, "test-cluster", got.Name)
	assert.Equal(t, "apache-kafka", got.ProviderID)
	assert.Equal(t, "localhost:9092", got.ConnectionConfig["bootstrap.servers"])
	assert.Equal(t, domain.ClusterValidationStatusPending, got.ValidationStatus)
}

func TestClusterRepository_List(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewClusterRepository(tx)
	ctx := context.Background()

	c1 := domain.NewKafkaCluster("cluster-1", "apache-kafka", map[string]string{"bootstrap.servers": "a:9092"})
	c2 := domain.NewKafkaCluster("cluster-2", "redpanda", map[string]string{"bootstrap.servers": "b:9092"})
	require.NoError(t, repo.Create(ctx, c1))
	require.NoError(t, repo.Create(ctx, c2))

	clusters, err := repo.List(ctx)
	require.NoError(t, err)
	assert.Len(t, clusters, 2)
}

func TestClusterRepository_Update(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewClusterRepository(tx)
	ctx := context.Background()

	cluster := domain.NewKafkaCluster("update-test", "apache-kafka", map[string]string{})
	require.NoError(t, repo.Create(ctx, cluster))

	cluster.MarkValid()
	err := repo.Update(ctx, cluster)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, cluster.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.ClusterValidationStatusValid, got.ValidationStatus)
	assert.NotNil(t, got.LastValidatedAt)
}

func TestClusterRepository_Delete(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewClusterRepository(tx)
	ctx := context.Background()

	cluster := domain.NewKafkaCluster("delete-test", "apache-kafka", map[string]string{})
	require.NoError(t, repo.Create(ctx, cluster))

	err := repo.Delete(ctx, cluster.ID)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, cluster.ID)
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestClusterRepository_GetByID_NotFound(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewClusterRepository(tx)
	ctx := context.Background()

	got, err := repo.GetByID(ctx, domain.NewKafkaCluster("x", "y", nil).ID)
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestClusterRepository_Delete_NotFound(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewClusterRepository(tx)
	ctx := context.Background()

	err := repo.Delete(ctx, domain.NewKafkaCluster("x", "y", nil).ID)
	assert.ErrorIs(t, err, domain.ErrClusterNotFound)
}
