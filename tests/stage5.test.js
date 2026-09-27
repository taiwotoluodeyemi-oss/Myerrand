const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

describe('Stage 5 contracts', () => {
  it('has additive webhook outbox, subscriptions and delivery retry schema', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'database/12-stage5-events.sql'), 'utf8');
    assert.match(sql, /webhook_subscriptions/i);
    assert.match(sql, /webhook_outbox/i);
    assert.match(sql, /webhook_deliveries/i);
    assert.match(sql, /UNIQUE KEY uq_webhook_delivery/i);
  });

  it('status transitions enqueue durable events instead of performing HTTP delivery', () => {
    const state = fs.readFileSync(path.join(ROOT, 'services/errandState.js'), 'utf8');
    const outbox = fs.readFileSync(path.join(ROOT, 'services/eventOutbox.js'), 'utf8');
    assert.match(state, /enqueueEvent\(conn/);
    assert.doesNotMatch(state, /axios\./);
    assert.match(outbox, /axios\.post/);
    assert.match(outbox, /WEBHOOK_MAX_RETRIES/);
    assert.match(outbox, /dead \? 'dead_letter' : 'retrying'/);
  });

  it('money engine enqueues paid/release/refund events without moving money elsewhere', () => {
    const money = fs.readFileSync(path.join(ROOT, 'services/errandMoney.js'), 'utf8');
    assert.match(money, /enqueueEvent\(conn/);
    assert.match(money, /eventType: 'paid'/);
    assert.match(money, /eventType: 'release'/);
    assert.match(money, /eventType: 'refund'/);
    assert.match(money, /async function releaseHold/);
    assert.match(money, /async function refundHold/);
  });

  it('merchant webhook registration shows the secret only on creation', () => {
    const src = fs.readFileSync(path.join(ROOT, 'routes/merchant.routes.js'), 'utf8');
    assert.match(src, /router\.post\('\/webhooks'/);
    assert.match(src, /secret_notice/);
    assert.match(src, /encryptSecret\(secret\)/);
    assert.match(src, /secret_notice/);
    assert.doesNotMatch(src, /SELECT[^\n]*secret_ciphertext/);
  });

  it('in-app notifications are event-linked and dispute/release/refund events are covered', () => {
    const src = fs.readFileSync(path.join(ROOT, 'services/eventOutbox.js'), 'utf8');
    assert.match(src, /case 'disputed'/);
    assert.match(src, /case 'resolved'/);
    assert.match(src, /case 'release'/);
    assert.match(src, /case 'refund'/);
    assert.match(src, /source_event_id/);
  });

  it('admin ops exposes disputes, stuck holds, due releases, expiry queue and dead letters', () => {
    const src = fs.readFileSync(path.join(ROOT, 'routes/admin.routes.js'), 'utf8');
    for (const term of ['open_disputes', 'stuck_holds', 'due_releases', 'paid_unaccepted_near_expiry', 'webhook_dead_letters']) assert.match(src, new RegExp(term));
    assert.match(src, /processDueRefunds/);
    assert.match(src, /processDueReleases/);
  });

  it('webhook worker is isolated from server request/state transitions', () => {
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.match(server, /processWebhookOutbox/);
    const state = fs.readFileSync(path.join(ROOT, 'services/errandState.js'), 'utf8');
    assert.doesNotMatch(state, /processWebhookOutbox/);
  });

  it('notifications utility no longer depends on an unsupported body column', () => {
    const src = fs.readFileSync(path.join(ROOT, 'utils/notify.js'), 'utf8');
    assert.doesNotMatch(src, /INSERT INTO notifications \([^)]*body/);
  });
});
