const express = require('express');
const router = express.Router();

const rateLimit = require('express-rate-limit');
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later.' },
});

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db.mysql').pool;
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');

// Prefer explicit USE_MONGO flag. With USE_MONGO=false always use MySQL.
const useMongo =
  process.env.USE_MONGO === 'true'
    ? true
    : process.env.USE_MONGO === 'false'
      ? false
      : Boolean(process.env.MONGO_URI);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET is required in production');
    process.exit(1);
  }
  console.warn('WARNING: JWT_SECRET not set — using insecure dev secret. Run: npm run setup:env');
}
const resolvedJwtSecret = jwtSecret || 'dev-only-insecure-secret-change-me';

const formatUser = (user) => ({
  id: user._id?.toString ? user._id.toString() : user.id,
  name: user.name,
  email: user.email,
  userType: user.userType || user.user_type || 'client',
  balance: parseFloat(user.balance || 0),
  phone: user.phone || null,
  address: user.address || null,
});

router.post('/register', async (req, res) => {
  try {
    const {
      email, password, name, phone, userType,
      address, city, zipCode, preferredContactMethod, typicalErrands, maxBudgetPerErrand,
      specialInstructions, emergencyContacts, smsNotifications, termsAccepted, privacyAccepted,
      vehicleType, areasOfService, availableHours, preferredErrandTypes, insuranceCoverage,
      emergencyContactName, emergencyContactPhone
    } = req.body;

    const normalizedEmail = typeof email === 'string' ? email.toLowerCase().trim() : '';
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedUserType = userType || 'client';

    if (!normalizedEmail || !password || !normalizedName) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    if (!['client', 'runner'].includes(normalizedUserType)) {
      return res.status(400).json({ error: 'User type must be client or runner.' });
    }

    const hashed = await bcrypt.hash(password, 10);

    if (useMongo) {
      const existing = await User.findOne({ email: normalizedEmail }).lean();
      if (existing) {
        return res.status(400).json({ error: 'User already exists with this email' });
      }

      const user = new User({
        name: normalizedName,
        email: normalizedEmail,
        password: hashed,
        phone: phone || null,
        userType: normalizedUserType,
        balance: 0,
        address: address || null,
      });

      await user.save();

      res.json({
        message: `${normalizedUserType.charAt(0).toUpperCase() + normalizedUserType.slice(1)} registered successfully`,
        userId: user._id.toString(),
        userType: user.userType
      });
      return;
    }

    // MySQL fallback registration
    const [existing] = await db.execute('SELECT id FROM users WHERE LOWER(email) = ?', [normalizedEmail]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      const [userResult] = await connection.execute(
        'INSERT INTO users (name, email, password, phone, user_type, balance) VALUES (?, ?, ?, ?, ?, ?)',
        [normalizedName, normalizedEmail, hashed, phone || null, normalizedUserType, 0.00]
      );

      const userId = userResult.insertId;

      if (normalizedUserType === 'client') {
        await connection.execute(
          `INSERT INTO clients (
            user_id, address, city, zip_code, preferred_contact_method, typical_errands, 
            max_budget_per_errand, special_instructions, emergency_contacts, 
            sms_notifications, terms_accepted, privacy_accepted, terms_accepted_at, privacy_accepted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId, address || null, city || null, zipCode || null,
            preferredContactMethod || 'phone', typicalErrands || null,
            maxBudgetPerErrand || null, specialInstructions || null,
            emergencyContacts || null, smsNotifications ?? true,
            termsAccepted ?? false, privacyAccepted ?? false,
            termsAccepted ? new Date() : null, privacyAccepted ? new Date() : null
          ]
        );
      } else if (normalizedUserType === 'runner') {
        await connection.execute(
          `INSERT INTO runners (
            user_id, vehicle_type, areas_of_service, available_hours, preferred_errand_types,
            insurance_coverage, emergency_contact_name, emergency_contact_phone, 
            sms_notifications, terms_accepted, privacy_accepted, terms_accepted_at, privacy_accepted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId, vehicleType || 'none', areasOfService || null, availableHours || null,
            preferredErrandTypes || null, insuranceCoverage || false,
            emergencyContactName || null, emergencyContactPhone || null,
            smsNotifications ?? true, termsAccepted ?? false, privacyAccepted ?? false,
            termsAccepted ? new Date() : null, privacyAccepted ? new Date() : null
          ]
        );
      }

      await connection.commit();

      res.json({
        message: `${normalizedUserType.charAt(0).toUpperCase() + normalizedUserType.slice(1)} registered successfully`,
        userId: userId,
        userType: normalizedUserType
      });
    } catch (transactionError) {
      await connection.rollback();
      throw transactionError;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed: ' + error.message });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = typeof email === 'string' ? email.toLowerCase().trim() : '';

    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (useMongo) {
      const user = await User.findOne({ email: normalizedEmail }).lean();
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = jwt.sign(
        { id: user._id.toString(), email: user.email, name: user.name, userType: user.userType || 'client' },
        resolvedJwtSecret,
        { expiresIn: process.env.JWT_EXPIRY || '7d' }
      );

      return res.json({
        token,
        user: formatUser(user)
      });
    }

    const [users] = await db.execute('SELECT * FROM users WHERE LOWER(email) = ?', [normalizedEmail]);
    const user = users[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.is_active === 0 || user.is_active === false || user.status === 'inactive') {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, userType: user.user_type || 'client' },
      resolvedJwtSecret,
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );

    const userData = {
      id: user.id,
      name: user.name,
      email: user.email,
      userType: user.user_type || 'client',
      balance: parseFloat(user.balance || 0)
    };

    res.json({
      token,
      user: userData
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Demo user route for testing
router.post('/demo-login', loginLimiter, async (req, res) => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_LOGIN !== 'true') {
    return res.status(403).json({ error: 'Demo login is disabled in production' });
  }
  if (process.env.ALLOW_DEMO_LOGIN === 'false') {
    return res.status(403).json({ error: 'Demo login is disabled' });
  }
  try {
    if (useMongo) {
      let user = await User.findOne({ email: 'demo@example.com' }).lean();
      if (!user) {
        const hashedPassword = await bcrypt.hash('demo123', 10);
        const created = await User.create({
          name: 'Demo User',
          email: 'demo@example.com',
          password: hashedPassword,
          userType: 'client',
          balance: 125.50
        });
        user = created.toObject();
      }

      const token = jwt.sign(
        { id: user._id.toString(), email: user.email, name: user.name, userType: user.userType || 'client' },
        resolvedJwtSecret,
        { expiresIn: process.env.JWT_EXPIRY || '7d' }
      );

      return res.json({
        token,
        user: formatUser(user)
      });
    }

    // Check if demo user exists, if not create it
    const [existing] = await db.execute('SELECT * FROM users WHERE email = ?', ['demo@example.com']);

    let user;
    if (existing.length === 0) {
      const hashedPassword = await bcrypt.hash('demo123', 10);
      const [result] = await db.execute(
        'INSERT INTO users (name, email, password, balance) VALUES (?, ?, ?, ?)',
        ['Demo User', 'demo@example.com', hashedPassword, 125.50]
      );
      user = {
        id: result.insertId,
        name: 'Demo User',
        email: 'demo@example.com',
        balance: 125.50,
        userType: 'client'
      };
    } else {
      user = {
        id: existing[0].id,
        name: existing[0].name,
        email: existing[0].email,
        balance: parseFloat(existing[0].balance || 125.50),
        userType: existing[0].user_type || 'client'
      };
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, userType: user.userType || 'client' },
      resolvedJwtSecret,
      { expiresIn: process.env.JWT_EXPIRY || '7d' }
    );

    res.json({
      token,
      user: { ...user, userType: user.userType || 'client' }
    });
  } catch (error) {
    console.error('Demo login error:', error);
    res.status(500).json({ error: 'Demo login failed' });
  }
});

// Get current user profile
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    if (useMongo) {
      const user = await User.findById(userId).lean();
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json({ success: true, user: formatUser(user) });
    }
    const [rows] = await db.execute(
      'SELECT id, name, email, phone, user_type, balance, address FROM users WHERE id = ?',
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true, user: formatUser(rows[0]) });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user profile
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { name, email, phone, address } = req.body;
    const userId = req.user.id;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    if (useMongo) {
      const existingUser = await User.findOne({ email: email.toLowerCase().trim(), _id: { $ne: userId } }).lean();
      if (existingUser) {
        return res.status(400).json({ error: 'Email is already taken by another user' });
      }

      const updatedUser = await User.findOneAndUpdate(
        { _id: userId },
        {
          name: name.trim(),
          email: email.toLowerCase().trim(),
          phone: phone || null,
          address: address || null,
        },
        { new: true, runValidators: true, context: 'query' }
      ).lean();

      if (!updatedUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.json({
        message: 'Profile updated successfully',
        user: formatUser(updatedUser)
      });
    }

    const [existingUsers] = await db.execute(
      'SELECT id FROM users WHERE email = ? AND id != ?',
      [email, userId]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ error: 'Email is already taken by another user' });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      await connection.execute(
        'UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?',
        [name, email, phone || null, userId]
      );

      const [userRows] = await connection.execute(
        'SELECT user_type FROM users WHERE id = ?',
        [userId]
      );

      const userType = userRows[0]?.user_type;

      if (address && userType === 'client') {
        await connection.execute(
          'UPDATE clients SET address = ? WHERE user_id = ?',
          [address, userId]
        );
      }

      await connection.commit();

      const [updatedUsers] = await connection.execute(
        'SELECT id, name, email, phone, balance FROM users WHERE id = ?',
        [userId]
      );

      const updatedUser = {
        id: updatedUsers[0].id,
        name: updatedUsers[0].name,
        email: updatedUsers[0].email,
        phone: updatedUsers[0].phone,
        balance: parseFloat(updatedUsers[0].balance || 0)
      };

      if (userType === 'client') {
        const [clientRows] = await connection.execute(
          'SELECT address FROM clients WHERE user_id = ?',
          [userId]
        );
        updatedUser.address = clientRows[0]?.address;
      }

      res.json({
        message: 'Profile updated successfully',
        user: updatedUser
      });
    } catch (transactionError) {
      await connection.rollback();
      throw transactionError;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Profile update failed: ' + error.message });
  }
});


