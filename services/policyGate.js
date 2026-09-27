const { pool } = require('../config/db.mysql');

const CLIENT_POLICIES = ['terms', 'privacy', 'escrow_disclosure'];
const RUNNER_POLICIES = ['terms', 'privacy', 'runner_agreement'];

async function currentPolicies(types = ['terms','privacy','escrow_disclosure','runner_agreement']) {
  const placeholders = types.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT policy_type, version, body, created_at FROM policy_versions WHERE active=TRUE AND policy_type IN (${placeholders}) ORDER BY policy_type, created_at DESC`,
    types
  );
  const out = {};
  for (const row of rows) if (!out[row.policy_type]) out[row.policy_type] = row;
  return out;
}

async function missingPolicies(userId, types) {
  const policies = await currentPolicies(types);
  const missing = [];
  for (const type of types) {
    const current = policies[type];
    if (!current) continue;
    const [[accepted]] = await pool.execute(
      'SELECT id FROM policy_acceptances WHERE user_id=? AND policy_type=? AND policy_version=? LIMIT 1',
      [userId, type, current.version]
    );
    if (!accepted) missing.push({ policy_type: type, version: current.version, body: current.body });
  }
  return missing;
}

async function assertPoliciesAccepted(userId, types) {
  const missing = await missingPolicies(userId, types);
  if (missing.length) {
    const error = new Error('Required policy acceptance is missing or out of date');
    error.status = 428;
    error.code = 'POLICY_ACCEPTANCE_REQUIRED';
    error.missing = missing.map(({ policy_type, version }) => ({ policy_type, version }));
    throw error;
  }
}

async function acceptPolicy(userId, policyType, version, req) {
  const policies = await currentPolicies([policyType]);
  const current = policies[policyType];
  if (!current || current.version !== version) {
    const error = new Error('Policy version is not the current active version');
    error.status = 409;
    throw error;
  }
  await pool.execute(
    `INSERT IGNORE INTO policy_acceptances (user_id,policy_type,policy_version,ip_address,user_agent) VALUES (?,?,?,?,?)`,
    [userId, policyType, version, req?.ip || null, String(req?.get?.('user-agent') || '').slice(0,512) || null]
  );
  return current;
}

async function assertLiabilityAccepted(userId, marketId, mode) {
  if (mode !== 'ack_only') return;
  const version = '2026-09';
  const [[row]] = await pool.execute(
    'SELECT id FROM liability_acknowledgements WHERE user_id=? AND market_id=? AND version=? LIMIT 1',
    [userId, marketId, version]
  );
  if (!row) {
    const error = new Error('Liability acknowledgement is required before accepting errands in this market');
    error.status = 428;
    error.code = 'LIABILITY_ACK_REQUIRED';
    error.market_id = marketId;
    error.version = version;
    throw error;
  }
}

async function acceptLiability(userId, marketId, version, req) {
  if (version !== '2026-09') {
    const error = new Error('Liability acknowledgement version is not current');
    error.status = 409;
    throw error;
  }
  await pool.execute(
    `INSERT IGNORE INTO liability_acknowledgements (user_id,market_id,version,ip_address,user_agent) VALUES (?,?,?,?,?)`,
    [userId, marketId, version, req?.ip || null, String(req?.get?.('user-agent') || '').slice(0,512) || null]
  );
}

module.exports = { CLIENT_POLICIES, RUNNER_POLICIES, currentPolicies, missingPolicies, assertPoliciesAccepted, acceptPolicy, assertLiabilityAccepted, acceptLiability };
