const crypto = require('crypto');
function getPool() { return require('../config/db.mysql').pool; }

const POLICIES = {
  challenge: { maxFailures: 5, windowMinutes: 15, baseLockMinutes: 1, maxLockMinutes: 60 },
  enrollment: { maxFailures: 5, windowMinutes: 15, baseLockMinutes: 1, maxLockMinutes: 60 },
  recovery: { maxFailures: 5, windowMinutes: 15, baseLockMinutes: 5, maxLockMinutes: 120 },
};

function keyHash(action, userId, ip) {
  return crypto.createHash('sha256').update(`${action}:${userId || 'unknown'}:${ip || 'unknown'}`).digest('hex');
}
function policyFor(action) { return POLICIES[action] || POLICIES.challenge; }
function lockMinutes(failures, policy = POLICIES.challenge) {
  if (failures < policy.maxFailures) return 0;
  return Math.min(policy.maxLockMinutes, policy.baseLockMinutes * (2 ** Math.min(6, failures - policy.maxFailures)));
}

async function check(action, userId, ip) {
  const policy = policyFor(action);
  const hash = keyHash(action, userId, ip);
  const pool = getPool();
  const [rows] = await pool.execute('SELECT failed_count,window_started_at,locked_until FROM admin_mfa_rate_limits WHERE key_hash=? LIMIT 1', [hash]);
  const row = rows[0];
  if (!row) return { allowed: true, remaining: policy.maxFailures };
  const now = Date.now();
  const lockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : 0;
  if (lockedUntil > now) return { allowed: false, retryAfterSeconds: Math.ceil((lockedUntil-now)/1000), remaining: 0 };
  const windowStart = row.window_started_at ? new Date(row.window_started_at).getTime() : now;
  if (now - windowStart > policy.windowMinutes * 60000) return { allowed: true, remaining: policy.maxFailures };
  return { allowed: true, remaining: Math.max(0, policy.maxFailures - Number(row.failed_count || 0)) };
}

async function recordFailure(action, userId, ip) {
  const policy = policyFor(action);
  const hash = keyHash(action, userId, ip);
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT failed_count,window_started_at FROM admin_mfa_rate_limits WHERE key_hash=? LIMIT 1 FOR UPDATE', [hash]);
    const now = new Date();
    let failures = 1;
    let windowStarted = now;
    if (rows[0]) {
      const started = rows[0].window_started_at ? new Date(rows[0].window_started_at).getTime() : Date.now();
      if (Date.now() - started <= policy.windowMinutes * 60000) { failures = Number(rows[0].failed_count || 0) + 1; windowStarted = rows[0].window_started_at; }
    }
    const mins = lockMinutes(failures, policy);
    const lockedUntil = mins ? new Date(Date.now() + mins * 60000) : null;
    await conn.execute(`INSERT INTO admin_mfa_rate_limits (key_hash,action,user_id,ip,failed_count,window_started_at,locked_until,updated_at)
      VALUES (?,?,?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE action=VALUES(action),user_id=VALUES(user_id),ip=VALUES(ip),failed_count=VALUES(failed_count),window_started_at=VALUES(window_started_at),locked_until=VALUES(locked_until),updated_at=NOW()`,
      [hash, action, userId || null, ip || null, failures, windowStarted, lockedUntil]);
    await conn.commit();
    return { failures, locked: !!lockedUntil, retryAfterSeconds: mins * 60 };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

async function recordSuccess(action, userId, ip) {
  const hash = keyHash(action, userId, ip);
  const pool = getPool();
  await pool.execute('DELETE FROM admin_mfa_rate_limits WHERE key_hash=?', [hash]);
}

function requestIp(req) { return req.ip || req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown'; }

module.exports = { POLICIES, lockMinutes, keyHash, check, recordFailure, recordSuccess, requestIp };
