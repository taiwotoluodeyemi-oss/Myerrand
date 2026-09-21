const mysql = require('mysql2');
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'errandsplace',
  ssl: false,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 10,
  connectTimeout: parseInt(process.env.DB_ACQUIRE_TIMEOUT, 10) || 10000,
});

module.exports = () => {
  pool.getConnection((err, connection) => {
    if (err) {
      console.error('❌ MySQL Connection Error:', err);
      console.error('⚠️  App will continue with MongoDB only');
      return;
    }
    console.log('✅ MySQL Connected');
    if (connection) connection.release();
  });
};

module.exports.pool = pool.promise();
