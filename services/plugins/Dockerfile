# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /build

# Install dependencies
RUN apk add --no-cache git

# Copy go.mod files first for better caching
COPY proto/go.mod proto/go.sum ./proto/
COPY services/plugins/go.mod services/plugins/go.sum ./services/plugins/

# Download dependencies
WORKDIR /build/services/plugins
RUN go mod download

# Copy source code
WORKDIR /build
COPY proto/ ./proto/
COPY services/plugins/ ./services/plugins/

# Build the binary
WORKDIR /build/services/plugins
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o /app/plugins-service ./cmd/server

# Runtime stage
FROM alpine:3.19

RUN apk --no-cache add ca-certificates

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/plugins-service .

# Expose gRPC and HTTP ports
EXPOSE 50053 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["./plugins-service"]
