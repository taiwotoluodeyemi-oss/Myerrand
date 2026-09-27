const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db.mysql');

function splitSql(sql) {
  return sql
    .replace(/^\s*--.*$/gm, '')
    .split(/;\s*(?=(?:CREATE|ALTER|UPDATE|INSERT|USE|DROP)\b)/i)
    .map(s => s.trim())
    .filter(Boolean);
}

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../database/19-enterprise-api-security.sql'), 'utf8');
    for (const stmt of splitSql(sql)) await pool.query(stmt);
    console.log('Enterprise/API security migration applied');
    process.exit(0);
  } catch (e) {
    console.error('Enterprise/API security migration failed:', e.message);
    process.exit(1);
  } finally {
    try { await pool.end(); } catch (_) {}
  }
})();
