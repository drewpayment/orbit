# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /build

# Install git for module downloads
RUN apk add --no-cache git

# Copy go mod files first for better caching
COPY proto/go.mod proto/go.sum ./proto/
COPY services/kafka/go.mod services/kafka/go.sum ./services/kafka/
COPY temporal-workflows/go.mod temporal-workflows/go.sum ./temporal-workflows/

# Download dependencies
WORKDIR /build/temporal-workflows
RUN go mod download

# Copy source code
WORKDIR /build
COPY proto/ ./proto/
COPY services/kafka/ ./services/kafka/
COPY temporal-workflows/ ./temporal-workflows/

# Build the worker
WORKDIR /build/temporal-workflows
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/worker ./cmd/worker

# Runtime stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/worker .

# Run the worker
CMD ["./worker"]
