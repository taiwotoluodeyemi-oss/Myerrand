const express = require('express');
const { pool } = require('../config/db.mysql');
const { verifyToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken, requireAdmin);

/** List recent wallet / payment-style transactions */
router.get('/payments', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT wt.*, 
              u.name AS user_name, u.email AS user_email,
              e.title AS errand_title
       FROM wallet_transactions wt
       LEFT JOIN wallets w ON w.id = COALESCE(wt.to_wallet_id, wt.from_wallet_id)
       LEFT JOIN users u ON u.id = w.user_id
       LEFT JOIN errands e ON e.id = wt.errand_id
       ORDER BY wt.created_at DESC
       LIMIT 200`
    );
    res.json({ success: true, payments: rows });
  } catch (err) {
    console.error('admin/payments', err);
    res.status(500).json({ error: 'Failed to load payments', detail: err.message });
  }
});

/** List users */
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, name, email, phone, user_type, status, balance, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT 500`
    );
    res.json({ success: true, users: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** List errands */
router.get('/errands', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT e.*, c.name AS client_name, r.name AS runner_name
       FROM errands e
       LEFT JOIN users c ON c.id = e.client_id
       LEFT JOIN users r ON r.id = e.runner_id
       ORDER BY e.created_at DESC
       LIMIT 200`
    );
    res.json({ success: true, errands: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Suspend / activate user */
router.patch('/users/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await pool.execute('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true, message: 'User status updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
