#!/bin/bash

# Development script for Hivemail

set -e

echo "🐝 Starting Hivemail development environment..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Start database services
echo "📦 Starting PostgreSQL and Redis..."
docker-compose up -d postgres redis

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL..."
until docker-compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do
    sleep 1
done
echo "✅ PostgreSQL is ready"

# Run database migrations
echo "🔄 Running database migrations..."
npm run db:push

echo ""
echo "✅ Development environment is ready!"
echo ""
echo "📝 Next steps:"
echo "   1. Copy env.example to .env.local and fill in values"
echo "   2. Run 'npm run dev' to start the Next.js app"
echo "   3. Run 'cd worker && python main.py' to start the worker"
echo ""
echo "🌐 App: http://localhost:3000"
echo "🔧 Worker: http://localhost:8000"
echo ""
