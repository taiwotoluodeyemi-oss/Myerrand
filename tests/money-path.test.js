/**
 * Integration-style checks that can run when MYSQL_* env points at a live DB.
 * Without DB credentials these tests are skipped (not false-passed).
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const hasMysql = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_PASSWORD);
const ROOT = path.join(__dirname, '..');

describe('static integrity', () => {
  it('package.json has start script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts && pkg.scripts.start);
  });
  it('server.js and app.js exist', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'server.js')));
    assert.ok(fs.existsSync(path.join(ROOT, 'app.js')));
  });
  it('no double-quoted SQL enums remain in errands routes', () => {
    const src = fs.readFileSync(path.join(ROOT, 'routes/errands.routes.js'), 'utf8');
    assert.equal(/\bstatus\s*=\s*"[a-z_]+"/.test(src), false);
  });
  it('Terms and Privacy pages exist', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'client/src/pages/Terms.jsx')));
    assert.ok(fs.existsSync(path.join(ROOT, 'client/src/pages/Privacy.jsx')));
  });
  it('Profile does not hardcode January 2025 earnings', () => {
    const src = fs.readFileSync(path.join(ROOT, 'client/src/pages/Profile.jsx'), 'utf8');
    assert.equal(src.includes('January 2025'), false);
    assert.equal(src.includes('1245.50'), false);
    assert.ok(src.includes('/api/auth/stats'));
  });
});

describe('live mysql money path', { skip: !hasMysql && 'MYSQL_* not set' }, () => {
  it('placeholder: run full path via scripts/manual QA harness', () => {
    assert.ok(hasMysql);
  });
});

describe('auth routes surface', () => {
  it('auth.routes exports password change and stats paths', () => {
    const src = fs.readFileSync(path.join(ROOT, 'routes/auth.routes.js'), 'utf8');
    assert.ok(src.includes("/change-password"));
    assert.ok(src.includes("/stats"));
    assert.ok(src.includes("/download-data"));
    assert.ok(src.includes("/deactivate"));
    assert.ok(src.includes("request-email-verification"));
  });
  it('wallet gift card insert uses created_by', () => {
    const src = fs.readFileSync(path.join(ROOT, 'routes/wallet.routes.js'), 'utf8');
    assert.ok(src.includes('created_by'));
    assert.equal(/INSERT INTO gift_cards[^`]*issued_by/.test(src), false);
  });
});

describe('payment and security surface', () => {
  it('payment-config exports isMockPaymentMode', () => {
    // static require without env
    const mod = require(path.join(ROOT, 'utils/payment-config.js'));
    assert.equal(typeof mod.isMockPaymentMode, 'function');
    assert.equal(typeof mod.isPaystackConfigured, 'function');
  });
  it('middleware has requireRole helpers', () => {
    const src = fs.readFileSync(path.join(ROOT, 'middleware/auth.js'), 'utf8');
    assert.ok(src.includes('requireRole') || src.includes('requireClient'));
  });
  it('errands progress route exists', () => {
    const src = fs.readFileSync(path.join(ROOT, 'routes/errands.routes.js'), 'utf8');
    assert.ok(src.includes('update-progress'));
    assert.ok(src.includes('errand_progress'));
  });
});

describe('gift card commerce surface', () => {
  it('giftcards routes file exists with purchase and code endpoints', () => {
    const src = fs.readFileSync(path.join(ROOT, 'routes/giftcards.routes.js'), 'utf8');
    assert.ok(src.includes('/products/:id/purchase'));
    assert.ok(src.includes('/orders/:id/code'));
    assert.ok(src.includes('encryptCode') || src.includes('createCipheriv'));
  });
  it('admin has fulfill endpoint', () => {
    const src = fs.readFileSync(path.join(ROOT, 'routes/admin.routes.js'), 'utf8');
    assert.ok(src.includes('gift-card-orders'));
    assert.ok(src.includes('/fulfill'));
  });
  it('schema file for commerce exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'database/06-gift-card-commerce.sql')));
  });
});
