# Orbit Backstage Backend

This is the Backstage backend service for Orbit IDP, providing plugin integration capabilities for external services (Jira, GitHub, Azure, etc.).

## Architecture

**Phase 1 (MVP)**: Single Backstage instance for testing
**Future Phases**: Separate Backstage instance per workspace for complete data isolation

See [Feature Plan](../../.agent/tasks/feature-backstage-plugin-integration.md) and [Phase 0 Research](../../.agent/research/phase-0-backstage-poc/FINDINGS.md) for architectural details.

## Development

### Prerequisites

- Node.js 18+ or 20+
- Yarn (preferred) or npm
- PostgreSQL 14+ (or SQLite for quick testing)

### Setup

```bash
# Install dependencies
yarn install

# Start in development mode (with hot reload)
yarn dev

# Build for production
yarn build

# Run tests
yarn test

# Lint code
yarn lint
```

### Configuration

The backend is configured via `app-config.yaml`. Key configuration:

- **Database**: PostgreSQL (production) or SQLite (development)
- **Port**: 7007
- **Workspace Isolation**: Custom middleware validates `X-Orbit-Workspace-Id` header
- **Plugins**: Installed via package.json, registered in `src/index.ts`

### Environment Variables

```bash
# PostgreSQL connection
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_USER=orbit
POSTGRES_PASSWORD=orbit
POSTGRES_DATABASE=backstage

# Orbit API integration
ORBIT_API_URL=http://localhost:3000
CONFIG_POLL_INTERVAL=60000  # Config refresh interval (ms)
```

### Docker

```bash
# Build image
docker build -t orbit-backstage:latest .

# Run container
docker run -p 7007:7007 \
  -e POSTGRES_HOST=host.docker.internal \
  -e POSTGRES_PORT=5433 \
  -e POSTGRES_USER=orbit \
  -e POSTGRES_PASSWORD=orbit \
  orbit-backstage:latest
```

## Adding Plugins

1. Install plugin package:
   ```bash
   yarn add @backstage-community/plugin-jira-backend
   ```

2. Register in `src/index.ts`:
   ```typescript
   backend.add(import('@backstage-community/plugin-jira-backend'));
   ```

3. Configure in `app-config.yaml` (if needed):
   ```yaml
   jira:
     - host: https://your-company.atlassian.net
       token: ${JIRA_API_TOKEN}
   ```

4. Rebuild and restart:
   ```bash
   yarn build
   yarn dev
   ```

## Workspace Isolation

All HTTP requests must include the `X-Orbit-Workspace-Id` header. This is enforced by the workspace isolation middleware in `src/modules/workspace-isolation/`.

Example:
```bash
curl -H "X-Orbit-Workspace-Id: ws-123" \
  http://localhost:7007/api/catalog/entities
```

## API Endpoints

Backstage plugins expose RESTful APIs at `/api/{plugin-id}/...`:

- `/api/catalog/entities` - Software catalog (core)
- `/api/jira/...` - Jira plugin endpoints (when installed)
- `/api/github-actions/...` - GitHub Actions plugin (when installed)
- `/api/argocd/...` - ArgoCD plugin (when installed)

See individual plugin documentation for full API reference.

## Testing

```bash
# Unit tests
yarn test

# With coverage
yarn test --coverage

# Watch mode
yarn test --watch
```

## Troubleshooting

### Backend won't start

1. Check PostgreSQL is running: `pg_isready -h localhost -p 5433`
2. Check database exists: `psql -h localhost -p 5433 -U orbit -l | grep backstage`
3. Check logs for specific error messages

### Plugin not loading

1. Verify plugin is installed: `yarn list | grep plugin-name`
2. Check plugin is registered in `src/index.ts`
3. Check plugin configuration in `app-config.yaml`

### Database connection errors

1. Verify PostgreSQL credentials in environment variables
2. For development, switch to SQLite by uncommenting the SQLite config in `app-config.yaml`

## Production Deployment

See `docker-compose.yml` and `infrastructure/kubernetes/` for production deployment configurations.

## Architecture Notes

- **Phase 0 Finding**: Backstage is single-tenant by design
- **Current (Phase 1)**: Single shared instance for MVP testing
- **Future (Phase 2+)**: Separate instance per workspace with dynamic routing

See [Phase 0 Research Findings](../../.agent/research/phase-0-backstage-poc/FINDINGS.md) for detailed analysis.

## License

Elastic License 2.0
