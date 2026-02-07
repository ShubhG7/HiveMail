# Hivemail - Personal Email CRM + Agent

A hosted AI-powered email management system. Users sign in with Google and add their own Gemini API key.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

- 🔐 **Google OAuth** - Users sign in with their Google account
- 🤖 **AI Categorization** - Auto-sorts emails into categories (Hiring, Bills, Receipts, etc.)
- 📝 **Smart Summaries** - Get the gist of long threads instantly
- 💬 **AI Chat** - Search and query emails naturally
- ✉️ **AI Reply Drafts** - Generate intelligent reply suggestions
- 🔒 **BYOK** - Users bring their own LLM API key (Gemini) - stored encrypted
- 🛡️ **Privacy First** - Encrypted storage, redaction options
- 📊 **Dashboard** - Email analytics and insights

## Tech Stack

- **Web App**: Next.js 15 (App Router), Auth.js v5, shadcn/ui, Prisma
- **Worker**: Python 3.11, FastAPI, LangGraph, LangChain
- **Database**: PostgreSQL + pgvector
- **LLM**: Gemini 2.5 Flash (default), configurable per user

---

## For Users

Simply:
1. **Sign in** with your Google account
2. **Add your Gemini API key** in Settings (get it from [Google AI Studio](https://aistudio.google.com/app/apikey))
3. **Start using** AI-powered email management!

Your API key is encrypted and stored securely. You can update or remove it anytime in Settings.

---

## Developer Setup (Local Development)

### Prerequisites

- Node.js 18+
- Python 3.11+
- Docker & Docker Compose (for local database)
- Google Cloud Console access (for OAuth setup)

### 1. Clone and Install

```bash
git clone https://github.com/ShubhG7/HiveMail.git
cd Hivemail

# Install Node.js dependencies
npm install

# Install Python dependencies
cd worker
pip install -r requirements.txt
cd ..
```

### 2. Set Up Environment

```bash
# Copy example env file
cp env.example .env.local

# Generate encryption key
openssl rand -base64 32
# Add to ENCRYPTION_MASTER_KEY in .env.local

# Generate NextAuth secret
openssl rand -base64 32
# Add to NEXTAUTH_SECRET in .env.local
```

### 3. Set Up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Gmail API:
   - APIs & Services → Library → Search "Gmail API" → Enable
4. Create OAuth Consent Screen:
   - APIs & Services → OAuth consent screen
   - User Type: External
   - App name: Hivemail
   - Scopes: Add `gmail.readonly` (and `gmail.send` for replies)
5. Create OAuth Credentials:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: Web application
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google`
     - `https://your-domain.vercel.app/api/auth/callback/google`
6. Copy Client ID and Client Secret to `.env.local`

### 4. Start Services

```bash
# Start PostgreSQL and Redis (if using Docker)
docker compose up -d postgres redis

# Start the Python worker (in a separate terminal)
cd worker
python -m uvicorn main:app --reload --port 8000
cd ..

# Or use your own PostgreSQL instance
# Update DATABASE_URL in .env.local

# Run database migrations
npm run db:push

# Start the Next.js app
npm run dev

# In another terminal, start the worker
cd worker
python main.py
```

### 5. Check Worker Status

You can check if the worker is running in several ways:

**Option 1: Via Settings Page (Recommended)**
- Go to Settings → Email Sync
- Look for the "Worker Status" section
- It will show "Healthy" if the worker is running, or "Unavailable" if not

**Option 2: Via Terminal Script**
```bash
./scripts/check-worker.sh
```

**Option 3: Direct HTTP Check**
```bash
curl http://localhost:8000/health
# Should return: {"status":"healthy","timestamp":"..."}
```

**Option 4: Via API**
```bash
curl http://localhost:3000/api/worker/health
# Returns worker health status
```

If the worker is not running, start it:
```bash
cd worker
python -m uvicorn main:app --reload --port 8000
```

### 6. Access the App

Open [http://localhost:3000](http://localhost:3000)

---

## Production Deployment

### Vercel Deployment (Next.js App)

1. **Push to GitHub**

2. **Connect to Vercel**
   - Import repository
   - Framework preset: Next.js

3. **Configure Environment Variables**
   ```
   DATABASE_URL=postgresql://...
   NEXTAUTH_URL=https://your-domain.vercel.app
   NEXTAUTH_SECRET=<your-secret>
   GOOGLE_CLIENT_ID=<your-client-id>
   GOOGLE_CLIENT_SECRET=<your-client-secret>
   ENCRYPTION_MASTER_KEY=<your-key>
   WORKER_BASE_URL=https://your-worker.run.app
   ```

4. **Deploy**

### GCP Cloud Run Deployment (Worker)

#### Prerequisites Checklist

- [ ] GCP Account with billing enabled
- [ ] gcloud CLI installed and authenticated

#### Step 1: Create GCP Project

```bash
# Create project
gcloud projects create email-agent-prod --name="Email Agent"

# Set as default
gcloud config set project email-agent-prod

# Link billing (do this in Console)
# Console → Billing → Link a billing account
```

#### Step 2: Enable APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudtasks.googleapis.com
```

#### Step 3: Create Service Account

```bash
# Create service account
gcloud iam service-accounts create email-agent-worker-sa \
  --display-name="Email Agent Worker"

# Get the email
SA_EMAIL="email-agent-worker-sa@email-agent-prod.iam.gserviceaccount.com"

# Grant roles
gcloud projects add-iam-policy-binding email-agent-prod \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding email-agent-prod \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/cloudtasks.enqueuer"
```

#### Step 4: Create Artifact Registry

```bash
gcloud artifacts repositories create email-agent \
  --repository-format=docker \
  --location=us-central1 \
  --description="Email Agent Docker images"
```

#### Step 5: Store Secrets

```bash
# Database URL
echo -n "postgresql://..." | gcloud secrets create DB_URL --data-file=-

# Encryption key
echo -n "<your-key>" | gcloud secrets create ENCRYPTION_MASTER_KEY --data-file=-

# Google OAuth
echo -n "<client-id>" | gcloud secrets create GOOGLE_CLIENT_ID --data-file=-
echo -n "<client-secret>" | gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=-

# Grant access
for secret in DB_URL ENCRYPTION_MASTER_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/secretmanager.secretAccessor"
done
```

#### Step 6: Build and Deploy Worker

```bash
cd worker

# Configure Docker for Artifact Registry
gcloud auth configure-docker us-central1-docker.pkg.dev

# Build and push
docker build -t us-central1-docker.pkg.dev/email-agent-prod/email-agent/worker:latest .
docker push us-central1-docker.pkg.dev/email-agent-prod/email-agent/worker:latest

# Deploy to Cloud Run
gcloud run deploy email-agent-worker \
  --image=us-central1-docker.pkg.dev/email-agent-prod/email-agent/worker:latest \
  --region=us-central1 \
  --service-account=$SA_EMAIL \
  --set-secrets="DATABASE_URL=DB_URL:latest,ENCRYPTION_MASTER_KEY=ENCRYPTION_MASTER_KEY:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest" \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --timeout=300 \
  --max-instances=10
```

#### Step 7: Set Up Cloud Tasks Queue

```bash
gcloud tasks queues create email-agent-jobs \
  --location=us-central1 \
  --max-dispatches-per-second=10 \
  --max-concurrent-dispatches=5
```

#### Step 8: Set Up Cloud Scheduler (Periodic Sync)

```bash
# Get the Cloud Run URL
WORKER_URL=$(gcloud run services describe email-agent-worker --region=us-central1 --format='value(status.url)')

# Create scheduler job for incremental sync (every 15 minutes)
gcloud scheduler jobs create http email-sync-job \
  --location=us-central1 \
  --schedule="*/15 * * * *" \
  --uri="$WORKER_URL/api/jobs" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{"jobType":"INCREMENTAL_ALL","correlationId":"scheduler"}' \
  --oidc-service-account-email=$SA_EMAIL
```

#### Step 9: Update Vercel Environment

Add `WORKER_BASE_URL` to Vercel environment variables with the Cloud Run URL.

---

## Database Setup (Neon/Supabase)

### Option A: Neon

1. Create account at [neon.tech](https://neon.tech)
2. Create a new project
3. Enable pgvector extension:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
4. Copy connection string to `DATABASE_URL`

### Option B: Supabase

1. Create project at [supabase.com](https://supabase.com)
2. Get connection string from Settings → Database
3. pgvector is pre-installed

---

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `NEXTAUTH_URL` | App URL (e.g., https://app.com) | Yes |
| `NEXTAUTH_SECRET` | Random 32-byte secret | Yes |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Yes |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Yes |
| `ENCRYPTION_MASTER_KEY` | 32-byte base64 encryption key | Yes |
| `WORKER_BASE_URL` | Worker service URL | Yes |
| `GCP_PROJECT_ID` | GCP project (for Cloud Tasks) | Optional |
| `GCP_LOCATION` | GCP region | Optional |
| `GCP_QUEUE_NAME` | Cloud Tasks queue name | Optional |

### User Configuration

Users configure their own LLM API key in Settings. Supported providers:

- **Gemini 2.5 Flash** (default) - Best price/performance
- **Gemini 2.5 Pro** - Higher quality
- **Gemini 2.0 Flash** - Budget option

Get API key: [Google AI Studio](https://aistudio.google.com/app/apikey)

---

## Security Considerations

- LLM API keys are stored encrypted server-side (per user)
- Email bodies are encrypted at rest
- OAuth tokens are encrypted
- Redaction modes available for sensitive content
- Never log raw email bodies
- All LLM calls are server-side only

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐
│   Next.js App   │────▶│    PostgreSQL    │
│   (Vercel)      │     │    + pgvector    │
└────────┬────────┘     └──────────────────┘
         │                       ▲
         │ HTTP                  │
         ▼                       │
┌─────────────────┐              │
│  Python Worker  │──────────────┘
│  (Cloud Run)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Gmail API     │
│   Gemini API    │
└─────────────────┘
```

---

## Development

### Running Tests

```bash
# Next.js
npm test

# Worker
cd worker
pytest
```

### Database Migrations

```bash
# Generate migration
npm run db:migrate

# Push schema changes (dev)
npm run db:push

# Open Prisma Studio
npm run db:studio
```

---

## Troubleshooting

### OAuth Errors

- Ensure redirect URIs match exactly
- Check scopes are approved in consent screen
- Verify client ID/secret are correct

### Sync Issues

- Check worker logs: `gcloud run logs read email-agent-worker`
- Verify OAuth tokens haven't expired
- Check historyId is valid (may need full re-sync)

### LLM Errors

- Verify user's API key is valid
- Check quota limits
- Review redaction settings

---

## License

MIT License - see LICENSE file for details.

---

## Contributing

Contributions welcome! Please read CONTRIBUTING.md first.
