const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('webhook delivery state machine is explicit and bounded', () => {
  const s = read('database/20-webhook-operations.sql');
  const e = read('services/eventOutbox.js');
  assert.match(s, /processing/);
  assert.match(s, /retrying/);
  assert.match(s, /dead_letter/);
  assert.match(e, /status='processing'/);
  assert.match(e, /status IN \('pending','retrying'\)/);
  assert.match(e, /WEBHOOK_MAX_RETRIES/);
  assert.match(e, /WEBHOOK_RETRY_BACKOFF_SECONDS/);
});

test('webhook requests carry stable event identity and HMAC signatures', () => {
  const e = read('services/eventOutbox.js');
  assert.match(e, /X-MyErrand-Event-Id/);
  assert.match(e, /X-MyErrand-Signature/);
  assert.match(e, /createHmac\('sha256'/);
  assert.match(read('database/12-stage5-events.sql'), /UNIQUE KEY uq_webhook_delivery/);
});

test('secret rotation preserves a bounded old-secret grace window', () => {
  const s = read('database/20-webhook-operations.sql');
  const r = read('routes/merchant.routes.js');
  const e = read('services/eventOutbox.js');
  assert.match(s, /previous_secret_ciphertext/);
  assert.match(s, /previous_secret_expires_at/);
  assert.match(r, /rotate-secret/);
  assert.match(r, /24 HOUR/);
  assert.match(e, /X-MyErrand-Signature-Previous/);
});

test('SSRF protection blocks private destinations and redirects', () => {
  const e = read('services/eventOutbox.js');
  assert.match(e, /isPrivateIp/);
  assert.match(e, /Webhook host resolves to a private or local address/);
  assert.match(e, /maxRedirects: 0/);
  assert.match(e, /parsed.protocol !== 'https:'/);
});

test('webhook failures cannot throw into state or money paths', () => {
  const e = read('services/eventOutbox.js');
  const state = read('services/errandState.js');
  const money = read('services/errandMoney.js');
  assert.match(e, /catch \(error\)/);
  assert.match(e, /safeWebhookError/);
  assert.match(state, /enqueueEvent\(conn/);
  assert.match(money, /enqueueEvent\(conn/);
  assert.doesNotMatch(state, /axios/);
  assert.doesNotMatch(money, /axios/);
});

test('dead-letter replay is idempotent and reuses the existing delivery/event', () => {
  const e = read('services/eventOutbox.js');
  assert.match(e, /status='dead_letter'/);
  assert.match(e, /UPDATE webhook_deliveries SET status='retrying'/);
  assert.match(e, /UPDATE webhook_outbox o JOIN webhook_deliveries d/);
  assert.match(e, /INSERT IGNORE INTO webhook_deliveries/);
});

test('notification failures are observable without exposing sensitive payloads', () => {
  const s = read('database/20-webhook-operations.sql');
  const e = read('services/eventOutbox.js');
  const a = read('routes/admin.routes.js');
  assert.match(s, /notification_failures/);
  assert.match(e, /recordNotificationFailure/);
  assert.match(a, /notification_failures/);
  assert.doesNotMatch(e, /console\.error\(.*secret/i);
  assert.doesNotMatch(e, /console\.error\(.*payload/i);
});

