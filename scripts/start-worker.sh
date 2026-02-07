#!/bin/bash

# Start the Python worker for Hivemail

set -e

cd "$(dirname "$0")/.."

echo "🔧 Starting Hivemail Worker..."

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "❌ .env.local not found. Please create it from env.example"
    exit 1
fi

# Load environment variables from .env.local
export $(cat .env.local | grep -v '^#' | xargs)

# Check if worker .env exists, create it if not
if [ ! -f worker/.env ]; then
    echo "📝 Creating worker/.env from .env.local..."
    cat > worker/.env << EOF
# Worker Environment Variables
# Auto-generated from .env.local

DATABASE_URL=${DATABASE_URL}
ENCRYPTION_MASTER_KEY=${ENCRYPTION_MASTER_KEY}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
EOF
    echo "✅ Created worker/.env"
fi

# Check if Python dependencies are installed
if [ ! -d "worker/venv" ] && [ ! -d "worker/.venv" ]; then
    echo "📦 Installing Python dependencies..."
    cd worker
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    cd ..
fi

# Activate virtual environment if it exists
if [ -d "worker/venv" ]; then
    source worker/venv/bin/activate
elif [ -d "worker/.venv" ]; then
    source worker/.venv/bin/activate
fi

# Check if port 8000 is in use
if lsof -ti:8000 > /dev/null 2>&1; then
    echo "⚠️  Port 8000 is already in use. Stopping existing process..."
    lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    sleep 2
fi

# Start the worker
echo "🚀 Starting worker on http://localhost:8000..."
cd worker
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
