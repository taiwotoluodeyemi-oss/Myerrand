const express = require('express');
const router = express.Router();
const { pool } = require('../config/db.mysql');
const { verifyToken } = require('../middleware/auth');
const { notifyUser } = require('../utils/notify');

const jsonResponse = (res, status, success, data = null, error = null) => {
  res.status(status).json({ success, data, error });
};

async function loadErrandForParticipant(errandId, userId) {
  const [rows] = await pool.execute('SELECT * FROM errands WHERE id = ?', [errandId]);
  const errand = rows[0];
  if (!errand) return { errand: null, isParticipant: false };
  const isParticipant = errand.client_id === userId || errand.runner_id === userId;
  return { errand, isParticipant };
}

// Message history for one errand's chat thread
router.get('/:errand_id', verifyToken, async (req, res) => {
  try {
    const { errand, isParticipant } = await loadErrandForParticipant(req.params.errand_id, req.user.id);
    if (!errand) return jsonResponse(res, 404, false, null, 'Errand not found');
    if (!isParticipant) return jsonResponse(res, 403, false, null, 'Access denied');

    const [messages] = await pool.execute(
      `SELECT m.*, u.name AS sender_name
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.errand_id = ? ORDER BY m.created_at ASC LIMIT 200`,
      [req.params.errand_id]
    );

    // Mark messages sent *to* this user as read
    await pool.execute(
      'UPDATE messages SET read_at = NOW() WHERE errand_id = ? AND sender_id != ? AND read_at IS NULL',
      [req.params.errand_id, req.user.id]
    );

    jsonResponse(res, 200, true, { messages });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// Send a message. Chat is only open while there's an active engagement
// (assigned or in_progress) — same rule as live location tracking: no
// chatting with a runner who was never assigned, and the thread quiets
// down once the errand is done.
router.post('/:errand_id', verifyToken, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return jsonResponse(res, 400, false, null, 'Message content is required');
    }
    if (content.length > 2000) {
      return jsonResponse(res, 400, false, null, 'Message is too long (2000 character limit)');
    }

    const { errand, isParticipant } = await loadErrandForParticipant(req.params.errand_id, req.user.id);
    if (!errand) return jsonResponse(res, 404, false, null, 'Errand not found');
    if (!isParticipant) return jsonResponse(res, 403, false, null, 'Access denied');
    if (!['assigned', 'in_progress'].includes(errand.status)) {
      return jsonResponse(res, 400, false, null, 'Chat is only available while an errand is active');
    }

    const [result] = await pool.execute(
      'INSERT INTO messages (errand_id, sender_id, content, message) VALUES (?, ?, ?, ?)',
      [req.params.errand_id, req.user.id, content.trim(), content.trim()]
    );

    const [[sender]] = await pool.execute('SELECT name FROM users WHERE id = ?', [req.user.id]);
    const message = {
      id: result.insertId,
      errand_id: Number(req.params.errand_id),
      sender_id: req.user.id,
      sender_name: sender?.name || 'User',
      content: content.trim(),
      created_at: new Date().toISOString(),
      read_at: null
    };

    const io = req.app.get('io');
    if (io) {
      io.to(`errand:${req.params.errand_id}`).emit('message', message);
    }

    const recipientId = errand.client_id === req.user.id ? errand.runner_id : errand.client_id;
    if (recipientId) {
      await notifyUser({
        userId: recipientId,
        errandId: errand.id,
        title: 'New message',
        message: content.trim().slice(0, 120),
        type: 'info'
      }, io);
    }

    jsonResponse(res, 201, true, { message });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

module.exports = router;
