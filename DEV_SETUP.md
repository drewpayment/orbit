# Orbit Development Environment Setup

This guide explains how to set up and run the Orbit development environment using Docker.

## Quick Start

### Option 1: Hybrid Setup (Infrastructure in Docker, orbit-www locally - RECOMMENDED)

If you prefer to run orbit-www outside of Docker for faster HMR:

```bash
# Start infrastructure only
make dev-local

# In another terminal, start orbit-www
cd orbit-www
bun run dev
```

### Option 2: Full Docker Setup

Start everything with a single command:

```bash
make dev
```

This will:
- Build all Docker images
- Start all infrastructure services (Temporal, MongoDB, PostgreSQL, Redis)
- Start orbit-www with hot module reloading
- Start the Temporal worker

Access the services:
- **Frontend**: http://localhost:3000
- **Temporal UI**: http://localhost:8080
- **MongoDB**: mongodb://localhost:27017
- **PostgreSQL**: postgresql://localhost:5433
- **Redis**: redis://localhost:6379

## Services Overview

### Core Application
- **orbit-www**: Next.js 15 + Payload CMS frontend
- **temporal-worker**: Go worker processing GitHub token refresh workflows

### Infrastructure
- **mongo**: MongoDB for Payload CMS data
- **temporal-server**: Temporal workflow engine
- **temporal-postgresql**: Database for Temporal
- **temporal-elasticsearch**: Search/visibility for Temporal
- **temporal-ui**: Web UI for monitoring workflows
- **postgres**: PostgreSQL for future Go services
- **redis**: Redis for caching and pub/sub

## Development Workflow

### Starting Development

```bash
# Start everything
make dev

# View logs for all services
docker-compose logs -f

# View logs for specific service
docker-compose logs -f orbit-www
docker-compose logs -f temporal-worker
```

### Stopping Development

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

### Rebuilding After Code Changes

#### Temporal Worker Changes

```bash
# Rebuild and restart worker
docker-compose up -d --build temporal-worker
```

#### orbit-www Changes

With the Docker setup, orbit-www has Hot Module Reloading (HMR) enabled:
- Source code changes are automatically detected
- No rebuild needed for most changes
- If HMR doesn't work, restart the container:

```bash
docker-compose restart orbit-www
```

## Environment Variables

### orbit-www

Environment variables are loaded from `orbit-www/.env`:

```bash
NEXT_PUBLIC_GITHUB_APP_NAME=orbit-idp
DATABASE_URI=mongodb://127.0.0.1:27017/orbit-www
PAYLOAD_SECRET=f0441e9d911d3bad9c9d087d
NEXT_PUBLIC_APP_URL=http://localhost:3000

GITHUB_APP_ID=...
GITHUB_APP_CLIENT_ID=...
GITHUB_APP_CLIENT_SECRET=...
GITHUB_APP_WEBHOOK_SECRET=...
GITHUB_APP_PRIVATE_KEY_BASE64=...
ENCRYPTION_KEY=...
```

**Note**: When running in Docker, the container can access MongoDB at `mongo:27017` (Docker network). The `DATABASE_URI` is overridden in docker-compose.yml.

### Temporal Worker

Environment variables are set in docker-compose.yml:
- `TEMPORAL_ADDRESS=temporal-server:7233`
- `TEMPORAL_NAMESPACE=default`
- `ORBIT_API_URL=http://orbit-www:3000`

## Troubleshooting

### Temporal worker can't connect to Temporal server

```bash
# Check if temporal-server is running
docker-compose ps temporal-server

# View temporal-server logs
docker-compose logs temporal-server

# Restart temporal-server
docker-compose restart temporal-server
```

### orbit-www can't connect to MongoDB

```bash
# Check if mongo is running
docker-compose ps mongo

# Check DATABASE_URI is set correctly in docker-compose.yml
# It should be: mongodb://mongo:27017/orbit-www
```

### Port conflicts

If ports are already in use:

```bash
# Check what's using the port
lsof -i :3000  # or :8080, :27017, etc.

# Stop conflicting services or change ports in docker-compose.yml
```

### HMR not working in orbit-www

```bash
# Restart the container
docker-compose restart orbit-www

# If still not working, rebuild
docker-compose up -d --build orbit-www
```

### Clean slate (nuclear option)

```bash
# Stop everything and remove all data
docker-compose down -v

# Rebuild and start fresh
make dev
```

## Testing GitHub App Integration

1. Start all services: `make dev`
2. Navigate to http://localhost:3000/settings/github
3. Click "+ Install GitHub App"
4. Complete GitHub App installation
5. You'll be redirected back to configure workspaces
6. Check Temporal UI at http://localhost:8080 to see the token refresh workflow running
7. View worker logs: `docker-compose logs -f temporal-worker`

## Additional Commands

```bash
# View all available commands
make help

# Run tests
make test

# Lint code
make lint

# Build all services (without Docker)
make build

# Generate protobuf code
make proto-gen
```

## Docker Compose Commands

```bash
# Start specific services
docker-compose up -d mongo temporal-server orbit-www

# Stop specific services
docker-compose stop orbit-www

# Restart services
docker-compose restart temporal-worker

# View logs
docker-compose logs -f [service-name]

# Execute command in running container
docker-compose exec orbit-www sh

# Remove stopped containers
docker-compose rm
```

## Development Tips

1. **Use `make dev-local` for faster frontend iteration** - HMR is slightly faster when running orbit-www outside Docker

2. **Monitor workflows in Temporal UI** - http://localhost:8080 shows all running workflows, activities, and task queues

3. **Check worker logs** when debugging workflows:
   ```bash
   docker-compose logs -f temporal-worker
   ```

4. **Use Docker volumes** for persistent data - Your MongoDB and PostgreSQL data persists between restarts

5. **Rebuild when changing dependencies**:
   ```bash
   # For orbit-www (package.json changes)
   docker-compose up -d --build orbit-www

   # For temporal-worker (go.mod changes)
   docker-compose up -d --build temporal-worker
   ```

## Next Steps

- Review the main [CLAUDE.md](./CLAUDE.md) for comprehensive project documentation
- Check [docs/plans/](./docs/plans/) for implementation plans
- View `.agent/SOPs/` for standard operating procedures
