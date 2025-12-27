# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /build

# Install git for module downloads
RUN apk add --no-cache git

# Copy go.mod files first for better caching
COPY proto/go.mod proto/go.sum ./proto/
COPY services/kafka/go.mod services/kafka/go.sum ./services/kafka/

# Download dependencies
WORKDIR /build/services/kafka
RUN go mod download

# Copy source code
WORKDIR /build
COPY proto/ ./proto/
COPY services/kafka/ ./services/kafka/

# Build the binary
WORKDIR /build/services/kafka
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server ./cmd/server

# Runtime stage
FROM alpine:3.19

WORKDIR /app

# Install ca-certificates for HTTPS
RUN apk add --no-cache ca-certificates

# Copy the binary
COPY --from=builder /app/server .

# Expose gRPC port
EXPOSE 50055

# Run the server
CMD ["./server"]
