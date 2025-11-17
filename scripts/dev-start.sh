#!/bin/bash

set -e

echo "🚀 Starting Orbit development environment..."
echo ""

# Stop any running containers
echo "📦 Stopping existing containers..."
docker-compose down

# Build core services only (excluding Backstage services)
echo "🔨 Building Docker images..."
docker-compose build temporal-worker orbit-www

# Start core services
echo "▶️  Starting all services..."
docker-compose up -d mongo temporal-postgresql temporal-elasticsearch temporal-server temporal-ui temporal-worker orbit-www postgres redis

echo ""
echo "✅ All services started!"
echo ""
echo "📊 Service URLs:"
echo "  - Frontend:      http://localhost:3000"
echo "  - Temporal UI:   http://localhost:8080"
echo "  - MongoDB:       mongodb://localhost:27017"
echo "  - PostgreSQL:    postgresql://localhost:5433"
echo "  - Redis:         redis://localhost:6379"
echo ""
echo "📝 View logs:"
echo "  docker-compose logs -f [service-name]"
echo ""
echo "🛑 Stop all services:"
echo "  docker-compose down"
echo ""
