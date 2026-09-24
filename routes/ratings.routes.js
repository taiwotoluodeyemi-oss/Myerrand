const express = require('express');
const router = express.Router();
const { pool } = require('../config/db.mysql');
const { verifyToken } = require('../middleware/auth');
const { notifyUser } = require('../utils/notify');

const jsonResponse = (res, status, success, data = null, error = null) => {
  res.status(status).json({ success, data, error });
};

async function recomputeAverageRating(userId) {
  const [[{ avg, count }]] = await pool.execute(
    'SELECT AVG(rating) AS avg, COUNT(*) AS count FROM ratings WHERE rated_id = ?',
    [userId]
  );
  const average = avg ? Number(avg).toFixed(2) : '0.00';

  // A user could be a runner, a client, or (rarely) both — update whichever
  // role rows exist for them.
  await pool.execute('UPDATE runners SET average_rating = ? WHERE user_id = ?', [average, userId]);
  await pool.execute('UPDATE clients SET average_rating = ? WHERE user_id = ?', [average, userId]);

  return { average: Number(average), count };
}

// Submit a rating for the other party on a completed errand. Each side can
// rate the other exactly once (enforced by the DB's UNIQUE (errand_id,
// rater_id) constraint too, so this is defense in depth, not the only
// guard).
router.post('/:errand_id', verifyToken, async (req, res) => {
  try {
    const errandId = req.params.errand_id;
    const raterId = req.user.id;
    const { rating, review, communicationRating, punctualityRating, qualityRating } = req.body;

    const ratingNum = parseInt(rating, 10);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return jsonResponse(res, 400, false, null, 'Rating must be an integer from 1 to 5');
    }

    const [rows] = await pool.execute('SELECT * FROM errands WHERE id = ?', [errandId]);
    const errand = rows[0];
    if (!errand) return jsonResponse(res, 404, false, null, 'Errand not found');
    if (errand.status !== 'completed') {
      return jsonResponse(res, 400, false, null, 'You can only rate completed errands');
    }
    if (errand.client_id !== raterId && errand.runner_id !== raterId) {
      return jsonResponse(res, 403, false, null, 'Access denied');
    }

    const ratedId = errand.client_id === raterId ? errand.runner_id : errand.client_id;
    if (!ratedId) {
      return jsonResponse(res, 400, false, null, 'There is no one to rate on this errand');
    }

    const clamp = (v) => (v == null || v === '') ? null : Math.min(5, Math.max(1, parseInt(v, 10)));

    try {
      await pool.execute(
        `INSERT INTO ratings (errand_id, rater_id, rated_id, ratee_id, rating, review, comment, communication_rating, punctuality_rating, quality_rating)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [errandId, raterId, ratedId, ratedId, ratingNum, review || null, review || null, clamp(communicationRating), clamp(punctualityRating), clamp(qualityRating)]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return jsonResponse(res, 409, false, null, 'You already rated this errand');
      }
      throw err;
    }

    const { average, count } = await recomputeAverageRating(ratedId);

    await notifyUser({
      userId: ratedId,
      errandId: Number(errandId),
      title: 'New rating received',
      message: `You received a ${ratingNum}-star rating${review ? ': "' + review.slice(0, 100) + '"' : ''}`,
      type: 'success'
    }, req.app.get('io'));

    jsonResponse(res, 201, true, { ratedUserAverage: average, ratedUserRatingCount: count });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// Ratings given/received for one errand (so the UI knows whether "you"
// still need to rate, and can show what the other side said)
router.get('/errand/:errand_id', verifyToken, async (req, res) => {
  try {
    const errandId = req.params.errand_id;
    const [rows] = await pool.execute('SELECT client_id, runner_id FROM errands WHERE id = ?', [errandId]);
    const errand = rows[0];
    if (!errand) return jsonResponse(res, 404, false, null, 'Errand not found');
    if (errand.client_id !== req.user.id && errand.runner_id !== req.user.id) {
      return jsonResponse(res, 403, false, null, 'Access denied');
    }

    const [ratings] = await pool.execute('SELECT * FROM ratings WHERE errand_id = ?', [errandId]);
    jsonResponse(res, 200, true, { ratings });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

// Public rating summary + recent reviews for a user's profile
router.get('/user/:user_id', verifyToken, async (req, res) => {
  try {
    const userId = req.params.user_id;
    const [[summary]] = await pool.execute(
      'SELECT AVG(rating) AS average, COUNT(*) AS count FROM ratings WHERE rated_id = ?',
      [userId]
    );
    const [reviews] = await pool.execute(
      `SELECT r.rating, r.review, r.communication_rating, r.punctuality_rating, r.quality_rating, r.created_at, u.name AS rater_name
       FROM ratings r JOIN users u ON u.id = r.rater_id
       WHERE r.rated_id = ? ORDER BY r.created_at DESC LIMIT 20`,
      [userId]
    );

    jsonResponse(res, 200, true, {
      average: summary.average ? Number(summary.average).toFixed(2) : null,
      count: summary.count,
      reviews
    });
  } catch (error) {
    jsonResponse(res, 500, false, null, error.message);
  }
});

module.exports = router;
