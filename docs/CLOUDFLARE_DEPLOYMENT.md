# Cloudflare Deployment Guide

This guide will help you deploy your my-errand-app frontend to Cloudflare Pages. The backend remains hosted externally because the current Express backend is not Cloudflare Workers-compatible.

## Architecture Overview

```
┌─────────────────────────────────────┐
│      Cloudflare Pages (CDN)         │
│      React Frontend (Static)        │
└────────────┬────────────────────────┘
             │ API Calls
┌────────────▼────────────────────────┐
│    External Backend Host / API      │
│      Express + Database Support     │
└────────────┬────────────────────────┘
             │ Database Queries
┌────────────▼────────────────────────┐
│    External Database (MongoDB/MySQL)│
│    (Kept at existing location)      │
└─────────────────────────────────────┘
```

## Prerequisites

1. A Cloudflare account (free tier is sufficient)
2. Node.js and npm installed locally
3. Git repository (GitHub recommended)
4. Your database credentials

## Step 1: Prepare Frontend for Deployment

### 1.1 Install Wrangler CLI (Cloudflare Worker Tools)

```bash
npm install -g @cloudflare/wrangler
wrangler login
```

### 1.2 Build the Frontend

```bash
cd client
npm install
npm run build
```

This creates a `client/dist` folder with your static assets.

## Step 2: Create Cloudflare Pages Project

### 2.1 Connect via GitHub

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Pages**
3. Click **Create a project** → **Connect to Git**
4. Select your GitHub repository
5. Configure build settings:
   - **Framework preset**: None (custom)
   - **Build command**: `cd client && npm install && npm run build`
   - **Build output directory**: `client/dist`
   - **Root directory**: (leave blank)

### 2.2 Add Environment Variables

In Pages settings, add environment variables:
- `API_BASE`: Your backend URL (e.g., `https://api.example.com`)

## Step 3: Host Backend Separately

The frontend is deployed to Cloudflare Pages. The backend should remain hosted on an external server, VPS, or platform that supports Node.js and the database drivers used by this app.

- Keep the Express backend running on a separate host.
- Set the backend URL in Cloudflare Pages build environment as `API_BASE`.
- Do not attempt to deploy the current backend to Cloudflare Workers without a full backend rewrite.

## Step 4: Connect Frontend to Backend

### 4.1 Update API Base URL

In `client/src/main.jsx` or axios configuration:

```javascript
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
```

### 4.2 Redeploy Frontend

Push changes to GitHub. Cloudflare Pages will automatically rebuild and deploy.

## Step 5: Custom Domain Setup (Optional)

1. In Cloudflare Dashboard → Pages project
2. **Settings** → **Domains & DNS**
3. Add your custom domain
4. Update DNS records as instructed

## Database Considerations

### Option A: Keep Existing Setup
- Continue using your current MySQL or MongoDB server
- Just update connection strings in environment variables
- Ensure database server is accessible from Cloudflare Workers

### Option B: MongoDB Atlas (Recommended for Workers)
1. Create free cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Get connection string
3. Add to Cloudflare environment variables

## Monitoring & Logs

### View Worker Logs
```bash
wrangler tail
```

### View Pages Deployment Logs
- Dashboard → Pages → Your Project → Deployments

## Cost Breakdown

- **Cloudflare Pages**: Free for unlimited deployments + 500 builds/month
- **Cloudflare Workers**: Free tier: 100,000 requests/day
- **Database**: Your existing service (or MongoDB Atlas free tier)

## Troubleshooting

### CORS Issues
Add CORS headers in worker:
```javascript
response.headers.set('Access-Control-Allow-Origin', '*');
response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
```

### Database Connection Timeouts
- Ensure database is publicly accessible OR
- Use Cloudflare Tunnel to reach private database

### Environment Variables Not Loading
- Redeploy: `wrangler deploy`
- Check variable names match exactly

## Next Steps

1. Set up `.env` file locally with database credentials
2. Test backend locally: `npm run dev`
3. Deploy to Cloudflare when ready
4. Monitor performance in Cloudflare Analytics

## Links & Resources

- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
