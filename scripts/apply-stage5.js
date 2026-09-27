require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db.mysql');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../database/12-stage5-events.sql'), 'utf8');
  const statements = sql.split(';').map(s => s.trim()).filter(Boolean).filter(s => !/^USE\s+/i.test(s));
  try {
    for (const statement of statements) await pool.query(statement);
    console.log('Stage 5 schema applied.');
  } catch (err) {
    console.error('Stage 5 schema failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