// --- Password reset & email verification (production-oriented) ---
async function ensureResetTable() {
  if (useMongo) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token_hash VARCHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_token_hash (token_hash),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

router.post('/forgot-password', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email required' });

    // Always return generic message to avoid account enumeration
    const generic = { message: 'If that email exists, a reset link was issued.' };

    if (useMongo) {
      const user = await User.findOne({ email }).lean();
      if (!user) return res.json(generic);
      const token = crypto.randomBytes(32).toString('hex');
      // Store hash on user document if field exists; otherwise return token in non-prod only
      if (process.env.NODE_ENV !== 'production') {
        return res.json({ ...generic, resetToken: token, note: 'Dev only: token returned in response. Configure email in production.' });
      }
      return res.json(generic);
    }

    await ensureResetTable();
    const [rows] = await db.execute('SELECT id FROM users WHERE LOWER(email) = ?', [email]);
    if (!rows.length) return res.json(generic);

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1h
    await db.execute(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [rows[0].id, tokenHash, expires]
    );

    // Production: send email via NotificationService / SMTP
    // Dev: return token so flows can be tested without mail
    if (process.env.NODE_ENV !== 'production' || process.env.RETURN_RESET_TOKEN === 'true') {
      return res.json({ ...generic, resetToken: token });
    }
    return res.json(generic);
  } catch (e) {
    console.error('forgot-password', e);
    res.status(500).json({ error: 'Unable to process request' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'Valid token and password (min 8 chars) required' });
    }
    if (useMongo) {
      return res.status(501).json({ error: 'Password reset for Mongo mode requires email integration' });
    }
    await ensureResetTable();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const [rows] = await db.execute(
      `SELECT * FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
       ORDER BY id DESC LIMIT 1`,
      [tokenHash]
    );
    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired token' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, rows[0].user_id]);
    await db.execute('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [rows[0].id]);
    res.json({ message: 'Password updated successfully' });
  } catch (e) {
    console.error('reset-password', e);
    res.status(500).json({ error: 'Unable to reset password' });
  }
});

