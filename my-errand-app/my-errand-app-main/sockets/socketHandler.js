const { getJwtSecret } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db.mysql');

module.exports = (io) => {
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) {
        // Allow anonymous connection but mark unauthenticated
        socket.data.user = null;
        return next();
      }
      socket.data.user = jwt.verify(token, getJwtSecret());
      next();
    } catch (e) {
      next(new Error('Unauthorized socket'));
    }
  });

  io.on('connection', (socket) => {
    console.log('Client connected', socket.id, socket.data.user?.id || 'anon');

    socket.on('join', async (room) => {
      if (typeof room !== 'string' || room.length > 128) return;

      if (room.startsWith('user:')) {
        // Only ever your own notification room
        if (!socket.data.user || room !== `user:${socket.data.user.id}`) return;
        return socket.join(room);
      }

      if (room.startsWith('errand:')) {
        if (!socket.data.user) return;
        const errandId = room.slice('errand:'.length);
        if (!/^\d+$/.test(errandId)) return;
        try {
          const [rows] = await pool.execute(
            'SELECT client_id, runner_id FROM errands WHERE id = ?',
            [errandId]
          );
          const errand = rows[0];
          if (!errand) return;
          if (errand.client_id !== socket.data.user.id && errand.runner_id !== socket.data.user.id) {
            return; // not a participant — refuse silently, same as an invalid room
          }
        } catch (e) {
          return;
        }
        return socket.join(room);
      }

      socket.join(room);
    });

    socket.on('leave', (room) => {
      if (typeof room === 'string') socket.leave(room);
    });

    socket.on('updateLocation', (data) => {
      if (!socket.data.user || !data || !data.errandId) return;
      const room = `errand:${data.errandId}`;
      socket.to(room).emit('driverLocationUpdate', {
        errandId: data.errandId,
        lat: data.lat,
        lng: data.lng,
        userId: socket.data.user.id,
        at: new Date().toISOString(),
      });
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected', socket.id);
    });
  });
};
