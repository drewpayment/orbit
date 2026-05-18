# Build stage
FROM golang:1.25-alpine AS builder

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

# kubectl is needed when AGENT_SANDBOX_BACKEND=k8s — the Infrastructure
# Agent's K8s SandboxExecutor shells out to it. Pinned to align with the
# server version range in infrastructure/k8s/agent-sandbox/.
ARG KUBECTL_VERSION=v1.31.1

RUN apk --no-cache add ca-certificates curl bash git \
    && ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') \
    && curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${ARCH}/kubectl" -o /usr/local/bin/kubectl \
    && chmod +x /usr/local/bin/kubectl \
    && apk del curl

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/worker .

# Run the worker
CMD ["./worker"]
