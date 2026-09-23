const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet'); // Add helmet for security headers
const cookieParser = require('cookie-parser'); // Add cookie-parser for JWT cookies
require('dotenv').config();


// Import middleware
const { notFound, errorHandler } = require('./middleware/errorHandler.middleware');
const rateLimit = require('express-rate-limit');

// Define the limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});



// Import middleware
// Rate limiter is already defined above
// Database connection
const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
const allowedOrigins = new Set([
  process.env.CLIENT_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost',
  'http://127.0.0.1',
  'http://myerrand.name.ng',
  // Production domains
  'https://myerrand.name.ng',
  'https://my-errand-app.pages.dev',
  'https://*.pages.dev',
  'https://my-errand-app.vercel.app',
  'https://*.vercel.app',
  'https://my-errand-app.netlify.app',
  'https://*.netlify.app'
]);

// Add custom production URL if set
if (process.env.FRONTEND_URL) {
  allowedOrigins.add(process.env.FRONTEND_URL);
}

if (process.env.WORDPRESS_URL) {
  allowedOrigins.add(process.env.WORDPRESS_URL.replace(/\/$/, ''));
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  // Wildcard-style entries stored as literal strings with *
  for (const entry of allowedOrigins) {
    if (entry.includes('*')) {
      const pattern = '^' + entry.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\*/g, '.*') + '$';
      if (new RegExp(pattern).test(origin)) return true;
    }
  }
  // Codespaces / GitHub preview hosts (auto when ALLOW_CODESPACES=true)
  if (process.env.ALLOW_CODESPACES === 'true') {
    if (/\.github\.dev$/.test(origin) || /\.app\.github\.dev$/.test(origin) || /\.githubpreview\.dev$/.test(origin)) {
      return true;
    }
  }
  // Localhost any port
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

app.use(cors({
  origin: function (origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS not allowed from origin: ' + origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
}));

// Body parsing middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// Logging middleware
app.use(morgan('dev'));

// Apply rate limiting to all API routes
app.use('/api', apiLimiter);

// Simple health checks
app.get('/health', (req, res) => res.json({ ok: true, service: 'my-errand-app', time: new Date().toISOString() }));
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'api', time: new Date().toISOString() }));

// Import authentication middleware
const { verifyToken } = require('./middleware/auth');
const walletRoutes = require('./routes/wallet.routes');

// Import Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/errands', require('./routes/errands.routes'));
// Wallet: JWT required except Paystack webhook (verified by provider signature inside route)
app.use('/api/wallet', (req, res, next) => {
  if (req.method === 'POST' && (req.path === '/paystack/webhook' || req.path === '/webhook/paystack')) {
    return next();
  }
  return verifyToken(req, res, next);
}, walletRoutes);
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/ratings', require('./routes/ratings.routes'));
app.use('/api/notifications', require('./routes/notifications.routes'));
app.use('/api/messages', require('./routes/messages.routes'));
app.use('/api/verification', require('./routes/verification.routes'));
// Mount client and agent routes for frontend AuthService endpoints
app.use('/api/clients', require('./routes/client.routes'));
app.use('/api/agents', require('./routes/agent.routes'));
// Import other routes here

// Serve static files from the React app dist directory in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'client/dist')));
  
  // Catch-all handler to serve React's index.html for any request not handled by API routes
  app.get('/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/dist', 'index.html'));
  });
}

// 404 handler for all routes
app.use(notFound);

// Global error handler - must be last
app.use(errorHandler);

module.exports = app;
