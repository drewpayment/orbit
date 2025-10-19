#!/bin/bash

# Backstage Integration PoC Research Script
# This script automates the research questions from Phase 0

set -e

BACKSTAGE_URL="http://localhost:7007"
OUTPUT_DIR="./research-output"

echo "=== Backstage Multi-Tenancy Research ==="
echo "Starting research at $(date)"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Wait for Backstage to be ready
echo "Waiting for Backstage to start..."
max_attempts=30
attempt=0
while ! curl -s "$BACKSTAGE_URL/api/catalog/entities" > /dev/null; do
    attempt=$((attempt + 1))
    if [ $attempt -ge $max_attempts ]; then
        echo "ERROR: Backstage did not start within expected time"
        exit 1
    fi
    echo "  Attempt $attempt/$max_attempts..."
    sleep 2
done
echo "✓ Backstage is ready"
echo ""

# Test 1: Database schema inspection
echo "=== Test 1: Database Schema Inspection ==="
echo "Inspecting Backstage database schema..."

# Since we're using SQLite in-memory for PoC, check if there's a file
if [ -f ".backstage/backstage.db" ]; then
    sqlite3 .backstage/backstage.db ".tables" > "$OUTPUT_DIR/db-tables.txt"
    sqlite3 .backstage/backstage.db ".schema" > "$OUTPUT_DIR/db-schema.txt"
    echo "✓ Database schema exported to $OUTPUT_DIR/db-schema.txt"
else
    echo "⚠ Using in-memory database, schema inspection limited"
    echo "NOTE: For production, we'll need persistent PostgreSQL" > "$OUTPUT_DIR/db-notes.txt"
fi
echo ""

# Test 2: API endpoint discovery - Catalog
echo "=== Test 2: API Endpoint Discovery - Catalog ==="
echo "Testing catalog API..."
curl -s "$BACKSTAGE_URL/api/catalog/entities" | jq '.' > "$OUTPUT_DIR/api-catalog-entities.json" 2>/dev/null || \
    curl -s "$BACKSTAGE_URL/api/catalog/entities" > "$OUTPUT_DIR/api-catalog-entities.json"
echo "✓ Catalog response saved to $OUTPUT_DIR/api-catalog-entities.json"
echo ""

# Test 3: API endpoint discovery - API Docs
echo "=== Test 3: API Endpoint Discovery - API Docs Plugin ==="
echo "Testing API docs plugin..."
curl -s "$BACKSTAGE_URL/api/api-docs/list" > "$OUTPUT_DIR/api-docs-list.json" 2>/dev/null || \
    echo "⚠ API docs endpoint may have different path"
echo ""

# Test 4: ArgoCD plugin API discovery
echo "=== Test 4: API Endpoint Discovery - ArgoCD Plugin ==="
echo "Testing ArgoCD plugin endpoints..."
# ArgoCD plugin typically exposes endpoints under /api/argocd
curl -s "$BACKSTAGE_URL/api/argocd/applications" > "$OUTPUT_DIR/argocd-applications.json" 2>/dev/null || \
    echo "⚠ ArgoCD plugin needs configuration (expected without ArgoCD server)"
echo ""

# Test 5: Workspace header injection test
echo "=== Test 5: Custom Header Propagation Test ==="
echo "Testing if Backstage propagates custom headers..."
curl -v -H "X-Orbit-Workspace-Id: ws-test-123" \
    -H "X-Orbit-User-Id: user-456" \
    "$BACKSTAGE_URL/api/catalog/entities" \
    2>&1 | grep -i "x-orbit" > "$OUTPUT_DIR/header-test.txt" || \
    echo "⚠ Headers may not be propagated (expected without middleware)"
echo "✓ Header test results in $OUTPUT_DIR/header-test.txt"
echo ""

# Test 6: Available API routes discovery
echo "=== Test 6: API Routes Discovery ==="
echo "Discovering available Backstage API routes..."
{
    echo "Testing common Backstage endpoints:"
    echo ""
    echo "Catalog API:"
    curl -s -o /dev/null -w "  /api/catalog/entities: %{http_code}\n" "$BACKSTAGE_URL/api/catalog/entities"
    curl -s -o /dev/null -w "  /api/catalog/entity-facets: %{http_code}\n" "$BACKSTAGE_URL/api/catalog/entity-facets"

    echo ""
    echo "API Docs Plugin:"
    curl -s -o /dev/null -w "  /api/api-docs: %{http_code}\n" "$BACKSTAGE_URL/api/api-docs"

    echo ""
    echo "ArgoCD Plugin:"
    curl -s -o /dev/null -w "  /api/argocd/applications: %{http_code}\n" "$BACKSTAGE_URL/api/argocd/applications"

    echo ""
    echo "Health/Metadata:"
    curl -s -o /dev/null -w "  /healthcheck: %{http_code}\n" "$BACKSTAGE_URL/healthcheck"
} > "$OUTPUT_DIR/endpoint-discovery.txt"
cat "$OUTPUT_DIR/endpoint-discovery.txt"
echo ""

# Test 7: Plugin dependency analysis
echo "=== Test 7: Plugin Dependency Analysis ==="
echo "Analyzing installed plugin dependencies..."
cd "$(dirname "$0")"
{
    echo "Installed Backstage Plugins:"
    echo ""
    bun pm ls | grep -E "@backstage|@roadiehq|@vippsas" || npm list --depth=0 | grep -E "@backstage|@roadiehq"
} > "$OUTPUT_DIR/plugin-dependencies.txt"
echo "✓ Dependencies saved to $OUTPUT_DIR/plugin-dependencies.txt"
echo ""

# Test 8: Config structure analysis
echo "=== Test 8: Configuration Structure Analysis ==="
echo "Analyzing Backstage configuration..."
cp app-config.yaml "$OUTPUT_DIR/app-config-backup.yaml"
echo "✓ Config backed up to $OUTPUT_DIR/app-config-backup.yaml"
echo ""

# Summary
echo "=== Research Complete ==="
echo "Results saved to: $OUTPUT_DIR/"
echo ""
echo "Next Steps:"
echo "1. Review all files in $OUTPUT_DIR/"
echo "2. Document findings in FINDINGS.md"
echo "3. Answer the 4 research questions from Phase 0"
echo ""
echo "Files created:"
ls -lh "$OUTPUT_DIR/"
