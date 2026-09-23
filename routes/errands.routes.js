const express = require('express');
const { body, param, query } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { pool } = require('../config/db.mysql');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/errands');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images, videos, and documents
    if (file.fieldname === 'images') {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed for images field'));
      }
    } else if (file.fieldname === 'videos') {
      if (file.mimetype.startsWith('video/')) {
        cb(null, true);
      } else {
        cb(new Error('Only video files are allowed for videos field'));
      }
    } else if (file.fieldname === 'documents') {
      if (file.mimetype === 'application/pdf' || 
          file.mimetype === 'application/msword' ||
          file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          file.mimetype === 'text/plain') {
        cb(null, true);
      } else {
        cb(new Error('Only PDF, DOC, DOCX, and TXT files are allowed for documents field'));
      }
    } else {
      cb(new Error('Unexpected field'));
    }
  }
});

// Utility functions for handling wallets
const { 
  getUserWallet, 
  updateWalletBalance, 
  createWalletTransaction, 
  processErrandPayment, 
  releaseEscrowFunds,
  getAllWalletBalances 
} = require('../utils/wallet-utils');

const { v4: uuidv4 } = require('uuid');
const { verifyToken } = require('./auth.routes');
const { requireClient, requireRunner, requireAdmin } = require('../middleware/auth');
const { geocodeAddress, isGeocodingConfigured } = require('../utils/geocode');
const { notifyUser } = require('../utils/notify');
const { calculateErrandPrice } = require('../utils/pricing');

const jsonResponse = (res, status, success, data = null, error = null) => {
    res.status(status).json({
        success,
        data,
        error,
        correlationId: uuidv4(),
        timestamp: new Date().toISOString()
    });
};

