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
    const ext = path.extname(file.originalname || '').toLowerCase();
    const imageExt = new Set(['.jpg','.jpeg','.png','.webp']);
    const videoExt = new Set(['.mp4','.mov','.webm','.m4v']);
    const docExt = new Set(['.pdf','.doc','.docx','.txt']);
    if (file.fieldname === 'images' && file.mimetype.startsWith('image/') && imageExt.has(ext)) return cb(null, true);
    if (file.fieldname === 'videos' && file.mimetype.startsWith('video/') && videoExt.has(ext)) return cb(null, true);
    if (file.fieldname === 'documents' && ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'].includes(file.mimetype) && docExt.has(ext)) return cb(null, true);
    cb(new Error('File type is not allowed for this upload field'));
  }
});

// Utility functions for handling wallets
const { getAllWalletBalances } = require('../utils/wallet-utils');
const { createHold, releaseHold, refundHold, processDueReleases, processDueRefunds } = require('../services/errandMoney');
const { transitionErrand, canonicalStatus } = require('../services/errandState');
const { DISPUTE_WINDOW_HOURS, PRIMARY_MARKET, MARKETS } = require('../config/marketplace');
const { CLIENT_POLICIES, RUNNER_POLICIES, assertPoliciesAccepted, assertLiabilityAccepted } = require('../services/policyGate');

const { v4: uuidv4 } = require('uuid');
const { verifyToken } = require('./auth.routes');
const { requireClient, requireRunner, requireAdmin } = require('../middleware/auth');
const { geocodeAddress, isGeocodingConfigured } = require('../utils/geocode');
const { notifyUser } = require('../utils/notify');
const { enqueueEventAfterCommit } = require('../services/eventOutbox');
const { calculateErrandPrice } = require('../utils/pricing');
const { auditSecurity } = require('../services/securityAudit');

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
    
    const role = req.user.userType || req.user.user_type || req.user.role;
    if (role === 'admin') {
      if (user_type === 'client') { query += ' WHERE e.client_id = ?'; params.push(userId); }
      else if (user_type === 'runner') { query += ' WHERE e.runner_id = ?'; params.push(userId); }
    } else if (role === 'client' || user_type === 'client') {
      query += ' WHERE e.client_id = ?';
      params.push(userId);
    } else if (role === 'runner' || user_type === 'runner') {
      query += ' WHERE e.runner_id = ?';
      params.push(userId);
    } else {
      return jsonResponse(res, 403, false, null, 'Role is not permitted to list errands');
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
      country, city, zone, market_id, channel = 'consumer', business_reference, reference, contact_phone, phone,
    } = req.body;
    const clientId = req.user.id;

    if (!title || !pickup_address || !delivery_address) {
      return jsonResponse(res, 400, false, null, 'title, pickup_address and delivery_address are required');
    }

    const normalizedChannel = channel === 'business' ? 'business' : 'consumer';
    const normalizedReference = business_reference || reference || null;
    const normalizedPhone = contact_phone || phone || null;
    if (normalizedChannel === 'business' && (!normalizedReference || !normalizedPhone)) {
      return jsonResponse(res, 400, false, null, 'Business errands require reference and contact phone');
    }
    const selectedMarket = MARKETS.find(m => m.id === market_id) || PRIMARY_MARKET;
    if (selectedMarket.status === 'paused') return jsonResponse(res, 409, false, null, 'This market is temporarily paused for new demand');
    const normalizedCountry = country || selectedMarket.country || PRIMARY_MARKET.country;
    const normalizedCity = city || selectedMarket.city || PRIMARY_MARKET.city;
    const normalizedZone = zone || selectedMarket.zones[0];
    if (!normalizedZone) return jsonResponse(res, 400, false, null, 'A service zone is required');
    if (!selectedMarket.zones.includes(normalizedZone)) return jsonResponse(res, 400, false, null, 'Selected service zone is not configured');
    try {
      const [zoneRows] = await pool.execute('SELECT pause_demand FROM market_zones WHERE country=? AND city=? AND zone=?', [country || PRIMARY_MARKET.country, city || PRIMARY_MARKET.city, normalizedZone]);
      if (zoneRows[0]?.pause_demand) return jsonResponse(res, 409, false, null, 'This zone is temporarily paused for new demand');
    } catch (zoneErr) { if (zoneErr.code !== 'ER_NO_SUCH_TABLE') throw zoneErr; }

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

    // Address text is sufficient; coordinates remain optional when geocoding is unavailable.

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
         client_id, title, description, pickup_address, delivery_address, country, city, zone, market_id,
         channel, business_reference, contact_phone,
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
        clientId, title, description || null, pickup_address, delivery_address, normalizedCountry, normalizedCity, normalizedZone, selectedMarket.id,
        normalizedChannel, normalizedReference, normalizedPhone,
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
        `${error.message}. Apply the latest database migrations (pricing, money, zone and market).`);
    }
    jsonResponse(res, status, false, null, error.message);
  }
});

