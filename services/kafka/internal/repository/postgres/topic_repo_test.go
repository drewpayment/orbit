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

func createTestCluster(t *testing.T, tx postgres.DBTX) *domain.KafkaCluster {
	t.Helper()
	repo := postgres.NewClusterRepository(tx)
	cluster := domain.NewKafkaCluster("test-cluster-"+uuid.New().String()[:8], "apache-kafka", map[string]string{
		"bootstrap.servers": "localhost:9092",
	})
	require.NoError(t, repo.Create(context.Background(), cluster))
	return cluster
}

func TestTopicRepository_CreateAndGetByID(t *testing.T) {
	tx := setupTestTx(t)
	cluster := createTestCluster(t, tx)
	repo := postgres.NewTopicRepository(tx)
	ctx := context.Background()

	topic := domain.NewKafkaTopic(uuid.New(), "my-events", "development")
	topic.ClusterID = cluster.ID

	err := repo.Create(ctx, topic)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, topic.ID)
	require.NoError(t, err)
	require.NotNil(t, got)

	assert.Equal(t, topic.ID, got.ID)
	assert.Equal(t, "my-events", got.Name)
	assert.Equal(t, "development", got.Environment)
	assert.Equal(t, domain.TopicStatusPendingApproval, got.Status)
	assert.Equal(t, 3, got.Partitions)
	assert.Equal(t, cluster.ID, got.ClusterID)
}

func TestTopicRepository_GetByName(t *testing.T) {
	tx := setupTestTx(t)
	cluster := createTestCluster(t, tx)
	repo := postgres.NewTopicRepository(tx)
	ctx := context.Background()

	wsID := uuid.New()
	topic := domain.NewKafkaTopic(wsID, "named-topic", "staging")
	topic.ClusterID = cluster.ID
	require.NoError(t, repo.Create(ctx, topic))

	got, err := repo.GetByName(ctx, wsID, "staging", "named-topic")
	require.NoError(t, err)
	assert.Equal(t, topic.ID, got.ID)
}

func TestTopicRepository_GetByName_NotFound(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewTopicRepository(tx)
	ctx := context.Background()

	_, err := repo.GetByName(ctx, uuid.New(), "production", "nonexistent")
	assert.ErrorIs(t, err, domain.ErrTopicNotFound)
}

func TestTopicRepository_List(t *testing.T) {
	tx := setupTestTx(t)
	cluster := createTestCluster(t, tx)
	repo := postgres.NewTopicRepository(tx)
	ctx := context.Background()

	wsID := uuid.New()
	t1 := domain.NewKafkaTopic(wsID, "topic-a", "dev")
	t1.ClusterID = cluster.ID
	t2 := domain.NewKafkaTopic(wsID, "topic-b", "dev")
	t2.ClusterID = cluster.ID
	t3 := domain.NewKafkaTopic(wsID, "topic-c", "staging")
	t3.ClusterID = cluster.ID

	require.NoError(t, repo.Create(ctx, t1))
	require.NoError(t, repo.Create(ctx, t2))
	require.NoError(t, repo.Create(ctx, t3))

	topics, err := repo.List(ctx, wsID, "dev")
	require.NoError(t, err)
	assert.Len(t, topics, 2)
}

func TestTopicRepository_Update(t *testing.T) {
	tx := setupTestTx(t)
	cluster := createTestCluster(t, tx)
	repo := postgres.NewTopicRepository(tx)
	ctx := context.Background()

	topic := domain.NewKafkaTopic(uuid.New(), "update-topic", "dev")
	topic.ClusterID = cluster.ID
	require.NoError(t, repo.Create(ctx, topic))

	approver := uuid.New()
	topic.Approve(approver)
	err := repo.Update(ctx, topic)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, topic.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.TopicStatusProvisioning, got.Status)
	assert.Equal(t, &approver, got.ApprovedBy)
}

func TestTopicRepository_Delete(t *testing.T) {
	tx := setupTestTx(t)
	cluster := createTestCluster(t, tx)
	repo := postgres.NewTopicRepository(tx)
	ctx := context.Background()

	topic := domain.NewKafkaTopic(uuid.New(), "delete-topic", "dev")
	topic.ClusterID = cluster.ID
	require.NoError(t, repo.Create(ctx, topic))

	err := repo.Delete(ctx, topic.ID)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, topic.ID)
	require.NoError(t, err)
	assert.Nil(t, got)
}
