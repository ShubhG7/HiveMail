# OAuth Quick Start Checklist

## ✅ Pre-Setup Checklist

- [ ] Google Cloud account created
- [ ] Billing enabled (required for some APIs, but Gmail API is free)
- [ ] Your app domain ready (e.g., `hivemail.vercel.app`)

## ✅ Step-by-Step Setup

### 1. Create Project & Enable API
- [ ] Go to [Google Cloud Console](https://console.cloud.google.com/)
- [ ] Create new project: `Hivemail`
- [ ] Enable **Gmail API**

### 2. OAuth Consent Screen
- [ ] Go to **APIs & Services** → **OAuth consent screen**
- [ ] Choose **External**
- [ ] Fill in app name: `Hivemail`
- [ ] Add scopes:
  - [ ] `gmail.readonly` (required)
  - [ ] `gmail.send` (optional, for AI replies)
- [ ] Add test users (your email)

### 3. Create OAuth Client
- [ ] Go to **APIs & Services** → **Credentials**
- [ ] Create **OAuth client ID** → **Web application**
- [ ] Add authorized redirect URIs:
  - [ ] `http://localhost:3000/api/auth/callback/google`
  - [ ] `https://your-domain.vercel.app/api/auth/callback/google`

### 4. Copy Credentials
- [ ] Copy **Client ID**
- [ ] Copy **Client Secret** (save immediately!)

### 5. Add to Environment
- [ ] Local: Add to `.env.local`
  ```env
  GOOGLE_CLIENT_ID=your-client-id
  GOOGLE_CLIENT_SECRET=your-client-secret
  ```
- [ ] Production: Add to Vercel environment variables

### 6. Test
- [ ] Start app: `npm run dev`
- [ ] Visit `http://localhost:3000`
- [ ] Click "Sign In"
- [ ] Sign in with test user
- [ ] Verify redirect works

## 🔧 Current Configuration

Your app is configured to request:
- `gmail.readonly` - Read emails (required)
- `gmail.send` - Send emails (optional, for AI replies)

To enable AI replies, make sure `gmail.send` is in your OAuth consent screen scopes.

## 📝 Environment Variables Needed

```env
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here
NEXTAUTH_URL=http://localhost:3000  # or your production URL
NEXTAUTH_SECRET=your-secret-here
```

## 🚨 Common Issues

| Issue | Solution |
|-------|----------|
| `redirect_uri_mismatch` | Check redirect URI matches exactly |
| `access_denied` | Add user as test user or publish app |
| Can't see client secret | Create new OAuth client |
| Scopes not working | Verify scopes in consent screen |

## 📚 Full Guide

See `OAUTH_SETUP.md` for detailed instructions.
