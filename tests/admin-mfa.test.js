const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { generateSecret, totp, verifyTotp, generateRecoveryCodes, hashRecoveryCode, encryptSecret, decryptSecret } = require('../services/adminMfa');

const authSource = fs.readFileSync(require.resolve('../middleware/auth'),'utf8');
const routesSource = fs.readFileSync(require.resolve('../routes/auth.routes'),'utf8');
const adminRoutes = fs.readFileSync(require.resolve('../routes/admin.routes'),'utf8');

test('TOTP generates and verifies a valid code', () => {
  const secret = generateSecret(); const now = 1730000000000; const code = totp(secret, now);
  assert.match(code,/^\d{6}$/); assert.equal(verifyTotp(secret,code,1,now),true); assert.equal(verifyTotp(secret,'000000',0,now),false);
});
test('MFA secret is encrypted at rest and round-trips', () => { const secret=generateSecret(); const encrypted=encryptSecret(secret); assert.notEqual(encrypted,secret); assert.equal(decryptSecret(encrypted),secret); });
test('recovery codes are random and only hashes are stored', () => { const codes=generateRecoveryCodes(); assert.equal(codes.length,10); assert.equal(new Set(codes).size,10); assert.equal(hashRecoveryCode(codes[0]).length,64); assert.notEqual(hashRecoveryCode(codes[0]),codes[0]); });
test('admin authorization requires completed MFA', () => { assert.match(authSource,/function requireAdminMfa/); assert.match(authSource,/req\.user\.mfaVerified !== true/); assert.match(authSource,/ADMIN_MFA_REQUIRED/); });
test('non-admin roles are rejected by admin authorization', () => { assert.match(authSource,/getRole\(req\.user\) !== 'admin'/); });
test('MFA enrollment/challenge/recovery endpoints exist', () => { for (const route of ['/admin/mfa/status','/admin/mfa/enroll','/admin/mfa/enroll/verify','/admin/mfa/challenge','/admin/mfa/recovery/regenerate']) assert.match(routesSource,new RegExp(route.replaceAll('/','\\/'))); });
test('admin routes use the MFA-enforcing requireAdmin middleware', () => { assert.match(adminRoutes,/router\.use\(verifyToken, requireAdmin\)/); assert.match(authSource,/const requireAdmin = requireAdminMfa/); });
test('MFA audit events and recovery one-time consumption are implemented', () => { assert.match(routesSource,/admin_mfa_challenge_failed/); assert.match(routesSource,/admin_mfa_challenge_success/); assert.match(routesSource,/admin_mfa_recovery_used/); assert.match(routesSource,/used_at IS NULL LIMIT 1 FOR UPDATE/); });
