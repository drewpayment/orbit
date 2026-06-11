#!/bin/sh
set -e

if [ -z "${MINIO_ROOT_USER}" ] || [ -z "${MINIO_ROOT_PASSWORD}" ]; then
  echo "ERROR: MINIO_ROOT_USER and MINIO_ROOT_PASSWORD must be set" >&2
  exit 1
fi

# Wait for MinIO to be ready
until mc alias set myminio http://minio:9000 "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}"; do
  echo "Waiting for MinIO..."
  sleep 2
done

# Create bucket if it doesn't exist
mc mb --ignore-existing myminio/orbit-registry

echo "MinIO bucket 'orbit-registry' ready"
