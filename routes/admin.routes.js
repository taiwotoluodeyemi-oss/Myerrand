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


// ========== Gift card commerce (admin) ==========
const { encryptCode, audit } = require('./giftcards.routes');
const { notifyUser } = require('../utils/notify');

router.get('/gift-card-products', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM gift_card_products ORDER BY brand, denomination`
    );
    res.json({ success: true, products: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/gift-card-products', async (req, res) => {
  try {
    const {
      brand, product_name, denomination, face_currency = 'USD', region = 'United States',
      selling_price_ngn, supplier_cost_ngn, description, image_url, status = 'active'
    } = req.body || {};
    if (!brand || !product_name || !denomination || !selling_price_ngn) {
      return res.status(400).json({ error: 'brand, product_name, denomination, selling_price_ngn required' });
    }
    const [r] = await pool.execute(
      `INSERT INTO gift_card_products
        (brand, product_name, denomination, face_currency, region, selling_price_ngn, supplier_cost_ngn, description, image_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [brand, product_name, denomination, face_currency, region, selling_price_ngn,
        supplier_cost_ngn || null, description || null, image_url || null, status]
    );
    await audit(req.user.id, 'gift_product_create', 'gift_card_product', r.insertId, selling_price_ngn, { brand, product_name }, req.ip);
    res.status(201).json({ success: true, id: r.insertId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/gift-card-products/:id', async (req, res) => {
  try {
    const fields = ['brand', 'product_name', 'denomination', 'face_currency', 'region',
      'selling_price_ngn', 'supplier_cost_ngn', 'description', 'image_url', 'status'];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        sets.push(`${f} = ?`);
        vals.push(req.body[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id);
    await pool.execute(`UPDATE gift_card_products SET ${sets.join(', ')} WHERE id = ?`, vals);
    await audit(req.user.id, 'gift_product_update', 'gift_card_product', Number(req.params.id), req.body.selling_price_ngn || null, req.body, req.ip);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/gift-card-orders', async (req, res) => {
  try {
    const status = req.query.status;
    let sql = `SELECT o.*, u.name AS customer_name, u.email AS customer_email
               FROM gift_card_orders o
               LEFT JOIN users u ON u.id = o.user_id`;
    const params = [];
    if (status) {
      sql += ' WHERE o.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY o.created_at DESC LIMIT 200';
    const [rows] = await pool.execute(sql, params);
    // strip encrypted codes from list
    const safe = rows.map(({ gift_code_encrypted, ...rest }) => rest);
    res.json({ success: true, orders: safe });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/gift-card-orders/:id/fulfill', async (req, res) => {
  const { code, notes } = req.body || {};
  if (!code || String(code).trim().length < 4) {
    return res.status(400).json({ error: 'Valid gift card code required' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT * FROM gift_card_orders WHERE id = ? FOR UPDATE`,
      [req.params.id]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Order not found' });
    }
    const order = rows[0];
    if (order.status === 'fulfilled') {
      await connection.rollback();
      return res.status(400).json({ error: 'Order already fulfilled' });
    }
    if (order.status === 'refunded' || order.status === 'cancelled') {
      await connection.rollback();
      return res.status(400).json({ error: 'Cannot fulfill cancelled/refunded order' });
    }
    const enc = encryptCode(String(code).trim());
    await connection.execute(
      `UPDATE gift_card_orders
       SET status = 'fulfilled', gift_code_encrypted = ?, fulfilled_by = ?, fulfilled_at = NOW(),
           fulfillment_notes = ?
       WHERE id = ?`,
      [enc, req.user.id, notes || null, order.id]
    );
    await connection.commit();
    await audit(req.user.id, 'gift_order_fulfill', 'gift_card_order', order.id, order.price_ngn, { order_ref: order.order_ref }, req.ip);
    notifyUser({
      userId: order.user_id,
      title: 'Gift card ready',
      message: `Your order ${order.order_ref} has been fulfilled. Log in to view your code.`,
      type: 'success'
    }).catch(() => {});
    res.json({ success: true, message: 'Order fulfilled' });
  } catch (e) {
    await connection.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    connection.release();
  }
});

router.get('/gift-card-stats', async (req, res) => {
  try {
    const [[sales]] = await pool.execute(
      `SELECT COALESCE(SUM(price_ngn),0) AS total_sales, COUNT(*) AS order_count
       FROM gift_card_orders WHERE status IN ('pending_fulfillment','fulfilled','under_review')`
    );
    const [[pending]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM gift_card_orders WHERE status = 'pending_fulfillment'`
    );
    const [[fulfilled]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM gift_card_orders WHERE status = 'fulfilled'`
    );
    res.json({
      success: true,
      total_sales_ngn: parseFloat(sales.total_sales),
      order_count: sales.order_count,
      pending_fulfillment: pending.n,
      fulfilled: fulfilled.n
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});



// Platform settings (deposit limits, hold hours)
router.get('/settings', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT setting_key, setting_value FROM platform_settings');
    const settings = {};
    rows.forEach((r) => { settings[r.setting_key] = r.setting_value; });
    res.json({ success: true, settings });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const allowed = ['min_deposit_ngn', 'max_deposit_ngn', 'large_deposit_review_ngn', 'hold_hours_large_deposit'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        await pool.execute(
          `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [key, String(req.body[key])]
        );
      }
    }
    const { audit } = require('./giftcards.routes');
    await audit(req.user.id, 'settings_update', 'platform_settings', null, null, req.body, req.ip);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Manual wallet credit/debit with mandatory reason + audit */
router.post('/wallet-adjust', async (req, res) => {
  const { userId, amount, reason, direction } = req.body || {};
  const amt = parseFloat(amount);
  if (!userId || !amt || amt <= 0 || !reason || String(reason).trim().length < 5) {
    return res.status(400).json({ error: 'userId, positive amount, and reason (min 5 chars) required' });
  }
  if (!['credit', 'debit'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be credit or debit' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    let [wallets] = await connection.execute(
      `SELECT * FROM wallets WHERE user_id = ? AND wallet_type = 'spendable' AND currency = 'NGN' FOR UPDATE`,
      [userId]
    );
    if (!wallets.length) {
      await connection.execute(
        `INSERT INTO wallets (user_id, wallet_type, currency, balance, status) VALUES (?, 'spendable', 'NGN', 0, 'active')`,
        [userId]
      );
      [wallets] = await connection.execute(
        `SELECT * FROM wallets WHERE user_id = ? AND wallet_type = 'spendable' AND currency = 'NGN' FOR UPDATE`,
        [userId]
      );
    }
    const bal = parseFloat(wallets[0].balance) || 0;
    if (direction === 'debit' && bal < amt) {
      await connection.rollback();
      return res.status(400).json({ error: 'Insufficient balance for debit' });
    }
    if (direction === 'credit') {
      await connection.execute(`UPDATE wallets SET balance = balance + ? WHERE id = ?`, [amt, wallets[0].id]);
      await connection.execute(
        `INSERT INTO wallet_transactions (to_wallet_id, transaction_type, amount, currency, description, status, processed_at)
         VALUES (?, 'manual_credit', ?, 'NGN', ?, 'completed', NOW())`,
        [wallets[0].id, amt, `Admin adjust: ${reason}`]
      );
    } else {
      await connection.execute(`UPDATE wallets SET balance = balance - ? WHERE id = ? AND balance >= ?`, [amt, wallets[0].id, amt]);
      await connection.execute(
        `INSERT INTO wallet_transactions (from_wallet_id, transaction_type, amount, currency, description, status, processed_at)
         VALUES (?, 'manual_debit', ?, 'NGN', ?, 'completed', NOW())`,
        [wallets[0].id, amt, `Admin adjust: ${reason}`]
      );
    }
    await connection.commit();
    const { audit } = require('./giftcards.routes');
    await audit(req.user.id, 'wallet_adjust', 'user', Number(userId), amt, { direction, reason }, req.ip);
    res.json({ success: true, message: `Wallet ${direction} applied` });
  } catch (e) {
    await connection.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    connection.release();
  }
});

router.get('/audit-logs', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200`
    );
    res.json({ success: true, logs: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


module.exports = router;
