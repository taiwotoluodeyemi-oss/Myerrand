const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');

test('policy acceptance records user, policy version and timestamp', () => {
  const s = read('database/14-stage7-trust-policy.sql');
  assert.match(s, /user_id INT NOT NULL/);
  assert.match(s, /policy_version VARCHAR\(40\) NOT NULL/);
  assert.match(s, /accepted_at TIMESTAMP NOT NULL/);
  assert.match(read('services/policyGate.js'), /INSERT IGNORE INTO policy_acceptances/);
});

test('sensitive verification document access is admin-only and audited', () => {
  const s = read('routes/verification.routes.js');
  assert.match(s, /router\.get\('\/admin\/document\/:runner_user_id', verifyToken, requireAdmin/);
  assert.match(s, /sensitive_verification_document_access/);
  assert.doesNotMatch(s, /router\.get\('\/document\//);
});

test('verification documents have explicit retention metadata and are not exposed in exports', () => {
  assert.match(read('database/21-privacy-controls.sql'), /verification_retention_until/);
  assert.match(read('routes/verification.routes.js'), /verification_retention_until = DATE_ADD/);
  const exportRoute = read('routes/admin.routes.js');
  assert.doesNotMatch(exportRoute, /client_id,runner_id.*csv/);
  assert.match(exportRoute, /personal_fields_excluded:true/);
});

test('account deactivation anonymizes unnecessary personal data while preserving financial records', () => {
  const s = read('services/privacy.js');
  assert.match(s, /financial_records_preserved/);
  assert.match(s, /anonymizedEmail/);
  assert.match(s, /phone=NULL/);
  assert.match(s, /address=NULL/);
  assert.match(s, /id_document_path=NULL/);
  assert.match(read('routes/auth.routes.js'), /deactivateMySqlAccount/);
});

test('privacy export is scoped to the authenticated user and excludes profile identifiers', () => {
  const s = read('routes/privacy.routes.js');
  assert.match(s, /client_id=\? OR runner_id=\?/);
  assert.match(s, /privacy_export/);
  assert.match(read('services/privacy.js'), /safeExportColumns/);
  for (const field of ['name','email','phone','address','client_id','runner_id']) assert.doesNotMatch(read('services/privacy.js'), new RegExp(`['"]${field}['"]`));
});

test('escrow disclosure remains visible from the payment-intent flow', () => {
  const s = read('routes/wallet.routes.js');
  assert.match(s, /policy_type='escrow_disclosure'/);
  assert.match(s, /escrow_disclosure:/);
});

test('market support contact remains configurable', () => {
  const s = read('config/marketplace.js');
  assert.match(s, /support_email/);
});

test('privacy retention metadata and sensitive-access audit tables are defined', () => {
  const s = read('database/21-privacy-controls.sql');
  assert.match(s, /CREATE TABLE IF NOT EXISTS privacy_retention_policies/);
  assert.match(s, /CREATE TABLE IF NOT EXISTS privacy_access_audit/);
});
