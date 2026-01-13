# Orbit Development Makefile

.PHONY: help dev dev-docker dev-local test test-go test-frontend lint lint-go lint-frontend build clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

dev: dev-docker ## Start complete development environment in Docker

dev-docker: ## Start all services in Docker (recommended)
	@./scripts/dev-start.sh

dev-local: ## Start infrastructure in Docker, run orbit-www locally
	@echo "🚀 Starting infrastructure services..."
	docker-compose up -d mongo temporal-postgresql temporal-elasticsearch temporal-server temporal-ui temporal-worker postgres redis
	@echo ""
	@echo "✅ Infrastructure started!"
	@echo ""
	@echo "📝 To start orbit-www locally:"
	@echo "  cd orbit-www && bun run dev"
	@echo ""

test: test-go test-frontend ## Run all tests

test-go: ## Run Go tests with coverage
	@echo "Running Go service tests..."
	@cd services/repository && go test -v -race -coverprofile=coverage.out ./... && go tool cover -html=coverage.out -o coverage.html
	@cd services/api-catalog && go test -v -race -coverprofile=coverage.out ./... && go tool cover -html=coverage.out -o coverage.html
	@cd services/knowledge && go test -v -race -coverprofile=coverage.out ./... && go tool cover -html=coverage.out -o coverage.html
	@cd services/build-service && go test -v -race -coverprofile=coverage.out ./... && go tool cover -html=coverage.out -o coverage.html
	@cd services/kafka && go test -v -race -coverprofile=coverage.out ./... && go tool cover -html=coverage.out -o coverage.html
	@cd services/bifrost-callback && go test -v -race -coverprofile=coverage.out ./... && go tool cover -html=coverage.out -o coverage.html
	@cd services/plugins && go test -v -race -coverprofile=coverage.out ./... && go tool cover -html=coverage.out -o coverage.html
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
	@cd services/bifrost-callback && golangci-lint run
	@cd services/plugins && golangci-lint run
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
	@cd services/bifrost-callback && gosec ./...
	@cd services/plugins && gosec ./...
	@cd temporal-workflows && gosec ./...
	@cd orbit-www && pnpm audit --audit-level moderate

build: ## Build all services
	@echo "Building services..."
	@cd services/repository && go build -o bin/repository ./cmd/server
	@cd services/api-catalog && go build -o bin/api-catalog ./cmd/server
	@cd services/knowledge && go build -o bin/knowledge ./cmd/server
	@cd services/build-service && go build -o bin/build-service ./cmd/server
	@cd services/kafka && go build -o bin/kafka ./cmd/server
	@cd services/bifrost-callback && go build -o bin/bifrost-callback ./cmd/server
	@cd services/plugins && go build -o bin/plugins ./cmd/server
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
	@echo "Installing Backstage backend dependencies..."
	@cd services/backstage-backend && yarn install

backstage-dev: ## Start Backstage backend in development mode
	@echo "Starting Backstage backend..."
	@cd services/backstage-backend && yarn dev

backstage-build: ## Build Backstage backend
	@echo "Building Backstage backend..."
	@cd services/backstage-backend && yarn build

backstage-test: ## Test Backstage backend
	@echo "Testing Backstage backend..."
	@cd services/backstage-backend && yarn test

backstage-lint: ## Lint Backstage backend
	@echo "Linting Backstage backend..."
	@cd services/backstage-backend && yarn lint

backstage-audit: ## Run security audit on Backstage backend
	@echo "Auditing Backstage backend..."
	@cd services/backstage-backend && npm audit --audit-level=high

dev-with-backstage: ## Start full development environment including Backstage
	docker-compose up -d