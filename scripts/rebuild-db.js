#!/usr/bin/env node
require('dotenv').config();
require('./mysql-ssl-preload');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const mysql = require('mysql2/promise');

const root = path.join(__dirname, '..');
const FILES = [
  'complete-schema.sql', 'wallet-system.sql', 'gift-card-system.sql',
  '04-production-align.sql', '05-qa-alignment.sql', '06-gift-card-commerce.sql', '07-pricing-engine.sql',
];
const BENIGN = /Duplicate|already exists|check that column|Can't DROP|multiple primary key/i;

function statements(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--.*$/gm, '')
    .split(/;[ \t]*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(USE|CREATE\s+DATABASE)\b/i.test(s));
}

(async () => {
  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      connectTimeout: 20000,
    });
    await conn.query('SELECT 1');
  } catch (e) {
    console.error('Cannot connect to ' + process.env.MYSQL_HOST + ':' + process.env.MYSQL_PORT + ' - ' + (e.code || e.message));
    process.exit(1);
  }
  console.log('Connected to ' + process.env.MYSQL_HOST + ' / ' + process.env.MYSQL_DATABASE);

  if (process.env.RESET_DB === 'yes') {
    const [rows] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const r of rows) await conn.query('DROP TABLE IF EXISTS `' + Object.values(r)[0] + '`');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('Dropped ' + rows.length + ' tables');
  }

  for (const f of FILES) {
    const p = path.join(root, 'database', f);
    if (!fs.existsSync(p)) { console.log('missing ' + f); continue; }
    let ok = 0, skip = 0, fail = 0;
    for (const s of statements(fs.readFileSync(p, 'utf8'))) {
      try { await conn.query(s); ok++; }
      catch (e) {
        if (BENIGN.test(e.message)) skip++;
        else { fail++; console.log('   FAIL [' + f + '] ' + e.message.slice(0, 110)); }
      }
    }
    console.log(f + ': ' + ok + ' applied, ' + skip + ' already there, ' + fail + ' failed');
  }

  const [tables] = await conn.query('SHOW TABLES');
  console.log('\n' + tables.length + ' tables in ' + process.env.MYSQL_DATABASE);
  await conn.end();

  const env = Object.assign({}, process.env, { NODE_OPTIONS: (process.env.NODE_OPTIONS || '') + ' --require ' + path.join(__dirname, 'mysql-ssl-preload.js') });
  const extras = ['scripts/seed-demo.js', 'scripts/auto-international.js'];
  for (const s of extras) {
    const full = path.join(root, s);
    if (!fs.existsSync(full)) continue;
    console.log('\n> node ' + s);
    const r = spawnSync(process.execPath, [full], { cwd: root, env: env, stdio: 'inherit' });
    if (r.status !== 0) console.log(s + ' exited ' + r.status + ' (optional, continuing)');
  }
})();
