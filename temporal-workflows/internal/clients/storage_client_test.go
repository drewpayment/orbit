package clients

import (
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewStorageClient(t *testing.T) {
	logger := slog.Default()

	t.Run("creates client with valid config", func(t *testing.T) {
		// Note: This won't actually connect - just validates construction
		client, err := NewStorageClient(
			"localhost:9000",
			"minioadmin",
			"minioadmin",
			"test-bucket",
			false,
			logger,
		)
		require.NoError(t, err)
		assert.NotNil(t, client)
		assert.Equal(t, "test-bucket", client.bucket)
	})

	t.Run("returns error with empty endpoint", func(t *testing.T) {
		_, err := NewStorageClient("", "key", "secret", "bucket", false, logger)
		assert.Error(t, err)
	})
}

func TestStorageClient_UploadJSON(t *testing.T) {
	t.Run("marshals and reports size correctly", func(t *testing.T) {
		// This is a unit test verifying JSON marshaling logic
		// Integration test with real MinIO would be separate
		data := map[string]any{
			"key1": "value1",
			"key2": 123,
		}

		jsonBytes, err := json.Marshal(data)
		require.NoError(t, err)
		assert.Greater(t, len(jsonBytes), 0)
	})
}

func TestStorageClient_EnsureBucket(t *testing.T) {
	t.Run("validates bucket name stored correctly", func(t *testing.T) {
		logger := slog.Default()

		client, err := NewStorageClient(
			"localhost:9000",
			"minioadmin",
			"minioadmin",
			"my-archive-bucket",
			false,
			logger,
		)
		require.NoError(t, err)
		assert.Equal(t, "my-archive-bucket", client.bucket)
	})
}

func TestStorageClient_Close(t *testing.T) {
	t.Run("close is a no-op for MinIO client", func(t *testing.T) {
		logger := slog.Default()

		client, err := NewStorageClient(
			"localhost:9000",
			"minioadmin",
			"minioadmin",
			"test-bucket",
			false,
			logger,
		)
		require.NoError(t, err)

		// Close should not error
		err = client.Close()
		assert.NoError(t, err)
	})
}
