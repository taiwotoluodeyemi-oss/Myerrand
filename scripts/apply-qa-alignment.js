/**
 * Applies database/05-qa-alignment.sql against MYSQL_* from .env
 * Safe to re-run; ignores "duplicate column/key" errors.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const root = path.join(__dirname, '..');
  const sqlPath = path.join(root, 'database', '05-qa-alignment.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error('Missing', sqlPath);
    process.exit(1);
  }
  const caPath = path.join(root, 'ca.pem');
  const ssl = fs.existsSync(caPath)
    ? { rejectUnauthorized: true, ca: fs.readFileSync(caPath) }
    : undefined;

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    ssl,
    multipleStatements: true
  });

  const raw = fs.readFileSync(sqlPath, 'utf8');
  const statements = raw
    .split(';')
    .map((s) => s.replace(/--.*$/gm, '').trim())
    .filter((s) => s.length > 5);

  let ok = 0, skip = 0, fail = 0;
  for (const s of statements) {
    try {
      await conn.query(s);
      ok++;
      console.log('OK', s.slice(0, 70).replace(/\s+/g, ' '));
    } catch (e) {
      if (/Duplicate|exists|check that column|Can't DROP/i.test(e.message)) {
        skip++;
        console.log('SKIP', e.message.slice(0, 80));
      } else {
        fail++;
        console.log('FAIL', e.message.slice(0, 120));
      }
    }
  }
  await conn.end();
  console.log({ ok, skip, fail });
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
