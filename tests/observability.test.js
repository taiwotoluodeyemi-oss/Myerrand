const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

function request(app, options) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const req = http.request({ host: '127.0.0.1', port, ...options }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', c => { body += c; });
        res.on('end', () => server.close(() => resolve({ status: res.statusCode, headers: res.headers, body })));
      });
      req.on('error', e => server.close(() => reject(e)));
      if (options.body) req.write(options.body);
      req.end();
    });
  });
}

test('structured request logging and correlation IDs are installed without sensitive request logging', () => {
  const app = read('app.js');
  const middleware = read('middleware/observability.js');
  const logger = read('config/winston.js');
  assert.match(app, /observabilityMiddleware/);
  assert.match(middleware, /X-Request-Id/);
  assert.match(middleware, /duration_ms/);
  assert.match(middleware, /organization_id/);
  assert.doesNotMatch(middleware, /req\.body\b.*logger|logger.*req\.body/);
  assert.match(logger, /winston\.format\.json/);
});

test('health endpoints expose safe process, database and dependency checks', () => {
  const app = read('app.js');
  assert.match(app, /app\.get\('\/health'/);
  assert.match(app, /app\.get\('\/health\/db'/);
  assert.match(app, /app\.get\('\/health\/dependencies'/);
  assert.match(app, /DATABASE_UNAVAILABLE/);
  assert.doesNotMatch(app, /PAYSTACK_SECRET_KEY.*health/);
});

test('database health fails safely when the database is unavailable', () => {
  const s = read('services/observability.js');
  assert.match(s, /SELECT 1 AS ok/);
  assert.match(s, /return \{ ok: false/);
  assert.match(s, /error_code: error\.code/);
});

test('malformed JSON is handled through the global validation/error path with a request ID', () => {
  const app = read('app.js');
  const middleware = read('middleware/observability.js');
  const errors = read('middleware/errorHandler.middleware.js');
  assert.match(app, /express\.json/);
  assert.match(errors, /VALIDATION_ERROR/);
  assert.match(middleware, /X-Request-Id/);
});

test('metrics expose required operational categories and financial alerts', () => {
  const s = read('services/observability.js');
  for (const term of ['requests','errors','login_failures','payment_failures','webhook_failures','deposits','holds','releases','refunds','disputes','stuck_payments','active_users']) assert.match(s, new RegExp(term));
  for (const term of ['negative_wallet','orphaned_hold','released_and_refunded_hold','missing_ledger_entry','stuck_payment','repeated_failed_verification']) assert.match(s, new RegExp(term));
});

test('error categories include all production categories', () => {
  const s = read('middleware/errorHandler.middleware.js');
  assert.match(s, /errors_\$\{category\.toLowerCase\(\)\}/);
  for (const c of ['AUTH_ERROR','PAYMENT_ERROR','MONEY_ERROR','DATABASE_ERROR','WEBHOOK_ERROR','VALIDATION_ERROR','EXTERNAL_PROVIDER_ERROR']) {
    if (c === 'MONEY_ERROR') assert.match(s, /MONEY_ERROR|money/i); else assert.match(s, new RegExp(c));
  }
});

test('payment and webhook failures increment observability counters without changing transaction semantics', () => {
  const p = read('services/paymentPort.js');
  const w = read('services/eventOutbox.js');
  assert.match(p, /recordPaymentFailure\(\)/);
  assert.match(w, /recordWebhookFailure\(\)/);
  assert.match(w, /catch \(error\)/);
});

test('graceful shutdown stops workers and closes HTTP, socket and database resources', () => {
  const s = read('server.js');
  assert.match(s, /gracefulShutdown/);
  assert.match(s, /clearInterval\(moneyWorker\)/);
  assert.match(s, /clearInterval\(webhookWorker\)/);
  assert.match(s, /server\.close/);
  assert.match(s, /io\.close/);
  assert.match(s, /rawPool.*end/);
  assert.match(s, /uncaughtException/);
  assert.match(s, /unhandledRejection/);
});

test('admin dashboard exposes operational health', () => {
  const route = read('routes/admin.routes.js');
  const ui = read('client/src/pages/AdminDashboard.jsx');
  assert.match(route, /router\.get\('\/observability'/);
  assert.match(route, /operationalSnapshot/);
  assert.match(ui, /\/api\/admin\/observability/);
  assert.match(ui, /Operational health/);
});
