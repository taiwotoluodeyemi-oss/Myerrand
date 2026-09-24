/**
 * Smoke tests — run with: node --test tests/smoke.test.js
 * Does not require a live DB for pure unit checks.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

describe('module load', () => {
  it('loads auth middleware', () => {
    const auth = require('../middleware/auth');
    assert.equal(typeof auth.verifyToken, 'function');
    assert.equal(typeof auth.requireAdmin, 'function');
  });

  it('loads currencies util', () => {
    const { currencies, getCurrencySymbol } = require('../utils/currencies');
    assert.ok(currencies.length > 0);
    assert.equal(getCurrencySymbol('USD'), '$');
  });

  it('loads payment-config', () => {
    const cfg = require('../utils/payment-config');
    assert.equal(typeof cfg.isPaystackConfigured, 'function');
  });

  it('app exports express app', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-smoke';
    process.env.USE_MONGO = 'false';
    const app = require('../app');
    assert.equal(typeof app, 'function');
  });
});
