const jwt = require('jsonwebtoken');
const { pool } = require('../config/db.mysql');
const User = require('../models/User');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production');
    return 'dev-only-insecure-secret-change-me';
  }
  return secret;
}

async function verifyToken(req, res, next) {
  const token = req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    const options = { algorithms: ['HS256'], issuer: process.env.JWT_ISSUER || 'my-errand-api', audience: process.env.JWT_AUDIENCE || 'my-errand-web' };
    const decoded = jwt.verify(token, getJwtSecret(), options);
    if (!decoded?.id || !decoded?.iat) return res.status(401).json({ error: 'Invalid or expired token.' });
    if (process.env.USE_MONGO === 'true') {
      const user = await User.findById(decoded.id).select('status isActive authVersion passwordChangedAt userType').lean();
      if (!user || user.isActive === false || user.status === 'inactive' || user.status === 'suspended') return res.status(401).json({ error: 'Authentication required.' });
      const currentVersion = Number(user.authVersion || 0);
      if (decoded.authVersion === undefined ? currentVersion > 0 : Number(decoded.authVersion) !== currentVersion) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
      if (user.passwordChangedAt && decoded.iat * 1000 < new Date(user.passwordChangedAt).getTime()) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
      req.user = decoded;
      return next();
    }
    const [rows] = await pool.execute('SELECT id,user_type,status,is_active,auth_version,password_changed_at FROM users WHERE id=? LIMIT 1', [decoded.id]);
    const user = rows[0];
    if (!user || user.is_active === 0 || user.status === 'inactive' || user.status === 'suspended') return res.status(401).json({ error: 'Authentication required.' });
    const currentVersion = Number(user.auth_version || 0);
    if (decoded.authVersion === undefined ? currentVersion > 0 : Number(decoded.authVersion) !== currentVersion) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    if (user.password_changed_at && decoded.iat * 1000 < new Date(user.password_changed_at).getTime()) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    if (decoded.userType !== (user.user_type || 'client')) return res.status(401).json({ error: 'Session role is no longer valid.' });
    req.user = decoded;
    return next();
  } catch (_) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function getRole(user) {
  return user?.userType || user?.user_type || user?.role || null;
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    const role = getRole(req.user);
    if (!roles.includes(role)) return res.status(403).json({ error: 'Forbidden.' });
    next();
  };
}

const requireClient = requireRole('client', 'admin');
const requireRunner = requireRole('runner', 'admin');
const requireBusinessUser = requireRole('client', 'business_user', 'admin');
const requireSupport = requireRole('support', 'admin');
const requireAdminBase = requireRole('admin');

function requireAdminMfa(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
  if (getRole(req.user) !== 'admin') return res.status(403).json({ error: 'Forbidden.' });
  if (req.user.mfaVerified !== true) return res.status(403).json({ error: 'Admin MFA verification required.', code: 'ADMIN_MFA_REQUIRED' });
  next();
}
const requireAdmin = requireAdminMfa;

function requireOwnerOrAdmin(getOwnerId) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (getRole(req.user) === 'admin') return next();
    try {
      const ownerId = await getOwnerId(req);
      if (Number(ownerId) !== Number(req.user.id)) return res.status(403).json({ error: 'Forbidden.' });
      next();
    } catch (_) { return res.status(403).json({ error: 'Forbidden.' }); }
  };
}

module.exports = { verifyToken, requireRole, requireClient, requireRunner, requireBusinessUser, requireSupport, requireAdmin, requireAdminBase, requireAdminMfa, requireOwnerOrAdmin, getJwtSecret, getRole };
