#!/usr/bin/env node
/** Apply production column alignment to an existing MySQL DB (ignores "duplicate column" errors). */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const statements = [

  "ALTER TABLE users ADD COLUMN preferred_language VARCHAR(10) NULL DEFAULT 'en'",
  "ALTER TABLE users ADD COLUMN preferred_currency VARCHAR(10) NULL DEFAULT 'USD'",
  `CREATE TABLE IF NOT EXISTS currency_rates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    from_currency VARCHAR(10) NOT NULL,
    to_currency VARCHAR(10) NOT NULL,
    rate DECIMAL(18, 8) NOT NULL,
    valid_until DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pair (from_currency, to_currency)
  )`,

  "ALTER TABLE users MODIFY COLUMN user_type ENUM('client', 'runner', 'admin') NOT NULL",
  "ALTER TABLE users ADD COLUMN address TEXT NULL",
  "ALTER TABLE errands ADD COLUMN amount DECIMAL(10, 2) NULL",
  // payment_status default is NULL (unpaid), not 'pending' — a non-empty
  // string is always truthy in JS and breaks the frontend's "Pay & Start"
  // button, which only renders when payment_status is falsy.
  "ALTER TABLE errands ADD COLUMN payment_status ENUM('pending', 'paid', 'escrowed', 'released', 'refunded') DEFAULT NULL",
  "ALTER TABLE errands ADD COLUMN weight_kg DECIMAL(8, 2) DEFAULT 0",
  "ALTER TABLE errands ADD COLUMN urgency ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium'",
  "ALTER TABLE errands ADD COLUMN estimated_hours DECIMAL(6, 2) DEFAULT 1",
  "UPDATE errands SET amount = budget_amount WHERE amount IS NULL AND budget_amount IS NOT NULL",

  // Live map tracking: geocoded pickup/delivery pins (cached on first
  // request, see GET /:errand_id/tracking) and the runner's last-known
  // position (updated via POST /:errand_id/runner-location).
  "ALTER TABLE errands ADD COLUMN pickup_latitude DECIMAL(10, 8) NULL",
  "ALTER TABLE errands ADD COLUMN pickup_longitude DECIMAL(11, 8) NULL",
  "ALTER TABLE errands ADD COLUMN delivery_latitude DECIMAL(10, 8) NULL",
  "ALTER TABLE errands ADD COLUMN delivery_longitude DECIMAL(11, 8) NULL",
  "ALTER TABLE users ADD COLUMN current_latitude DECIMAL(10, 8) NULL",
  "ALTER TABLE users ADD COLUMN current_longitude DECIMAL(11, 8) NULL",
  "ALTER TABLE users ADD COLUMN location_updated_at DATETIME NULL",

  // Ratings + chat + runner verification
  `CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    errand_id INT NOT NULL,
    sender_id INT NOT NULL,
    content TEXT NOT NULL,
    read_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_errand_id (errand_id),
    INDEX idx_created_at (created_at)
  )`,
  "ALTER TABLE runners ADD COLUMN background_check_notes TEXT NULL",
  "ALTER TABLE runners ADD COLUMN id_document_path VARCHAR(500) NULL",
];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'errand_user',
    password: process.env.MYSQL_PASSWORD || 'errand_dev_password',
    database: process.env.MYSQL_DATABASE || 'errandsplace',
  });
  for (const sql of statements) {
    try {
      await conn.execute(sql);
      console.log('OK:', sql.slice(0, 60) + '...');
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME' || e.message.includes('Duplicate')) {
        console.log('skip (exists):', sql.slice(0, 50));
      } else {
        console.warn('warn:', e.message);
      }
    }
  }
  await conn.end();
  console.log('Schema alignment finished');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
