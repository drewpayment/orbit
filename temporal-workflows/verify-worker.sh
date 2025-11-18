#!/bin/bash
# Verification script for manual token refresh testing
# Usage: ./verify-worker.sh

set -e

echo "=========================================="
echo "Manual Token Refresh - Test Verification"
echo "=========================================="
echo ""

# Check if worker binary exists
echo "[1/5] Checking worker binary..."
if [ -f "./bin/worker" ]; then
    echo "✅ Worker binary exists at: ./bin/worker"
else
    echo "❌ Worker binary not found. Building..."
    go build -o bin/worker ./cmd/worker
    echo "✅ Worker binary built successfully"
fi
echo ""

# Verify workflow code has signal handler
echo "[2/5] Verifying signal handler in workflow..."
if grep -q "trigger-refresh" internal/workflows/github_token_refresh_workflow.go; then
    echo "✅ Signal handler 'trigger-refresh' found in workflow"
else
    echo "❌ Signal handler not found - implementation may be incomplete"
    exit 1
fi
echo ""

# Check if Temporal server is accessible
echo "[3/5] Checking Temporal server connection..."
if curl -s http://localhost:7233 > /dev/null 2>&1; then
    echo "✅ Temporal server accessible at localhost:7233"
else
    echo "⚠️  Temporal server not accessible. Start with: make docker-up"
fi
echo ""

# Check if Temporal UI is accessible
echo "[4/5] Checking Temporal UI..."
if curl -s http://localhost:8080 > /dev/null 2>&1; then
    echo "✅ Temporal UI accessible at http://localhost:8080"
else
    echo "⚠️  Temporal UI not accessible. Start with: make docker-up"
fi
echo ""

# Check if frontend is running
echo "[5/5] Checking frontend server..."
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "✅ Frontend accessible at http://localhost:3000"
else
    echo "⚠️  Frontend not running. Start with: cd ../orbit-www && bun run dev"
fi
echo ""

echo "=========================================="
echo "Next Steps:"
echo "=========================================="
echo ""
echo "If any prerequisites are missing:"
echo ""
echo "1. Start Temporal infrastructure:"
echo "   cd /Users/drew.payment/dev/orbit"
echo "   make docker-up"
echo ""
echo "2. Start Temporal worker:"
echo "   cd /Users/drew.payment/dev/orbit/temporal-workflows"
echo "   ./bin/worker"
echo ""
echo "3. Start frontend (in separate terminal):"
echo "   cd /Users/drew.payment/dev/orbit/orbit-www"
echo "   bun run dev"
echo ""
echo "4. Navigate to GitHub settings:"
echo "   http://localhost:3000/settings/github"
echo ""
echo "5. Click 'Test Refresh Now' button on an installation"
echo ""
echo "6. Verify in Temporal UI:"
echo "   http://localhost:8080"
echo "   - Find workflow: github-token-refresh:<installation-id>"
echo "   - Check Events tab for SignalReceived event"
echo ""