// Get all errands
router.get('/', verifyToken, async (req, res) => {
  try {
    const { status, user_type } = req.query;
    const userId = req.user.id;
    
    let query = `
      SELECT e.*, u.name as client_name, r.name as runner_name 
      FROM errands e 
      LEFT JOIN users u ON e.client_id = u.id 
      LEFT JOIN users r ON e.runner_id = r.id
    `;
    let params = [];
    
    if (user_type === 'client') {
      query += ' WHERE e.client_id = ?';
      params.push(userId);
    } else if (user_type === 'runner') {
      query += ' WHERE e.runner_id = ? OR e.runner_id IS NULL';
      params.push(userId);
    }
    
    if (status) {
      query += params.length > 0 ? ' AND e.status = ?' : ' WHERE e.status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY e.created_at DESC';
    
    const [errands] = await pool.execute(query, params);
    jsonResponse(res, 200, true, errands);
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

/**
 * GET /api/errands/quote
 * Live price estimate for the create form. Does NOT create an errand.
 * Query or body: pickup_lat, pickup_lng, delivery_lat, delivery_lng, mode, urgency
 * Optional: pickup_address / delivery_address — geocoded when coords missing.
 */
router.get('/quote', verifyToken, async (req, res) => {
  try {
    const src = { ...req.query, ...req.body };
    let {
      pickup_lat, pickup_lng, delivery_lat, delivery_lng,
      mode, urgency, pickup_address, delivery_address,
    } = src;

    if ((pickup_lat == null || pickup_lng == null) && pickup_address) {
      const coords = await geocodeAddress(pickup_address);
      if (coords) {
        pickup_lat = coords.lat;
        pickup_lng = coords.lng;
      }
    }
    if ((delivery_lat == null || delivery_lng == null) && delivery_address) {
      const coords = await geocodeAddress(delivery_address);
      if (coords) {
        delivery_lat = coords.lat;
        delivery_lng = coords.lng;
      }
    }

    if ([pickup_lat, pickup_lng, delivery_lat, delivery_lng].some((v) => v == null || v === '')) {
      return jsonResponse(res, 400, false, null,
        'pickup_lat, pickup_lng, delivery_lat, delivery_lng are required (or provide addresses that can be geocoded)');
    }

    const breakdown = await calculateErrandPrice({
      pickup_lat, pickup_lng, delivery_lat, delivery_lng,
      mode: mode || 'motorcycle',
      urgency: urgency || 'medium',
    });
    jsonResponse(res, 200, true, breakdown);
  } catch (error) {
    const status = error.status || 500;
    jsonResponse(res, status, false, null, error.message);
  }
});

// Create new errand — server recomputes price; client-supplied amount is ignored
router.post('/create', verifyToken, requireClient, async (req, res) => {
  try {
    const {
      title, description, pickup_address, delivery_address,
      estimated_hours, weight_kg, urgency, category, mode,
      pickup_lat, pickup_lng, delivery_lat, delivery_lng,
    } = req.body;
    const clientId = req.user.id;

    if (!title || !pickup_address || !delivery_address) {
      return jsonResponse(res, 400, false, null, 'title, pickup_address and delivery_address are required');
    }

    let plat = pickup_lat != null ? parseFloat(pickup_lat) : null;
    let plng = pickup_lng != null ? parseFloat(pickup_lng) : null;
    let dlat = delivery_lat != null ? parseFloat(delivery_lat) : null;
    let dlng = delivery_lng != null ? parseFloat(delivery_lng) : null;

    if (![plat, plng].every(Number.isFinite) && pickup_address) {
      const coords = await geocodeAddress(pickup_address);
      if (coords) { plat = coords.lat; plng = coords.lng; }
    }
    if (![dlat, dlng].every(Number.isFinite) && delivery_address) {
      const coords = await geocodeAddress(delivery_address);
      if (coords) { dlat = coords.lat; dlng = coords.lng; }
    }

    if (![plat, plng, dlat, dlng].every(Number.isFinite)) {
      return jsonResponse(res, 400, false, null,
        'Could not resolve coordinates. Provide pickup_lat/lng and delivery_lat/lng, or enable geocoding.');
    }

    const transportMode = (mode || 'motorcycle').toLowerCase();
    const urgencyLevel = urgency || 'medium';

    const quote = await calculateErrandPrice({
      pickup_lat: plat,
      pickup_lng: plng,
      delivery_lat: dlat,
      delivery_lng: dlng,
      mode: transportMode,
      urgency: urgencyLevel,
    });

    // amount / budget_amount = client_total (what escrow holds & client pays)
    const [result] = await pool.execute(
      `INSERT INTO errands (
         client_id, title, description, pickup_address, delivery_address,
         pickup_latitude, pickup_longitude, delivery_latitude, delivery_longitude,
         amount, budget_amount, estimated_hours, weight_kg, urgency, category, mode,
         distance_km, base_fare, distance_cost, fuel_cost, urgency_fee, subtotal,
         platform_fee, vat_amount, vat_rate, runner_payout,
         status, payment_status
       ) VALUES (
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?,
         'pending', NULL
       )`,
      [
        clientId, title, description || null, pickup_address, delivery_address,
        plat, plng, dlat, dlng,
        quote.client_total, quote.client_total,
        estimated_hours || 1, weight_kg || 0, urgencyLevel, category || null, transportMode,
        quote.distance_km, quote.base_fare, quote.distance_cost, quote.fuel_cost,
        quote.urgency_fee, quote.subtotal,
        quote.platform_fee, quote.vat, quote.vat_rate, quote.runner_payout,
      ]
    );

    jsonResponse(res, 201, true, {
      errandId: result.insertId,
      message: 'Errand created successfully',
      pricing: quote,
    });
  } catch (error) {
    const status = error.status || 500;
    // If new columns are missing, surface a clearer migration hint
    if (error.code === 'ER_BAD_FIELD_ERROR') {
      return jsonResponse(res, 500, false, null,
        `${error.message}. Apply database/07-pricing-engine.sql migration.`);
    }
    jsonResponse(res, status, false, null, error.message);
  }
});

// Get unassigned errands for runners
router.get('/unassigned', verifyToken, requireRunner, async (req, res) => {
  try {
    const [errands] = await pool.execute(
      `SELECT e.*, u.name as client_name 
       FROM errands e 
       LEFT JOIN users u ON e.client_id = u.id 
       WHERE e.runner_id IS NULL AND e.status = 'pending' 
       ORDER BY e.created_at DESC`
    );
    
    jsonResponse(res, 200, true, errands);
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// Assign errand to runner
router.patch('/assign/:errand_id', verifyToken, requireRunner, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const errandId = req.params.errand_id;
    const runnerId = req.user.id;
    
    // Check if errand exists and is available
    const [errand] = await connection.execute(
      `SELECT * FROM errands WHERE id = ? AND runner_id IS NULL AND status ='pending'`,
      [errandId]
    );
    
    if (errand.length === 0) {
      return jsonResponse(res, 404, false, null, 'Errand not found or already assigned');
    }
    
    // Assign errand to runner
    await connection.execute(
      `UPDATE errands SET runner_id = ?, status ='assigned' WHERE id = ?`,
      [runnerId, errandId]
    );
    
    await connection.commit();
    jsonResponse(res, 200, true, { message: 'Errand assigned successfully' });
  } catch (error) {
    await connection.rollback();
    jsonResponse(res, 500, false, null, error.message);
  } finally {
    connection.release();
  }
});

// Pay for errand (move funds to escrow)
router.post('/pay/:errand_id', verifyToken, requireClient, async (req, res) => {
  try {
    const errandId = req.params.errand_id;
    const clientId = req.user.id;
    
    // Get errand details. payment_status is NULL until paid (see /create),
    // so "unpaid" means NULL — but also accept the legacy 'pending' string
    // for rows created before this fix.
    const [errand] = await pool.execute(
      `SELECT * FROM errands WHERE id = ? AND client_id = ? AND (payment_status IS NULL OR payment_status ='pending')`,
      [errandId, clientId]
    );
    
    if (errand.length === 0) {
      return jsonResponse(res, 404, false, null, 'Errand not found or already paid');
    }
    
    // Process payment to escrow
    const result = await processErrandPayment(clientId, errandId, errand[0].amount);
    jsonResponse(res, 200, true, result);
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// Start errand
router.patch('/start/:errand_id', verifyToken, requireRunner, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const errandId = req.params.errand_id;
    const runnerId = req.user.id;
    
    // Check if errand is assigned to this runner
    const [errand] = await connection.execute(
      `SELECT * FROM errands WHERE id = ? AND runner_id = ? AND status ='assigned'`,
      [errandId, runnerId]
    );
    
    if (errand.length === 0) {
      return jsonResponse(res, 404, false, null, 'Errand not found or not assigned to you');
    }
    
    await connection.execute(
      `UPDATE errands SET status ='in_progress', started_at = NOW() WHERE id = ?`,
      [errandId]
    );
    
    await connection.commit();
    jsonResponse(res, 200, true, { message: 'Errand started successfully' });
  } catch (error) {
    await connection.rollback();
    jsonResponse(res, 500, false, null, error.message);
  } finally {
    connection.release();
  }
});

// Complete errand
router.patch('/complete/:errand_id', verifyToken, requireRunner, async (req, res) => {
  try {
    const errandId = req.params.errand_id;
    const runnerId = req.user.id;
    
    // Get errand details
    const [errand] = await pool.execute(
      `SELECT * FROM errands WHERE id = ? AND runner_id = ? AND status ='in_progress'`,
      [errandId, runnerId]
    );
    
    if (errand.length === 0) {
      return jsonResponse(res, 404, false, null, 'Errand not found or not in progress');
    }
    
    // Escrow holds client_total (amount); runner receives runner_payout only
    const row = errand[0];
    const held = parseFloat(row.amount) || 0;
    const payout = row.runner_payout != null ? parseFloat(row.runner_payout) : held;
    const result = await releaseEscrowFunds(
      row.client_id,
      runnerId,
      errandId,
      held,
      'USD',
      { heldAmount: held, runnerPayout: payout }
    );

    await pool.execute(
      `UPDATE errands SET status ='completed', completed_at = NOW() WHERE id = ?`,
      [errandId]
    );

    jsonResponse(res, 200, true, result);
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// Get client's errands
router.get('/client', verifyToken, requireClient, async (req, res) => {
  try {
    const clientId = req.user.id;
    
    const [errands] = await pool.execute(
      `SELECT e.*, r.name as runner_name 
       FROM errands e 
       LEFT JOIN users r ON e.runner_id = r.id 
       WHERE e.client_id = ? 
       ORDER BY e.created_at DESC`,
      [clientId]
    );
    
    jsonResponse(res, 200, true, { errands });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// Get available errands for runners
router.get('/available', verifyToken, requireRunner, async (req, res) => {
  try {
    const [errands] = await pool.execute(
      `SELECT e.*, u.name as client_name 
       FROM errands e 
       LEFT JOIN users u ON e.client_id = u.id 
       WHERE e.runner_id IS NULL AND e.status = 'pending' AND e.payment_status = 'escrowed'
       ORDER BY e.created_at DESC`
    );
    
    jsonResponse(res, 200, true, { errands });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// Get runner's errands
router.get('/runner', verifyToken, requireRunner, async (req, res) => {
  try {
    const runnerId = req.user.id;
    
    const [errands] = await pool.execute(
      `SELECT e.*, u.name as client_name, u.phone as client_phone 
       FROM errands e 
       LEFT JOIN users u ON e.client_id = u.id 
       WHERE e.runner_id = ? 
       ORDER BY e.created_at DESC`,
      [runnerId]
    );
    
    jsonResponse(res, 200, true, { errands });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// Cancel errand
router.patch('/cancel/:errand_id', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const errandId = req.params.errand_id;
    const userId = req.user.id;
    
    // Get errand details
    const [errand] = await connection.execute(
      'SELECT * FROM errands WHERE id = ? AND (client_id = ? OR runner_id = ?)',
      [errandId, userId, userId]
    );
    
    if (errand.length === 0) {
      return jsonResponse(res, 404, false, null, 'Errand not found or you are not authorized');
    }
    
    const errandData = errand[0];
    
    // Check if errand can be cancelled
    if (errandData.status === 'completed') {
      return jsonResponse(res, 400, false, null, 'Cannot cancel completed errand');
    }
    
    // If payment was made, refund to client's spendable wallet
    if (errandData.payment_status === 'escrowed') {
      // Get client's wallets
      const [escrowWallet] = await connection.execute(
        `SELECT * FROM wallets WHERE user_id = ? AND wallet_type ='escrow' AND currency = 'USD'`,
        [errandData.client_id]
      );
      
      const [spendableWallet] = await connection.execute(
        `SELECT * FROM wallets WHERE user_id = ? AND wallet_type ='spendable' AND currency = 'USD'`,
        [errandData.client_id]
      );
      
      if (escrowWallet.length > 0 && spendableWallet.length > 0) {
        // Transfer from escrow back to spendable
        await connection.execute(
          'UPDATE wallets SET balance = balance - ? WHERE id = ?',
          [errandData.amount, escrowWallet[0].id]
        );
        
        await connection.execute(
          'UPDATE wallets SET balance = balance + ? WHERE id = ?',
          [errandData.amount, spendableWallet[0].id]
        );
        
        // Record refund transaction
        await connection.execute(
          `INSERT INTO wallet_transactions (
            from_wallet_id, to_wallet_id, transaction_type, amount, currency,
            description, errand_id, status, processed_at
          ) VALUES (?, ?, 'refund', ?, 'USD', ?, ?, 'completed', NOW())`,
          [escrowWallet[0].id, spendableWallet[0].id, errandData.amount, 
           `Refund for cancelled errand #${errandId}`, errandId]
        );
      }
    }
    
    // Update errand status
    await connection.execute(
      `UPDATE errands SET status ='cancelled', cancelled_at = NOW() WHERE id = ?`,
      [errandId]
    );
    
    await connection.commit();
    jsonResponse(res, 200, true, { message: 'Errand cancelled successfully' });
  } catch (error) {
    await connection.rollback();
    jsonResponse(res, 500, false, null, error.message);
  } finally {
    connection.release();
  }
});

// Accept errand
router.post('/:errand_id/accept', verifyToken, requireRunner, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const errandId = req.params.errand_id;
    const runnerId = req.user.id;

    // Only verified runners can accept work. An admin acting through the
    // runner role (requireRunner allows 'admin' too) skips this check —
    // there's no runner profile row to check verification against.
    const role = req.user.userType || req.user.user_type || req.user.role;
    if (role !== 'admin') {
      const [runnerRows] = await connection.execute(
        'SELECT background_check_status FROM runners WHERE user_id = ?',
        [runnerId]
      );
      if (runnerRows[0]?.background_check_status !== 'approved') {
        await connection.rollback();
        return jsonResponse(res, 403, false, null, 'Your identity verification must be approved before you can accept errands. Submit a document under Verification in your dashboard.');
      }
    }
    
    // Check if errand exists and is available
    const [errand] = await connection.execute(
      `SELECT * FROM errands WHERE id = ? AND runner_id IS NULL AND status ='pending' AND payment_status ='escrowed' FOR UPDATE`,
      [errandId]
    );
    
    if (errand.length === 0) {
      await connection.rollback();
      return jsonResponse(res, 404, false, null, 'Errand not found or not available');
    }
    
    // Assign errand to runner (row locked — prevents double accept)
    const [upd] = await connection.execute(
      `UPDATE errands SET runner_id = ?, status ='assigned', accepted_at = NOW() WHERE id = ? AND runner_id IS NULL`,
      [runnerId, errandId]
    );
    if (upd.affectedRows === 0) {
      await connection.rollback();
      return jsonResponse(res, 409, false, null, 'Errand was just accepted by another runner');
    }
    
    await connection.commit();

    await notifyUser({
      userId: errand[0].client_id,
      errandId: Number(errandId),
      title: 'Runner assigned',
      message: `A runner accepted your errand "${errand[0].title}"`,
      type: 'success'
    }, req.app.get('io'));

    jsonResponse(res, 200, true, { message: 'Errand accepted successfully' });
  } catch (error) {
    await connection.rollback();
    jsonResponse(res, 500, false, null, error.message);
  } finally {
    connection.release();
  }
});

// Update errand status
router.put('/:errand_id/status', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const errandId = req.params.errand_id;
    const { status } = req.body;
    const userId = req.user.id;
    
    // Validate status
    const validStatuses = ['assigned', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return jsonResponse(res, 400, false, null, 'Invalid status');
    }
    
    // Check if user is the runner of this errand
    const [errand] = await connection.execute(
      'SELECT * FROM errands WHERE id = ? AND runner_id = ?',
      [errandId, userId]
    );
    
    if (errand.length === 0) {
      return jsonResponse(res, 404, false, null, 'Errand not found or not assigned to you');
    }
    
    const errandData = errand[0];
    
    // Update status
    let updateQuery = 'UPDATE errands SET status = ? WHERE id = ?';
    let params = [status, errandId];
    
    if (status === 'in_progress') {
      updateQuery = 'UPDATE errands SET status = ?, started_at = NOW() WHERE id = ?';
    } else if (status === 'completed') {
      updateQuery = `UPDATE errands SET status = ?, completed_at = NOW(), payment_status = 'released' WHERE id = ?`;
      
      // Release escrow funds to runner using centralized utility function
      if (errandData.payment_status === 'escrowed') {
        // Temporarily commit transaction to allow utility function to work
        await connection.commit();
        
        try {
          {
            const held = parseFloat(errandData.amount) || 0;
            const payout = errandData.runner_payout != null ? parseFloat(errandData.runner_payout) : held;
            await releaseEscrowFunds(
              errandData.client_id,
              userId,
              errandId,
              held,
              'USD',
              { heldAmount: held, runnerPayout: payout }
            );
            console.log(`✅ FUNDS RELEASED: runner_payout=${payout} (held=${held}) to runner ${userId} for errand ${errandId}`);
          }
        } catch (escrowError) {
          console.error('❌ ERROR releasing escrow funds:', escrowError);
          // Continue with status update even if escrow release fails
        }
        
        // Start new transaction for status update
        await connection.beginTransaction();
      }
    }
    
    await connection.execute(updateQuery, params);
    await connection.commit();

    if (status === 'in_progress') {
      await notifyUser({
        userId: errandData.client_id,
        errandId: Number(errandId),
        title: 'Errand in progress',
        message: `Your runner has started "${errandData.title}"`,
        type: 'info'
      }, req.app.get('io'));
    } else if (status === 'completed') {
      await notifyUser({
        userId: errandData.client_id,
        errandId: Number(errandId),
        title: 'Errand completed',
        message: `"${errandData.title}" is complete. Tap to rate your runner.`,
        type: 'success'
      }, req.app.get('io'));
    }
    
    jsonResponse(res, 200, true, { 
      message: `Errand status updated to ${status}`,
      fundsReleased: status === 'completed' && errandData.payment_status === 'escrowed'
    });
  } catch (error) {
    await connection.rollback();
    console.error('❌ ERROR in status update:', error);
    jsonResponse(res, 500, false, null, error.message);
  } finally {
    connection.release();
  }
});

// Update errand progress with file uploads
router.post('/update-progress', verifyToken, upload.fields([
  { name: 'images', maxCount: 5 },
  { name: 'videos', maxCount: 3 },
  { name: 'documents', maxCount: 5 }
]), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { errandId, status, notes } = req.body;
    const userId = req.user.id;
    
    // Verify the errand belongs to this runner
    const [errand] = await connection.execute(
      'SELECT * FROM errands WHERE id = ? AND runner_id = ?',
      [errandId, userId]
    );
    
    if (errand.length === 0) {
      return jsonResponse(res, 404, false, null, 'Errand not found or not assigned to you');
    }
    
    // Update errand status if provided
    if (status && status !== errand[0].status) {
      const errandData = errand[0];
      let updateQuery = 'UPDATE errands SET status = ? WHERE id = ?';
      let params = [status, errandId];
      
      if (status === 'in_progress') {
        updateQuery = 'UPDATE errands SET status = ?, started_at = NOW() WHERE id = ?';
      } else if (status === 'completed') {
        updateQuery = `UPDATE errands SET status = ?, completed_at = NOW(), payment_status = 'released' WHERE id = ?`;
        
        // Release escrow funds to runner using centralized utility function
        if (errandData.payment_status === 'escrowed') {
          // Temporarily commit transaction to allow utility function to work
          await connection.commit();
          
          try {
            {
              const held = parseFloat(errandData.amount) || 0;
              const payout = errandData.runner_payout != null ? parseFloat(errandData.runner_payout) : held;
              await releaseEscrowFunds(
                errandData.client_id,
                userId,
                errandId,
                held,
                'USD',
                { heldAmount: held, runnerPayout: payout }
              );
              console.log(`✅ FUNDS RELEASED (Progress): runner_payout=${payout} (held=${held}) to runner ${userId} for errand ${errandId}`);
            }
          } catch (escrowError) {
            console.error('❌ ERROR releasing escrow funds:', escrowError);
            // Continue with status update even if escrow release fails
          }
          
          // Start new transaction for remaining operations
          await connection.beginTransaction();
        }
      }
      
      await connection.execute(updateQuery, params);
    }
    
    // Create progress update record
    const [progressResult] = await connection.execute(
      'INSERT INTO errand_progress (errand_id, runner_id, notes, created_at) VALUES (?, ?, ?, NOW())',
      [errandId, userId, notes || '']
    );
    
    const progressId = progressResult.insertId;
    
    // Handle file uploads
    if (req.files) {
      const fileTypes = ['images', 'videos', 'documents'];
      
      for (const type of fileTypes) {
        if (req.files[type]) {
          for (const file of req.files[type]) {
            await connection.execute(
              'INSERT INTO errand_files (progress_id, errand_id, file_type, file_name, file_path, file_size, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
              [progressId, errandId, type.slice(0, -1), file.originalname, file.path, file.size, file.mimetype]
            );
          }
        }
      }
    }
    
    await connection.commit();
    jsonResponse(res, 200, true, { message: 'Progress updated successfully', progressId });
  } catch (error) {
    await connection.rollback();
    
    // Clean up uploaded files if database operation failed
    if (req.files) {
      const allFiles = Object.values(req.files).flat();
      allFiles.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }
    
    jsonResponse(res, 500, false, null, error.message);
  } finally {
    connection.release();
  }
});

// Get errand progress history
router.get('/:errand_id/progress', verifyToken, async (req, res) => {
  try {
    const errandId = req.params.errand_id;
    const userId = req.user.id;
    
    // Check if user has access to this errand
    const [errand] = await pool.execute(
      'SELECT * FROM errands WHERE id = ? AND (client_id = ? OR runner_id = ?)',
      [errandId, userId, userId]
    );
    
    if (errand.length === 0) {
      return jsonResponse(res, 404, false, null, 'Errand not found or access denied');
    }
    
    // Get progress history with files
    const [progress] = await pool.execute(
      `SELECT p.*, u.name as runner_name,
              GROUP_CONCAT(
                CASE WHEN f.file_type = 'image' THEN f.file_name END
              ) as images,
              GROUP_CONCAT(
                CASE WHEN f.file_type = 'video' THEN f.file_name END
              ) as videos,
              GROUP_CONCAT(
                CASE WHEN f.file_type = 'document' THEN f.file_name END
              ) as documents
       FROM errand_progress p
       LEFT JOIN users u ON p.runner_id = u.id
       LEFT JOIN errand_files f ON p.id = f.progress_id
       WHERE p.errand_id = ?
       GROUP BY p.id
       ORDER BY p.created_at DESC`,
      [errandId]
    );
    
    jsonResponse(res, 200, true, { progress });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// =======================
// LIVE MAP TRACKING
// =======================

// Get everything the map needs for one errand: pickup/delivery pins
// (geocoded on first request and cached) plus the runner's last-known
// position, if there's an active engagement.
router.get('/:errand_id/tracking', verifyToken, async (req, res) => {
  try {
    const errandId = req.params.errand_id;
    const [rows] = await pool.execute('SELECT * FROM errands WHERE id = ?', [errandId]);
    const errand = rows[0];

    if (!errand) {
      return jsonResponse(res, 404, false, null, 'Errand not found');
    }

    const role = req.user.userType || req.user.user_type || req.user.role;
    const isOwner = req.user.id === errand.client_id || req.user.id === errand.runner_id;
    if (!isOwner && role !== 'admin') {
      return jsonResponse(res, 403, false, null, 'Access denied');
    }

    // Geocode pickup/delivery on demand and cache the result so we don't
    // re-hit the Geocoding API on every poll.
    let { pickup_latitude, pickup_longitude, delivery_latitude, delivery_longitude } = errand;

    if ((pickup_latitude == null || pickup_longitude == null) && errand.pickup_address) {
      const coords = await geocodeAddress(errand.pickup_address);
      if (coords) {
        pickup_latitude = coords.lat;
        pickup_longitude = coords.lng;
        await pool.execute(
          'UPDATE errands SET pickup_latitude = ?, pickup_longitude = ? WHERE id = ?',
          [coords.lat, coords.lng, errandId]
        );
      }
    }

    if ((delivery_latitude == null || delivery_longitude == null) && errand.delivery_address) {
      const coords = await geocodeAddress(errand.delivery_address);
      if (coords) {
        delivery_latitude = coords.lat;
        delivery_longitude = coords.lng;
        await pool.execute(
          'UPDATE errands SET delivery_latitude = ?, delivery_longitude = ? WHERE id = ?',
          [coords.lat, coords.lng, errandId]
        );
      }
    }

    // Only surface the runner's live position while there's an active
    // engagement — not before they're assigned, and not after completion.
    let runner = null;
    if (errand.runner_id && ['assigned', 'in_progress'].includes(errand.status)) {
      const [runnerRows] = await pool.execute(
        'SELECT current_latitude, current_longitude, location_updated_at FROM users WHERE id = ?',
        [errand.runner_id]
      );
      const runnerRow = runnerRows[0];
      if (runnerRow?.current_latitude != null && runnerRow?.current_longitude != null) {
        runner = {
          lat: parseFloat(runnerRow.current_latitude),
          lng: parseFloat(runnerRow.current_longitude),
          updatedAt: runnerRow.location_updated_at
        };
      }
    }

    jsonResponse(res, 200, true, {
      status: errand.status,
      geocodingConfigured: isGeocodingConfigured(),
      pickup: pickup_latitude != null ? { lat: parseFloat(pickup_latitude), lng: parseFloat(pickup_longitude), address: errand.pickup_address } : null,
      delivery: delivery_latitude != null ? { lat: parseFloat(delivery_latitude), lng: parseFloat(delivery_longitude), address: errand.delivery_address } : null,
      runner
    });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// Runner pushes their current position while actively working an errand
// (heading to pickup, or en route to delivery).
router.post('/:errand_id/runner-location', verifyToken, requireRunner, async (req, res) => {
  try {
    const errandId = req.params.errand_id;
    const { latitude, longitude } = req.body;

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return jsonResponse(res, 400, false, null, 'Valid latitude and longitude are required');
    }

    const [rows] = await pool.execute('SELECT * FROM errands WHERE id = ?', [errandId]);
    const errand = rows[0];

    if (!errand || errand.runner_id !== req.user.id) {
      return jsonResponse(res, 404, false, null, 'Errand not found or not assigned to you');
    }
    if (!['assigned', 'in_progress'].includes(errand.status)) {
      return jsonResponse(res, 400, false, null, 'Location updates are only accepted while an errand is active');
    }

    await pool.execute(
      'UPDATE users SET current_latitude = ?, current_longitude = ?, location_updated_at = NOW() WHERE id = ?',
      [lat, lng, req.user.id]
    );

    jsonResponse(res, 200, true, { message: 'Location updated' });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

module.exports = router;

