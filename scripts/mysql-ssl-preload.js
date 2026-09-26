const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const root = path.join(__dirname, '..');
function sslConfig() {
  const ca = [path.join(root, 'ca.pem'), path.join(root, 'ca.pem.txt'), process.env.MYSQL_CA_PATH]
    .filter(Boolean).find((p) => fs.existsSync(p));
  return ca ? { rejectUnauthorized: true, ca: fs.readFileSync(ca) } : { rejectUnauthorized: false };
}
const orig = mysql.createConnection.bind(mysql);
mysql.createConnection = (cfg = {}) => {
  const c = { ...cfg };
  const host = c.host || process.env.MYSQL_HOST || 'localhost';
  const remote = !['localhost', '127.0.0.1', '::1'].includes(host);
  if (!c.port && process.env.MYSQL_PORT) c.port = Number(process.env.MYSQL_PORT);
  if (c.ssl === undefined && remote) c.ssl = sslConfig();
  return orig(c);
};
