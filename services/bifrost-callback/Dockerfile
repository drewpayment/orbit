# services/bifrost-callback/Dockerfile
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install git for fetching dependencies
RUN apk add --no-cache git

# Copy proto module first (shared dependency)
COPY proto ./proto

# Copy service files
COPY services/bifrost-callback/go.mod services/bifrost-callback/go.sum ./services/bifrost-callback/
WORKDIR /app/services/bifrost-callback

# Download dependencies
RUN go mod download

# Copy source code
COPY services/bifrost-callback ./

# Update dependencies and build
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o /bifrost-callback ./cmd/server

# Final stage
FROM alpine:3.19

RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY --from=builder /bifrost-callback .

ENV GRPC_PORT=50061
ENV TEMPORAL_ADDRESS=temporal-server:7233
ENV TEMPORAL_NAMESPACE=default

EXPOSE 50061

ENTRYPOINT ["./bifrost-callback"]
