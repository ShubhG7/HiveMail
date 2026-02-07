#!/bin/bash

# Test script to verify sync flow

echo "🔍 Testing Hivemail Sync Flow"
echo "=============================="
echo ""

# 1. Check worker health
echo "1. Worker Health Check:"
WORKER_RESPONSE=$(curl -s http://localhost:8000/health)
if echo "$WORKER_RESPONSE" | grep -q "healthy"; then
    echo "   ✅ Worker is healthy"
    echo "$WORKER_RESPONSE" | jq '.' 2>/dev/null || echo "$WORKER_RESPONSE"
else
    echo "   ❌ Worker is not healthy"
    echo "$WORKER_RESPONSE"
fi
echo ""

# 2. Check if worker can receive jobs
echo "2. Testing Worker Job Reception:"
TEST_PAYLOAD='{"userId":"test-user-123","jobType":"BACKFILL","correlationId":"test-$(date +%s)","metadata":{"jobId":"test-job-123","backfillDays":7}}'
WORKER_JOB_RESPONSE=$(curl -s -X POST http://localhost:8000/api/jobs \
  -H "Content-Type: application/json" \
  -H "X-Correlation-ID: test-correlation" \
  -d "$TEST_PAYLOAD")

if echo "$WORKER_JOB_RESPONSE" | grep -q "No OAuth token"; then
    echo "   ✅ Worker received job (expected error: no OAuth token)"
elif echo "$WORKER_JOB_RESPONSE" | grep -q "invalid dsn"; then
    echo "   ❌ Database connection error"
    echo "$WORKER_JOB_RESPONSE"
else
    echo "   ⚠️  Unexpected response:"
    echo "$WORKER_JOB_RESPONSE" | jq '.' 2>/dev/null || echo "$WORKER_JOB_RESPONSE"
fi
echo ""

# 3. Check Next.js app
echo "3. Next.js App Check:"
APP_RESPONSE=$(curl -s http://localhost:3000/api/worker/health 2>&1)
if echo "$APP_RESPONSE" | grep -q "healthy\|unavailable"; then
    echo "   ✅ Next.js app is responding"
    echo "$APP_RESPONSE" | jq '.' 2>/dev/null || echo "$APP_RESPONSE"
else
    echo "   ⚠️  Next.js app response:"
    echo "$APP_RESPONSE"
fi
echo ""

# 4. Check environment
echo "4. Environment Check:"
if [ -f .env.local ]; then
    if grep -q "WORKER_BASE_URL" .env.local; then
        WORKER_URL=$(grep "WORKER_BASE_URL" .env.local | cut -d'=' -f2 | tr -d '"')
        echo "   ✅ WORKER_BASE_URL is set: $WORKER_URL"
        
        # Test if URL is reachable
        if curl -s --connect-timeout 2 "$WORKER_URL/health" > /dev/null 2>&1; then
            echo "   ✅ Worker URL is reachable"
        else
            echo "   ❌ Worker URL is NOT reachable"
        fi
    else
        echo "   ❌ WORKER_BASE_URL not found in .env.local"
    fi
else
    echo "   ❌ .env.local not found"
fi
echo ""

echo "=============================="
echo "💡 Next Steps:"
echo "   1. Make sure you're logged in to the app"
echo "   2. Go to Settings → Email Sync"
echo "   3. Click 'Refresh Now' or 'Full Re-sync'"
echo "   4. Check the worker terminal for logs"
echo "   5. Check the Next.js terminal for logs"
echo ""
