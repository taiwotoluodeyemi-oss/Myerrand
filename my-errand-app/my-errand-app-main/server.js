const http = require('http');
const app = require('./app');
const { Server } = require('socket.io');
const connectMySQL = require('./config/db.mysql');
const connectMongoDB = require('./config/db.mongo');

const useMongoOnly = process.env.USE_MONGO === 'true';
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}


process.on('uncaughtException', (err) => {
  console.error('UNCUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

console.log('[STARTUP] Creating HTTP server...');
const server = http.createServer(app);
console.log('[STARTUP] HTTP server created. Initializing Socket.IO...');
const socketOrigins = process.env.ALLOW_CODESPACES === 'true'
  ? true  // reflect request origin in dev/Codespaces
  : (process.env.CLIENT_URL || process.env.FRONTEND_URL || 'http://localhost:3001');
const io = new Server(server, {
  cors: {
    origin: socketOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});
app.set('io', io);

if (!useMongoOnly) {
  console.log('[STARTUP] Connecting to MySQL...');
  connectMySQL(); // Will gracefully handle connection errors
} else {
  console.log('[STARTUP] USE_MONGO is enabled, skipping MySQL startup');
}

if (useMongoOnly) {
  console.log('[STARTUP] Connecting to MongoDB...');
  connectMongoDB();
} else {
  console.log('[STARTUP] USE_MONGO is disabled, skipping MongoDB startup');
}

try {
  console.log('[STARTUP] Loading socket handlers...');
  const newLocal = './sockets/socketHandler';
  require(newLocal)(io);
  console.log('[STARTUP] Socket handlers loaded.');
} catch (e) {
  console.error('[STARTUP] Failed to load socket handlers:', e);
}

console.log(`[STARTUP] Starting server on port ${PORT}...`);
server.listen(PORT)
  .on('listening', () => console.log(`🚀 Server running on port ${PORT}`))
  .on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[STARTUP] Cannot start server: port ${PORT} is already in use.`);
      console.error('Please stop the existing process using this port or set a different PORT in your .env file.');
    } else {
      console.error('[STARTUP] Server error:', err);
    }
    process.exit(1);
  });
