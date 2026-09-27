const express = require('express');
const router = express.Router();
const { pool } = require('../config/db.mysql');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { auditSecurity } = require('../services/securityAudit');
const { deactivateMySqlAccount, buildSafeCsv } = require('../services/privacy');

router.get('/mine', verifyToken, async (req,res)=>{
  try {
    const [[u]] = await pool.execute('SELECT id,status,is_active,deactivated_at,anonymized_at FROM users WHERE id=?',[req.user.id]);
    const [retention] = await pool.execute('SELECT data_category,retention_days,reason FROM privacy_retention_policies WHERE active=1 ORDER BY data_category');
    res.json({success:true,account:u||null,retention});
  } catch(e){res.status(500).json({success:false,error:'Request failed'});}
});

router.post('/deactivate', verifyToken, async (req,res)=>{
  try {
    if(req.body?.confirm !== 'DELETE') return res.status(400).json({success:false,error:'Send confirm: DELETE to deactivate account'});
    const result = await deactivateMySqlAccount(req.user.id, req);
    res.json({success:true,...result});
  } catch(e){res.status(e.status||500).json({success:false,error:process.env.NODE_ENV==='production'?'Request failed':e.message});}
});

router.get('/export/errands', verifyToken, async (req,res)=>{
  try {
    const [rows] = await pool.execute(`SELECT id,status,payment_status,market_id,zone,channel,created_at,paid_at,accepted_at,picked_up_at,delivered_at,completed_at,cancelled_at,disputed_at FROM errands WHERE client_id=? OR runner_id=? ORDER BY created_at DESC LIMIT 5000`,[req.user.id,req.user.id]);
    const csv=buildSafeCsv(rows);
    await auditSecurity({actorId:req.user.id,action:'privacy_export',targetType:'user',targetId:req.user.id,details:{export:'errands',rows:rows.length,personal_fields_excluded:true},req});
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="myerrand-privacy-export.csv"`);
    res.send(csv);
  } catch(e){res.status(500).json({success:false,error:'Export failed'});}
});

router.get('/admin/access-audit', verifyToken, requireAdmin, async (req,res)=>{
  try { const [rows]=await pool.execute(`SELECT id,actor_user_id,target_type,target_id,purpose,ip_address,created_at FROM privacy_access_audit ORDER BY created_at DESC LIMIT 200`); res.json({success:true,rows}); }
  catch(e){res.status(500).json({success:false,error:'Request failed'});}
});

module.exports=router;
