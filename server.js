const http = require('http');
const app = require('./app');
const { Server } = require('socket.io');
const connectMySQL = require('./config/db.mysql');
const connectMongoDB = require('./config/db.mongo');
const logger = require('./config/winston');

const useMongoOnly = process.env.USE_MONGO === 'true';
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}

let shuttingDown = false;
let shutdownTimer = null;

async function gracefulShutdown(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn({ event: 'shutdown_started', signal });
  clearInterval(moneyWorker);
  clearInterval(webhookWorker);
  shutdownTimer = setTimeout(() => process.exit(1), 10000);
  if (shutdownTimer.unref) shutdownTimer.unref();
  try { await new Promise(resolve => server.close(resolve)); } catch (_) {}
  try { if (io?.close) await io.close(); } catch (_) {}
  try { if (require('./config/db.mysql').rawPool) await require('./config/db.mysql').rawPool.end(); } catch (_) {}
  logger.info({ event: 'shutdown_complete', signal });
  clearTimeout(shutdownTimer);
  process.exit(0);
}

process.on('uncaughtException', (err) => {
  logger.error({ event: 'uncaught_exception', category: 'DATABASE_ERROR', message: String(err?.message || err).slice(0, 500) });
  gracefulShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'unhandled_rejection', category: 'EXTERNAL_PROVIDER_ERROR', message: String(reason?.message || reason).slice(0, 500) });
  gracefulShutdown('unhandledRejection');
});
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));


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
  require('./sockets/socketHandler')(io);
  console.log('[STARTUP] Socket handlers loaded.');
} catch (e) {
  console.warn('[STARTUP] Socket handlers not loaded (optional):', e.message);
}

console.log(`[STARTUP] Starting server on port ${PORT}...`);
const { processDueReleases, processDueRefunds } = require('./services/errandMoney');

// Lightweight safety worker. The money engine is idempotent, so repeated runs are safe.
const moneyWorker = setInterval(async () => {
  try {
    await processDueRefunds();
    await processDueReleases();
  } catch (error) {
    console.error('[MONEY WORKER] Failed:', error.message);
  }
}, 5 * 60 * 1000);
if (moneyWorker.unref) moneyWorker.unref();

const { processWebhookOutbox } = require('./services/eventOutbox');
let webhookWorkerRunning = false;
const webhookWorker = setInterval(async () => {
  if (webhookWorkerRunning) return;
  webhookWorkerRunning = true;
  try { await processWebhookOutbox({ limit: 50 }); }
  catch (error) { console.error('[WEBHOOK WORKER] Failed:', error.message); }
  finally { webhookWorkerRunning = false; }
}, 15 * 1000);
if (webhookWorker.unref) webhookWorker.unref();

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
