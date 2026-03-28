//go:build integration

package postgres_test

import (
	"context"
	"testing"

	"github.com/drewpayment/orbit/services/kafka/internal/repository/postgres"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProviderRepository_List(t *testing.T) {
	repo := postgres.NewProviderRepository()
	ctx := context.Background()

	providers, err := repo.List(ctx)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, len(providers), 4) // apache-kafka, confluent-cloud, aws-msk, redpanda
}

func TestProviderRepository_GetByID(t *testing.T) {
	repo := postgres.NewProviderRepository()
	ctx := context.Background()

	got, err := repo.GetByID(ctx, "apache-kafka")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "Apache Kafka", got.DisplayName)
}

func TestProviderRepository_GetByID_NotFound(t *testing.T) {
	repo := postgres.NewProviderRepository()
	ctx := context.Background()

	got, err := repo.GetByID(ctx, "nonexistent-provider")
	require.NoError(t, err)
	assert.Nil(t, got)
}
