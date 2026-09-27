const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('security hardening contracts', async (t) => {
  await t.test('JWT verification pins HS256 and production requires a secret', () => {
    const s = read('middleware/auth.js');
    assert.match(s, /algorithms:\s*\['HS256'\]/);
    assert.match(s, /NODE_ENV === 'production'/);
  });

  await t.test('general errand listing is scoped to authenticated user unless admin', () => {
    const s = read('routes/errands.routes.js');
    assert.match(s, /role === 'admin'/);
    assert.match(s, /role === 'client' \|\| user_type === 'client'/);
    assert.match(s, /role === 'runner' \|\| user_type === 'runner'/);
    assert.doesNotMatch(s, /e\.runner_id = \? OR e\.runner_id IS NULL/);
  });

  await t.test('runner assignment/discovery cannot expose or assign unpaid pending jobs', () => {
    const s = read('routes/errands.routes.js');
    const assignment = s.slice(s.indexOf("router.patch('/assign/:errand_id'"), s.indexOf("// Get client's errands"));
    assert.match(assignment, /status ='paid' AND payment_status='escrowed'/);
    const discovery = s.slice(s.indexOf("router.get('/unassigned'"), s.indexOf("// Assign errand"));
    assert.match(discovery, /e\.status = 'paid' AND e\.payment_status = 'escrowed'/);
  });

  await t.test('wallet balance mutation is centralized outside routes', () => {
    const routeFiles = ['routes/wallet.routes.js','routes/giftcards.routes.js','routes/growth.routes.js','routes/admin.routes.js'];
    for (const f of routeFiles) {
      const s = read(f);
      assert.doesNotMatch(s, /UPDATE wallets SET balance\s*=\s*balance\s*[+-]/i, `${f} still mutates wallet balance directly`);
    }
    assert.match(read('services/financialService.js'), /UPDATE wallets SET balance=balance-?/);
    assert.match(read('services/financialService.js'), /UPDATE wallets SET balance=balance\+?/);
  });

  await t.test('production webhook delivery blocks private/local destinations and redirects', () => {
    const s = read('services/eventOutbox.js');
    assert.match(s, /isPrivateIp/);
    assert.match(s, /maxRedirects:\s*0/);
    assert.match(s, /resolves to a private or local address/);
  });

  await t.test('production remote MySQL requires verified TLS', () => {
    const s = read('config/db.mysql.js');
    assert.match(s, /MYSQL_CA_PATH\/ca\.pem is required/);
    assert.match(s, /rejectUnauthorized: false/);
  });

  await t.test('upload handlers enforce bounded types/extensions', () => {
    const errand = read('routes/errands.routes.js');
    const verification = read('routes/verification.routes.js');
    assert.match(errand, /fileSize: 10 \* 1024 \* 1024/);
    assert.match(errand, /imageExt = new Set/);
    assert.match(verification, /files: 1/);
    assert.match(verification, /expected && ext === expected/);
  });

  await t.test('production errors do not return internal exception messages by default', () => {
    const s = read('middleware/errorHandler.middleware.js');
    assert.match(s, /Internal server error/);
    assert.match(s, /if \(!isProd\) response\.stack/);
  });
});
