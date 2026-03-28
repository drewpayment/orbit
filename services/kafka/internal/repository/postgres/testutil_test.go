//go:build integration

package postgres_test

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/drewpayment/orbit/services/kafka/internal/repository/postgres"
	"github.com/drewpayment/orbit/services/kafka/migrations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// testPool is a shared connection pool for all integration tests (QA-004).
var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	connString := os.Getenv("TEST_DATABASE_URL")
	if connString == "" {
		connString = "postgres://orbit:orbit@localhost:5433/kafka_service_test?sslmode=disable"
	}

	ctx := context.Background()

	pool, err := pgxpool.New(ctx, connString)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to connect to test database: %v\n", err)
		os.Exit(1)
	}

	if err := pool.Ping(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "failed to ping test database: %v\n", err)
		os.Exit(1)
	}

	if err := postgres.RunMigrations(connString, migrations.FS); err != nil {
		fmt.Fprintf(os.Stderr, "failed to run migrations: %v\n", err)
		os.Exit(1)
	}

	testPool = pool
	code := m.Run()
	pool.Close()
	os.Exit(code)
}

// setupTestTx creates a transaction for test isolation.
// The transaction is rolled back on test cleanup, so no data leaks between tests.
func setupTestTx(t *testing.T) pgx.Tx {
	t.Helper()
	tx, err := testPool.Begin(context.Background())
	if err != nil {
		t.Fatalf("failed to begin transaction: %v", err)
	}
	t.Cleanup(func() {
		tx.Rollback(context.Background())
	})
	return tx
}
