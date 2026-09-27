require('dotenv').config();
const { pool } = require('../config/db.mysql');
const fs = require('fs');
const path = require('path');
(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', '18-auth-security.sql'), 'utf8');
  const statements = sql.split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean).filter(s => !s.startsWith('--'));
  for (const statement of statements) {
    await pool.query(statement);
  }
  console.log('Auth security migration applied.');
  await pool.end();
})().catch(err => { console.error(err.message); process.exit(1); });
