# Google OAuth Setup Guide

This guide walks you through setting up Google OAuth for Hivemail so users can sign in with their Google accounts and access Gmail.

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top
3. Click **"New Project"**
4. Enter project name: `Hivemail` (or your preferred name)
5. Click **"Create"**
6. Wait for the project to be created, then select it

## Step 2: Enable Gmail API

1. In the Google Cloud Console, go to **"APIs & Services"** → **"Library"**
2. Search for **"Gmail API"**
3. Click on **"Gmail API"** from the results
4. Click **"Enable"**
5. Wait for the API to be enabled

## Step 3: Configure OAuth Consent Screen

1. Go to **"APIs & Services"** → **"OAuth consent screen"**
2. Select **"External"** (unless you have a Google Workspace account, then you can use "Internal")
3. Click **"Create"**

### App Information
- **App name**: `Hivemail` (or your app name)
- **User support email**: Your email address
- **App logo**: (Optional) Upload a logo if you have one
- **Application home page**: Your app URL (e.g., `https://hivemail.vercel.app`)
- **Application privacy policy link**: (Optional) Link to your privacy policy
- **Application terms of service link**: (Optional) Link to your terms

4. Click **"Save and Continue"**

### Scopes
1. Click **"Add or Remove Scopes"**
2. In the filter box, search for and add:
   - `https://www.googleapis.com/auth/gmail.readonly` - Read Gmail messages
   - `https://www.googleapis.com/auth/gmail.send` - Send email (optional, for AI replies)
3. Click **"Update"**
4. Click **"Save and Continue"**

### Test Users (for development)
1. Click **"Add Users"**
2. Add your email address (and any test users)
3. Click **"Add"**
4. Click **"Save and Continue"**

### Summary
1. Review your settings
2. Click **"Back to Dashboard"**

**Note**: For production, you'll need to submit your app for verification if you want to allow all users. For now, test users can use the app.

## Step 4: Create OAuth Credentials

1. Go to **"APIs & Services"** → **"Credentials"**
2. Click **"+ CREATE CREDENTIALS"** at the top
3. Select **"OAuth client ID"**

### Application Type
- Select **"Web application"**

### Name
- Enter: `Hivemail Web Client`

### Authorized JavaScript origins
Add your app URLs:
- `http://localhost:3000` (for local development)
- `https://your-domain.vercel.app` (your production URL)

### Authorized redirect URIs
Add your callback URLs:
- `http://localhost:3000/api/auth/callback/google` (for local development)
- `https://your-domain.vercel.app/api/auth/callback/google` (your production URL)

4. Click **"Create"**

## Step 5: Copy Your Credentials

After creating the OAuth client, you'll see a popup with:
- **Your Client ID** (looks like: `123456789-abcdefghijklmnop.apps.googleusercontent.com`)
- **Your Client Secret** (looks like: `GOCSPX-abcdefghijklmnopqrstuvwxyz`)

**Important**: Copy these immediately - you won't be able to see the secret again!

## Step 6: Add Credentials to Your App

### For Local Development

1. Open `.env.local` (create it if it doesn't exist)
2. Add your credentials:

```env
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here
```

### For Production (Vercel)

1. Go to your Vercel project dashboard
2. Go to **Settings** → **Environment Variables**
3. Add:
   - `GOOGLE_CLIENT_ID` = your client ID
   - `GOOGLE_CLIENT_SECRET` = your client secret

## Step 7: Update OAuth Consent Screen for Production

When you're ready to launch:

1. Go back to **"OAuth consent screen"**
2. Click **"PUBLISH APP"** (if you want to allow all users)
3. Or submit for verification if you need to:
   - Click **"SUBMIT FOR VERIFICATION"**
   - Fill out the verification form
   - This process can take a few days

**Note**: Until your app is verified, only test users can sign in. After verification, any Google user can sign in.

## Testing

1. Start your app: `npm run dev`
2. Go to `http://localhost:3000`
3. Click **"Sign In"**
4. You should see the Google sign-in screen
5. Sign in with one of your test users
6. Grant permissions for Gmail access
7. You should be redirected back to your app

## Troubleshooting

### "Error 400: redirect_uri_mismatch"
- Make sure the redirect URI in your OAuth client exactly matches your app URL
- Check for trailing slashes, http vs https, etc.
- The URL must be: `https://your-domain.com/api/auth/callback/google`

### "Access blocked: This app's request is invalid"
- Make sure you've added your email as a test user
- Check that the OAuth consent screen is configured correctly
- Verify the scopes are added correctly

### "Error 403: access_denied"
- Your app might not be published yet
- Add yourself as a test user
- Or submit for verification

### Users can't sign in
- Check that your app is published (or users are added as test users)
- Verify the OAuth consent screen is configured
- Make sure the redirect URIs match exactly

## Security Best Practices

1. **Never commit credentials to Git** - Always use environment variables
2. **Use different credentials for dev and production** - Create separate OAuth clients
3. **Rotate secrets regularly** - If a secret is compromised, create a new one
4. **Limit scopes** - Only request the permissions you actually need
5. **Monitor usage** - Check Google Cloud Console for unusual activity

## Next Steps

After OAuth is configured:
1. Users can sign in with their Google accounts
2. They'll be prompted to grant Gmail access
3. Once granted, the app can sync their emails
4. Users can then add their Gemini API key in Settings to enable AI features

## Additional Resources

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [OAuth Consent Screen Guide](https://support.google.com/cloud/answer/10311615)
