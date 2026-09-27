require('dotenv').config();
const { pool } = require('../config/db.mysql');

async function columnExists(conn, table, column) {
  const [rows] = await conn.execute(`SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`, [table, column]);
  return rows.length > 0;
}
async function addColumn(conn, table, definition) {
  const match = definition.match(/ADD COLUMN\s+`?([A-Za-z0-9_]+)`?/i);
  if (!match) throw new Error(`Cannot determine column from ${definition}`);
  if (!(await columnExists(conn, table, match[1]))) await conn.execute(`ALTER TABLE ${table} ${definition}`);
}

(async () => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const def of [
      'ADD COLUMN country VARCHAR(100) NULL',
      'ADD COLUMN city VARCHAR(100) NULL',
      'ADD COLUMN zone VARCHAR(120) NULL',
      "ADD COLUMN channel VARCHAR(20) NOT NULL DEFAULT 'consumer'",
      'ADD COLUMN business_reference VARCHAR(120) NULL',
      'ADD COLUMN contact_phone VARCHAR(30) NULL',
    ]) await addColumn(conn, 'errands', def);
    await addColumn(conn, 'runners', 'ADD COLUMN service_zones TEXT NULL');
    await conn.execute(`CREATE INDEX IF NOT EXISTS idx_errand_zone_status_created ON errands (zone, status, created_at)`).catch(() => {});
    await conn.execute(`CREATE INDEX IF NOT EXISTS idx_errand_city_zone ON errands (city, zone)`).catch(() => {});
    await conn.execute(`UPDATE errands SET country = COALESCE(country, ?) WHERE country IS NULL`, [process.env.PRIMARY_MARKET_COUNTRY || 'Nigeria']);
    await conn.execute(`UPDATE errands SET city = COALESCE(city, ?) WHERE city IS NULL`, [process.env.PRIMARY_MARKET_CITY || 'Lagos']);
    await conn.execute(`UPDATE errands SET zone = COALESCE(zone, ?) WHERE zone IS NULL`, [(process.env.PRIMARY_MARKET_ZONES || 'Central').split(',')[0].trim() || 'Central']);
    await conn.execute(`UPDATE runners SET service_zones = COALESCE(service_zones, areas_of_service) WHERE service_zones IS NULL`);
    await conn.commit();
    console.log('Zone ops migration applied successfully.');
  } catch (e) {
    await conn.rollback();
    console.error('Zone ops migration failed:', e.message);
    process.exitCode = 1;
  } finally { conn.release(); }
})();
