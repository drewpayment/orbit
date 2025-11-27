# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /build

# Install git for module downloads
RUN apk add --no-cache git

# Copy go.mod files first for better caching
COPY proto/go.mod proto/go.sum ./proto/
COPY temporal-workflows/go.mod temporal-workflows/go.sum ./temporal-workflows/
COPY services/repository/go.mod services/repository/go.sum ./services/repository/

# Download dependencies
WORKDIR /build/services/repository
RUN go mod download

# Copy source code
WORKDIR /build
COPY proto/ ./proto/
COPY temporal-workflows/ ./temporal-workflows/
COPY services/repository/ ./services/repository/

# Build the binary
WORKDIR /build/services/repository
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server ./cmd/server

# Runtime stage
FROM alpine:3.19

WORKDIR /app

# Install ca-certificates for HTTPS and git for git operations
RUN apk add --no-cache ca-certificates git

# Copy the binary
COPY --from=builder /app/server .

# Create work directory for templates
RUN mkdir -p /tmp/orbit-templates

# Expose ports
EXPOSE 50051 8081

# Run the server
CMD ["./server"]
