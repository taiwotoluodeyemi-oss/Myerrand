const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT,f),'utf8');

describe('Stage 7 contracts', () => {
  it('has additive verification, policy and liability schema', () => {
    const sql=read('database/14-stage7-trust-policy.sql');
    for (const term of ['verification_status','verification_updated_at','require_verified_runners','display_name','insurance_mode','policy_versions','policy_acceptances','liability_acknowledgements']) assert.match(sql,new RegExp(term,'i'));
  });
  it('verification status is the authoritative manual gate with legacy compatibility',()=>{
    const src=read('routes/verification.routes.js'); const accept=read('routes/errands.routes.js');
    assert.match(src,/verification_status/); assert.match(src,/decision.*approved.*rejected/); assert.match(src,/background_check_status/);
    assert.match(accept,/require_verified_runners/); assert.match(accept,/verification_status/); assert.match(accept,/verification must be approved/i);
  });
  it('policy gate requires current versions before pay or accept',()=>{
    const gate=read('services/policyGate.js'); const errands=read('routes/errands.routes.js');
    assert.match(gate,/missingPolicies/); assert.match(gate,/POLICY_ACCEPTANCE_REQUIRED/); assert.match(gate,/acceptPolicy/);
    assert.match(errands,/assertPoliciesAccepted\(req\.user\.id, CLIENT_POLICIES\)/); assert.match(errands,/assertPoliciesAccepted\(runnerId, RUNNER_POLICIES\)/);
  });
  it('liability is acknowledgement-only and never claims insurance',()=>{
    const gate=read('services/policyGate.js'); const routes=read('routes/policy.routes.js');
    assert.match(gate,/LIABILITY_ACK_REQUIRED/); assert.match(routes,/liability\/ack/); assert.match(routes,/acknowledged:true/);
    assert.match(read('config/marketplace.js'),/insurance_mode/);
  });
  it('trust analytics includes funnel, dispute reasons, verification funnel and CSV export',()=>{
    const src=read('routes/admin.routes.js');
    assert.match(src,/trust\/funnel/); assert.match(src,/created_to_paid/); assert.match(src,/by_reason/); assert.match(src,/verification_funnel/); assert.match(src,/trust\/export/); assert.match(src,/text\/csv/);
  });
  it('market exposes light branding and verification/insurance policy',()=>{
    const src=read('routes/market.routes.js'); const cfg=read('config/marketplace.js');
    assert.match(src,/display_name/); assert.match(src,/require_verified_runners/); assert.match(src,/insurance_mode/); assert.match(cfg,/PRIMARY_MARKET_DISPLAY_NAME/);
  });
  it('money engine remains untouched as canonical errand money module',()=>{
    const src=read('services/errandMoney.js');
    assert.match(src,/async function createHold/); assert.match(src,/async function releaseHold/); assert.match(src,/async function refundHold/); assert.match(src,/processDueReleases/); assert.match(src,/processDueRefunds/);
  });
  it('docs for verification and policy versioning exist',()=>{
    assert.ok(fs.existsSync(path.join(ROOT,'VERIFICATION.md'))); assert.ok(fs.existsSync(path.join(ROOT,'POLICY_VERSIONING.md'))); assert.ok(fs.existsSync(path.join(ROOT,'COMPLIANCE_NOTES.md')));
  });
});
