require('dotenv').config();
const { pool } = require('../config/db.mysql');
(async () => {
  const [rows] = await pool.query('DESCRIBE organization_api_keys');
  console.log(rows.map(r => r.Field).join(', '));
  await pool.end();
})();
