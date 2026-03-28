//go:build integration

package postgres_test

import (
	"context"
	"testing"

	"github.com/drewpayment/orbit/services/kafka/internal/domain"
	"github.com/drewpayment/orbit/services/kafka/internal/repository/postgres"
	"github.com/drewpayment/orbit/services/kafka/internal/service"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func createTestTopic(t *testing.T, tx postgres.DBTX) *domain.KafkaTopic {
	t.Helper()
	cluster := createTestCluster(t, tx)
	repo := postgres.NewTopicRepository(tx)
	topic := domain.NewKafkaTopic(uuid.New(), "test-topic-"+uuid.New().String()[:8], "dev")
	topic.ClusterID = cluster.ID
	require.NoError(t, repo.Create(context.Background(), topic))
	return topic
}

func TestShareRepository_CreateAndGetByID(t *testing.T) {
	tx := setupTestTx(t)
	topic := createTestTopic(t, tx)
	repo := postgres.NewShareRepository(tx)
	ctx := context.Background()

	wsID := uuid.New()
	requester := uuid.New()
	share := domain.NewTopicShareRequest(topic.ID, wsID, requester, domain.SharePermissionRead, "need access for analytics")

	err := repo.Create(ctx, share)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, share.ID)
	require.NoError(t, err)
	require.NotNil(t, got)

	assert.Equal(t, share.ID, got.ID)
	assert.Equal(t, topic.ID, got.TopicID)
	assert.Equal(t, domain.ShareStatusPendingRequest, got.Status)
	assert.Equal(t, domain.SharePermissionRead, got.Permission)
	assert.Equal(t, "need access for analytics", got.Justification)
}

func TestShareRepository_List_WithFilter(t *testing.T) {
	tx := setupTestTx(t)
	topic := createTestTopic(t, tx)
	repo := postgres.NewShareRepository(tx)
	ctx := context.Background()

	ws1 := uuid.New()
	ws2 := uuid.New()
	s1 := domain.NewTopicShareRequest(topic.ID, ws1, uuid.New(), domain.SharePermissionRead, "reason1")
	s2 := domain.NewTopicShareRequest(topic.ID, ws2, uuid.New(), domain.SharePermissionWrite, "reason2")
	require.NoError(t, repo.Create(ctx, s1))
	require.NoError(t, repo.Create(ctx, s2))

	// Filter by topic
	shares, err := repo.List(ctx, service.ShareFilter{TopicID: &topic.ID})
	require.NoError(t, err)
	assert.Len(t, shares, 2)

	// Filter by workspace
	shares, err = repo.List(ctx, service.ShareFilter{WorkspaceID: &ws1})
	require.NoError(t, err)
	assert.Len(t, shares, 1)
	assert.Equal(t, s1.ID, shares[0].ID)
}

func TestShareRepository_GetExisting(t *testing.T) {
	tx := setupTestTx(t)
	topic := createTestTopic(t, tx)
	repo := postgres.NewShareRepository(tx)
	ctx := context.Background()

	wsID := uuid.New()
	share := domain.NewTopicShareRequest(topic.ID, wsID, uuid.New(), domain.SharePermissionRead, "reason")
	require.NoError(t, repo.Create(ctx, share))

	got, err := repo.GetExisting(ctx, topic.ID, wsID)
	require.NoError(t, err)
	assert.Equal(t, share.ID, got.ID)
}

func TestShareRepository_GetExisting_NotFound(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewShareRepository(tx)
	ctx := context.Background()

	_, err := repo.GetExisting(ctx, uuid.New(), uuid.New())
	assert.ErrorIs(t, err, domain.ErrShareNotFound)
}

func TestShareRepository_Update(t *testing.T) {
	tx := setupTestTx(t)
	topic := createTestTopic(t, tx)
	repo := postgres.NewShareRepository(tx)
	ctx := context.Background()

	share := domain.NewTopicShareRequest(topic.ID, uuid.New(), uuid.New(), domain.SharePermissionRead, "reason")
	require.NoError(t, repo.Create(ctx, share))

	approver := uuid.New()
	share.Approve(approver, nil)
	err := repo.Update(ctx, share)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, share.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.ShareStatusApproved, got.Status)
	assert.Equal(t, &approver, got.ApprovedBy)
}

func TestShareRepository_Delete(t *testing.T) {
	tx := setupTestTx(t)
	topic := createTestTopic(t, tx)
	repo := postgres.NewShareRepository(tx)
	ctx := context.Background()

	share := domain.NewTopicShareRequest(topic.ID, uuid.New(), uuid.New(), domain.SharePermissionRead, "reason")
	require.NoError(t, repo.Create(ctx, share))

	err := repo.Delete(ctx, share.ID)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, share.ID)
	require.NoError(t, err)
	assert.Nil(t, got)
}
