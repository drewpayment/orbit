# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /build

# Install git for module downloads
RUN apk add --no-cache git

# Copy go.mod files first for better caching
COPY proto/go.mod proto/go.sum ./proto/
COPY services/build-service/go.mod services/build-service/go.sum ./services/build-service/

# Download dependencies
WORKDIR /build/services/build-service
RUN go mod download

# Copy source code
WORKDIR /build
COPY proto/ ./proto/
COPY services/build-service/ ./services/build-service/

# Build the binary
WORKDIR /build/services/build-service
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server ./cmd/server

# Runtime stage
FROM alpine:3.19

WORKDIR /app

# Install dependencies for building and container operations
RUN apk add --no-cache ca-certificates git docker-cli

# Create work directory for builds
RUN mkdir -p /tmp/orbit-builds

# Copy the binary
COPY --from=builder /app/server .

# Expose ports
EXPOSE 50054

# Run the server
CMD ["./server"]
