#!/usr/bin/env node
/**
 * Automatic international setup:
 *  - ensure currency_rates table + user preference columns
 *  - pull live FX rates for major pairs and cache in DB
 * Safe to re-run.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { fetchLiveRate } = require('../utils/exchange-rates');
const { currencies } = require('../utils/currencies');

const BASES = ['USD', 'EUR', 'GBP', 'NGN'];
// Targets: all supported codes except self
const TARGETS = currencies.map((c) => c.code);

async function ensureSchema(conn) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS currency_rates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      from_currency VARCHAR(10) NOT NULL,
      to_currency VARCHAR(10) NOT NULL,
      rate DECIMAL(18, 8) NOT NULL,
      valid_until DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pair (from_currency, to_currency)
    )`,
    `ALTER TABLE users ADD COLUMN preferred_language VARCHAR(10) NULL DEFAULT 'en'`,
    `ALTER TABLE users ADD COLUMN preferred_currency VARCHAR(10) NULL DEFAULT 'USD'`,
  ];
  for (const sql of statements) {
    try {
      await conn.execute(sql);
    } catch (e) {
      if (!String(e.message).includes('Duplicate') && e.code !== 'ER_DUP_FIELDNAME') {
        // ignore missing users table during very early boot
        if (!String(e.message).includes("doesn't exist")) {
          console.warn('schema:', e.message);
        }
      }
    }
  }
}

async function cacheRate(conn, from, to, rate) {
  await conn.execute(
    `INSERT INTO currency_rates (from_currency, to_currency, rate, valid_until)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
    [from, to, rate]
  );
}

async function main() {
  if (process.env.USE_MONGO === 'true') {
    console.log('auto-international: skip (USE_MONGO=true)');
    return;
  }

  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      user: process.env.MYSQL_USER || 'errand_user',
      password: process.env.MYSQL_PASSWORD || 'errand_dev_password',
      database: process.env.MYSQL_DATABASE || 'errandsplace',
    });
  } catch (e) {
    console.warn('auto-international: DB not ready —', e.message);
    process.exit(0);
  }

  console.log('🌍 Auto international setup…');
  await ensureSchema(conn);

  let ok = 0;
  let fail = 0;
  // Limit network calls: USD → each target, plus NGN/EUR/GBP → USD
  const jobs = [];
  for (const to of TARGETS) {
    if (to !== 'USD') jobs.push(['USD', to]);
  }
  for (const from of ['EUR', 'GBP', 'NGN', 'KES', 'GHS', 'INR', 'AED']) {
    jobs.push([from, 'USD']);
  }

  for (const [from, to] of jobs) {
    try {
      const rate = await fetchLiveRate(from, to);
      if (rate != null && rate > 0) {
        await cacheRate(conn, from, to, rate);
        ok++;
      } else {
        fail++;
      }
    } catch {
      fail++;
    }
  }

  await conn.end();
  console.log(`✅ Cached ${ok} FX rates (${fail} unavailable — normal for some exotic pairs)`);
  console.log('   Languages: auto-detect in browser (en/es/fr/pt/de/ar/hi/sw)');
  console.log('   Currency: auto from browser locale; override in UI anytime');
}

main().catch((e) => {
  console.warn('auto-international warning:', e.message);
  process.exit(0);
});
