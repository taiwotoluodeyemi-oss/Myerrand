// One-off fix: the live `clients.max_budget_per_errand` column was created
// (by an earlier version of complete-schema.sql) as a DECIMAL, but the
// current schema — and the registration form, which sends values like
// "under-25", "25-50", "over-200" — expects VARCHAR(50).
//
// `npm run setup-db` uses CREATE TABLE IF NOT EXISTS, so it never fixes an
// already-existing table. This script directly ALTERs the live column.
//
// Usage: node scripts/fix-max-budget-column.js
// Reads connection info from .env (same as the rest of the app).

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

function buildSsl() {
      const caCandidates = [
            path.join(__dirname, '..', 'ca.pem'),
                path.join(__dirname, '..', 'ca.pem.txt'),
                    process.env.MYSQL_CA_PATH,
      ].filter(Boolean);
        for (const caPath of caCandidates) {
                try {
                          if (fs.existsSync(caPath)) {
                                    console.log('[fix-column] Using CA from', caPath);
                                            return { rejectUnauthorized: true, ca: fs.readFileSync(caPath) };
                          }
                } catch (e) {}
        }
          const host = process.env.MYSQL_HOST || 'localhost';
            if (host === 'localhost' || host === '127.0.0.1') return false;
              return { rejectUnauthorized: false };
}

async function main() {
      const connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.MYSQL_PORT || process.env.DB_PORT || '3306', 10),
                    user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
                        password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
                            database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'errandsplace',
                                ssl: buildSsl(),
                                    connectTimeout: 20000,
});

  try {
        const [cols] = await connection.query(
                  `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
                         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'max_budget_per_errand'`
        );

            if (cols.length === 0) {
                      console.log('[fix-column] Column not found — nothing to do (table may not exist yet).');
                            return;
            }

                console.log('[fix-column] Current column type:', cols[0].COLUMN_TYPE);

                    if (cols[0].COLUMN_TYPE.toLowerCase().startsWith('varchar')) {
                              console.log('[fix-column] Already VARCHAR — nothing to fix.');
                                    return;
                    }

                        console.log('[fix-column] Altering column to VARCHAR(50)...');
                            await connection.query(
                                      'ALTER TABLE clients MODIFY COLUMN max_budget_per_errand VARCHAR(50)'
                            );
                                console.log('✅ [fix-column] Done. max_budget_per_errand is now VARCHAR(50).');
  } finally {
        await connection.end();
  }
}

main().catch((err) => {
      console.error('❌ [fix-column] Failed:', err.message || err);
        process.exit(1);
});// One-off fix: the live `clients.max_budget_per_errand` column was created
// (by an earlier version of complete-schema.sql) as a DECIMAL, but the
// current schema — and the registration form, which sends values like
// "under-25", "25-50", "over-200" — expects VARCHAR(50).
//
// `npm run setup-db` uses CREATE TABLE IF NOT EXISTS, so it never fixes an
// already-existing table. This script directly ALTERs the live column.
//
// Usage: node scripts/fix-max-budget-column.js
// Reads connection info from .env (same as the rest of the app).

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

function buildSsl() {
  const caCandidates = [
    path.join(__dirname, '..', 'ca.pem'),
    path.join(__dirname, '..', 'ca.pem.txt'),
    process.env.MYSQL_CA_PATH,
  ].filter(Boolean);
  for (const caPath of caCandidates) {
    try {
      if (fs.existsSync(caPath)) {
        console.log('[fix-column] Using CA from', caPath);
        return { rejectUnauthorized: true, ca: fs.readFileSync(caPath) };
      }
    } catch (e) {}
  }
  const host = process.env.MYSQL_HOST || 'localhost';
  if (host === 'localhost' || host === '127.0.0.1') return false;
  return { rejectUnauthorized: false };
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || process.env.DB_PORT || '3306', 10),
    user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'errandsplace',
    ssl: buildSsl(),
    connectTimeout: 20000,
  });

  try {
    const [cols] = await connection.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clients' AND COLUMN_NAME = 'max_budget_per_errand'`
    );

    if (cols.length === 0) {
      console.log('[fix-column] Column not found — nothing to do (table may not exist yet).');
      return;
    }

    console.log('[fix-column] Current column type:', cols[0].COLUMN_TYPE);

    if (cols[0].COLUMN_TYPE.toLowerCase().startsWith('varchar')) {
      console.log('[fix-column] Already VARCHAR — nothing to fix.');
      return;
    }

    console.log('[fix-column] Altering column to VARCHAR(50)...');
    await connection.query(
      'ALTER TABLE clients MODIFY COLUMN max_budget_per_errand VARCHAR(50)'
    );
    console.log('✅ [fix-column] Done. max_budget_per_errand is now VARCHAR(50).');
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error('❌ [fix-column] Failed:', err.message || err);
  process.exit(1);

        )
                          }
                }
        }
      ]
}