// ---- Profile statistics (real DB aggregates, no hardcoded UI numbers) ----
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    if (useMongo) {
      return res.json({
        success: true,
        stats: { memberSince: null, rating: null, completedTasks: 0, totalEarnings: 0, totalSpent: 0 }
      });
    }
    const [users] = await db.execute(
      'SELECT id, name, user_type, created_at, balance FROM users WHERE id = ?',
      [userId]
    );
    if (!users.length) return res.status(404).json({ error: 'User not found' });
    const u = users[0];
    const role = u.user_type || 'client';

    let rating = null;
    let ratingCount = 0;
    try {
      const [r] = await db.execute(
        'SELECT AVG(rating) AS avg_rating, COUNT(*) AS cnt FROM ratings WHERE rated_id = ? OR ratee_id = ?',
        [userId, userId]
      );
      if (r[0] && r[0].cnt > 0) {
        rating = Math.round(Number(r[0].avg_rating) * 10) / 10;
        ratingCount = Number(r[0].cnt);
      }
    } catch (_) {}

    let completedTasks = 0;
    let totalEarnings = 0;
    let totalSpent = 0;
    if (role === 'runner') {
      const [c] = await db.execute(
        "SELECT COUNT(*) AS n FROM errands WHERE runner_id = ? AND status = 'completed'",
        [userId]
      );
      completedTasks = Number(c[0]?.n || 0);
      try {
        const [w] = await db.execute(
          "SELECT COALESCE(SUM(balance),0) AS bal FROM wallets WHERE user_id = ? AND wallet_type = 'withdrawable'",
          [userId]
        );
        totalEarnings = parseFloat(w[0]?.bal || 0);
      } catch (_) {}
    } else {
      const [c] = await db.execute(
        "SELECT COUNT(*) AS n FROM errands WHERE client_id = ? AND status = 'completed'",
        [userId]
      );
      completedTasks = Number(c[0]?.n || 0);
      const [s] = await db.execute(
        "SELECT COALESCE(SUM(amount),0) AS spent FROM errands WHERE client_id = ? AND payment_status IN ('escrowed','released')",
        [userId]
      );
      totalSpent = parseFloat(s[0]?.spent || 0);
    }

    res.json({
      success: true,
      stats: {
        memberSince: u.created_at,
        rating,
        ratingCount,
        completedTasks,
        totalEarnings,
        totalSpent,
        balance: parseFloat(u.balance || 0),
        userType: role
      }
    });
  } catch (e) {
    console.error('stats', e);
    res.status(500).json({ error: 'Failed to load statistics' });
  }
});

