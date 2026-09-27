const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root,'routes/admin.routes.js'),'utf8');
const service = fs.readFileSync(path.join(root,'services/adminOperations.js'),'utf8');

test('operations center exposes all required queues', () => {
  for (const name of ['open_disputes','stuck_holds','failed_payments','failed_webhooks','dead_letter_events','unaccepted_paid_errands','verification_queue','payment_disputes','high_dispute_users','system_health']) assert.match(service, new RegExp(name));
  assert.match(route, /\/operations-center/);
});

test('queue items expose operational triage fields', () => {
  for (const field of ['age','severity','market','zone','responsible_action','current_state']) assert.match(service, new RegExp(field));
});

test('filters and pagination are bounded', () => {
  assert.match(service, /page_size/);
  assert.match(service, /Math\.min\(100/);
  assert.match(service, /query\.market/);
  assert.match(service, /query\.zone/);
  assert.match(service, /query\.from/);
  assert.match(service, /query\.to/);
  assert.match(service, /query\.search/);
});

test('admin actions delegate to existing services rather than financial SQL', () => {
  assert.match(route, /processDueRefunds\(\)/);
  assert.match(route, /processDueReleases\(\)/);
  assert.match(route, /processWebhookOutbox/);
  assert.match(route, /replayDeadLetter/);
  assert.doesNotMatch(route.slice(route.indexOf("router.post('/operations-center/action'"), route.indexOf("router.get('/ops'")), /UPDATE wallets|INSERT INTO wallet_transactions|UPDATE errand_holds|UPDATE errands SET payment_status/);
});

test('operations actions are audited', () => assert.match(route, /auditSecurity\(\{ actorId:req\.user\.id, action:`operations_/));

test('sensitive operator details are not selected into the center', () => {
  assert.doesNotMatch(service, /SELECT \* FROM/);
  assert.doesNotMatch(service, /password|api_key|secret|authorization/i);
});

test('runbooks exist and contain required operator guidance', () => {
  for (const f of ['RUNBOOK_PAYMENTS.md','RUNBOOK_DISPUTES.md','RUNBOOK_WEBHOOKS.md','RUNBOOK_INCIDENTS.md','RUNBOOK_ACCOUNT_SECURITY.md']) {
    const text = fs.readFileSync(path.join(root,f),'utf8');
    assert.match(text,/What happened/);
    assert.match(text,/Operator checks/);
    assert.match(text,/Safe action/);
    assert.match(text,/Escalation/);
    assert.match(text,/What NOT to do/);
  }
});
