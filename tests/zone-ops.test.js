const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { median, classifyHealth } = require('../services/zoneScoreboard');

const ROOT = path.join(__dirname, '..');

describe('zone operating system', () => {
  it('stores zone fields and business fields in the migration', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'database/09-zone-ops.sql'), 'utf8');
    for (const field of ['country', 'city', 'zone', 'channel', 'business_reference', 'contact_phone']) assert.match(sql, new RegExp(`ADD COLUMN ${field}`, 'i'));
    assert.match(sql, /service_zones/i);
  });

  it('has a configurable primary zone and supply/health thresholds', () => {
    const cfg = require('../config/marketplace');
    assert.ok(Array.isArray(cfg.PRIMARY_MARKET.zones));
    assert.ok(cfg.PRIMARY_MARKET.zones.length >= 1);
    assert.equal(cfg.SUPPLY_GATE_RUNNERS, 15);
    assert.equal(cfg.MIN_SAMPLE_JOBS, 10);
  });

  it('returns insufficient data below the sample threshold', () => {
    assert.equal(classifyHealth({ sample_size: 9 }), 'INSUFFICIENT');
  });

  it('classifies strong and early zone health without inventing values', () => {
    const strong = { sample_size: 10, median_accept_minutes: 10, accept_rate: .90, completion_rate: .95, dispute_rate: .01 };
    const early = { sample_size: 10, median_accept_minutes: 15, accept_rate: .75, completion_rate: .87, dispute_rate: .04 };
    const red = { sample_size: 10, median_accept_minutes: 25, accept_rate: .60, completion_rate: .80, dispute_rate: .08 };
    assert.equal(classifyHealth(strong), 'GREEN');
    assert.equal(classifyHealth(early), 'YELLOW');
    assert.equal(classifyHealth(red), 'RED');
  });

  it('computes median acceptance time', () => {
    assert.equal(median([1, 5, 3]), 3);
    assert.equal(median([1, 5, 3, 7]), 4);
    assert.equal(median([]), null);
  });

  it('business create route requires reference and phone', () => {
    const src = fs.readFileSync(path.join(ROOT, 'routes/errands.routes.js'), 'utf8');
    assert.match(src, /normalizedChannel === 'business'/);
    assert.match(src, /Business errands require reference and contact phone/);
  });

  it('runner discovery uses service zones', () => {
    const src = fs.readFileSync(path.join(ROOT, 'routes/errands.routes.js'), 'utf8');
    assert.match(src, /service_zones/);
    assert.match(src, /FIND_IN_SET/);
  });

  it('money paths remain delegated to errandMoney', () => {
    const src = fs.readFileSync(path.join(ROOT, 'routes/errands.routes.js'), 'utf8');
    assert.match(src, /createHold\(/);
    assert.match(src, /refundHold\(/);
    assert.match(src, /processDueReleases\(/);
    assert.doesNotMatch(src, /UPDATE wallets SET balance/);
  });
});
