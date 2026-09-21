const express = require('express');
const router = express.Router();
const { pool } = require('../config/db.mysql');
const { verifyToken } = require('../middleware/auth');

const jsonResponse = (res, status, success, data = null, error = null) => {
  res.status(status).json({ success, data, error });
};

// List the current user's notifications, most recent first, plus an unread
// count for a badge. Capped at 50 — this is an inbox, not a full archive.
router.get('/', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    const [[{ unread }]] = await pool.execute(
      'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = FALSE',
      [req.user.id]
    );

    jsonResponse(res, 200, true, { notifications: rows, unreadCount: unread });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// Mark a single notification read
router.post('/:id/read', verifyToken, async (req, res) => {
  try {
    const [result] = await pool.execute(
      'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return jsonResponse(res, 404, false, null, 'Notification not found');
    }
    jsonResponse(res, 200, true, { message: 'Marked as read' });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// Mark everything read (e.g. "clear all" in the bell dropdown)
router.post('/read-all', verifyToken, async (req, res) => {
  try {
    await pool.execute(
      'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = ? AND is_read = FALSE',
      [req.user.id]
    );
    jsonResponse(res, 200, true, { message: 'All notifications marked as read' });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

module.exports = router;
