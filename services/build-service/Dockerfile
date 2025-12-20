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

# Runtime stage - use Debian for glibc compatibility (required by mise/railpack)
FROM debian:bookworm-slim

WORKDIR /app

# Install dependencies for building and container operations
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    curl \
    bash \
    tar \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI
RUN curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y --no-install-recommends docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

# Install Railpack for automatic container image building
# Railpack will download and manage mise automatically
RUN curl -sSL https://railpack.com/install.sh | sh && \
    railpack --version

# Create work directory for builds
RUN mkdir -p /tmp/orbit-builds

# Copy the binary
COPY --from=builder /app/server .

# Expose ports
EXPOSE 50054

# Run the server
CMD ["./server"]
