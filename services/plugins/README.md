# Orbit Plugins gRPC Service

Go-based gRPC service that proxies requests to Backstage backend, enforcing workspace isolation and providing plugin management APIs.

## Architecture

This service acts as a middleware layer between Orbit's frontend and Backstage backend:

```
Frontend (TypeScript) → gRPC (plugins service) → HTTP (Backstage backend) → External APIs
```

## Features

- **Generic Proxy**: Single `ProxyPluginRequest` endpoint works for all plugins
- **Workspace Isolation**: Validates JWT claims and workspace access
- **Circuit Breaker**: Automatic failure detection and recovery
- **Health Checks**: HTTP endpoints for Kubernetes readiness/liveness probes
- **Reflection**: gRPC reflection enabled for debugging with grpcurl

## Development

### Prerequisites

- Go 1.21+
- Backstage backend running on port 7007
- Protocol buffers generated (`make proto-gen` from project root)

### Setup

```bash
# Install dependencies
go mod download

# Build
go build -o bin/plugins-service ./cmd/server

# Run
./bin/plugins-service
```

### Environment Variables

```bash
# gRPC server port
GRPC_PORT=50053

# HTTP server port (metrics/health)
HTTP_PORT=8080

# Backstage backend URL
BACKSTAGE_URL=http://localhost:7007

# JWT secret for token validation
JWT_SECRET=your-secret-key

# Timeouts
BACKSTAGE_TIMEOUT=10s
GRPC_DEADLINE=15s
CIRCUIT_BREAKER_TIMEOUT=30s

# Redis (for future caching)
REDIS_URL=redis://localhost:6379
```

### Testing

```bash
# Run tests
go test -v ./...

# Run tests with coverage
go test -v -race -coverprofile=coverage.out ./...
go tool cover -html=coverage.out

# Run specific package tests
go test -v ./internal/backstage/...
```

### Testing with grpcurl

```bash
# List available services
grpcurl -plaintext localhost:50053 list

# List available methods
grpcurl -plaintext localhost:50053 list idp.plugins.v1.PluginsService

# Call ListPlugins
grpcurl -plaintext -d '{"workspace_id": "ws-123"}' \
  localhost:50053 idp.plugins.v1.PluginsService/ListPlugins

# Proxy request to Backstage catalog
grpcurl -plaintext -d '{
  "workspace_id": "ws-123",
  "plugin_id": "catalog",
  "endpoint_path": "/entities",
  "http_method": "GET"
}' localhost:50053 idp.plugins.v1.PluginsService/ProxyPluginRequest
```

## API Reference

### ListPlugins

Lists all available plugins for a workspace.

**Request:**
```protobuf
message ListPluginsRequest {
  string workspace_id = 1;
  string category = 2; // Optional filter
  optional bool enabled_only = 3;
}
```

**Response:**
```protobuf
message ListPluginsResponse {
  repeated Plugin plugins = 1;
}
```

### ProxyPluginRequest

Generic proxy for all plugin requests.

**Request:**
```protobuf
message ProxyPluginRequestMessage {
  string workspace_id = 1;
  string plugin_id = 2;
  string endpoint_path = 3; // e.g., "/entities"
  string http_method = 4; // GET, POST, PUT, DELETE
  map<string, string> query_params = 5;
  map<string, string> headers = 6;
  bytes body = 7;
}
```

**Response:**
```protobuf
message ProxyPluginResponse {
  int32 status_code = 1;
  bytes data = 2; // Raw JSON from Backstage
  map<string, string> headers = 3;
  string error_message = 4;
  bool from_cache = 5;
}
```

## Circuit Breaker

The service uses the circuit breaker pattern for resilience:

- **Closed**: Normal operation, requests flow through
- **Open**: Too many failures (60% of last 5 requests), fast-fail mode
- **Half-Open**: Testing recovery after 30s timeout

### States

```
CLOSED → (failures exceed threshold) → OPEN → (30s timeout) → HALF-OPEN → (success) → CLOSED
                                                   ↓ (failure)
                                                 OPEN
```

### Monitoring

Check circuit breaker state via logs:
```
[Circuit Breaker] backstage-api: CLOSED -> OPEN
[Alert] Backstage circuit breaker OPEN - service degraded
```

## Docker

```bash
# Build image
docker build -t orbit-plugins:latest .

# Run container
docker run -p 50053:50053 -p 8080:8080 \
  -e BACKSTAGE_URL=http://backstage:7007 \
  -e JWT_SECRET=your-secret \
  orbit-plugins:latest

# Health check
curl http://localhost:8080/health
```

## Production Deployment

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: plugins-service
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: plugins
        image: orbit-plugins:latest
        ports:
        - containerPort: 50053
          name: grpc
        - containerPort: 8080
          name: http
        env:
        - name: BACKSTAGE_URL
          value: "http://backstage-backend:7007"
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: orbit-secrets
              key: jwt-secret
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
```

## Troubleshooting

### Service won't start

**Check Backstage connectivity:**
```bash
curl http://localhost:7007/healthcheck
```

**Check environment variables:**
```bash
env | grep -E "BACKSTAGE|GRPC|JWT"
```

### Circuit breaker keeps opening

**Symptoms:** All requests fail with "circuit breaker open" error

**Solutions:**
1. Check Backstage backend logs for errors
2. Verify Backstage is responding on port 7007
3. Check network connectivity between services
4. Review circuit breaker thresholds in code

### Authentication errors

**Missing JWT:**
- For development, auth is optional (requests allowed without JWT)
- For production, ensure frontend sends `authorization` header

**Invalid JWT:**
- Verify JWT_SECRET matches between services
- Check token hasn't expired
- Validate workspace claim is present

### gRPC connection refused

**Check service is running:**
```bash
lsof -i :50053
```

**Test with grpcurl:**
```bash
grpcurl -plaintext localhost:50053 list
```

## Future Enhancements

- [ ] Redis caching for Backstage responses
- [ ] Prometheus metrics export
- [ ] Distributed tracing (OpenTelemetry)
- [ ] Rate limiting per workspace
- [ ] Plugin instance routing (multi-instance Backstage)
- [ ] Payload CMS integration for plugin metadata

## License

Elastic License 2.0
