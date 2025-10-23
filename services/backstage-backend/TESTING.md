# Backstage Backend Testing Guide

This guide explains how to test the Backstage backend service for Orbit IDP.

## Prerequisites

- Node.js 18+ or 20+
- Yarn package manager
- PostgreSQL running on port 5433 (via docker-compose)
- Access to the Orbit project directory

## Phase 1 Testing: Basic Backend Startup

### Step 1: Install Dependencies

```bash
cd services/backstage-backend
yarn install
```

Expected output:
- All packages should install successfully
- Total ~2800+ packages (including Backstage core + plugins)
- No HIGH/CRITICAL vulnerabilities

### Step 2: Build the Backend

```bash
yarn build
```

Expected output:
- TypeScript compilation succeeds
- No type errors
- Build artifacts created in `dist/` directory

### Step 3: Start PostgreSQL

Ensure PostgreSQL is running:

```bash
# From project root
docker-compose up -d postgres
```

Verify connection:
```bash
psql -h localhost -p 5433 -U orbit -c "\l" | grep backstage
```

Should show `backstage` database.

### Step 4: Start Backstage Backend

```bash
# Development mode (with hot reload)
yarn dev

# OR Production mode
yarn start
```

Expected output:
```
[1] Backend server started on port 7007
[2] Loaded workspace isolation middleware
[3] Registered plugins:
    - catalog
    - scaffolder
    - auth
    - github-actions
    - argo-cd
```

### Step 5: Health Check

Test the backend is running:

```bash
curl http://localhost:7007/api/catalog/entities
```

Expected response:
```json
{
  "items": []
}
```

(Empty array is correct - no entities registered yet)

### Step 6: Workspace Isolation Test

Test workspace header validation:

```bash
# Without workspace header (should warn in logs but allow for MVP)
curl http://localhost:7007/api/catalog/entities

# With workspace header (proper usage)
curl -H "X-Orbit-Workspace-Id: ws-test-123" \
  http://localhost:7007/api/catalog/entities
```

Check backend logs for:
```
[backstage] Workspace context attached: workspaceId=ws-test-123
```

## Phase 1 Success Criteria

- ✅ Dependencies install without errors
- ✅ TypeScript build succeeds
- ✅ Backend starts on port 7007
- ✅ PostgreSQL connection successful
- ✅ All plugins load without errors
- ✅ Health check endpoint responds
- ✅ Workspace isolation middleware logs workspace ID

## Common Issues & Solutions

### Issue: PostgreSQL Connection Failed

**Error:**
```
Error: connect ECONNREFUSED 127.0.0.1:5433
```

**Solution:**
```bash
# Ensure PostgreSQL is running
docker-compose up -d postgres

# Check PostgreSQL logs
docker-compose logs postgres

# Verify port is open
lsof -i :5433
```

### Issue: Plugin Registration Failed

**Error:**
```
Failed to load plugin @backstage-community/plugin-github-actions-backend
```

**Solution:**
```bash
# Reinstall dependencies
rm -rf node_modules yarn.lock
yarn install

# Rebuild
yarn build
```

### Issue: TypeScript Compilation Errors

**Error:**
```
Cannot find module '@backstage/backend-defaults'
```

**Solution:**
```bash
# Ensure all dependencies are installed
yarn install

# Check package versions match
yarn list @backstage/backend-defaults
```

### Issue: Port 7007 Already in Use

**Error:**
```
EADDRINUSE: address already in use :::7007
```

**Solution:**
```bash
# Find and kill process using port 7007
lsof -ti:7007 | xargs kill -9

# OR use a different port
export PORT=7008
yarn dev
```

## Testing Individual Plugins

### Catalog Plugin

```bash
# List all entities
curl http://localhost:7007/api/catalog/entities

# Get entity by UID
curl http://localhost:7007/api/catalog/entities/by-uid/{uid}

# List entity facets
curl http://localhost:7007/api/catalog/entity-facets
```

### GitHub Actions Plugin

Requires `GITHUB_TOKEN` environment variable:

```bash
export GITHUB_TOKEN=ghp_your_token_here
yarn dev
```

Test workflow endpoint:
```bash
curl http://localhost:7007/api/github-actions/workflows
```

### ArgoCD Plugin

Requires ArgoCD instance configuration in `app-config.yaml`.

For testing without real ArgoCD:
```yaml
argocd:
  appLocatorMethods:
    - type: 'config'
      instances:
        - name: test-instance
          url: http://argocd-test.local
          token: test-token
```

Test endpoint:
```bash
curl http://localhost:7007/api/argocd/argoInstance/test-instance/applications
```

## Next Steps

Once Phase 1 testing passes:

1. **Phase 2**: Create Go plugins gRPC service to proxy Backstage APIs
2. **Phase 3**: Create Payload CMS collections for plugin management
3. **Phase 4**: Build frontend integration with gRPC clients

## Docker Testing

Test the Dockerized backend:

```bash
# Build image
docker build -t orbit-backstage:test .

# Run container
docker run -p 7007:7007 \
  -e POSTGRES_HOST=host.docker.internal \
  -e POSTGRES_PORT=5433 \
  -e POSTGRES_USER=orbit \
  -e POSTGRES_PASSWORD=orbit \
  -e POSTGRES_DATABASE=backstage \
  orbit-backstage:test

# Health check
curl http://localhost:7007/api/catalog/entities
```

## Docker Compose Testing

Test the full stack:

```bash
# From project root
docker-compose up -d postgres backstage-backend

# View logs
docker-compose logs -f backstage-backend

# Test endpoint
curl http://localhost:7007/api/catalog/entities
```

## Debugging

### Enable Debug Logging

```bash
export LOG_LEVEL=debug
yarn dev
```

### Inspect Database

```bash
# Connect to PostgreSQL
psql -h localhost -p 5433 -U orbit backstage

# List tables created by Backstage
\dt

# Inspect entities table
SELECT * FROM entities LIMIT 10;
```

### Check Plugin Health

Each plugin exposes metadata:

```bash
# Catalog plugin info
curl http://localhost:7007/api/catalog/entities?filter=kind=Component

# Auth providers
curl http://localhost:7007/api/auth/providers
```

## Performance Testing

Basic load test:

```bash
# Install Apache Bench
brew install httpd  # macOS

# Run load test (100 requests, 10 concurrent)
ab -n 100 -c 10 http://localhost:7007/api/catalog/entities
```

Expected results:
- Mean response time: < 100ms
- 99th percentile: < 500ms
- No failed requests

## Security Audit

```bash
# Check for vulnerabilities
npm audit --audit-level=high

# Update vulnerable packages
npm audit fix

# Generate audit report
npm audit --json > audit-report.json
```

## Cleanup

```bash
# Stop backend
# Press Ctrl+C in terminal

# Clean build artifacts
yarn clean

# Remove node_modules (if needed)
rm -rf node_modules

# Stop Docker containers
docker-compose down
```

---

**Questions or Issues?**

See main [README.md](./README.md) or check [Phase 0 Research Findings](../../.agent/research/phase-0-backstage-poc/FINDINGS.md).
