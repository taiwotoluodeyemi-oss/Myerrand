#!/usr/bin/env node
/**
 * One-command bootstrap for local + GitHub Codespaces:
 *  1. setup-env
 *  2. npm install (root + client)
 *  3. start MariaDB via Docker if available
 *  4. wait for DB + optional schema ensure
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const isWin = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  console.log(`\n▶ ${cmd} ${args.join(' ')}`);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      shell: isWin,
      ...opts,
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}`));
    });
  });
}

function runNode(script) {
  return run(process.execPath, [path.join(root, script)]);
}

function hasDocker() {
  try {
    execSync('docker --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForMysql(maxAttempts = 30) {
  require('dotenv').config({ path: path.join(root, '.env') });
  const mysql = require('mysql2/promise');
  const config = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'errand_user',
    password: process.env.MYSQL_PASSWORD || 'errand_dev_password',
    database: process.env.MYSQL_DATABASE || 'errandsplace',
  };

  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const conn = await mysql.createConnection(config);
      await conn.query('SELECT 1');
      await conn.end();
      console.log(`✅ MySQL ready (attempt ${i})`);
      return true;
    } catch (e) {
      process.stdout.write(`   waiting for MySQL... ${i}/${maxAttempts}\r`);
      await sleep(2000);
    }
  }
  console.log('\n⚠️  MySQL not reachable yet — you can start it later with: npm run db:start');
  return false;
}

async function main() {
  console.log('🚀 My Errand App — bootstrap\n');

  // 1. Env
  await runNode('scripts/setup-env.js');

  // 2. Root deps
  if (!fs.existsSync(path.join(root, 'node_modules'))) {
    await run('npm', ['install']);
  } else {
    console.log('ℹ️  root node_modules present — skipping npm install (run npm install if needed)');
  }

  // 3. Client deps
  const clientMods = path.join(root, 'client', 'node_modules');
  if (!fs.existsSync(clientMods)) {
    await run('npm', ['run', 'install-client']);
  } else {
    console.log('ℹ️  client node_modules present — skipping');
  }

  // 4. Docker DB
  if (hasDocker()) {
    try {
      await run('npm', ['run', 'db:start']);
      await waitForMysql();
      // Ensure schema (safe to re-run most files)
      try {
        await run('npm', ['run', 'setup-db']);
      } catch (e) {
        console.log('⚠️  setup-db had issues (schema may already be loaded by Docker init):', e.message);
      }
      try {
        await run('npm', ['run', 'db:align']);
      } catch (e) {
        console.log('⚠️  db:align:', e.message);
      }
      try {
        await runNode('scripts/auto-international.js');
      } catch (e) {
        console.log('⚠️  auto-international:', e.message);
      }
      try {
        await run('npm', ['run', 'seed']);
      } catch (e) {
        console.log('⚠️  seed (optional):', e.message);
      }
    } catch (e) {
      console.log('⚠️  Could not start Docker DB:', e.message);
      console.log('   Start manually: npm run db:start');
    }
  } else {
    console.log('⚠️  Docker not found — skip DB container.');
    console.log('   Use a remote MySQL or install Docker, then: npm run db:start');
    // Still try remote DB auto-international if .env points to one
    try {
      await runNode('scripts/auto-international.js');
    } catch (e) {
      console.log('⚠️  auto-international:', e.message);
    }
  }

  console.log(`
✅ Bootstrap finished (env + install + DB + international FX cache + seed).

Next:
  npm run dev          # API + React (recommended)
  # or
  npm run server       # API only on PORT (default 5000)
  cd client && npm run dev   # frontend on 3001

Health check:  curl http://localhost:5000/health
`);
}

main().catch((err) => {
  console.error('❌ Bootstrap failed:', err.message);
  process.exit(1);
});
