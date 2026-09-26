require("dotenv").config();
require("./scripts/mysql-ssl-preload");
const mysql = require("mysql2/promise");
(async () => {
  const c = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
          port: Number(process.env.MYSQL_PORT),
              user: process.env.MYSQL_USER,
                  password: process.env.MYSQL_PASSWORD,
                      database: process.env.MYSQL_DATABASE,
                        });
                          const [cols] = await c.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'");
                            console.log("users columns:", cols.map(r => r.COLUMN_NAME).join(", "));
                              const [rows] = await c.query("SELECT DISTINCT transaction_type FROM wallet_transactions");
                                console.log("wallet_transactions types:", JSON.stringify(rows));
                                  await c.end();
                                  })();