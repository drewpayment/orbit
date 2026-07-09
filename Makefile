# Orbit Development Makefile

.PHONY: help dev dev-docker dev-local dev-local-full test test-go test-frontend lint lint-go lint-frontend build clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

dev: dev-docker ## Start complete development environment in Docker

dev-docker: ## Start all services in Docker (recommended)
	@./scripts/dev-start.sh

dev-local: ## Start core infrastructure in Docker, run orbit-www locally
	@echo "🚀 Starting core infrastructure and application services..."
	docker compose up -d \
		mongo postgres redis \
		temporal-postgresql temporal-elasticsearch temporal-server temporal-ui temporal-worker \
		redpanda redpanda-console \
		bifrost traefik \
		repository-service kafka-service \
		orbit-automations-worker
	@echo ""
	@echo "✅ Core services started!"
	@echo ""
	@echo "📝 To start orbit-www locally:"
	@echo "  cd orbit-www && bun run dev"
	@echo ""
	@echo "🔗 Service URLs:"
	@echo "  Frontend:          http://localhost:3000  (run locally)"
	@echo "  Temporal UI:       http://localhost:8080"
	@echo "  Redpanda Console:  http://localhost:8083"
	@echo ""
	@echo "ℹ️  Launches/build stack (MinIO, registry, BuildKit, build-service,"
	@echo "   launches-worker-azure) and Prometheus are not started."
	@echo "   Testing launches or image builds? Run: make dev-local-full"
	@echo ""
	@echo "ℹ️  Changed temporal-workflows/ code? The worker container does NOT"
	@echo "   rebuild automatically — run: make rebuild-worker"
	@echo ""

rebuild-worker: ## Rebuild + restart the Temporal worker (required after changing temporal-workflows/ — new workflows/activities only register via a fresh image)
	docker compose build temporal-worker
	docker compose up -d temporal-worker
	@echo "✅ temporal-worker rebuilt and restarted — new workflow/activity registrations are live."

dev-local-full: dev-local ## dev-local plus the launches/build stack and Prometheus
	@echo "🚀 Starting launches/build stack..."
	docker compose up -d \
		minio minio-init orbit-registry \
		buildkit build-service launches-worker-azure \
		prometheus
	@echo ""
	@echo "✅ Launches/build stack started!"
	@echo "  MinIO Console:     http://localhost:9001"
	@echo "  Prometheus:        http://localhost:9090"
	@echo ""

test: test-go test-frontend ## Run all tests

test-go: ## Run Go tests with coverage
	@echo "Running Go service tests..."
	@cd services/repository && go test -v -race -coverprofile=coverage.out ./... && go tool cover -html=coverage.out -o coverage.html
	@cd services/api-catalog && go test -v -race -coverprofile=coverage.out ./... && go tool cover -html=coverage.out -o coverage.html
	@cd services/knowledge && go test -v -race -coverprofile=coverage.out ./... && go tool cover -html=coverage.out -o coverage.html
	@cd services/build-service && go test -v -race -coverprofile=coverage.out ./... && go tool cover -html=coverage.out -o coverage.html
	@cd services/kafka && go test -v -race -coverprofile=coverage.out ./... && go tool cover -html=coverage.out -o coverage.html
	@cd services/bifrost && go test -v -race -coverprofile=coverage.out ./... && go tool cover -html=coverage.out -o coverage.html
	@cd temporal-workflows && go test -v -race -coverprofile=coverage.out ./... && go tool cover -html=coverage.out -o coverage.html

test-frontend: ## Run frontend tests
	@echo "Running frontend tests..."
	@cd orbit-www && pnpm test

test-e2e: ## Run end-to-end tests
	@echo "Running E2E tests..."
	@cd orbit-www && pnpm exec playwright test

lint: lint-go lint-frontend ## Run all linting

lint-go: ## Lint Go code
	@echo "Linting Go services..."
	@cd services/repository && golangci-lint run
	@cd services/api-catalog && golangci-lint run
	@cd services/knowledge && golangci-lint run
	@cd services/build-service && golangci-lint run
	@cd services/kafka && golangci-lint run
	@cd services/bifrost && golangci-lint run
	@cd temporal-workflows && golangci-lint run

lint-frontend: ## Lint frontend code
	@echo "Linting frontend..."
	@cd orbit-www && pnpm lint

security: ## Run security scans
	@echo "Running security scans..."
	@cd services/repository && gosec ./...
	@cd services/api-catalog && gosec ./...
	@cd services/knowledge && gosec ./...
	@cd services/build-service && gosec ./...
	@cd services/kafka && gosec ./...
	@cd services/bifrost && gosec ./...
	@cd temporal-workflows && gosec ./...
	@cd orbit-www && pnpm audit --audit-level moderate

build: ## Build all services
	@echo "Building services..."
	@cd services/repository && go build -o bin/repository ./cmd/server
	@cd services/api-catalog && go build -o bin/api-catalog ./cmd/server
	@cd services/knowledge && go build -o bin/knowledge ./cmd/server
	@cd services/build-service && go build -o bin/build-service ./cmd/server
	@cd services/kafka && go build -o bin/kafka ./cmd/server
	@cd services/bifrost && go build -o bin/bifrost ./cmd/bifrost
	@cd temporal-workflows && go build -o bin/worker ./cmd/worker
	@cd orbit-www && pnpm build

clean: ## Clean build artifacts
	@echo "Cleaning..."
	@find . -name "bin" -type d -exec rm -rf {} +
	@find . -name "coverage.out" -delete
	@find . -name "coverage.html" -delete
	@cd orbit-www && rm -rf .next

docker-up: ## Start all services with Docker Compose
	docker-compose up -d

docker-down: ## Stop all services
	docker-compose down

docker-logs: ## View service logs
	docker-compose logs -f

proto-gen: ## Generate protobuf code
	@echo "Generating protobuf code..."
	@cd orbit-www && bun run generate:proto

install-deps: ## Install development dependencies
	@echo "Installing Go tools..."
	@go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	@go install github.com/securecodewarrior/gosec/v2/cmd/gosec@latest
	@echo "Installing frontend dependencies (includes buf CLI)..."
	@cd orbit-www && pnpm install