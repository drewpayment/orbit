#!/bin/sh
set -e

# Wait for MinIO to be ready
until mc alias set myminio http://minio:9000 orbit-admin orbit-secret-key; do
  echo "Waiting for MinIO..."
  sleep 2
done

# Create bucket if it doesn't exist
mc mb --ignore-existing myminio/orbit-registry

echo "MinIO bucket 'orbit-registry' ready"
