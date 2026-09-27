const express = require('express');
const router = express.Router();
const { pool } = require('../config/db.mysql');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { auditSecurity } = require('../services/securityAudit');
const { currentPolicies, missingPolicies, acceptPolicy, acceptLiability } = require('../services/policyGate');

router.get('/current', async (req,res)=>{
  try {
    const policies = await currentPolicies();
    const out = Object.fromEntries(Object.entries(policies).map(([k,v])=>[k,{version:v.version,body:v.body,created_at:v.created_at}]));
    res.json({success:true,policies:out});
  } catch(e){res.status(500).json({success:false,error:e.message});}
});

router.get('/mine', verifyToken, async (req,res)=>{
  try {
    const policies = await currentPolicies();
    const missing = await missingPolicies(req.user.id,Object.keys(policies));
    const [accepted] = await pool.execute('SELECT policy_type,policy_version,accepted_at FROM policy_acceptances WHERE user_id=? ORDER BY accepted_at DESC',[req.user.id]);
    res.json({success:true,missing:missing.map(x=>({policy_type:x.policy_type,version:x.version})),accepted});
  } catch(e){res.status(500).json({success:false,error:e.message});}
});

router.post('/accept', verifyToken, async (req,res)=>{
  try {
    const { policy_type, version } = req.body || {};
    if (!['terms','privacy','escrow_disclosure','runner_agreement'].includes(policy_type) || !version) return res.status(400).json({success:false,error:'policy_type and version are required'});
    const policy = await acceptPolicy(req.user.id,policy_type,String(version),req);
    res.status(201).json({success:true,accepted:{policy_type:policy.policy_type,version:policy.version,accepted_at:new Date().toISOString()}});
  } catch(e){res.status(e.status||500).json({success:false,error:e.message});}
});

router.post('/liability/ack', verifyToken, async (req,res)=>{
  try {
    const { market_id, version='2026-09' } = req.body || {};
    if (!market_id) return res.status(400).json({success:false,error:'market_id is required'});
    const [[market]] = await pool.execute('SELECT id,insurance_mode FROM markets WHERE id=?',[market_id]);
    if (!market) return res.status(404).json({success:false,error:'Market not found'});
    await acceptLiability(req.user.id,market_id,version,req);
    res.status(201).json({success:true,market_id,version,insurance_mode:market.insurance_mode,acknowledged:true});
  } catch(e){res.status(e.status||500).json({success:false,error:e.message});}
});

router.get('/admin/acceptances', verifyToken, requireAdmin, async (req,res)=>{
  try {
    const [rows] = await pool.execute(`SELECT policy_type,policy_version,COUNT(*) acceptances,MAX(accepted_at) last_accepted_at FROM policy_acceptances GROUP BY policy_type,policy_version ORDER BY policy_type,policy_version DESC`);
    res.json({success:true,acceptances:rows});
  } catch(e){res.status(500).json({success:false,error:e.message});}
});

module.exports=router;
