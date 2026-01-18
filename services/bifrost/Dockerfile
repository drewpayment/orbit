# services/bifrost/Dockerfile
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install git for fetching dependencies
RUN apk add --no-cache git

# Copy proto module first (shared dependency)
COPY proto ./proto

# Copy service files
COPY services/bifrost/go.mod services/bifrost/go.sum ./services/bifrost/
WORKDIR /app/services/bifrost

# Download dependencies
RUN go mod download

# Copy source code
COPY services/bifrost ./

# Update dependencies and build
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o /bifrost ./cmd/bifrost

# Final stage
FROM alpine:3.19

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /bifrost .

# Kafka proxy port, Admin gRPC port, Metrics port
EXPOSE 9092 50060 8080

ENTRYPOINT ["./bifrost"]
