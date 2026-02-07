#!/bin/bash

# Diagnostic script for email sync issues

echo "🔍 Hivemail Sync Diagnostics"
echo "=============================="
echo ""

# Check worker health
echo "1. Worker Health:"
curl -s http://localhost:8000/health | jq '.' 2>/dev/null || echo "   ❌ Worker not responding or jq not installed"
echo ""

# Check if worker can connect to database
echo "2. Testing Worker Database Connection:"
curl -s -X POST http://localhost:8000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"userId":"test-connection","jobType":"BACKFILL","correlationId":"diagnostic-test","metadata":{}}' \
  | jq '.' 2>/dev/null || echo "   ❌ Worker database connection failed"
echo ""

# Check Next.js app
echo "3. Next.js App:"
curl -s http://localhost:3000/api/worker/health 2>/dev/null | jq '.' || echo "   ⚠️  Next.js app not responding (might be normal if not logged in)"
echo ""

# Check environment variables
echo "4. Environment Check:"
if [ -f .env.local ]; then
    if grep -q "WORKER_BASE_URL" .env.local; then
        echo "   ✅ WORKER_BASE_URL is set"
        grep "WORKER_BASE_URL" .env.local | head -1
    else
        echo "   ❌ WORKER_BASE_URL not found in .env.local"
    fi
    
    if grep -q "DATABASE_URL" .env.local; then
        echo "   ✅ DATABASE_URL is set"
    else
        echo "   ❌ DATABASE_URL not found in .env.local"
    fi
else
    echo "   ❌ .env.local not found"
fi
echo ""

# Check worker .env
echo "5. Worker Environment:"
if [ -f worker/.env ]; then
    echo "   ✅ worker/.env exists"
    if grep -q "schema=public" worker/.env; then
        echo "   ⚠️  worker/.env still contains 'schema=public' (should be removed)"
    else
        echo "   ✅ worker/.env looks good"
    fi
else
    echo "   ❌ worker/.env not found"
fi
echo ""

# Check Docker containers
echo "6. Docker Containers:"
if docker ps | grep -q "hivemail-postgres"; then
    echo "   ✅ PostgreSQL container is running"
else
    echo "   ❌ PostgreSQL container is not running"
fi

if docker ps | grep -q "hivemail-redis"; then
    echo "   ✅ Redis container is running"
else
    echo "   ⚠️  Redis container is not running (optional for local dev)"
fi
echo ""

echo "=============================="
echo "💡 Next Steps:"
echo "   1. If worker database connection failed, restart the worker:"
echo "      ./scripts/start-worker.sh"
echo ""
echo "   2. Check worker logs for detailed error messages"
echo ""
echo "   3. Try triggering a sync from the Settings page"
