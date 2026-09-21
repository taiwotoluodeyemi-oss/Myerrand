const express = require('express');
const router = express.Router();

/** @deprecated Use POST /api/auth/register with userType: "runner" and POST /api/auth/login */
router.post('/register', (req, res) => {
  res.status(410).json({
    error: 'Deprecated endpoint',
    message: 'Use POST /api/auth/register with body.userType = "runner"',
  });
});

router.post('/login', (req, res) => {
  res.status(410).json({
    error: 'Deprecated endpoint',
    message: 'Use POST /api/auth/login',
  });
});

module.exports = router;
