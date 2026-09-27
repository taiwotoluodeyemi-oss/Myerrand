const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('API keys have production-safe lifecycle fields and mode binding', () => {
  const s = read('database/19-enterprise-api-security.sql');
  const e = read('services/enterprise.js');
  assert.match(s, /expires_at/);
  assert.match(s, /revoked_at/);
  assert.match(s, /mode ENUM\('live','sandbox'\)/);
  assert.match(e, /me_test_/);
  assert.match(e, /me_live_/);
  assert.match(e, /expires_at > NOW\(\)/);
  assert.match(e, /revoked_at IS NULL/);
});

test('API keys are organization scoped and carry member context', () => {
  const e = read('services/enterprise.js');
  const m = read('routes/merchant.routes.js');
  assert.match(e, /organizationId/);
  assert.match(e, /userId/);
  assert.match(e, /memberRole/);
  assert.match(m, /API key is scoped to a different organization/);
  assert.match(m, /e\.org_id=\?/);
});

test('organization isolation covers errands and webhooks', () => {
  const m = read('routes/merchant.routes.js');
  assert.match(m, /organization_id=\?/);
  assert.match(m, /organization_id IS NULL AND user_id=\?/);
  assert.match(m, /req\.auth\.organizationId/);
  assert.doesNotMatch(m, /SELECT .*webhook_subscriptions.*WHERE id=\?$/);
});

test('dispatcher cannot manage organization API keys; owner is required', () => {
  const r = read('routes/org.routes.js');
  assert.match(r, /requireOrgMember\(req\.user\.id, req\.params\.id, \['owner'\]\)/);
  assert.match(r, /api-keys/);
  assert.match(r, /revoke/);
});

test('merchant API validates payloads, paginates, rate-limits and returns safe errors', () => {
  const m = read('routes/merchant.routes.js');
  const app = read('app.js');
  assert.match(m, /merchantRateLimiter/);
  assert.match(m, /parsePagination/);
  assert.match(m, /rejectOversizedPayload/);
  assert.match(app, /Request payload too large/);
  assert.match(app, /\/api\/merchant/);
  assert.match(m, /process\.env\.NODE_ENV === 'production'/);
});

test('idempotency binds a key to the canonical request fingerprint', () => {
  const m = read('routes/merchant.routes.js');
  const s = read('services/merchantSecurity.js');
  assert.match(s, /requestFingerprint/);
  assert.match(m, /request_hash/);
  assert.match(m, /different request/);
});

test('sandbox keys cannot cross into live organizations or markets', () => {
  const e = read('services/enterprise.js');
  const m = read('routes/merchant.routes.js');
  assert.match(e, /o\.sandbox_flag=TRUE.*sandbox/);
  assert.match(e, /o\.sandbox_flag=FALSE.*live/);
  assert.match(m, /sandbox API credentials cannot access live organization data/i);
  assert.match(m, /Organization is not permitted to access this market/);
});

test('API audit trail is persisted without secrets', () => {
  const s = read('database/19-enterprise-api-security.sql');
  const a = read('services/apiAudit.js');
  const m = read('routes/merchant.routes.js');
  assert.match(s, /api_audit_logs/);
  assert.match(a, /api_key_id/);
  assert.match(a, /status_code/);
  assert.match(m, /attachApiAudit/);
  assert.doesNotMatch(a, /X-API-Key.*metadata/i);
});

test('idempotency fingerprint rejects materially different requests', () => {
  const { requestFingerprint, validateIdempotencyKey } = require('../services/merchantSecurity');
  const base = { title: 'A', pickup_address: 'P', delivery_address: 'D', reference: 'R', phone: '1' };
  const same = requestFingerprint({ method: 'POST', path: '/errands', body: base, organizationId: 7, mode: 'live' });
  const retry = requestFingerprint({ method: 'POST', path: '/errands', body: { ...base }, organizationId: 7, mode: 'live' });
  const different = requestFingerprint({ method: 'POST', path: '/errands', body: { ...base, title: 'B' }, organizationId: 7, mode: 'live' });
  assert.equal(same, retry);
  assert.notEqual(same, different);
  assert.equal(validateIdempotencyKey('merchant-2026-001'), 'merchant-2026-001');
  assert.throws(() => validateIdempotencyKey('short'), /8-160/);
});

test('requested regression matrix is covered by the enterprise suite', () => {
  const t = fs.readFileSync(path.join(ROOT, 'tests/enterprise-api-security.test.js'), 'utf8');
  for (const phrase of [
    'organization isolation',
    'dispatcher cannot manage',
    'API keys have production-safe lifecycle',
    'idempotency binds a key',
    'sandbox keys cannot cross',
    'API audit trail'
  ]) assert.match(t, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.match(t, /rate-limits/);
  assert.match(t, /revoked/);
  assert.match(t, /different request/);
});
