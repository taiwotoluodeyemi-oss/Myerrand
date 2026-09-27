const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { rollupMetricSets } = require('../services/zoneScoreboard');
const ROOT = path.join(__dirname, '..');

describe('Stage 3 city scale', () => {
  it('configures at least two independent primary-market zones', () => {
    const { PRIMARY_MARKET } = require('../config/marketplace');
    assert.ok(PRIMARY_MARKET.zones.length >= 2);
    assert.notEqual(PRIMARY_MARKET.zones[0], PRIMARY_MARKET.zones[1]);
  });
  it('rolls up independent zone statistics', () => {
    const r = rollupMetricSets([
      { sample_size: 10, jobs_created: 10, jobs_paid: 10, jobs_accepted: 9, jobs_completed: 8, jobs_cancelled: 1, jobs_disputed: 1, median_accept_minutes: 10 },
      { sample_size: 10, jobs_created: 12, jobs_paid: 12, jobs_accepted: 10, jobs_completed: 9, jobs_cancelled: 2, jobs_disputed: 0, median_accept_minutes: 14 },
    ], 30);
    assert.equal(r.jobs_paid, 22); assert.equal(r.jobs_accepted, 19); assert.equal(r.jobs_completed, 17);
    assert.equal(r.sample_size, 22);
  });
  it('has persistent zone flags and expansion event schema', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'database/10-city-scale.sql'), 'utf8');
    assert.match(sql, /market_zones/i); assert.match(sql, /launch_focus/i); assert.match(sql, /pause_demand/i); assert.match(sql, /expansion_events/i);
  });
  it('exception path uses dispute and does not duplicate money logic', () => {
    const src = fs.readFileSync(path.join(ROOT, 'routes/errands.routes.js'), 'utf8');
    assert.match(src, /exception_type/); assert.match(src, /no_show/); assert.match(src, /address_not_found/);
    assert.doesNotMatch(src, /UPDATE wallets SET/);
  });
  it('city scale routes and money delegation exist', () => {
    const admin = fs.readFileSync(path.join(ROOT, 'routes/admin.routes.js'), 'utf8');
    assert.match(admin, /city-scoreboard/); assert.match(admin, /expansion\/checklist/); assert.match(admin, /expansion-events/); assert.match(admin, /MAX_ACTIVE_LAUNCH_ZONES/);
    const money = fs.readFileSync(path.join(ROOT, 'services/errandMoney.js'), 'utf8');
    assert.match(money, /async function releaseHold/); assert.match(money, /async function refundHold/);
  });
});
