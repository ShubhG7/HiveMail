#!/bin/bash

# Comprehensive diagnostic for Hivemail sync issues

set +e  # Don't exit on errors

echo "🔍 HIVEMAIL FULL DIAGNOSTIC"
echo "══════════════════════════════════════════════════════════════"
echo ""

# 1. Infrastructure check
echo "1. INFRASTRUCTURE"
echo "────────────────────────────────────────────────────────────────"

echo "PostgreSQL:"
docker ps | grep hivemail-postgres > /dev/null && echo "  ✅ Running" || echo "  ❌ Not running"

echo "Redis:"
docker ps | grep hivemail-redis > /dev/null && echo "  ✅ Running" || echo "  ❌ Not running"

echo "Worker (Port 8000):"
if curl -s --max-time 2 http://localhost:8000/health | grep -q "healthy"; then
    echo "  ✅ Healthy"
else
    echo "  ❌ Not responding"
fi

echo "Next.js (Port 3000):"
if curl -s --max-time 2 http://localhost:3000 > /dev/null 2>&1; then
    echo "  ✅ Running"
else
    echo "  ❌ Not responding"
fi

echo ""

# 2. Environment variables
echo "2. ENVIRONMENT VARIABLES"
echo "────────────────────────────────────────────────────────────────"

if [ -f .env.local ]; then
    echo "WORKER_BASE_URL:"
    grep "WORKER_BASE_URL" .env.local | cut -d'=' -f2 | tr -d '"' || echo "  ❌ Not set"
    
    echo "GOOGLE_CLIENT_ID:"
    if grep -q "GOOGLE_CLIENT_ID" .env.local; then
        echo "  ✅ Set"
    else
        echo "  ❌ Not set"
    fi
    
    echo "GOOGLE_CLIENT_SECRET:"
    if grep -q "GOOGLE_CLIENT_SECRET" .env.local; then
        echo "  ✅ Set"
    else
        echo "  ❌ Not set"
    fi
    
    echo "DATABASE_URL:"
    if grep -q "DATABASE_URL" .env.local; then
        echo "  ✅ Set"
    else
        echo "  ❌ Not set"
    fi
else
    echo "  ❌ .env.local not found"
fi

echo ""

# 3. Database check
echo "3. DATABASE CHECK"
echo "────────────────────────────────────────────────────────────────"

echo "Checking tables and data..."
docker exec hivemail-postgres psql -U postgres -d hivemail -c "
SELECT 
    'Users' as table_name, COUNT(*) as count FROM \"User\"
UNION ALL
SELECT 'OAuthTokens', COUNT(*) FROM \"OAuthToken\"
UNION ALL
SELECT 'SyncJobs', COUNT(*) FROM \"SyncJob\"
UNION ALL
SELECT 'Threads', COUNT(*) FROM \"Thread\"
UNION ALL
SELECT 'Messages', COUNT(*) FROM \"Message\"
ORDER BY table_name;
" 2>&1 || echo "  ❌ Failed to query database"

echo ""
echo "Recent sync jobs:"
docker exec hivemail-postgres psql -U postgres -d hivemail -c "
SELECT 
    \"jobType\", 
    status, 
    progress, 
    \"totalItems\", 
    LEFT(error, 50) as error_preview,
    \"createdAt\"
FROM \"SyncJob\"
ORDER BY \"createdAt\" DESC
LIMIT 5;
" 2>&1 || echo "  ❌ Failed to query sync jobs"

echo ""
echo "OAuth tokens:"
docker exec hivemail-postgres psql -U postgres -d hivemail -c "
SELECT 
    \"userId\",
    provider,
    scope,
    expiry,
    CASE WHEN \"historyId\" IS NOT NULL THEN 'Yes' ELSE 'No' END as has_history_id
FROM \"OAuthToken\"
LIMIT 5;
" 2>&1 || echo "  ❌ Failed to query OAuth tokens"

echo ""

# 4. Google OAuth Scopes check
echo "4. GOOGLE OAUTH SCOPES"
echo "────────────────────────────────────────────────────────────────"
echo "Required scopes:"
echo "  - https://www.googleapis.com/auth/gmail.readonly"
echo "  - https://www.googleapis.com/auth/gmail.send"
echo ""
echo "Check if granted in database:"
docker exec hivemail-postgres psql -U postgres -d hivemail -c "
SELECT scope FROM \"OAuthToken\" WHERE provider = 'google' LIMIT 1;
" 2>&1 | grep -E "gmail.readonly|gmail.send" || echo "  ⚠️  Gmail scopes not found or not granted"

echo ""

# 5. Worker test
echo "5. WORKER FUNCTIONALITY TEST"
echo "────────────────────────────────────────────────────────────────"

echo "Testing worker job reception..."
RESPONSE=$(curl -s -X POST http://localhost:8000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","jobType":"BACKFILL","correlationId":"diagnostic","metadata":{"jobId":"test"}}' 2>&1)

if echo "$RESPONSE" | grep -q "No OAuth token"; then
    echo "  ✅ Worker can receive jobs and query database"
elif echo "$RESPONSE" | grep -q "invalid dsn\|connection"; then
    echo "  ❌ Worker has database connection issues"
    echo "  Error: $RESPONSE"
else
    echo "  ⚠️  Unexpected response: $RESPONSE"
fi

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "📋 SUMMARY"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. If no OAuth tokens found:"
echo "     → Sign out and sign back in with Google"
echo "     → Make sure Gmail API is enabled in Google Cloud Console"
echo ""
echo "  2. If OAuth tokens exist but no emails:"
echo "     → Check sync job errors in the database"
echo "     → Check worker logs: tail -f /tmp/worker.log"
echo "     → Check Next.js logs: tail -f /tmp/nextjs.log"
echo ""
echo "  3. If scopes are missing gmail.readonly:"
echo "     → Delete the OAuth consent and re-authenticate"
echo "     → Make sure scopes are configured in src/lib/auth.ts"
echo ""
