require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');

console.log('Host:', process.env.MYSQL_HOST, 'Port:', process.env.MYSQL_PORT);

mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  ssl: { ca: fs.readFileSync('ca.pem') },
})
  .then(() => console.log('CONNECTED'))
  .catch((e) => console.log('ERROR:', e.code, e.message));
