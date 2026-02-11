# Hivemail Deployment Guide

This guide walks you through deploying Hivemail to production. The application consists of:
1. **Next.js Frontend** → Deploy to Vercel
2. **Python Worker** → Deploy to GCP Cloud Run
3. **PostgreSQL Database** → Use Neon or Supabase (with pgvector)

---

## Prerequisites

- GitHub account (code should be pushed to a repository)
- Vercel account (free tier works)
- Google Cloud Platform account with billing enabled
- `gcloud` CLI installed and authenticated
- Docker installed (for building worker image)

---

## Step 1: Set Up Database

### Option A: Neon (Recommended)

1. Go to [neon.tech](https://neon.tech) and create an account
2. Create a new project
3. Enable pgvector extension:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
4. Copy the connection string (it will look like: `postgresql://user:pass@host/dbname`)

### Option B: Supabase

1. Go to [supabase.com](https://supabase.com) and create a project
2. pgvector is pre-installed automatically
3. Get connection string from Settings → Database

**Save your `DATABASE_URL` for later steps.**

---

## Step 2: Generate Required Secrets

```bash
# Generate NextAuth secret
openssl rand -base64 32

# Generate encryption master key
openssl rand -base64 32
```

**Save both secrets for later steps.**

---

## Step 3: Set Up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Gmail API:
   - APIs & Services → Library → Search "Gmail API" → Enable
4. Create OAuth Consent Screen:
   - APIs & Services → OAuth consent screen
   - User Type: External
   - App name: Hivemail
   - Scopes: Add `gmail.readonly` and `gmail.send`
5. Create OAuth Credentials:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: Web application
   - Authorized redirect URIs:
     - `https://your-app.vercel.app/api/auth/callback/google` (you'll update this after Vercel deployment)
6. Copy **Client ID** and **Client Secret**

---

## Step 4: Deploy Python Worker to GCP Cloud Run

### 4.1 Create GCP Project

```bash
# Create project (replace with your project name)
gcloud projects create hivemail-prod --name="Hivemail Production"

# Set as default
gcloud config set project hivemail-prod

# Link billing account (do this in Console: Billing → Link a billing account)
```

### 4.2 Enable Required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudtasks.googleapis.com
```

### 4.3 Create Service Account

```bash
# Create service account
gcloud iam service-accounts create hivemail-worker-sa \
  --display-name="Hivemail Worker Service Account"

# Get the email (replace PROJECT_ID with your actual project ID)
SA_EMAIL="hivemail-worker-sa@hivemail-prod.iam.gserviceaccount.com"

# Grant roles
gcloud projects add-iam-policy-binding hivemail-prod \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding hivemail-prod \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/cloudtasks.enqueuer"
```

### 4.4 Create Artifact Registry

```bash
gcloud artifacts repositories create hivemail \
  --repository-format=docker \
  --location=us-central1 \
  --description="Hivemail Docker images"
```

### 4.5 Store Secrets in Secret Manager

```bash
# Replace values with your actual secrets
echo -n "postgresql://your-database-url" | gcloud secrets create DATABASE_URL --data-file=-

echo -n "your-encryption-master-key" | gcloud secrets create ENCRYPTION_MASTER_KEY --data-file=-

echo -n "your-google-client-id" | gcloud secrets create GOOGLE_CLIENT_ID --data-file=-

echo -n "your-google-client-secret" | gcloud secrets create GOOGLE_CLIENT_SECRET --data-file=-

# Grant access to service account
for secret in DATABASE_URL ENCRYPTION_MASTER_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/secretmanager.secretAccessor"
done
```

### 4.6 Build and Deploy Worker

```bash
cd worker

# Configure Docker for Artifact Registry
gcloud auth configure-docker us-central1-docker.pkg.dev

# Build and push Docker image (replace PROJECT_ID)
PROJECT_ID="hivemail-prod"
docker build -t us-central1-docker.pkg.dev/$PROJECT_ID/hivemail/worker:latest .
docker push us-central1-docker.pkg.dev/$PROJECT_ID/hivemail/worker:latest

# Deploy to Cloud Run
gcloud run deploy hivemail-worker \
  --image=us-central1-docker.pkg.dev/$PROJECT_ID/hivemail/worker:latest \
  --region=us-central1 \
  --service-account=$SA_EMAIL \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest,ENCRYPTION_MASTER_KEY=ENCRYPTION_MASTER_KEY:latest,GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest" \
  --allow-unauthenticated \
  --memory=1Gi \
  --cpu=1 \
  --timeout=300 \
  --max-instances=10 \
  --platform=managed

# Get the worker URL
WORKER_URL=$(gcloud run services describe hivemail-worker --region=us-central1 --format='value(status.url)')
echo "Worker URL: $WORKER_URL"
```

**Save the `WORKER_URL` for the next step.**

### 4.7 Set Up Cloud Tasks Queue (Optional but Recommended)

```bash
gcloud tasks queues create hivemail-jobs \
  --location=us-central1 \
  --max-dispatches-per-second=10 \
  --max-concurrent-dispatches=5
```

### 4.8 Set Up Cloud Scheduler for Periodic Sync (Optional)

```bash
# Create scheduler job for incremental sync (every 15 minutes)
gcloud scheduler jobs create http hivemail-sync-job \
  --location=us-central1 \
  --schedule="*/15 * * * *" \
  --uri="$WORKER_URL/api/jobs" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{"jobType":"INCREMENTAL_ALL","correlationId":"scheduler"}' \
  --oidc-service-account-email=$SA_EMAIL
```

---

## Step 5: Deploy Next.js Frontend to Vercel

### 5.1 Push Code to GitHub

```bash
# Make sure your code is pushed to GitHub
git add .
git commit -m "Ready for deployment"
git push origin main
```

### 5.2 Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click "Add New Project"
3. Import your GitHub repository
4. Framework preset: **Next.js** (should auto-detect)

### 5.3 Configure Environment Variables

In Vercel project settings → Environment Variables, add:

```
DATABASE_URL=postgresql://your-database-url
NEXTAUTH_URL=https://your-app.vercel.app
NEXTAUTH_SECRET=your-generated-nextauth-secret
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
ENCRYPTION_MASTER_KEY=your-generated-encryption-key
WORKER_BASE_URL=https://your-worker-url.run.app
```

**Note:** Update `NEXTAUTH_URL` after first deployment with your actual Vercel URL.

### 5.4 Deploy

Click "Deploy" and wait for the build to complete.

### 5.5 Update Google OAuth Redirect URI

After deployment, update the OAuth redirect URI in Google Cloud Console:
- Go to APIs & Services → Credentials
- Edit your OAuth client
- Add: `https://your-app.vercel.app/api/auth/callback/google`

---

## Step 6: Run Database Migrations

After deployment, run Prisma migrations to set up the database schema:

```bash
# Install dependencies locally
npm install

# Run migrations
npx prisma migrate deploy
# OR for first-time setup:
npx prisma db push
```

Alternatively, you can run this from your local machine pointing to the production database (make sure `DATABASE_URL` is set correctly).

---

## Step 7: Verify Deployment

1. **Check Worker Health:**
   ```bash
   curl https://your-worker-url.run.app/health
   ```
   Should return: `{"status":"healthy","timestamp":"..."}`

2. **Check Frontend:**
   - Visit your Vercel URL
   - Try signing in with Google OAuth
   - Check Settings → Email Sync for worker status

3. **Test Email Sync:**
   - After signing in, go to Settings
   - Trigger a manual sync
   - Check that emails are being processed

---

## Troubleshooting

### Worker Not Responding
- Check Cloud Run logs: `gcloud run logs read hivemail-worker --region=us-central1`
- Verify secrets are correctly set in Secret Manager
- Check service account permissions

### OAuth Errors
- Verify redirect URI matches exactly in Google Cloud Console
- Check that `NEXTAUTH_URL` matches your Vercel domain
- Ensure Gmail API is enabled

### Database Connection Issues
- Verify `DATABASE_URL` is correct
- Check that pgvector extension is enabled: `CREATE EXTENSION IF NOT EXISTS vector;`
- Ensure database allows connections from Vercel and Cloud Run IPs

### Environment Variables
- Double-check all environment variables are set in Vercel
- Verify secrets are accessible by the Cloud Run service account

---

## Cost Estimates

**Vercel (Frontend):**
- Free tier: 100GB bandwidth, unlimited requests
- Pro: $20/month for more bandwidth

**GCP Cloud Run (Worker):**
- Free tier: 2 million requests/month
- Pay per use: ~$0.40 per million requests after free tier
- Memory/CPU: ~$0.00002400 per GB-second

**Database (Neon/Supabase):**
- Neon: Free tier available, paid plans start at $19/month
- Supabase: Free tier available, paid plans start at $25/month

**Total estimated cost for small-medium usage: $0-50/month**

---

## Next Steps

- Set up monitoring and alerts
- Configure custom domain in Vercel
- Set up backup strategy for database
- Configure rate limiting if needed
- Set up error tracking (e.g., Sentry)

---

## Support

For issues or questions:
- Check the [README.md](./README.md) for more details
- Review logs in Vercel and Cloud Run
- Open an issue on GitHub
