const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { pool } = require('../config/db.mysql');
const { auditSecurity } = require('./securityAudit');

function anonymizedEmail(id) { return `deactivated+${Number(id)}@invalid.myerrand`; }
function anonymizedName(id) { return `Deactivated User ${Number(id)}`; }
function retentionDays(value, fallback = 365) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

async function deactivateMySqlAccount(userId, req = null) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[user]] = await connection.execute('SELECT id,email,user_type FROM users WHERE id=? FOR UPDATE', [userId]);
    if (!user) { const e = new Error('Account not found'); e.status = 404; throw e; }
    const [runnerRows] = await connection.execute('SELECT id,id_document_path FROM runners WHERE user_id=? LIMIT 1', [userId]);
    const documentPath = runnerRows[0]?.id_document_path || null;
    await connection.execute(`UPDATE users SET name=?, email=?, phone=NULL, address=NULL, city=NULL, state=NULL, profile_image=NULL, is_active=0, status='inactive', auth_version=auth_version+1, deactivated_at=NOW(), anonymized_at=NOW() WHERE id=?`, [anonymizedName(userId), anonymizedEmail(userId), userId]);
    await connection.execute(`UPDATE runners SET emergency_contact_name=NULL, emergency_contact_phone=NULL, emergency_contact_relationship=NULL, id_document_path=NULL, verification_notes=NULL, background_check_notes=NULL, anonymized_at=NOW() WHERE user_id=?`, [userId]);
    await connection.execute(`UPDATE notifications SET message='Notification retained without personal content.' WHERE user_id=?`, [userId]).catch(()=>{});
    await connection.commit();
    if (documentPath) {
      const absolute = path.resolve(__dirname, '..', documentPath.replace(/^\//, ''));
      const root = path.resolve(__dirname, '..', 'uploads', 'verification');
      if (absolute.startsWith(root + path.sep)) await fs.unlink(absolute).catch(()=>{});
    }
    await auditSecurity({actorId:userId, action:'account_deactivated_privacy', targetType:'user', targetId:userId, details:{personal_data_anonymized:true,financial_records_preserved:true}, req});
    return { deactivated:true, financial_records_preserved:true, personal_data_anonymized:true };
  } catch (e) { await connection.rollback().catch(()=>{}); throw e; }
  finally { connection.release(); }
}

function safeExportColumns() {
  return ['id','status','payment_status','market_id','zone','channel','created_at','paid_at','accepted_at','picked_up_at','delivered_at','completed_at','cancelled_at','disputed_at'];
}
function csvEscape(v) { return `"${String(v ?? '').replace(/"/g,'""')}"`; }
function buildSafeCsv(rows) {
  const columns = safeExportColumns();
  return [columns.join(','), ...rows.map(r => columns.map(k => csvEscape(r[k])).join(','))].join('\n') + '\n';
}

async function logSensitiveAccess({ actorId, targetType, targetId, purpose, req }) {
  await pool.execute(`INSERT INTO privacy_access_audit (actor_user_id,target_type,target_id,purpose,ip_address,user_agent) VALUES (?,?,?,?,?,?)`, [actorId,targetType,targetId,String(purpose||'').slice(0,255),req?.ip||null,String(req?.get?.('user-agent')||'').slice(0,512)||null]);
}

module.exports = { deactivateMySqlAccount, safeExportColumns, buildSafeCsv, logSensitiveAccess, retentionDays };
