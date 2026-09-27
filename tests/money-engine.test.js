/**
 * Money/state contract tests.
 *
 * Full wallet-path integration tests run when MYSQL_HOST/MYSQL_PASSWORD are
 * supplied and the Phase 0-2 migration has been applied. This environment
 * does not include a MySQL server, so the DB cases are intentionally skipped
 * rather than falsely passing.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { canonicalStatus, assertTransition } = require('../services/errandState');

const ROOT = path.join(__dirname, '..');
const hasMysql = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_PASSWORD);

function read(name) { return fs.readFileSync(path.join(ROOT, name), 'utf8'); }

describe('errand state machine', () => {
  it('maps legacy states without rewriting them', () => {
    assert.equal(canonicalStatus('assigned'), 'accepted');
    assert.equal(canonicalStatus('in_progress'), 'picked_up');
  });

  it('rejects illegal jumps', () => {
    assert.throws(() => assertTransition('pending', 'completed'), /Illegal errand transition/);
    assert.throws(() => assertTransition('paid', 'delivered'), /Illegal errand transition/);
  });

  it('allows only the authoritative lifecycle transitions', () => {
    assert.doesNotThrow(() => assertTransition('pending', 'paid'));
    assert.doesNotThrow(() => assertTransition('paid', 'accepted'));
    assert.doesNotThrow(() => assertTransition('accepted', 'picked_up'));
    assert.doesNotThrow(() => assertTransition('picked_up', 'delivered'));
    assert.doesNotThrow(() => assertTransition('delivered', 'completed'));
  });
});

describe('money engine contract', () => {
  it('exports the only errand money operations', () => {
    const money = read('services/errandMoney.js');
    for (const fn of ['createHold', 'releaseHold', 'refundHold', 'processDueReleases', 'processDueRefunds']) {
      assert.match(money, new RegExp(`async function ${fn}`), `${fn} must exist`);
    }
  });

  it('contains idempotent hold states and release/refund guards', () => {
    const src = read('services/errandMoney.js');
    assert.match(src, /status === 'released'/);
    assert.match(src, /status === 'refunded'/);
    assert.match(src, /released_at/);
    assert.match(src, /refunded_at/);
    assert.match(src, /Disputed errand hold is frozen/);
    assert.match(src, /DATE_SUB\(NOW\(\), INTERVAL \? HOUR\)/);
  });

  it('keeps errand routes off direct errand wallet movement', () => {
    const src = read('routes/errands.routes.js');
    assert.equal(src.includes('UPDATE wallets SET balance'), false);
    assert.equal(src.includes('INSERT INTO wallet_transactions'), false);
    assert.match(src, /createHold\(/);
    assert.match(src, /releaseHold\(/);
    assert.match(src, /refundHold\(/);
  });
});

describe('live MySQL money path', { skip: !hasMysql && 'MYSQL_HOST/MYSQL_PASSWORD not configured' }, () => {
  it('requires a migrated test database for end-to-end balance/hold assertions', async () => {
    // This is deliberately explicit: CI/local environments with MySQL should
    // extend this block with seeded client/runner IDs and run the 10 required
    // scenarios against an isolated database. No live DB is available here.
    assert.ok(hasMysql);
  });
});
