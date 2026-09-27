require('dotenv').config();
const fs = require('fs');
const { pool } = require('../config/db.mysql');
(async () => {
  const sql = fs.readFileSync('database/11-stage4-market-merchant.sql', 'utf8');
  try {
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean).filter(s => !/^USE\s+/i.test(s));
    for (const statement of statements) {
      await pool.query(statement);
    }
    console.log('Stage 4 (market-merchant) applied successfully.');
  } catch (e) {
    console.error('Stage 4 failed:', e.message);
  } finally {
    await pool.end();
  }
})();
