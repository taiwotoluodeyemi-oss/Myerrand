# Backend Deployment Guide

## Render + MongoDB Deployment (Your Choice)

Since you're using Render for Node.js and MongoDB for the database, here's your deployment guide.

### 1. Set up MongoDB Atlas
1. Go to [MongoDB Atlas](https://cloud.mongodb.com/)
2. Create a free account
3. Create a new cluster (free tier)
4. Create a database user
5. Get your connection string (looks like: `mongodb+srv://username:password@cluster.mongodb.net/database`)

### 2. Deploy to Render

#### Create Render Account
- Go to [render.com](https://render.com)
- Sign up with GitHub

#### Create Web Service
1. Click **"New"** → **"Web Service"**
2. Connect your GitHub repo (`my-errand-app`)
3. Configure the service:
   - **Name**: `my-errand-app-backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free tier is fine to start

#### Environment Variables
Add these environment variables in Render:

```
# Server Configuration
NODE_ENV=production
PORT=10000
FRONTEND_URL=https://yourdomain.com

# Database (MongoDB only)
USE_MONGO=true
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/database

# Authentication
JWT_SECRET=your-super-secure-jwt-secret-here-make-it-long-and-random
JWT_EXPIRY=7d

# Payment Processing
PAYPAL_CLIENT_ID=your-paypal-client-id
PAYPAL_SECRET=your-paypal-secret
```

### 3. Deploy
Render will build and deploy your app automatically.

### 4. Get Your Backend URL
Once deployed, Render will give you a URL like: `https://my-errand-app-backend.onrender.com`

### 5. Configure Cloudflare Pages
1. Go to your Cloudflare Pages project
2. **Settings** → **Environment variables**
3. Add: `API_BASE=https://your-backend-url.onrender.com`

### 6. Test the Deployment
- Visit your frontend domain
- Try registering/logging in
- Check browser console for errors