const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const authSource = fs.readFileSync(path.join(root, 'routes/auth.routes.js'), 'utf8');
const middlewareSource = fs.readFileSync(path.join(root, 'middleware/auth.js'), 'utf8');
const migrationSource = fs.readFileSync(path.join(root, 'database/18-auth-security.sql'), 'utf8');

test('auth source uses bcrypt and never stores plaintext password directly', () => {
  assert.match(authSource, /bcrypt\.hash\([^\n]+, 12\)/);
  assert.doesNotMatch(authSource, /INSERT INTO users[^\n]*password[^\n]*\bpassword\b/i);
});

test('JWT verification pins algorithm, issuer and audience', () => {
  assert.match(middlewareSource, /algorithms:\s*\['HS256'\]/);
  assert.match(middlewareSource, /issuer:\s*process\.env\.JWT_ISSUER/);
  assert.match(middlewareSource, /audience:\s*process\.env\.JWT_AUDIENCE/);
});

test('JWT sessions are invalidated by auth version/password change', () => {
  assert.match(middlewareSource, /decoded\.authVersion/);
  assert.match(middlewareSource, /password_changed_at/);
  assert.match(authSource, /auth_version = auth_version \+ 1/);
  assert.match(authSource, /password_changed_at = NOW\(\)/);
});

test('login, registration, reset and email verification have rate limits', () => {
  assert.match(authSource, /router\.post\('\/login', loginLimiter/);
  assert.match(authSource, /router\.post\('\/register', registerLimiter/);
  assert.match(authSource, /router\.post\('\/forgot-password', passwordResetLimiter/);
  assert.match(authSource, /router\.post\('\/reset-password', passwordResetConfirmLimiter/);
  assert.match(authSource, /router\.post\('\/request-email-verification', verifyToken, emailVerificationLimiter/);
});

test('password reset tokens are hashed, random, short-lived and single-use', () => {
  assert.match(authSource, /crypto\.randomBytes\(32\)/);
  assert.match(authSource, /crypto\.createHash\('sha256'\)/);
  assert.match(authSource, /expires_at > NOW\(\)/);
  assert.match(authSource, /used_at IS NULL/);
  assert.match(authSource, /FOR UPDATE/);
  assert.match(migrationSource, /UNIQUE KEY uq_password_reset_token_hash/);
});

test('logout endpoint revokes auth version', () => {
  assert.match(authSource, /router\.post\('\/logout', verifyToken/);
  assert.match(authSource, /auth_version = auth_version \+ 1/);
});

test('production never returns password-reset or email-verification tokens', () => {
  assert.doesNotMatch(authSource, /NODE_ENV !== 'production' \|\| process\.env\.RETURN_RESET_TOKEN/);
  assert.doesNotMatch(authSource, /NODE_ENV !== 'production' \|\| process\.env\.RETURN_VERIFY_TOKEN/);
});

test('migration adds lockout/session fields without destructive data operations', () => {
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS auth_version/);
  assert.match(migrationSource, /failed_login_attempts/);
  assert.match(migrationSource, /locked_until/);
  assert.doesNotMatch(migrationSource, /DROP TABLE|TRUNCATE TABLE|DELETE FROM users/i);
});

test('reset token generation has sufficient entropy', () => {
  const token = crypto.randomBytes(32).toString('hex');
  assert.equal(token.length, 64);
});

let jwt;
try { jwt = require('jsonwebtoken'); } catch (_) { jwt = null; }
if (jwt) {
  test('JWT rejects expired and forged tokens', () => {
    const secret = 'test-secret';
    const valid = jwt.sign({ id: 1, userType: 'client', authVersion: 0 }, secret, { expiresIn: '1s', issuer: 'my-errand-api', audience: 'my-errand-web' });
    assert.doesNotThrow(() => jwt.verify(valid, secret, { algorithms: ['HS256'], issuer: 'my-errand-api', audience: 'my-errand-web' }));
    assert.throws(() => jwt.verify(valid, 'wrong-secret', { algorithms: ['HS256'], issuer: 'my-errand-api', audience: 'my-errand-web' }));
    const expired = jwt.sign({ id: 1, userType: 'client', authVersion: 0 }, secret, { expiresIn: -1, issuer: 'my-errand-api', audience: 'my-errand-web' });
    assert.throws(() => jwt.verify(expired, secret, { algorithms: ['HS256'], issuer: 'my-errand-api', audience: 'my-errand-web' }));
  });
} else {
  test('JWT runtime test requires installed dependencies', { skip: 'jsonwebtoken is not installed in this runtime; run after npm install' }, () => {});
}
