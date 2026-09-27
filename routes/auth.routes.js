const express = require('express');
const router = express.Router();
const { recordLoginFailure } = require('../services/observability');
const { deactivateMySqlAccount } = require('../services/privacy');

const rateLimit = require('express-rate-limit');
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later.' },
});
const registerLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many registration attempts, try again later.' } });
const passwordResetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many password reset attempts, try again later.' } });
const passwordResetConfirmLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many password reset attempts, try again later.' } });
const emailVerificationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many verification requests, try again later.' } });

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db.mysql').pool;
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');
const { auditSecurity } = require('../services/securityAudit');
const { requireAdminBase } = require('../middleware/auth');
const { generateSecret, verifyTotp, encryptSecret, decryptSecret, generateRecoveryCodes, hashRecoveryCode, otpauthUri } = require('../services/adminMfa');
const { check: checkMfaRate, recordFailure: recordMfaFailure, recordSuccess: recordMfaSuccess, requestIp: mfaRequestIp } = require('../services/adminMfaRateLimit');

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
const JWT_ISSUER = process.env.JWT_ISSUER || 'my-errand-api';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'my-errand-web';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '2h';
function signAccessToken(user) {
  return jwt.sign(
    { mfaVerified: user.mfaVerified === true, id: user.id ?? user._id?.toString(), email: user.email, name: user.name, userType: user.userType || user.user_type || 'client', authVersion: Number(user.auth_version || user.authVersion || 0) },
    resolvedJwtSecret,
    { expiresIn: JWT_EXPIRY, issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
  );
}
function passwordPolicy(password) {
  const pwd = String(password || '');
  return pwd.length >= 10 && /[A-Z]/.test(pwd) && /[a-z]/.test(pwd) && /[0-9]/.test(pwd) && /[^A-Za-z0-9]/.test(pwd);
}


const formatUser = (user) => ({
  id: user._id?.toString ? user._id.toString() : user.id,
  name: user.name,
  email: user.email,
  userType: user.userType || user.user_type || 'client',
  balance: parseFloat(user.balance || 0),
  phone: user.phone || null,
  address: user.address || null,
});

router.post('/register', registerLimiter, async (req, res) => {
  try {
    const {
      email, password, name, phone, userType,
      address, city, zipCode, preferredContactMethod, typicalErrands, maxBudgetPerErrand,
      specialInstructions, emergencyContacts, smsNotifications, termsAccepted, privacyAccepted,
      vehicleType, areasOfService, availableHours, preferredErrandTypes, insuranceCoverage,
      emergencyContactName, emergencyContactPhone, serviceZones, referralCode
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

    if (normalizedUserType === 'runner' && !String(serviceZones || areasOfService || '').trim()) {
      return res.status(400).json({ error: 'Runner service zone is required.' });
    }

    // Strong password: min 8 chars, upper, lower, number, special character
    const pwd = String(password);
    if (!passwordPolicy(pwd)) {
      return res.status(400).json({
        error: 'Password must be at least 10 characters and include uppercase, lowercase, a number, and a special character.'
      });
    }

    // Normalize max_budget_per_errand to a number (DECIMAL column) or null
    const parseMaxBudget = (val) => {
      if (val === null || val === undefined || val === '') return null;
      if (typeof val === 'number' && Number.isFinite(val)) return val;
      const s = String(val).trim().toLowerCase();
      const rangeMap = {
        'under-25': 25, '25-50': 50, '50-100': 100, '100-200': 200, 'over-200': 500,
        'under-10000': 10000, '10000-25000': 25000, '25000-50000': 50000,
        '50000-100000': 100000, 'over-100000': 250000
      };
      if (rangeMap[s] != null) return rangeMap[s];
      const n = parseFloat(s.replace(/[^0-9.]/g, ''));
      return Number.isFinite(n) ? n : null;
    };
    const maxBudget = parseMaxBudget(maxBudgetPerErrand);

    // Combine emergency name + phone if frontend sent them separately
    let emergencyContactsValue = emergencyContacts || null;
    if (!emergencyContactsValue && (emergencyContactName || emergencyContactPhone)) {
      emergencyContactsValue = [emergencyContactName, emergencyContactPhone]
        .map((s) => (s || '').trim())
        .filter(Boolean)
        .join(' | ') || null;
    }

    const hashed = await bcrypt.hash(password, 12);

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

      if (referralCode) {
        const normalizedReferral = String(referralCode).trim().toUpperCase();
        const [[ref]] = await connection.execute('SELECT user_id, active FROM referral_codes WHERE code=? LIMIT 1', [normalizedReferral]);
        if (ref && Number(ref.user_id) !== Number(userId) && ref.active) {
          await connection.execute('INSERT INTO referral_attributions (referrer_user_id, referee_user_id, code) VALUES (?,?,?)', [ref.user_id, userId, normalizedReferral]);
        }
      }

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
            maxBudget, specialInstructions || null,
            emergencyContactsValue, smsNotifications ?? true,
            termsAccepted ?? false, privacyAccepted ?? false,
            termsAccepted ? new Date() : null, privacyAccepted ? new Date() : null
          ]
        );
      } else if (normalizedUserType === 'runner') {
        await connection.execute(
          `INSERT INTO runners (
            user_id, vehicle_type, areas_of_service, service_zones, available_hours, preferred_errand_types,
            insurance_coverage, emergency_contact_name, emergency_contact_phone, 
            sms_notifications, terms_accepted, privacy_accepted, terms_accepted_at, privacy_accepted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId, vehicleType || 'none', areasOfService || serviceZones || null, serviceZones || areasOfService || null,
            availableHours || null, preferredErrandTypes || null, insuranceCoverage || false,
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

      const token = signAccessToken({ ...user, id: user._id.toString(), userType: user.userType, authVersion: user.authVersion, mfaVerified: user.userType !== 'admin' ? true : false });

      return res.json({
        token,
        user: formatUser(user)
      });
    }

    const [users] = await db.execute('SELECT * FROM users WHERE LOWER(email) = ?', [normalizedEmail]);
    const user = users[0];
    if (user?.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      recordLoginFailure();
      await auditSecurity({action:'login_failure_locked',targetType:'user',targetId:user.id,details:{email:normalizedEmail},req});
      return res.status(429).json({ error: 'Too many failed login attempts. Try again later.' });
    }
    const passwordMatches = user ? await bcrypt.compare(password, user.password) : false;
    if (!user || !passwordMatches) {
      if (user) {
        await db.execute(`UPDATE users SET failed_login_attempts = failed_login_attempts + 1, locked_until = CASE WHEN failed_login_attempts + 1 >= 10 THEN DATE_ADD(NOW(), INTERVAL 1 HOUR) WHEN failed_login_attempts + 1 >= 5 THEN DATE_ADD(NOW(), INTERVAL 15 MINUTE) ELSE locked_until END WHERE id = ?`, [user.id]);
      }
      recordLoginFailure();
      await auditSecurity({action:'login_failure',targetType:'user',targetId:user?.id||null,details:{email:normalizedEmail},req});
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    await db.execute('UPDATE users SET failed_login_attempts=0, locked_until=NULL WHERE id=?', [user.id]);
    if (user.is_active === 0 || user.is_active === false || user.status === 'inactive') {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    const token = signAccessToken({ ...user, userType: user.user_type, authVersion: user.auth_version, mfaVerified: user.user_type !== 'admin' ? true : false });

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


// Admin-only MFA enrollment/challenge. Admins authenticate with the normal password first,
// then receive an MFA-pending token until enrollment/challenge succeeds.
router.get('/admin/mfa/status', verifyToken, requireAdminBase, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT mfa_enabled, mfa_enrolled_at, mfa_last_verified_at FROM users WHERE id=? AND user_type=\'admin\' LIMIT 1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Admin account not found.' });
    res.json({ success: true, enabled: !!rows[0].mfa_enabled, enrolledAt: rows[0].mfa_enrolled_at, lastVerifiedAt: rows[0].mfa_last_verified_at });
  } catch (_) { res.status(500).json({ error: 'Unable to load MFA status.' }); }
});

router.post('/admin/mfa/enroll', verifyToken, requireAdminBase, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT email,mfa_enabled FROM users WHERE id=? AND user_type=\'admin\' LIMIT 1', [req.user.id]);
    const admin = rows[0];
    if (!admin) return res.status(404).json({ error: 'Admin account not found.' });
    if (Number(admin.mfa_enabled) === 1) return res.status(409).json({ error: 'MFA is already enabled.' });
    const secret = generateSecret();
    await db.execute('UPDATE users SET mfa_secret_enc=? WHERE id=? AND user_type=\'admin\'', [encryptSecret(secret), req.user.id]);
    await auditSecurity({actorId:req.user.id, action:'admin_mfa_enrollment_started', targetType:'user', targetId:req.user.id, details:{}, req});
    res.json({ success:true, secret, otpauthUri:otpauthUri(admin.email, secret), message:'Scan the secret with an authenticator app, then verify it to activate MFA.' });
  } catch (_) { res.status(500).json({ error: 'Unable to start MFA enrollment.' }); }
});

router.post('/admin/mfa/enroll/verify', verifyToken, requireAdminBase, async (req, res) => {
  try {
    const gate = await checkMfaRate('enrollment', req.user.id, mfaRequestIp(req));
    if (!gate.allowed) return res.status(429).json({ error: 'Too many MFA enrollment attempts. Try again later.', retryAfterSeconds: gate.retryAfterSeconds });
    const [rows] = await db.execute('SELECT id,email,auth_version,mfa_enabled,mfa_secret_enc FROM users WHERE id=? AND user_type=\'admin\' LIMIT 1', [req.user.id]);
    const admin = rows[0];
    if (!admin) return res.status(404).json({ error: 'Admin account not found.' });
    if (Number(admin.mfa_enabled) === 1) return res.status(409).json({ error: 'MFA is already enabled.' });
    if (!admin.mfa_secret_enc) return res.status(400).json({ error: 'Start MFA enrollment first.' });
    const secret = decryptSecret(admin.mfa_secret_enc);
    if (!verifyTotp(secret, req.body?.code)) { await recordMfaFailure('enrollment', req.user.id, mfaRequestIp(req)); await auditSecurity({actorId:req.user.id, action:'admin_mfa_enrollment_failed', targetType:'user', targetId:req.user.id, req}); return res.status(401).json({ error:'Invalid MFA code.' }); }
    await recordMfaSuccess('enrollment', req.user.id, mfaRequestIp(req));
    const recoveryCodes = generateRecoveryCodes();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('UPDATE users SET mfa_enabled=1,mfa_enrolled_at=NOW(),mfa_last_verified_at=NOW(),auth_version=auth_version+1 WHERE id=? AND user_type=\'admin\'', [req.user.id]);
      for (const code of recoveryCodes) await conn.execute('INSERT INTO admin_mfa_recovery_codes (user_id,code_hash) VALUES (?,?)',[req.user.id,hashRecoveryCode(code)]);
      await conn.commit();
    } catch(e) { await conn.rollback(); throw e; } finally { conn.release(); }
    await auditSecurity({actorId:req.user.id, action:'admin_mfa_enabled', targetType:'user', targetId:req.user.id, details:{recoveryCodesIssued:recoveryCodes.length}, req});
    const token = signAccessToken({id:admin.id,email:admin.email,userType:'admin',authVersion:Number(admin.auth_version||0)+1,mfaVerified:true});
    res.json({success:true,token,recoveryCodes,message:'Store recovery codes securely. They are shown only once.'});
  } catch (e) { console.error('MFA enrollment verify',e); res.status(500).json({error:'Unable to enable MFA.'}); }
});

router.post('/admin/mfa/challenge', verifyToken, requireAdminBase, async (req, res) => {
  try {
    const action = req.body?.recoveryCode ? 'recovery' : 'challenge';
    const gate = await checkMfaRate(action, req.user.id, mfaRequestIp(req));
    if (!gate.allowed) return res.status(429).json({ error: 'Too many MFA attempts. Try again later.', retryAfterSeconds: gate.retryAfterSeconds });
    const [rows] = await db.execute('SELECT id,email,auth_version,mfa_enabled,mfa_secret_enc FROM users WHERE id=? AND user_type=\'admin\' LIMIT 1',[req.user.id]);
    const admin=rows[0];
    if (!admin || Number(admin.mfa_enabled)!==1) return res.status(400).json({error:'Admin MFA is not enabled.'});
    let valid=false, recoveryUsed=false;
    if (req.body?.code && /^\d{6}$/.test(String(req.body.code))) {
      valid=verifyTotp(decryptSecret(admin.mfa_secret_enc), req.body.code);
    } else if (req.body?.recoveryCode) {
      const conn=await db.getConnection();
      try {
        await conn.beginTransaction();
        const [codes]=await conn.execute('SELECT id FROM admin_mfa_recovery_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL LIMIT 1 FOR UPDATE',[req.user.id,hashRecoveryCode(req.body.recoveryCode)]);
        if(codes[0]) { await conn.execute('UPDATE admin_mfa_recovery_codes SET used_at=NOW() WHERE id=? AND used_at IS NULL',[codes[0].id]); valid=true; recoveryUsed=true; }
        await conn.commit();
      } catch(e){await conn.rollback();throw e;} finally{conn.release();}
    }
    if(!valid){await recordMfaFailure(action, req.user.id, mfaRequestIp(req)); await auditSecurity({actorId:req.user.id,action:'admin_mfa_challenge_failed',targetType:'user',targetId:req.user.id,req});return res.status(401).json({error:'Invalid MFA challenge.'});}
    await recordMfaSuccess(action, req.user.id, mfaRequestIp(req));
    await db.execute('UPDATE users SET mfa_last_verified_at=NOW() WHERE id=?',[req.user.id]);
    await auditSecurity({actorId:req.user.id,action:recoveryUsed?'admin_mfa_recovery_used':'admin_mfa_challenge_success',targetType:'user',targetId:req.user.id,details:{recoveryUsed},req});
    const token=signAccessToken({id:admin.id,email:admin.email,userType:'admin',authVersion:Number(admin.auth_version||0),mfaVerified:true});
    res.json({success:true,token,user:{id:admin.id,email:admin.email,userType:'admin'},recoveryUsed});
  } catch(e){console.error('MFA challenge',e);res.status(500).json({error:'Unable to verify MFA.'});}
});

router.post('/admin/mfa/recovery/regenerate', verifyToken, requireAdminBase, async (req,res)=>{
  try {
    if(req.user.mfaVerified!==true) return res.status(403).json({error:'MFA verification required.'});
    const [rows]=await db.execute('SELECT id FROM users WHERE id=? AND user_type=\'admin\' AND mfa_enabled=1',[req.user.id]);
    if(!rows[0]) return res.status(400).json({error:'Admin MFA is not enabled.'});
    const codes=generateRecoveryCodes(); const conn=await db.getConnection();
    try{await conn.beginTransaction();await conn.execute('DELETE FROM admin_mfa_recovery_codes WHERE user_id=?',[req.user.id]);for(const code of codes)await conn.execute('INSERT INTO admin_mfa_recovery_codes(user_id,code_hash) VALUES(?,?)',[req.user.id,hashRecoveryCode(code)]);await conn.commit();}catch(e){await conn.rollback();throw e;}finally{conn.release();}
    await auditSecurity({actorId:req.user.id,action:'admin_mfa_recovery_regenerated',targetType:'user',targetId:req.user.id,details:{count:codes.length},req});
    res.json({success:true,recoveryCodes:codes,message:'Store recovery codes securely. They are shown only once.'});
  }catch(e){res.status(500).json({error:'Unable to regenerate recovery codes.'});}
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

      const token = signAccessToken({ ...user, id: user._id.toString(), userType: user.userType, authVersion: user.authVersion });

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

    const token = signAccessToken(user);

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
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_token_hash (token_hash),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
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
    if (process.env.NODE_ENV !== 'production') {
      return res.json({ ...generic, resetToken: token });
    }
    return res.json(generic);
  } catch (e) {
    console.error('forgot-password', e);
    res.status(500).json({ error: 'Unable to process request' });
  }
});

router.post('/reset-password', passwordResetConfirmLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !passwordPolicy(newPassword)) {
      return res.status(400).json({ error: 'Valid token and password (min 10 chars with upper/lower/number/special) required' });
    }
    if (useMongo) {
      return res.status(501).json({ error: 'Password reset for Mongo mode requires email integration' });
    }
    await ensureResetTable();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const conn = await db.getConnection();
    let resetUserId = null;
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute(`SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() ORDER BY id DESC LIMIT 1 FOR UPDATE`, [tokenHash]);
      if (!rows.length) { await conn.rollback(); return res.status(400).json({ error: 'Invalid or expired token' }); }
      resetUserId = rows[0].user_id;
      const hashed = await bcrypt.hash(newPassword, 12);
      await conn.execute('UPDATE users SET password = ?, password_changed_at = NOW(), auth_version = auth_version + 1, failed_login_attempts=0, locked_until=NULL WHERE id = ?', [hashed, rows[0].user_id]);
      await conn.execute('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ? AND used_at IS NULL', [rows[0].id]);
      await conn.execute('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [rows[0].user_id]);
      await conn.commit();
    } catch (txErr) { await conn.rollback(); throw txErr; } finally { conn.release(); }
    await auditSecurity({action:'password_reset_success',targetType:'user',targetId:resetUserId,req});
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
    if (!passwordPolicy(newPassword)) {
      return res.status(400).json({ error: 'New password must be at least 10 characters and include uppercase, lowercase, a number, and a special character.' });
    }
    if (useMongo) {
      const user = await User.findById(req.user.id);
      if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      user.password = await bcrypt.hash(newPassword, 12);
      user.passwordChangedAt = new Date();
      user.authVersion = Number(user.authVersion || 0) + 1;
      await user.save();
      await auditSecurity({action:'password_change',targetType:'user',targetId:req.user.id,req});
      return res.json({ message: 'Password changed successfully. Please sign in again.' });
    }
    const [rows] = await db.execute('SELECT id, password FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    if (!(await bcrypt.compare(currentPassword, rows[0].password))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const hashed = await bcrypt.hash(newPassword, 12);
    await db.execute('UPDATE users SET password = ?, password_changed_at = NOW(), auth_version = auth_version + 1, failed_login_attempts=0, locked_until=NULL WHERE id = ?', [hashed, req.user.id]);
    await db.execute('UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=? AND used_at IS NULL', [req.user.id]).catch(() => {});
    await auditSecurity({action:'password_change',targetType:'user',targetId:req.user.id,req});
    res.json({ message: 'Password changed successfully. Please sign in again.' });
  } catch (e) {
    console.error('change-password', e);
    res.status(500).json({ error: 'Unable to change password' });
  }
});

// Stateless JWT logout is implemented by revoking the user's current auth version.
router.post('/logout', verifyToken, async (req, res) => {
  try {
    if (useMongo) {
      await User.findByIdAndUpdate(req.user.id, { $inc: { authVersion: 1 } });
    } else {
      await db.execute('UPDATE users SET auth_version = auth_version + 1 WHERE id = ?', [req.user.id]);
    }
    await auditSecurity({ action: 'logout', targetType: 'user', targetId: req.user.id, req });
    return res.json({ message: 'Logged out successfully.' });
  } catch (e) {
    return res.status(500).json({ error: 'Unable to log out' });
  }
});

// Privacy-aware account deactivation. Financial/accounting records remain intact; unnecessary profile and verification data are anonymized/removed.
router.post('/deactivate', verifyToken, async (req, res) => {
  try {
    const { confirm } = req.body || {};
    if (confirm !== 'DELETE' && confirm !== true) return res.status(400).json({ error: 'Send confirm: \"DELETE\" to deactivate account' });
    if (useMongo) {
      await User.findByIdAndUpdate(req.user.id, { isActive: false, status: 'inactive', authVersion: { $inc: 1 }, deactivatedAt: new Date() });
      await auditSecurity({actorId:req.user.id,action:'account_deactivated_privacy',targetType:'user',targetId:req.user.id,details:{financial_records_preserved:true,personal_data_anonymized:false,mongo_mode:true},req});
      return res.json({ message: 'Account deactivated. Financial records are retained where required.' });
    }
    const result = await deactivateMySqlAccount(req.user.id, req);
    res.json({ message: 'Account deactivated. You can no longer sign in.', ...result });
  } catch (e) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message });
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

router.post('/request-email-verification', verifyToken, emailVerificationLimiter, async (req, res) => {
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
    if (process.env.NODE_ENV !== 'production') {
      payload.verificationToken = token;
    }
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message });
  }
});

router.post('/confirm-email-verification', async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Token required' });
    if (useMongo) return res.status(501).json({ error: 'Not configured for Mongo mode' });
    await ensureEmailVerifyTable();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute(`SELECT * FROM email_verification_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() ORDER BY id DESC LIMIT 1 FOR UPDATE`, [tokenHash]);
      if (!rows.length) { await conn.rollback(); return res.status(400).json({ error: 'Invalid or expired token' }); }
      try {
        await conn.execute('UPDATE users SET email_verified = TRUE WHERE id = ?', [rows[0].user_id]);
      } catch (_) {
        await conn.execute('UPDATE users SET is_verified = 1 WHERE id = ?', [rows[0].user_id]).catch(() => {});
      }
      await conn.execute('UPDATE email_verification_tokens SET used_at = NOW() WHERE id = ? AND used_at IS NULL', [rows[0].id]);
      await conn.commit();
    } catch (txErr) { await conn.rollback(); throw txErr; } finally { conn.release(); }
    res.json({ message: 'Email verified successfully' });
  } catch (e) {
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message });
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
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message });
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
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Request failed' : e.message });
  }
});


module.exports = router;
module.exports.verifyToken = verifyToken;

