# Migration from Vite to Webpack

## Overview
This document outlines the migration from React + Vite to React + Node.js with Webpack.

## Changes Made

### 1. Root Package.json Updates
- Added `concurrently` and `nodemon` as dev dependencies
- Updated scripts to run both client and server simultaneously
- Added build scripts for production deployment

### 2. Client Package.json Changes
- Removed Vite dependencies (`vite`, `@vitejs/plugin-react`)
- Removed `"type": "module"` to use CommonJS
- Added Webpack and Babel dependencies:
  - `webpack`, `webpack-cli`, `webpack-dev-server`
  - `babel-loader`, `@babel/core`, `@babel/preset-env`, `@babel/preset-react`
  - `html-webpack-plugin`, `css-loader`, `style-loader`
  - `file-loader`, `url-loader` for assets

### 3. New Configuration Files
- **webpack.config.js**: Webpack configuration with development server, proxy to backend API, and production builds
- **babel.config.js**: Babel configuration for React JSX transformation

### 4. File Updates
- **client/public/index.html**: Removed Vite-specific script tag (Webpack auto-injects)
- Removed **client/vite.config.js** (no longer needed)

### 5. Backend Configuration (No Changes Required)
- The existing Express.js server already serves static files from `client/dist`
- API routes and CORS configuration remain unchanged

## New Scripts Available

### Root level (package.json)
```bash
npm run dev          # Run both client and server in development
npm run server       # Run only the backend server
npm run client       # Run only the frontend client
npm run build        # Build the React client for production
npm run build:prod   # Build and start in production mode
```

### Client level (client/package.json)
```bash
npm run dev          # Start Webpack dev server
npm run build        # Build for production
npm run start        # Start dev server with auto-open browser
```

## Development Workflow

1. **Development**: Run `npm run dev` from the root directory
2. **Production Build**: Run `npm run build` to create production assets
3. **Production Deploy**: Run `npm run build:prod` to build and start server

## Key Benefits of Migration

1. **Unified Node.js Ecosystem**: Both frontend and backend use Node.js/npm toolchain
2. **Better Production Control**: Webpack provides more granular control over builds
3. **Asset Management**: Better handling of static assets and code splitting
4. **Development Experience**: Hot reloading and proxy setup maintained
5. **SEO Ready**: Server-side rendering capability if needed in the future

## API Integration

The backend-frontend integration remains unchanged:
- API calls from React app go to `/api/*` routes
- Webpack dev server proxies API calls to `http://localhost:5000`
- Production builds are served by Express.js from `client/dist`
