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

func TestServiceAccountRepository_CreateAndGetByID(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewServiceAccountRepository(tx)
	ctx := context.Background()

	wsID := uuid.New()
	creator := uuid.New()
	account := domain.NewKafkaServiceAccount(wsID, "my-producer", domain.ServiceAccountTypeProducer, creator)

	err := repo.Create(ctx, account)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, account.ID)
	require.NoError(t, err)
	require.NotNil(t, got)

	assert.Equal(t, account.ID, got.ID)
	assert.Equal(t, "my-producer", got.Name)
	assert.Equal(t, domain.ServiceAccountTypeProducer, got.Type)
	assert.Equal(t, domain.ServiceAccountStatusActive, got.Status)
	assert.Equal(t, wsID, got.WorkspaceID)
}

func TestServiceAccountRepository_List(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewServiceAccountRepository(tx)
	ctx := context.Background()

	wsID := uuid.New()
	a1 := domain.NewKafkaServiceAccount(wsID, "producer-1", domain.ServiceAccountTypeProducer, uuid.New())
	a2 := domain.NewKafkaServiceAccount(wsID, "consumer-1", domain.ServiceAccountTypeConsumer, uuid.New())
	a3 := domain.NewKafkaServiceAccount(uuid.New(), "other-ws", domain.ServiceAccountTypeAdmin, uuid.New())

	require.NoError(t, repo.Create(ctx, a1))
	require.NoError(t, repo.Create(ctx, a2))
	require.NoError(t, repo.Create(ctx, a3))

	accounts, err := repo.List(ctx, wsID)
	require.NoError(t, err)
	assert.Len(t, accounts, 2)
}

func TestServiceAccountRepository_Update(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewServiceAccountRepository(tx)
	ctx := context.Background()

	account := domain.NewKafkaServiceAccount(uuid.New(), "revoke-me", domain.ServiceAccountTypeConsumer, uuid.New())
	require.NoError(t, repo.Create(ctx, account))

	account.Revoke()
	err := repo.Update(ctx, account)
	require.NoError(t, err)

	got, err := repo.GetByID(ctx, account.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.ServiceAccountStatusRevoked, got.Status)
}

func TestServiceAccountRepository_GetByID_NotFound(t *testing.T) {
	tx := setupTestTx(t)
	repo := postgres.NewServiceAccountRepository(tx)
	ctx := context.Background()

	got, err := repo.GetByID(ctx, uuid.New())
	require.NoError(t, err)
	assert.Nil(t, got)
}
