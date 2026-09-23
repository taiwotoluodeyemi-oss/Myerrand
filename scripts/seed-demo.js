#!/usr/bin/env node
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db.mysql');

async function upsertUser({ name, email, password, userType, balance }) {
  const [rows] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
  if (rows.length) {
    console.log('exists:', email);
    return rows[0].id;
  }
  const hash = await bcrypt.hash(password, 10);
  const [r] = await pool.execute(
    'INSERT INTO users (name, email, password, user_type, balance, status) VALUES (?, ?, ?, ?, ?, ?)',
    [name, email, hash, userType, balance, 'active']
  );
  const userId = r.insertId;

  // The registration endpoint also creates a role-specific detail row
  // (clients/runners) — do the same here so seeded demo accounts behave
  // like real signups instead of silently missing that row.
  if (userType === 'client') {
    await pool.execute('INSERT INTO clients (user_id) VALUES (?)', [userId]);
  } else if (userType === 'runner') {
    // Pre-approved so the demo account can accept errands immediately —
    // a real signup starts 'pending' and needs admin approval (see
    // routes/verification.routes.js).
    await pool.execute(
      `INSERT INTO runners (user_id, background_check_status, background_check_date, identity_verified)
       VALUES (?, 'approved', NOW(), TRUE)`,
      [userId]
    );
  }

  console.log('created:', email, `(${userType})`);
  return userId;
}

async function main() {
  if (process.env.USE_MONGO === 'true') {
    console.log('Seed is MySQL-only; set USE_MONGO=false');
    process.exit(0);
  }
  await upsertUser({ name: 'Demo Client', email: 'demo@example.com', password: 'demo123', userType: 'client', balance: 125.5 });
  await upsertUser({ name: 'Demo Runner', email: 'runner@example.com', password: 'demo123', userType: 'runner', balance: 0 });
  if (process.env.SEED_ADMIN === 'true') {
    await upsertUser({ name: 'Admin', email: 'admin@example.com', password: 'admin123', userType: 'admin', balance: 0 });
  }
  console.log('Seed complete (dev passwords — change in production)');
  process.exit(0);
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
