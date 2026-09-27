const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const routes = fs.readFileSync(require.resolve('../routes/auth.routes'),'utf8');
const { POLICIES, lockMinutes } = require('../services/adminMfaRateLimit');

test('admin MFA policies use progressive lockout', () => {
  for (const action of ['challenge','enrollment','recovery']) {
    const p = POLICIES[action];
    assert.ok(p.maxFailures >= 3);
    assert.ok(p.maxLockMinutes > p.baseLockMinutes);
    assert.equal(lockMinutes(p.maxFailures - 1, p), 0);
    assert.equal(lockMinutes(p.maxFailures, p), p.baseLockMinutes);
    assert.ok(lockMinutes(p.maxFailures + 1, p) > lockMinutes(p.maxFailures, p));
    assert.ok(lockMinutes(99, p) <= p.maxLockMinutes);
  }
});

test('challenge, enrollment verification and recovery are rate-gated', () => {
  assert.match(routes, /checkMfaRate\('enrollment'/);
  assert.match(routes, /checkMfaRate\(action/);
  assert.match(routes, /recordMfaFailure\('enrollment'/);
  assert.match(routes, /recordMfaFailure\(action/);
  assert.match(routes, /status\(429\)/);
});

test('successful MFA resets the applicable failure bucket', () => {
  assert.match(routes, /recordMfaSuccess\('enrollment'/);
  assert.match(routes, /recordMfaSuccess\(action/);
});

test('rate-limit state is database-backed and row-locked for multi-worker safety', () => {
  const source = fs.readFileSync(require.resolve('../services/adminMfaRateLimit'),'utf8');
  const migration = fs.readFileSync(require.resolve('../database/19-admin-mfa.sql'),'utf8');
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /admin_mfa_rate_limits/);
  assert.match(migration, /UNIQUE KEY uq_admin_mfa_rate_key/);
});
