#!/bin/bash

# Fix stuck sync jobs and create missing threads

echo "🔧 Fixing Hivemail Sync Issues"
echo "══════════════════════════════════════════════════════════════"
echo ""

# 1. Cancel stuck jobs
echo "1. Cancelling stuck RUNNING/PENDING jobs..."
docker exec hivemail-postgres psql -U postgres -d hivemail -c "
UPDATE \"SyncJob\" 
SET status = 'CANCELLED', 
    error = 'Cancelled by fix script - worker was stuck', 
    \"completedAt\" = NOW()
WHERE status IN ('RUNNING', 'PENDING');
" 2>&1 | grep -E "UPDATE|ERROR" || echo "  Done"

echo ""

# 2. Create threads for existing messages
echo "2. Creating Thread records for orphaned messages..."
docker exec hivemail-postgres psql -U postgres -d hivemail -c "
INSERT INTO \"Thread\" (
    id, \"userId\", \"gmailThreadId\", subject, participants,
    \"lastMessageAt\", category, priority, summary, \"summaryShort\",
    \"needsReply\", \"isRead\", \"isStarred\", labels, \"messageCount\",
    \"createdAt\", \"updatedAt\", \"processedAt\"
)
SELECT 
    gen_random_uuid() as id,
    m.\"userId\",
    m.\"gmailThreadId\",
    MIN(m.subject) as subject,
    ARRAY_AGG(DISTINCT m.\"fromAddress\") as participants,
    MAX(m.date) as \"lastMessageAt\",
    'misc' as category,
    'NORMAL' as priority,
    NULL as summary,
    NULL as \"summaryShort\",
    FALSE as \"needsReply\",
    TRUE as \"isRead\",
    FALSE as \"isStarred\",
    ARRAY[]::text[] as labels,
    COUNT(*) as \"messageCount\",
    NOW() as \"createdAt\",
    NOW() as \"updatedAt\",
    NOW() as \"processedAt\"
FROM \"Message\" m
WHERE NOT EXISTS (
    SELECT 1 FROM \"Thread\" t 
    WHERE t.\"userId\" = m.\"userId\" 
    AND t.\"gmailThreadId\" = m.\"gmailThreadId\"
)
GROUP BY m.\"userId\", m.\"gmailThreadId\"
ON CONFLICT (\"userId\", \"gmailThreadId\") DO NOTHING;
" 2>&1 | grep -E "INSERT|ERROR" || echo "  Done"

echo ""

# 3. Update message threadId references
echo "3. Linking messages to threads..."
docker exec hivemail-postgres psql -U postgres -d hivemail -c "
UPDATE \"Message\" m
SET \"threadId\" = t.id
FROM \"Thread\" t
WHERE m.\"userId\" = t.\"userId\" 
AND m.\"gmailThreadId\" = t.\"gmailThreadId\"
AND m.\"threadId\" IS NULL;
" 2>&1 | grep -E "UPDATE|ERROR" || echo "  Done"

echo ""

# 4. Show results
echo "4. RESULTS"
echo "────────────────────────────────────────────────────────────────"
docker exec hivemail-postgres psql -U postgres -d hivemail -c "
SELECT 
    'Users' as table_name, COUNT(*) as count FROM \"User\"
UNION ALL
SELECT 'Threads', COUNT(*) FROM \"Thread\"
UNION ALL
SELECT 'Messages', COUNT(*) FROM \"Message\"
UNION ALL
SELECT 'Messages without thread', COUNT(*) FROM \"Message\" WHERE \"threadId\" IS NULL
ORDER BY table_name;
" 2>&1

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "✅ Fix complete!"
echo ""
echo "Next steps:"
echo "  1. Refresh your browser at http://localhost:3000"
echo "  2. Go to Inbox - you should see your emails"
echo "  3. If threads still missing, check worker logs"
echo ""
