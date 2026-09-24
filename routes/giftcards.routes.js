/**
 * Gift-card catalog, wallet purchase, customer orders, secure code reveal.
 * Manual fulfillment is handled under /api/admin (see admin.routes.js extensions).
 * Existing /api/wallet/giftcards/* (user-issued codes) are left unchanged.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { pool } = require('../config/db.mysql');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { getUserWallet, createWallet } = require('../utils/wallet-utils');
const { notifyUser } = require('../utils/notify');

const CODE_SECRET = () =>
  process.env.GIFT_CODE_SECRET || process.env.JWT_SECRET || 'dev-gift-code-secret';

function encryptCode(plain) {
  const key = crypto.createHash('sha256').update(CODE_SECRET()).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptCode(payload) {
  if (!payload) return null;
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = crypto.createHash('sha256').update(CODE_SECRET()).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function orderRef() {
  return `GCO-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function audit(adminId, action, targetType, targetId, amount, details, ip) {
  try {
    await pool.execute(
      `INSERT INTO audit_logs (admin_id, action, target_type, target_id, amount, details, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [adminId || null, action, targetType || null, targetId || null, amount || null,
        typeof details === 'string' ? details : JSON.stringify(details || {}), ip || null]
    );
  } catch (e) {
    console.error('audit_log', e.message);
  }
}

// ---------- Public catalog (auth optional for browse; purchase requires auth) ----------

router.get('/products', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, brand, product_name, denomination, face_currency, region,
              selling_price_ngn, description, image_url, status
       FROM gift_card_products
       WHERE status = 'active'
       ORDER BY brand, denomination`
    );
    // Never expose supplier_cost to customers
    res.json({ success: true, products: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/products/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, brand, product_name, denomination, face_currency, region,
              selling_price_ngn, description, image_url, status
       FROM gift_card_products WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Product not found' });
    res.json({ success: true, product: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---------- Purchase with wallet (atomic) ----------

router.post('/products/:id/purchase', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const productId = req.params.id;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [products] = await connection.execute(
      `SELECT * FROM gift_card_products WHERE id = ? AND status = 'active' FOR UPDATE`,
      [productId]
    );
    if (!products.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Product unavailable' });
    }
    const product = products[0];

    const price = parseFloat(product.selling_price_ngn);

    // Configurable risk: large recent deposits may force under_review
    let orderStatus = 'pending_fulfillment';
    try {
      const [settings] = await connection.execute(
        `SELECT setting_key, setting_value FROM platform_settings
         WHERE setting_key IN ('large_deposit_review_ngn','hold_hours_large_deposit')`
      );
      const map = {};
      settings.forEach((s) => { map[s.setting_key] = s.setting_value; });
      const large = parseFloat(map.large_deposit_review_ngn || '500000');
      const holdH = parseFloat(map.hold_hours_large_deposit || '0');
      if (holdH > 0) {
        const [deps] = await connection.execute(
          `SELECT wt.amount, wt.processed_at FROM wallet_transactions wt
           JOIN wallets w ON w.id = wt.to_wallet_id
           WHERE w.user_id = ? AND wt.transaction_type IN ('deposit','manual_credit')
             AND wt.processed_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
           ORDER BY wt.processed_at DESC LIMIT 5`,
          [userId, holdH]
        );
        const recentLarge = deps.some((d) => parseFloat(d.amount) >= large);
        if (recentLarge) orderStatus = 'under_review';
      }
    } catch (_) {}

    if (!price || price <= 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Invalid product price' });
    }

    // Server-side price only — ignore any client-supplied amount
    let [wallets] = await connection.execute(
      `SELECT * FROM wallets WHERE user_id = ? AND wallet_type = 'spendable' AND currency = 'NGN' AND status = 'active' FOR UPDATE`,
      [userId]
    );
    if (!wallets.length) {
      // try create NGN spendable
      await connection.execute(
        `INSERT INTO wallets (user_id, wallet_type, currency, balance, status) VALUES (?, 'spendable', 'NGN', 0, 'active')`,
        [userId]
      );
      [wallets] = await connection.execute(
        `SELECT * FROM wallets WHERE user_id = ? AND wallet_type = 'spendable' AND currency = 'NGN' AND status = 'active' FOR UPDATE`,
        [userId]
      );
    }
    const wallet = wallets[0];
    const bal = parseFloat(wallet.balance) || 0;
    if (bal < price) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: 'Insufficient wallet balance',
        price_ngn: price,
        available: bal,
        shortfall: Math.round((price - bal) * 100) / 100
      });
    }

    const balanceBefore = bal;
    const balanceAfter = Math.round((bal - price) * 100) / 100;
    await connection.execute(
      `UPDATE wallets SET balance = balance - ?, updated_at = NOW() WHERE id = ? AND balance >= ?`,
      [price, wallet.id, price]
    );

    const [txResult] = await connection.execute(
      `INSERT INTO wallet_transactions
        (from_wallet_id, transaction_type, amount, currency, description, status, processed_at)
       VALUES (?, 'gift_card_purchase', ?, 'NGN', ?, 'completed', NOW())`,
      [wallet.id, price, `Gift card: ${product.product_name} (${product.region})`]
    );
    const txId = txResult.insertId;
    const ref = orderRef();

    const [orderResult] = await connection.execute(
      `INSERT INTO gift_card_orders
        (order_ref, user_id, product_id, brand, product_name, denomination, face_currency, region,
         price_ngn, status, wallet_transaction_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ref, userId, product.id, product.brand, product.product_name, product.denomination,
        product.face_currency, product.region, price, orderStatus, txId]
    );

    await connection.commit();

    notifyUser({
      userId,
      title: 'Gift card order received',
      message: `Order ${ref} is pending fulfillment. You will be notified when your code is ready.`,
      type: 'info'
    }).catch(() => {});

    res.status(201).json({
      success: true,
      order: {
        id: orderResult.insertId,
        order_ref: ref,
        product_name: product.product_name,
        brand: product.brand,
        region: product.region,
        price_ngn: price,
        status: orderStatus,
        balance_before: balanceBefore,
        balance_after: balanceAfter
      }
    });
  } catch (e) {
    await connection.rollback();
    console.error('gift purchase', e);
    res.status(500).json({ success: false, error: 'Purchase failed' });
  } finally {
    connection.release();
  }
});

// ---------- Customer orders ----------

router.get('/orders', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, order_ref, brand, product_name, denomination, face_currency, region,
              price_ngn, status, created_at, fulfilled_at
       FROM gift_card_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json({ success: true, orders: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/orders/:id', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, order_ref, brand, product_name, denomination, face_currency, region,
              price_ngn, status, created_at, fulfilled_at, fulfillment_notes
       FROM gift_card_orders WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Order not found' });
    const order = rows[0];
    const isAdmin = (req.user.userType || req.user.user_type) === 'admin';
    if (order.user_id !== undefined && false) { /* filled below */ }
    // ownership: re-fetch with user check
    const [owned] = await pool.execute(
      `SELECT id, order_ref, user_id, brand, product_name, denomination, face_currency, region,
              price_ngn, status, created_at, fulfilled_at
       FROM gift_card_orders WHERE id = ? AND (user_id = ? OR ? = 1)`,
      [req.params.id, req.user.id, isAdmin ? 1 : 0]
    );
    // simpler: only owner
    const [check] = await pool.execute(
      `SELECT id, order_ref, user_id, brand, product_name, denomination, face_currency, region,
              price_ngn, status, created_at, fulfilled_at
       FROM gift_card_orders WHERE id = ?`,
      [req.params.id]
    );
    if (!check.length) return res.status(404).json({ success: false, error: 'Order not found' });
    if (check[0].user_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Not authorized to view this order' });
    }
    res.json({ success: true, order: check[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Reveal gift code — owner only, fulfilled only */
router.get('/orders/:id/code', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, user_id, status, gift_code_encrypted, order_ref, product_name
       FROM gift_card_orders WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Order not found' });
    const order = rows[0];
    if (order.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    if (order.status !== 'fulfilled') {
      return res.status(400).json({ success: false, error: 'Code is available only after fulfillment' });
    }
    const code = decryptCode(order.gift_code_encrypted);
    if (!code) return res.status(404).json({ success: false, error: 'Code not available' });
    res.json({ success: true, order_ref: order.order_ref, product_name: order.product_name, code });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Unable to retrieve code' });
  }
});

/** Customer cancel before fulfillment → refund */
router.post('/orders/:id/cancel', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT * FROM gift_card_orders WHERE id = ? FOR UPDATE`,
      [req.params.id]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    const order = rows[0];
    if (order.user_id !== userId) {
      await connection.rollback();
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    if (order.status !== 'pending_fulfillment' && order.status !== 'under_review') {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Only unfulfilled orders can be cancelled' });
    }
    if (order.refund_transaction_id) {
      await connection.rollback();
      return res.status(400).json({ success: false, error: 'Already refunded' });
    }

    const price = parseFloat(order.price_ngn);
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
    await connection.execute(
      `UPDATE wallets SET balance = balance + ?, updated_at = NOW() WHERE id = ?`,
      [price, wallets[0].id]
    );
    const [tx] = await connection.execute(
      `INSERT INTO wallet_transactions
        (to_wallet_id, transaction_type, amount, currency, description, status, processed_at)
       VALUES (?, 'refund', ?, 'NGN', ?, 'completed', NOW())`,
      [wallets[0].id, price, `Refund for cancelled order ${order.order_ref}`]
    );
    await connection.execute(
      `UPDATE gift_card_orders SET status = 'refunded', cancelled_at = NOW(), refund_transaction_id = ? WHERE id = ?`,
      [tx.insertId, order.id]
    );
    await connection.commit();
    res.json({ success: true, message: 'Order cancelled and wallet refunded', refunded: price });
  } catch (e) {
    await connection.rollback();
    res.status(500).json({ success: false, error: e.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
module.exports.encryptCode = encryptCode;
module.exports.decryptCode = decryptCode;
module.exports.audit = audit;
