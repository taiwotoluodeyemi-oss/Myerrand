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
                          await c.query("ALTER TABLE wallet_transactions MODIFY COLUMN transaction_type ENUM('deposit','withdrawal','transfer','earning','payment','refund','fee','conversion','gift_card_issue','gift_card_redeem','escrow_hold','escrow_release') NOT NULL");
                            console.log("wallet_transactions.transaction_type widened successfully");
                              await c.end();
                              })();
