const { pool } = require('../config/db.mysql');

async function auditSecurity({ actorId = null, action, targetType = null, targetId = null, details = {}, req = null }) {
  try {
    await pool.execute(
      `INSERT INTO audit_logs (admin_id, action, target_type, target_id, details, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [actorId, action, targetType, targetId, typeof details === 'string' ? details : JSON.stringify(details), req?.ip || null]
    );
  } catch (error) {
    // Audit failures must never break the protected business operation.
    console.error('[SECURITY AUDIT] write failed:', error.message);
  }
}

module.exports = { auditSecurity };
