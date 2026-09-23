// Creates a notification row and, if a Socket.IO server instance is
// available, pushes it live to the user's room (joined client-side as
// `user:<id>` — see sockets/socketHandler.js). Persisting to the DB first
// means the notification is never lost even if the user isn't connected;
// the socket emit is a best-effort "wake up now" on top of that.

const { pool } = require('../config/db.mysql');

/**
 * @param {object} opts
 * @param {number} opts.userId - recipient
 * @param {number} [opts.errandId]
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {'info'|'success'|'warning'|'error'} [opts.type='info']
 * @param {import('socket.io').Server} [io]
 */
async function notifyUser({ userId, errandId = null, title, message, type = 'info' }, io = null) {
  try {
    const [result] = await pool.execute(
      'INSERT INTO notifications (user_id, errand_id, title, message, body, type) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, errandId, title, message, message, type]
    );

    const payload = {
      id: result.insertId,
      userId,
      errandId,
      title,
      message,
      type,
      isRead: false,
      createdAt: new Date().toISOString()
    };

    if (io) {
      io.to(`user:${userId}`).emit('notification', payload);
    }

    return payload;
  } catch (error) {
    // Notifications are a nice-to-have on top of the core action that
    // triggered them — never let a failure here bubble up and fail the
    // request that was actually asked for (accepting an errand, sending a
    // message, etc.).
    console.error('Failed to create notification:', error.message);
    return null;
  }
}

module.exports = { notifyUser };
