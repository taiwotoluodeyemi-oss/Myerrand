const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { pool } = require('../config/db.mysql');
const { verifyToken, requireRunner, requireAdmin } = require('../middleware/auth');
const { notifyUser } = require('../utils/notify');

const jsonResponse = (res, status, success, data = null, error = null) => {
  res.status(status).json({ success, data, error });
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/verification');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `id-${req.user.id}-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// Current runner's own verification status
router.get('/status', verifyToken, requireRunner, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT background_check_status, background_check_date, background_check_notes, identity_verified, id_document_path IS NOT NULL AS has_document FROM runners WHERE user_id = ?',
      [req.user.id]
    );
    if (!rows[0]) return jsonResponse(res, 404, false, null, 'Runner profile not found');
    jsonResponse(res, 200, true, rows[0]);
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// Runner submits (or resubmits, e.g. after a rejection) an ID document for
// review. This is a manual-review flow, not an automated background-check
// API integration — there's no third-party provider (Checkr etc.) wired
// in here, so "background check" means an admin looks at the document.
router.post('/submit', verifyToken, requireRunner, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return jsonResponse(res, 400, false, null, 'An ID document (image or PDF) is required');
    }

    const relativePath = `/uploads/verification/${req.file.filename}`;
    const [result] = await pool.execute(
      `UPDATE runners
       SET id_document_path = ?, background_check_status = 'pending', background_check_notes = NULL
       WHERE user_id = ?`,
      [relativePath, req.user.id]
    );
    if (result.affectedRows === 0) {
      return jsonResponse(res, 404, false, null, 'Runner profile not found');
    }

    jsonResponse(res, 200, true, { message: 'Document submitted for review', status: 'pending' });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// --- Admin review ---

// Queue of runners waiting on a decision
router.get('/admin/pending', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT r.user_id, r.id_document_path, r.background_check_status, r.updated_at, u.name, u.email
       FROM runners r JOIN users u ON u.id = r.user_id
       WHERE r.background_check_status = 'pending' AND r.id_document_path IS NOT NULL
       ORDER BY r.updated_at ASC`
    );
    jsonResponse(res, 200, true, { runners: rows });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// Every runner + their current status, for a general oversight view
router.get('/admin/all', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT r.user_id, r.background_check_status, r.identity_verified, r.average_rating, r.total_errands_completed, u.name, u.email
       FROM runners r JOIN users u ON u.id = r.user_id
       ORDER BY r.background_check_status = 'pending' DESC, r.updated_at DESC`
    );
    jsonResponse(res, 200, true, { runners: rows });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

router.post('/admin/:runner_user_id/decision', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { decision, notes } = req.body;
    if (!['approved', 'rejected'].includes(decision)) {
      return jsonResponse(res, 400, false, null, 'decision must be "approved" or "rejected"');
    }

    const [result] = await pool.execute(
      `UPDATE runners
       SET background_check_status = ?,
           background_check_date = NOW(),
           background_check_notes = ?,
           identity_verified = ?
       WHERE user_id = ?`,
      [decision, notes || null, decision === 'approved', req.params.runner_user_id]
    );
    if (result.affectedRows === 0) {
      return jsonResponse(res, 404, false, null, 'Runner not found');
    }

    await notifyUser({
      userId: req.params.runner_user_id,
      title: decision === 'approved' ? 'Verification approved' : 'Verification rejected',
      message: decision === 'approved'
        ? 'Your ID has been verified. You can now accept errands.'
        : `Your ID verification was rejected.${notes ? ' Reason: ' + notes : ''} You can resubmit a document.`,
      type: decision === 'approved' ? 'success' : 'warning'
    }, req.app.get('io'));

    jsonResponse(res, 200, true, { message: `Runner ${decision}` });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

router.get('/admin/document/:runner_user_id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id_document_path FROM runners WHERE user_id = ?',
      [req.params.runner_user_id]
    );
    const docPath = rows[0]?.id_document_path;
    if (!docPath) {
      return jsonResponse(res, 404, false, null, 'No document on file for this runner');
    }
    // docPath is always our own generated `/uploads/verification/<file>`
    // string (see POST /submit above) — never taken from request input —
    // so resolving it against the uploads dir is safe from traversal.
    const absolutePath = path.join(__dirname, '..', docPath);
    res.sendFile(absolutePath);
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

module.exports = router;
