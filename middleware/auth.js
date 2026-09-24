const jwt = require('jsonwebtoken');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET is required in production');
    }
    return 'dev-only-insecure-secret-change-me';
  }
  return secret;
}

function verifyToken(req, res, next) {
  const token = req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  try {
    req.user = jwt.verify(token, getJwtSecret());
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const role = req.user.userType || req.user.user_type || req.user.role;
    if (!roles.includes(role)) {
      return res.status(403).json({ error: `Forbidden. Requires role: ${roles.join(' or ')}` });
    }
    next();
  };
}

const requireClient = requireRole('client', 'admin');
const requireRunner = requireRole('runner', 'admin');
const requireAdmin = requireRole('admin');

module.exports = {
  verifyToken,
  requireRole,
  requireClient,
  requireRunner,
  requireAdmin,
  getJwtSecret,
};
