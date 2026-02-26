# Hivemail Deployment Guide

This guide walks you through deploying Hivemail to production. The application consists of:
1. **Next.js Frontend** → Deploy to Vercel
2. **Python Worker** → Deploy to Railway (recommended) or GCP Cloud Run
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
   - User support email: Your email (shubhguptarm7@gmail.com)
   - Developer contact information: Your email
   - Scopes: Add `gmail.readonly` and `gmail.send`
   - **Important**: Since these are sensitive scopes, you'll see a verification warning
5. Create OAuth Credentials:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: Web application
   - Authorized redirect URIs:
     - For local development: `http://localhost:3000/api/auth/callback/google`
     - For production: `https://your-app.vercel.app/api/auth/callback/google` (you'll update this after Vercel deployment)
6. Copy **Client ID** and **Client Secret**

### Handling the "Google hasn't verified this app" Warning

Since Hivemail requests sensitive Gmail scopes (`gmail.readonly` and `gmail.send`), Google shows a verification warning. Here's how to handle it:

#### Option A: For Development/Testing (Quick Fix)

**Add Test Users** (Recommended for development):

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to: **APIs & Services → OAuth consent screen**
3. Scroll down to **"Test users"** section
4. Click **"+ ADD USERS"**
5. Add your Google account email (shubhguptarm7@gmail.com) and any other test accounts
6. Click **"SAVE"**

**Note**: Test users can bypass the verification warning. You can add up to 100 test users. This is perfect for development and testing.

#### Option B: For Production (Full Verification)

To remove the warning for all users, you need to submit your app for Google's OAuth verification:

1. **Complete OAuth Consent Screen**:
   - Go to **APIs & Services → OAuth consent screen**
   - Fill in all required fields:
     - App name, logo (optional but recommended)
     - App domain (your Vercel domain)
     - Authorized domains
     - Developer contact information
     - Privacy policy URL (required for verification)
     - Terms of service URL (required for verification)

2. **Create Privacy Policy & Terms of Service**:
   - You must have publicly accessible privacy policy and terms of service pages
   - These should explain how you use Gmail data
   - Example: `https://your-app.vercel.app/privacy` and `https://your-app.vercel.app/terms`

3. **Submit for Verification**:
   - Click **"PUBLISH APP"** button (or "SUBMIT FOR VERIFICATION" if available)
   - Google will review your app (can take 1-2 weeks)
   - You may need to provide:
     - Video demonstration of your app
     - Explanation of why you need Gmail scopes
     - Security assessment (for sensitive scopes)

4. **During Review**:
   - Your app will be in "Testing" mode
   - Only test users can sign in
   - After approval, all users can sign in without warnings

**For now, use Option A (Test Users) to continue development without waiting for verification.**

---

## Step 4: Deploy Python Worker

### Option A: Railway (Recommended - Easier Setup)

Railway is simpler than GCP and doesn't require billing setup.

#### 4.1 Create Railway Account

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your Hivemail repository

#### 4.2 Configure Service

1. Railway will auto-detect the Dockerfile in the `worker/` directory
2. If not detected, go to Settings → Source → Set Root Directory to `worker/`
3. Railway will automatically build and deploy

#### 4.3 Set Environment Variables

In Railway Dashboard → Your Service → Variables, add:

```
DATABASE_URL=postgresql://neondb_owner:npg_0vXqDgl1Pdbu@ep-winter-water-ai8jqrco-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
ENCRYPTION_MASTER_KEY=your-encryption-master-key-here
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
WORKER_BATCH_SIZE=50
WORKER_MAX_RETRIES=3
DEFAULT_LLM_MODEL=gemini-2.5-flash
```

**Important:** Use the same `ENCRYPTION_MASTER_KEY` as in Vercel!

#### 4.4 Get Worker URL

1. After deployment, Railway will provide a URL like: `https://your-service.up.railway.app`
2. Copy this URL - you'll need it for Vercel

#### 4.5 Update Vercel Environment Variables

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add or update:
   ```
   WORKER_BASE_URL=https://your-service.up.railway.app
   ```
3. Redeploy Vercel (or it will auto-redeploy)

**That's it!** Railway handles everything automatically. The worker should now be accessible.

---

### Option B: GCP Cloud Run (Requires Billing)

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

#### "Authentication Error: There is a problem with the server configuration"

This error typically indicates missing or incorrect environment variables. Check the following:

1. **Verify Environment Variables are Set:**
   ```bash
   # Check your .env.local file (for local development) or Vercel environment variables
   # Required variables:
   - NEXTAUTH_URL (must match your app URL exactly)
   - NEXTAUTH_SECRET (must be a valid secret, generate with: openssl rand -base64 32)
   - GOOGLE_CLIENT_ID
   - GOOGLE_CLIENT_SECRET
   ```

2. **For Local Development:**
   - Ensure `.env.local` exists in the project root
   - `NEXTAUTH_URL` should be `http://localhost:3000` (or your local port)
   - Restart your Next.js dev server after changing environment variables

3. **For Production (Vercel):**
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Verify all variables are set correctly
   - `NEXTAUTH_URL` must match your Vercel domain exactly (e.g., `https://your-app.vercel.app`)
   - Redeploy after adding/changing environment variables

4. **Verify Google OAuth Configuration:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Navigate to: **APIs & Services → Credentials**
   - Check your OAuth 2.0 Client ID
   - Verify **Authorized redirect URIs** includes:
     - For local: `http://localhost:3000/api/auth/callback/google`
     - For production: `https://your-app.vercel.app/api/auth/callback/google`
   - Ensure the redirect URI matches **exactly** (including http/https, port, trailing slashes)

5. **Check OAuth Consent Screen:**
   - Go to **APIs & Services → OAuth consent screen**
   - Verify app is in "Testing" mode (for development)
   - Ensure your email is added as a test user
   - Verify scopes `gmail.readonly` and `gmail.send` are added

6. **Verify Gmail API is Enabled:**
   - Go to **APIs & Services → Library**
   - Search for "Gmail API"
   - Ensure it's enabled

7. **Check Server Logs:**
   - For local: Check terminal where Next.js is running
   - For Vercel: Go to Vercel Dashboard → Your Project → Logs
   - Look for error messages about missing environment variables

#### Other OAuth Errors
- **"Access Denied"**: User is not in the test users list (add them in OAuth consent screen)
- **"Invalid redirect URI"**: Redirect URI in Google Console doesn't match your app URL
- **"Invalid client"**: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is incorrect

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
