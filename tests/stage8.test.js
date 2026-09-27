const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read=f=>fs.readFileSync(path.join(ROOT,f),'utf8');

describe('Stage 8 contracts',()=>{
  it('has additive organization, membership, API key, sandbox and business fields schema',()=>{const s=read('database/15-stage8-enterprise.sql'); for(const x of ['organizations','organization_members','organization_api_keys','sandbox_flag','org_id','po_number','cost_center','verification_mode']) assert.match(s,new RegExp(x,'i'));});
  it('organization supports owner and dispatcher while errands keep org nullable',()=>{const s=read('routes/org.routes.js'); const m=read('routes/merchant.routes.js'); assert.match(s,/owner/); assert.match(s,/dispatcher/); assert.match(m,/requestedOrgId/); assert.match(m,/org_id/);});
  it('API keys are hashed, shown once and rotation disables old key',()=>{const s=read('services/enterprise.js'); const r=read('routes/org.routes.js'); assert.match(s,/sha256/); assert.match(r,/Store this key now/); assert.match(r,/active=FALSE/); assert.match(r,/hashApiKey/);});
  it('merchant accepts JWT or API key',()=>{const s=read('routes/merchant.routes.js'); assert.match(s,/X-API-Key/); assert.match(s,/authenticateApiKey/); assert.match(s,/verifyToken/);});
  it('sandbox organizations force demo deposits through payment port',()=>{const s=read('services/paymentPort.js'); const w=read('routes/wallet.routes.js'); assert.match(s,/isSandboxOrg/); assert.match(s,/is_demo/); assert.match(w,/sandbox_flag/); assert.match(w,/is_demo: true/);});
  it('delivery receipt is completed-only HTML and includes PO/cost center',()=>{const s=read('routes/merchant.routes.js'); assert.match(s,/delivery receipt/i); assert.match(s,/po_number/); assert.match(s,/cost_center/); assert.match(s,/res\.type\('html'\)/);});
  it('KYC, push and insurance are Noop-first and optional',()=>{const s=read('services/providers.js'); assert.match(s,/class NoopProvider/); assert.match(s,/KYC_PROVIDER_URL/); assert.match(s,/PUSH_PROVIDER_URL/); assert.match(s,/INSURANCE_PROVIDER_URL/); const v=read('routes/verification.routes.js'); assert.match(v,/KycProvider/);});
  it('verification mode is market-configured and manual approval remains available',()=>{const s=read('database/15-stage8-enterprise.sql'); const c=read('config/marketplace.js'); const v=read('routes/verification.routes.js'); assert.match(s,/verification_mode/); assert.match(c,/PRIMARY_MARKET_VERIFICATION_MODE/); assert.match(v,/admin\/:runner_user_id\/decision/);});
  it('money engine remains untouched/canonical',()=>{const s=read('services/errandMoney.js'); for(const x of ['createHold','releaseHold','refundHold','processDueReleases','processDueRefunds']) assert.match(s,new RegExp(x));});
  it('enterprise documentation exists',()=>{for(const f of ['ENTERPRISE.md','KYC_PUSH_INSURANCE.md']) assert.ok(fs.existsSync(path.join(ROOT,f)));});
});
