#!/bin/bash

# Check if worker is running
# Usage: ./scripts/check-worker.sh

WORKER_URL="${WORKER_BASE_URL:-http://localhost:8000}"

echo "Checking worker at: $WORKER_URL"
echo ""

# Check health endpoint
response=$(curl -s -w "\n%{http_code}" "$WORKER_URL/health" 2>/dev/null)
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    echo "✅ Worker is healthy!"
    echo "Response: $body"
    exit 0
else
    echo "❌ Worker is not responding"
    echo "HTTP Status: $http_code"
    if [ -n "$body" ]; then
        echo "Response: $body"
    fi
    echo ""
    echo "Troubleshooting:"
    echo "1. Check if worker is running:"
    echo "   cd worker && python -m uvicorn main:app --reload"
    echo ""
    echo "2. Verify WORKER_BASE_URL in .env.local:"
    echo "   WORKER_BASE_URL=$WORKER_URL"
    echo ""
    echo "3. Check worker logs for errors"
    exit 1
fi
