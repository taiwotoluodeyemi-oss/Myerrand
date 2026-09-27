require('dotenv').config();
const { pool } = require('../config/db.mysql');
const { PRIMARY_MARKET } = require('../config/marketplace');

(async () => {
  const conn = await pool.getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS market_zones (
      id INT AUTO_INCREMENT PRIMARY KEY, country VARCHAR(100) NOT NULL, city VARCHAR(100) NOT NULL, zone VARCHAR(120) NOT NULL,
      launch_focus BOOLEAN NOT NULL DEFAULT FALSE, pause_demand BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_market_zone (country, city, zone), INDEX idx_market_zone_city (city, zone)
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS expansion_events (
      id INT AUTO_INCREMENT PRIMARY KEY, from_zone VARCHAR(120) NOT NULL, to_zone VARCHAR(120) NOT NULL, city VARCHAR(100) NULL,
      operator_id INT NULL, operator_note TEXT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_expansion_city_created (city, created_at), INDEX idx_expansion_from_to (from_zone, to_zone)
    )`);
    const [cols] = await conn.query(`SHOW COLUMNS FROM errands LIKE 'exception_type'`);
    if (!cols.length) await conn.query(`ALTER TABLE errands ADD COLUMN exception_type VARCHAR(50) NULL, ADD INDEX idx_errand_exception (exception_type)`);
    const [addressCols] = await conn.query(`SHOW COLUMNS FROM errands LIKE 'had_address_issue'`);
    if (!addressCols.length) await conn.query(`ALTER TABLE errands ADD COLUMN had_address_issue BOOLEAN NOT NULL DEFAULT FALSE`);
    for (const zone of PRIMARY_MARKET.zones) {
      await conn.execute(`INSERT INTO market_zones (country, city, zone) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE updated_at=updated_at`, [PRIMARY_MARKET.country, PRIMARY_MARKET.city, zone]);
    }
    console.log(`Stage 3 city/zone schema ready: ${PRIMARY_MARKET.zones.join(', ')}`);
  } finally { conn.release(); await pool.end(); }
})().catch(err => { console.error(err); process.exit(1); });
