package clients

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// StorageClient provides S3-compatible object storage access.
type StorageClient struct {
	client *minio.Client
	bucket string
	logger *slog.Logger
}

// NewStorageClient creates a new MinIO/S3 storage client.
func NewStorageClient(endpoint, accessKey, secretKey, bucket string, useSSL bool, logger *slog.Logger) (*StorageClient, error) {
	if endpoint == "" {
		return nil, fmt.Errorf("endpoint is required")
	}

	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("creating minio client: %w", err)
	}

	return &StorageClient{
		client: client,
		bucket: bucket,
		logger: logger,
	}, nil
}

// UploadJSON serializes data to JSON and uploads to the specified path.
// Returns the number of bytes written.
func (c *StorageClient) UploadJSON(ctx context.Context, path string, data any) (int64, error) {
	c.logger.Debug("uploading JSON to storage",
		slog.String("bucket", c.bucket),
		slog.String("path", path),
	)

	jsonData, err := json.Marshal(data)
	if err != nil {
		return 0, fmt.Errorf("marshaling data: %w", err)
	}

	reader := bytes.NewReader(jsonData)
	size := int64(len(jsonData))

	info, err := c.client.PutObject(ctx, c.bucket, path, reader, size, minio.PutObjectOptions{
		ContentType: "application/json",
	})
	if err != nil {
		return 0, fmt.Errorf("uploading to storage: %w", err)
	}

	c.logger.Debug("upload complete",
		slog.Int64("bytes", info.Size),
		slog.String("etag", info.ETag),
	)

	return info.Size, nil
}

// EnsureBucket creates the bucket if it doesn't exist.
func (c *StorageClient) EnsureBucket(ctx context.Context) error {
	exists, err := c.client.BucketExists(ctx, c.bucket)
	if err != nil {
		return fmt.Errorf("checking bucket existence: %w", err)
	}

	if !exists {
		err = c.client.MakeBucket(ctx, c.bucket, minio.MakeBucketOptions{})
		if err != nil {
			return fmt.Errorf("creating bucket: %w", err)
		}
		c.logger.Info("created storage bucket", slog.String("bucket", c.bucket))
	}

	return nil
}

// Close is a no-op for the MinIO client as it doesn't maintain persistent connections.
// This method is provided for consistency with other clients in the package.
func (c *StorageClient) Close() error {
	// MinIO client doesn't require explicit cleanup
	return nil
}
