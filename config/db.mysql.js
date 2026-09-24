const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');

// Aiven (and most managed MySQL) require SSL.
// Use the project CA if present; otherwise fall back to rejectUnauthorized: false
// only as a last resort so local Docker still works.
function buildSslConfig() {
  const caCandidates = [
    path.join(__dirname, '..', 'ca.pem'),
    path.join(__dirname, '..', 'ca.pem.txt'),
    process.env.MYSQL_CA_PATH,
  ].filter(Boolean);

  for (const caPath of caCandidates) {
    try {
      if (fs.existsSync(caPath)) {
        const ca = fs.readFileSync(caPath);
        console.log('[MySQL] Using CA certificate from', caPath);
        return { rejectUnauthorized: true, ca };
      }
    } catch (e) {
      // continue
    }
  }

  // No CA found. For remote hosts we still force SSL (Aiven rejects non-SSL).
  // For pure local Docker/MariaDB we allow plain connections.
  const host = process.env.MYSQL_HOST || 'localhost';
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLocal) {
    return false; // no SSL for local
  }
  console.warn('[MySQL] No CA file found – connecting with SSL but without certificate verification');
  return { rejectUnauthorized: false };
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT, 10) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'errandsplace',
  ssl: buildSslConfig(),
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 10,
  connectTimeout: parseInt(process.env.DB_ACQUIRE_TIMEOUT, 10) || 15000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

module.exports = () => {
  pool.getConnection((err, connection) => {
    if (err) {
      console.error('❌ MySQL Connection Error:', err.message || err);
      console.error('   Host:', process.env.MYSQL_HOST);
      console.error('   Port:', process.env.MYSQL_PORT || 3306);
      console.error('   User:', process.env.MYSQL_USER);
      console.error('   Database:', process.env.MYSQL_DATABASE);
      console.error('⚠️  Registration / wallet / errands that need MySQL will fail until this is fixed.');
      return;
    }
    console.log('✅ MySQL Connected successfully');
    if (connection) connection.release();
  });
};

module.exports.pool = pool.promise();
module.exports.rawPool = pool;
