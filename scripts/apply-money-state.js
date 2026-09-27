require('dotenv').config();
const { pool } = require('../config/db.mysql');

async function columnExists(conn, table, column) {
  const [rows] = await conn.execute(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function addColumn(conn, table, definition) {
  const match = definition.match(/ADD COLUMN\s+`?([A-Za-z0-9_]+)`?/i);
  if (!match) throw new Error(`Cannot determine column from: ${definition}`);
  if (!(await columnExists(conn, table, match[1]))) await conn.execute(`ALTER TABLE ${table} ${definition}`);
}

async function main() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`ALTER TABLE errands MODIFY COLUMN status ENUM('pending','paid','accepted','picked_up','delivered','completed','cancelled','disputed','assigned','in_progress') NOT NULL DEFAULT 'pending'`);
    for (const def of [
      'ADD COLUMN paid_at TIMESTAMP NULL',
      'ADD COLUMN picked_up_at TIMESTAMP NULL',
      'ADD COLUMN delivered_at TIMESTAMP NULL',
      'ADD COLUMN disputed_at TIMESTAMP NULL',
    ]) await addColumn(conn, 'errands', def);

    await conn.execute(`CREATE TABLE IF NOT EXISTS errand_holds (
      id INT AUTO_INCREMENT PRIMARY KEY, errand_id INT NOT NULL, client_id INT NOT NULL,
      amount DECIMAL(15,2) NOT NULL, currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      status ENUM('held','released','refunded') NOT NULL DEFAULT 'held',
      held_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, released_at TIMESTAMP NULL, refunded_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_errand_hold (errand_id), INDEX idx_hold_status (status), INDEX idx_hold_client (client_id),
      CONSTRAINT fk_hold_errand FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE CASCADE,
      CONSTRAINT fk_hold_client FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await conn.execute(`CREATE TABLE IF NOT EXISTS errand_disputes (
      id INT AUTO_INCREMENT PRIMARY KEY, errand_id INT NOT NULL, opened_by INT NOT NULL,
      reason_code VARCHAR(64) NOT NULL, note TEXT NOT NULL, status ENUM('open','resolved') NOT NULL DEFAULT 'open',
      resolution_code VARCHAR(64) NULL, resolution_note TEXT NULL, resolved_by INT NULL, resolved_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_dispute_errand (errand_id), INDEX idx_dispute_status (status),
      CONSTRAINT fk_dispute_errand FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE CASCADE,
      CONSTRAINT fk_dispute_opener FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_dispute_resolver FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
    )`);
    await addColumn(conn, 'wallet_transactions', 'ADD COLUMN actor_id INT NULL');
    await addColumn(conn, 'wallet_transactions', 'ADD COLUMN reason TEXT NULL');
    await addColumn(conn, 'wallet_transactions', 'ADD COLUMN is_demo TINYINT(1) NOT NULL DEFAULT 0');
    await conn.execute(`ALTER TABLE wallet_transactions MODIFY COLUMN transaction_type ENUM('deposit','withdrawal','transfer','earning','payment','refund','fee','conversion','escrow_hold','escrow_release','gift_card_issue','gift_card_redeem') NOT NULL`);
    await conn.execute(`UPDATE errands SET paid_at = COALESCE(paid_at, updated_at) WHERE payment_status IN ('paid','escrowed','released','refunded') AND paid_at IS NULL`);
    await conn.execute(`UPDATE errands SET accepted_at = COALESCE(accepted_at, assigned_at) WHERE status IN ('assigned','in_progress','completed') AND accepted_at IS NULL`);
    await conn.execute(`UPDATE errands SET picked_up_at = COALESCE(picked_up_at, started_at) WHERE status IN ('in_progress','completed') AND picked_up_at IS NULL`);
    await conn.execute(`UPDATE errands SET completed_at = COALESCE(completed_at, updated_at) WHERE status = 'completed' AND completed_at IS NULL`);
    await conn.commit();
    console.log('Money/state migration applied successfully.');
  } catch (e) {
    await conn.rollback();
    console.error('Money/state migration failed:', e.message);
    process.exitCode = 1;
  } finally { conn.release(); }
}
main();