// Primary-market zone configuration for create forms and runner discovery.
router.get('/config/zones', async (req, res) => {
  jsonResponse(res, 200, true, PRIMARY_MARKET);
});

// Get unassigned errands for runners
router.get('/unassigned', verifyToken, requireRunner, async (req, res) => {
  try {
    const [runnerRows] = await pool.execute('SELECT service_zones, areas_of_service FROM runners WHERE user_id = ?', [req.user.id]);
    const runnerZones = String(runnerRows[0]?.service_zones || runnerRows[0]?.areas_of_service || '').split(',').map((z) => z.trim()).filter(Boolean);
    const [errands] = await pool.execute(
      `SELECT e.*, u.name as client_name 
       FROM errands e 
       LEFT JOIN users u ON e.client_id = u.id 
       WHERE e.runner_id IS NULL AND e.status = 'paid' AND e.payment_status = 'escrowed'
         AND (? = '' OR e.zone IS NULL OR FIND_IN_SET(REPLACE(e.zone, ' ', ''), REPLACE(?, ' ', '')) > 0)
       ORDER BY CASE WHEN ? <> '' AND FIND_IN_SET(REPLACE(e.zone, ' ', ''), REPLACE(?, ' ', '')) > 0 THEN 0 ELSE 1 END,
                CASE WHEN e.pickup_latitude IS NOT NULL AND e.pickup_longitude IS NOT NULL THEN 0 ELSE 1 END,
                e.created_at DESC`,
      [runnerZones.join(','), runnerZones.join(','), runnerZones.join(','), runnerZones.join(',')]
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
      `SELECT * FROM errands WHERE id = ? AND runner_id IS NULL AND status ='paid' AND payment_status='escrowed'`,
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

// Pay for errand: the money engine creates exactly one errand hold.
router.post('/pay/:errand_id', verifyToken, requireClient, async (req, res) => {
  try {
    const [[errand]] = await pool.execute('SELECT id,market_id FROM errands WHERE id=? AND client_id=?',[req.params.errand_id,req.user.id]);
    if (!errand) return jsonResponse(res,404,false,null,'Errand not found or you are not authorized to pay');
    await assertPoliciesAccepted(req.user.id, CLIENT_POLICIES);
    const result = await createHold(req.params.errand_id, req.user.id, 'USD', Boolean(req.body?.is_demo));
    jsonResponse(res, 200, true, result);
  } catch (error) {
    jsonResponse(res, error.status || 500, false, null, error.message || 'Payment failed');
  }
});

// Pickup/start errand. Legacy clients may still call this route; the DB now records picked_up.
router.patch('/start/:errand_id', verifyToken, requireRunner, async (req, res) => {
  try {
    const errand = await transitionErrand(req.params.errand_id, 'picked_up', req.user);
    jsonResponse(res, 200, true, { message: 'Errand picked up successfully', status: errand.status });
  } catch (error) {
    jsonResponse(res, error.status || 500, false, null, error.message);
  }
});

// Deliver errand. Funds remain held until the 24-hour release window passes.
router.patch('/deliver/:errand_id', verifyToken, requireRunner, async (req, res) => {
  try {
    const errand = await transitionErrand(req.params.errand_id, 'delivered', req.user);
    jsonResponse(res, 200, true, { message: 'Errand delivered; funds remain held for the release window', status: errand.status });
  } catch (error) {
    jsonResponse(res, error.status || 500, false, null, error.message);
  }
});

// Complete errand. Completion never directly pays the runner; releaseHold owns money movement.
router.patch('/complete/:errand_id', verifyToken, requireRunner, async (req, res) => {
  try {
    const errand = await transitionErrand(req.params.errand_id, 'completed', req.user);
    jsonResponse(res, 200, true, { message: 'Errand completed; escrow release is processed separately', status: errand.status });
  } catch (error) {
    jsonResponse(res, error.status || 500, false, null, error.message);
  }
});

// Get client's errands
router.get('/client', verifyToken, requireClient, async (req, res) => {
  try {
    const clientId = req.user.id;
    
    const [errands] = await pool.execute(
      `SELECT e.*, r.name as runner_name, h.status AS errand_hold_status
       FROM errands e 
       LEFT JOIN users r ON e.runner_id = r.id 
       LEFT JOIN errand_holds h ON h.errand_id = e.id
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
    const [runnerRows] = await pool.execute('SELECT service_zones, areas_of_service FROM runners WHERE user_id = ?', [req.user.id]);
    const runnerZones = String(runnerRows[0]?.service_zones || runnerRows[0]?.areas_of_service || '').split(',').map((z) => z.trim()).filter(Boolean);
    const zoneCsv = runnerZones.join(',');
    const [errands] = await pool.execute(
      `SELECT e.*, u.name as client_name 
       FROM errands e 
       LEFT JOIN users u ON e.client_id = u.id 
       WHERE e.runner_id IS NULL AND e.status = 'paid' AND e.payment_status = 'escrowed'
         AND (? = '' OR e.zone IS NULL OR FIND_IN_SET(REPLACE(e.zone, ' ', ''), REPLACE(?, ' ', '')) > 0)
       ORDER BY CASE WHEN ? <> '' AND FIND_IN_SET(REPLACE(e.zone, ' ', ''), REPLACE(?, ' ', '')) > 0 THEN 0 ELSE 1 END, e.created_at DESC`,
      [zoneCsv, zoneCsv, zoneCsv, zoneCsv]
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

// Cancel errand. Only paid/accepted-but-not-picked-up client cancellations are refundable in v1.
router.patch('/cancel/:errand_id', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM errands WHERE id = ? AND client_id = ?', [req.params.errand_id, req.user.id]);
    if (!rows.length) return jsonResponse(res, 404, false, null, 'Errand not found or you are not authorized');
    const errand = rows[0];
    const current = canonicalStatus(errand.status);
    if (!['pending', 'paid', 'accepted'].includes(current)) {
      return jsonResponse(res, 400, false, null, 'This errand cannot be cancelled at its current stage');
    }
    if (current === 'pending') {
      await transitionErrand(errand.id, 'cancelled', req.user);
      return jsonResponse(res, 200, true, { message: 'Errand cancelled successfully' });
    }
    const result = await refundHold(errand.id, req.user.id, 'Client cancellation refund', { finalizeStatus: 'cancelled' });
    jsonResponse(res, 200, true, { message: 'Errand cancelled and refunded', refund: result });
  } catch (error) {
    jsonResponse(res, error.status || 500, false, null, error.message);
  }
});

// Accept errand. Explicit agreement is required by the API.
router.post('/:errand_id/accept', verifyToken, requireRunner, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const errandId = req.params.errand_id;
    const runnerId = req.user.id;
    if (req.body?.confirm_agreement !== true) {
      await connection.rollback();
      return jsonResponse(res, 400, false, null, 'You must explicitly agree to the runner terms before accepting');
    }
    const role = req.user.userType || req.user.user_type || req.user.role;
    if (role !== 'admin') {
      const [[market]] = await pool.execute(
        `SELECT id,require_verified_runners,insurance_mode FROM markets WHERE id=(SELECT market_id FROM errands WHERE id=? LIMIT 1)`,
        [errandId]
      );
      const requireVerified = market ? Boolean(market.require_verified_runners) : true;
      const [runnerRows] = await connection.execute('SELECT verification_status, background_check_status FROM runners WHERE user_id = ?', [runnerId]);
      const verificationStatus = runnerRows[0]?.verification_status || runnerRows[0]?.background_check_status || 'pending';
      if (requireVerified && verificationStatus !== 'approved') {
        await connection.rollback();
        return jsonResponse(res, 403, false, null, 'Your verification must be approved before you can accept errands.');
      }
      await assertPoliciesAccepted(runnerId, RUNNER_POLICIES);
      if (market?.insurance_mode === 'ack_only') await assertLiabilityAccepted(runnerId, market.id, market.insurance_mode);
    }
    const [rows] = await connection.execute(
      `SELECT * FROM errands WHERE id = ? AND runner_id IS NULL AND status IN ('paid','pending') AND payment_status = 'escrowed' FOR UPDATE`,
      [errandId]
    );
    if (!rows.length) {
      await connection.rollback();
      return jsonResponse(res, 404, false, null, 'Errand not found or not available');
    }
    await connection.execute('UPDATE errands SET runner_id = ?, updated_at = NOW() WHERE id = ?', [runnerId, errandId]);
    await transitionErrand(errandId, 'accepted', req.user, connection);
    await connection.commit();
    await notifyUser({ userId: rows[0].client_id, errandId: Number(errandId), title: 'Runner assigned', message: `A runner accepted your errand "${rows[0].title}"`, type: 'success' }, req.app.get('io'));
    jsonResponse(res, 200, true, { message: 'Errand accepted successfully', status: 'accepted' });
  } catch (error) {
    await connection.rollback();
    jsonResponse(res, error.status || 500, false, null, error.message);
  } finally { connection.release(); }
});

// Compatibility status endpoint. Canonical states are enforced by errandState; legacy names are mapped.
router.put('/:errand_id/status', verifyToken, requireRunner, async (req, res) => {
  try {
    const requested = req.body?.status;
    const mapped = { assigned: 'accepted', in_progress: 'picked_up', picked_up: 'picked_up', delivered: 'delivered', completed: 'completed' }[requested];
    if (!mapped) return jsonResponse(res, 400, false, null, 'Invalid status');
    if (mapped === 'accepted' && req.body?.confirm_agreement !== true) {
      return jsonResponse(res, 400, false, null, 'Explicit agreement is required before accepting');
    }
    const errand = await transitionErrand(req.params.errand_id, mapped, req.user);
    jsonResponse(res, 200, true, { message: `Errand status updated to ${errand.status}`, status: errand.status, fundsReleased: false });
  } catch (error) {
    jsonResponse(res, error.status || 500, false, null, error.message);
  }
});

// Record an operational exception and open the existing dispute path; money movement remains in errandMoney.
router.post('/:errand_id/exception', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { exception_type, note } = req.body || {};
    if (!['no_show', 'address_not_found'].includes(exception_type)) {
      await connection.rollback();
      return jsonResponse(res, 400, false, null, 'Invalid exception_type');
    }
    const [rows] = await connection.execute('SELECT * FROM errands WHERE id = ? AND (client_id = ? OR runner_id = ?) FOR UPDATE', [req.params.errand_id, req.user.id, req.user.id]);
    if (!rows.length) { await connection.rollback(); return jsonResponse(res, 404, false, null, 'Errand not found or access denied'); }
    const errand = rows[0];
    const current = canonicalStatus(errand.status);
    if (!['accepted', 'picked_up', 'delivered', 'completed'].includes(current)) {
      await connection.rollback(); return jsonResponse(res, 409, false, null, 'This exception is not available at the current stage');
    }
    const [open] = await connection.execute(`SELECT id FROM errand_disputes WHERE errand_id = ? AND status = 'open' FOR UPDATE`, [errand.id]);
    if (open.length) { await connection.rollback(); return jsonResponse(res, 409, false, null, 'An open dispute already exists'); }
    await connection.execute('UPDATE errands SET exception_type = ?, had_address_issue = CASE WHEN ? = \'address_not_found\' THEN 1 ELSE had_address_issue END, updated_at=NOW() WHERE id=?', [exception_type, exception_type, errand.id]);
    await connection.execute(`INSERT INTO errand_disputes (errand_id, opened_by, reason_code, note, status) VALUES (?, ?, ?, ?, 'open')`, [errand.id, req.user.id, exception_type, note || exception_type]);
    await transitionErrand(errand.id, 'disputed', req.user, connection);
    await connection.commit();
    jsonResponse(res, 201, true, { message: `${exception_type} recorded; dispute opened and money remains frozen`, exception_type });
  } catch (error) { await connection.rollback(); jsonResponse(res, error.status || 500, false, null, error.message); }
  finally { connection.release(); }
});

// Open a service dispute. Money remains frozen while the dispute is open.
router.post('/:errand_id/dispute', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { reason_code, note } = req.body || {};
    if (!reason_code || !note) {
      await connection.rollback();
      return jsonResponse(res, 400, false, null, 'reason_code and note are required');
    }
    const [rows] = await connection.execute('SELECT * FROM errands WHERE id = ? AND (client_id = ? OR runner_id = ?) FOR UPDATE', [req.params.errand_id, req.user.id, req.user.id]);
    if (!rows.length) { await connection.rollback(); return jsonResponse(res, 404, false, null, 'Errand not found or access denied'); }
    const errand = rows[0];
    const current = canonicalStatus(errand.status);
    if (!['accepted','picked_up','delivered','completed'].includes(current)) {
      await connection.rollback();
      return jsonResponse(res, 409, false, null, 'This errand is not in a dispute-eligible state');
    }
    if (current === 'completed' && (!errand.completed_at || Date.now() - new Date(errand.completed_at).getTime() > DISPUTE_WINDOW_HOURS * 60 * 60 * 1000)) {
      await connection.rollback();
      return jsonResponse(res, 409, false, null, 'Dispute window has expired');
    }
    const [open] = await connection.execute(`SELECT id FROM errand_disputes WHERE errand_id = ? AND status = 'open' FOR UPDATE`, [errand.id]);
    if (open.length) { await connection.rollback(); return jsonResponse(res, 409, false, null, 'An open dispute already exists'); }
    await connection.execute(`INSERT INTO errand_disputes (errand_id, opened_by, reason_code, note, status) VALUES (?, ?, ?, ?, 'open')`, [errand.id, req.user.id, reason_code, note]);
    await transitionErrand(errand.id, 'disputed', req.user, connection);
    await connection.commit();
    jsonResponse(res, 201, true, { message: 'Dispute opened; money processing is frozen' });
  } catch (error) {
    await connection.rollback();
    jsonResponse(res, error.status || 500, false, null, error.message);
  } finally { connection.release(); }
});

// Admin dispute resolution. All money movement goes through errandMoney.
router.post('/:errand_id/dispute/resolve', verifyToken, requireAdmin, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { resolution_code, note } = req.body || {};
    if (!['release_to_runner','refund_to_client','cancel_no_pay'].includes(resolution_code)) return jsonResponse(res, 400, false, null, 'Invalid resolution_code');
    const [rows] = await connection.execute(`SELECT * FROM errand_disputes WHERE errand_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`, [req.params.errand_id]);
    if (!rows.length) return jsonResponse(res, 404, false, null, 'Open dispute not found');

    let moneyResult = null;
    if (resolution_code === 'release_to_runner') moneyResult = await releaseHold(req.params.errand_id, req.user.id, 'Admin resolution: release_to_runner', { finalizeStatus: 'completed' });
    if (resolution_code === 'refund_to_client') moneyResult = await refundHold(req.params.errand_id, req.user.id, 'Admin resolution: refund_to_client', { finalizeStatus: 'cancelled' });

    const [errands] = await pool.execute('SELECT * FROM errands WHERE id = ?', [req.params.errand_id]);
    const errand = errands[0];
    if (!errand) return jsonResponse(res, 404, false, null, 'Errand not found');
    if (resolution_code === 'cancel_no_pay') {
      if (errand.payment_status === 'escrowed') moneyResult = await refundHold(errand.id, req.user.id, 'Admin resolution: cancel_no_pay', { finalizeStatus: 'cancelled' });
      else await transitionErrand(errand.id, 'cancelled', req.user);
    } else if (resolution_code === 'release_to_runner' || resolution_code === 'refund_to_client') {
      // The money engine finalized the terminal errand state atomically.
    }
    await pool.execute(`UPDATE errand_disputes SET status = 'resolved', resolution_code = ?, resolution_note = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ?`, [resolution_code, note || '', req.user.id, rows[0].id]);
    try {
      await enqueueEventAfterCommit({ eventType: 'resolved', errandId: errand.id, payload: {
        type: 'resolved', errand_id: errand.id, status: errand.status, reference: errand.business_reference || null,
        market_id: errand.market_id || null, zone: errand.zone || null, client_id: errand.client_id, runner_id: errand.runner_id || null, actor_id: req.user.id,
        resolution_code, resolution_note: note || '', resolved_at: new Date().toISOString(),
        timestamps: { paid_at: errand.paid_at || null, accepted_at: errand.accepted_at || null, picked_up_at: errand.picked_up_at || null, delivered_at: errand.delivered_at || null, completed_at: errand.completed_at || null, cancelled_at: errand.cancelled_at || null, disputed_at: errand.disputed_at || null }
      }});
    } catch (eventError) { console.error('[EVENT OUTBOX] resolve event enqueue failed:', eventError.message); }
    await auditSecurity({actorId:req.user.id,action:'money_resolution',targetType:'errand',targetId:Number(req.params.errand_id),details:{resolution_code,note:note||null},req});
    jsonResponse(res, 200, true, { message: 'Dispute resolved', resolution_code, money: moneyResult });
  } catch (error) {
    jsonResponse(res, error.status || 500, false, null, error.message);
  } finally { connection.release(); }
});

// Lightweight due-money processor; safe to invoke repeatedly.
router.post('/process-due-money', verifyToken, requireAdmin, async (req, res) => {
  try {
    const releases = await processDueReleases();
    const refunds = await processDueRefunds();
    jsonResponse(res, 200, true, { releases, refunds });
  } catch (error) { jsonResponse(res, 500, false, null, error.message); }
});

// Update errand progress with file uploads. Status changes use errandState only.
router.post('/update-progress', verifyToken, upload.fields([
  { name: 'images', maxCount: 5 },
  { name: 'videos', maxCount: 3 },
  { name: 'documents', maxCount: 5 }
]), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { errandId, status, notes } = req.body;
    const userId = req.user.id;
    const [rows] = await connection.execute('SELECT * FROM errands WHERE id = ? AND runner_id = ?', [errandId, userId]);
    if (!rows.length) return jsonResponse(res, 404, false, null, 'Errand not found or not assigned to you');
    let finalStatus = canonicalStatus(rows[0].status);
    if (status && status !== rows[0].status) {
      const mapped = { assigned: 'accepted', in_progress: 'picked_up', picked_up: 'picked_up', delivered: 'delivered', completed: 'completed' }[status];
      if (!mapped) return jsonResponse(res, 400, false, null, 'Invalid status');
      const updated = await transitionErrand(errandId, mapped, req.user);
      finalStatus = updated.status;
    }

    await connection.beginTransaction();
    const [progressResult] = await connection.execute('INSERT INTO errand_progress (errand_id, runner_id, notes, created_at) VALUES (?, ?, ?, NOW())', [errandId, userId, notes || '']);
    const progressId = progressResult.insertId;
    if (req.files) {
      for (const type of ['images','videos','documents']) {
        for (const file of (req.files[type] || [])) {
          await connection.execute('INSERT INTO errand_files (progress_id, errand_id, file_type, file_name, file_path, file_size, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())', [progressId, errandId, type.slice(0, -1), file.originalname, file.path, file.size, file.mimetype]);
        }
      }
    }
    await connection.commit();
    jsonResponse(res, 200, true, { message: 'Progress updated successfully', progressId, status: finalStatus });
  } catch (error) {
    await connection.rollback();
    if (req.files) Object.values(req.files).flat().forEach(file => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
    jsonResponse(res, error.status || 500, false, null, error.message);
  } finally { connection.release(); }
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