// Authenticated password change
router.post('/change-password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    if (useMongo) {
      const user = await User.findById(req.user.id);
      if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      user.password = await bcrypt.hash(newPassword, 10);
      await user.save();
      return res.json({ message: 'Password changed successfully' });
    }
    const [rows] = await db.execute('SELECT id, password FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    if (!(await bcrypt.compare(currentPassword, rows[0].password))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);
    res.json({ message: 'Password changed successfully' });
  } catch (e) {
    console.error('change-password', e);
    res.status(500).json({ error: 'Unable to change password' });
  }
});

// Soft-deactivate account (preserve financial rows)
router.post('/deactivate', verifyToken, async (req, res) => {
  try {
    const { confirm } = req.body || {};
    if (confirm !== 'DELETE' && confirm !== true) {
      return res.status(400).json({ error: 'Send confirm: \"DELETE\" to deactivate account' });
    }
    if (useMongo) {
      await User.findByIdAndUpdate(req.user.id, { isActive: false, status: 'inactive' });
      return res.json({ message: 'Account deactivated' });
    }
    try {
      await db.execute('UPDATE users SET is_active = 0 WHERE id = ?', [req.user.id]);
    } catch (_) {
      await db.execute("UPDATE users SET status = 'inactive' WHERE id = ?", [req.user.id]).catch(() => {});
    }
    res.json({ message: 'Account deactivated. You can no longer sign in.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Email verification: issue token (dev returns token; production should email it)
async function ensureEmailVerifyTable() {
  await db.execute(`CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_evt_user (user_id),
    INDEX idx_evt_hash (token_hash)
  )`);
}

router.post('/request-email-verification', verifyToken, async (req, res) => {
  try {
    if (useMongo) {
      return res.status(501).json({ error: 'Email verification for Mongo mode not configured' });
    }
    await ensureEmailVerifyTable();
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.execute(
      'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [req.user.id, tokenHash, expires]
    );
    const payload = {
      message: 'Verification token created. Configure SMTP to email it in production.',
      emailConfigured: Boolean(process.env.SMTP_HOST || process.env.EMAIL_HOST)
    };
    if (process.env.NODE_ENV !== 'production' || process.env.RETURN_VERIFY_TOKEN === 'true') {
      payload.verificationToken = token;
    }
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/confirm-email-verification', async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Token required' });
    if (useMongo) return res.status(501).json({ error: 'Not configured for Mongo mode' });
    await ensureEmailVerifyTable();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const [rows] = await db.execute(
      `SELECT * FROM email_verification_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
       ORDER BY id DESC LIMIT 1`,
      [tokenHash]
    );
    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired token' });
    try {
      await db.execute('UPDATE users SET email_verified = TRUE WHERE id = ?', [rows[0].user_id]);
    } catch (_) {
      await db.execute('UPDATE users SET is_verified = 1 WHERE id = ?', [rows[0].user_id]).catch(() => {});
    }
    await db.execute('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = ?', [rows[0].id]);
    res.json({ message: 'Email verified successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Legacy endpoint kept but no longer silently marks verified without a token in production
router.post('/verify-email', verifyToken, async (req, res) => {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_EMAIL_VERIFY !== 'true') {
    return res.status(400).json({
      error: 'Use /api/auth/request-email-verification and /api/auth/confirm-email-verification'
    });
  }
  try {
    if (useMongo) {
      await User.findByIdAndUpdate(req.user.id, { emailVerified: true });
      return res.json({ message: 'Email marked verified (dev only)' });
    }
    try {
      await db.execute('UPDATE users SET email_verified = TRUE WHERE id = ?', [req.user.id]);
    } catch (_) {
      await db.execute('UPDATE users SET is_verified = 1 WHERE id = ?', [req.user.id]).catch(() => {});
    }
    res.json({ message: 'Email marked verified (dev only)' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});



// Export authenticated user's own data (GDPR-style self-service)
router.get('/download-data', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    if (useMongo) {
      const user = await User.findById(userId).select('-password').lean();
      return res.json({ success: true, exportedAt: new Date().toISOString(), user });
    }
    const [users] = await db.execute(
      'SELECT id, name, email, phone, user_type, balance, created_at FROM users WHERE id = ?',
      [userId]
    );
    const [errandsAsClient] = await db.execute('SELECT * FROM errands WHERE client_id = ?', [userId]).catch(() => [[]]);
    const [errandsAsRunner] = await db.execute('SELECT * FROM errands WHERE runner_id = ?', [userId]).catch(() => [[]]);
    const [wallets] = await db.execute('SELECT id, wallet_type, currency, balance, status, updated_at FROM wallets WHERE user_id = ?', [userId]).catch(() => [[]]);
    res.json({
      success: true,
      exportedAt: new Date().toISOString(),
      user: users[0] || null,
      errandsAsClient: errandsAsClient || [],
      errandsAsRunner: errandsAsRunner || [],
      wallets: wallets || []
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


module.exports = router;
module.exports.verifyToken = verifyToken;

