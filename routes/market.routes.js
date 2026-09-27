const express = require('express');
const { pool } = require('../config/db.mysql');
const { MARKETS } = require('../config/marketplace');
const { MIN_SAMPLE_JOBS } = require('../config/marketplace');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const router = express.Router();

async function loadMarket(id) {
  const [rows] = await pool.execute('SELECT id,name,display_name,country_iso2,default_currency,zones_json,status,supply_gate_runners,support_email,require_verified_runners,insurance_mode,verification_mode FROM markets WHERE id=?',[id]);
  const r=rows[0];
  if (!r) return MARKETS.find(x=>x.id===id) || null;
  return {...r,display_name:r.display_name||r.name,zones:typeof r.zones_json==='string'?JSON.parse(r.zones_json):r.zones_json,defaultCurrency:r.default_currency,supply_gate:r.supply_gate_runners,require_verified_runners:Boolean(r.require_verified_runners),insurance_mode:r.insurance_mode||'off',verification_mode:r.verification_mode||'manual'};
}

async function reliability(market) {
  const zones=market.zones||[]; const ph=zones.map(()=>'?').join(',')||"''";
  const params=[...zones,market.id];
  const [rows]=await pool.execute(`SELECT COUNT(*) jobs_paid,SUM(CASE WHEN accepted_at IS NOT NULL THEN 1 ELSE 0 END) jobs_accepted,SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) jobs_completed FROM errands WHERE zone IN (${ph}) AND (market_id=? OR market_id IS NULL) AND created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY)`,params);
  const [accepts]=await pool.execute(`SELECT TIMESTAMPDIFF(SECOND,paid_at,accepted_at)/60 minutes FROM errands WHERE zone IN (${ph}) AND (market_id=? OR market_id IS NULL) AND paid_at IS NOT NULL AND accepted_at IS NOT NULL AND created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY)`,params);
  const [disputes]=await pool.execute(`SELECT COUNT(DISTINCT d.errand_id) n FROM errand_disputes d JOIN errands e ON e.id=d.errand_id WHERE e.zone IN (${ph}) AND (e.market_id=? OR e.market_id IS NULL) AND d.created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY)`,params);
  const paid=Number(rows[0]?.jobs_paid||0), accepted=Number(rows[0]?.jobs_accepted||0), completed=Number(rows[0]?.jobs_completed||0);
  if(paid<MIN_SAMPLE_JOBS)return {status:'insufficient_data',sample_size:paid,min_sample_jobs:MIN_SAMPLE_JOBS,window_days:30};
  const vals=accepts.map(x=>Number(x.minutes)).filter(Number.isFinite).sort((a,b)=>a-b); const mid=Math.floor(vals.length/2); const med=vals.length?(vals.length%2?vals[mid]:(vals[mid-1]+vals[mid])/2):null;
  return {status:'ok',sample_size:paid,completion_rate:accepted?completed/accepted:null,median_accept_minutes:med,dispute_rate:accepted?Number(disputes[0]?.n||0)/accepted:null,window_days:30};
}

router.get('/',async(req,res)=>{try{const [rows]=await pool.execute('SELECT id,name,display_name,country_iso2,default_currency,zones_json,status,supply_gate_runners,support_email,require_verified_runners,insurance_mode,verification_mode FROM markets ORDER BY name'); const out=rows.length?rows.map(r=>({...r,display_name:r.display_name||r.name,zones:typeof r.zones_json==='string'?JSON.parse(r.zones_json):r.zones_json,defaultCurrency:r.default_currency,supply_gate:r.supply_gate_runners,require_verified_runners:Boolean(r.require_verified_runners),insurance_mode:r.insurance_mode||'off',verification_mode:r.verification_mode||'manual'})):MARKETS; res.json({success:true,markets:out});}catch(e){res.json({success:true,markets:MARKETS});}});
router.get('/:id/reliability',async(req,res)=>{try{const m=await loadMarket(req.params.id);if(!m)return res.status(404).json({success:false,error:'Market not found'});res.json({success:true,...await reliability(m)});}catch(e){res.status(500).json({success:false,error:e.message});}});
router.get('/:id/sla',async(req,res)=>{
  try { const m=await loadMarket(req.params.id); if(!m)return res.status(404).json({success:false,error:'Market not found'}); const metrics=await reliability(m); const [[t]]=await pool.execute('SELECT * FROM market_sla_targets WHERE market_id=?',[m.id]); const [incidents]=await pool.execute(`SELECT * FROM sla_incidents WHERE market_id=? ORDER BY created_at DESC LIMIT 20`,[m.id]); if(metrics.status==='insufficient_data') return res.json({success:true,status:'insufficient_data',market:{id:m.id,name:m.name},targets:t||null,metrics,incidents}); const targets=t||{target_accept_minutes:20,target_completion_rate:.85,target_dispute_rate_max:.05}; const checks={accept:metrics.median_accept_minutes==null?null:metrics.median_accept_minutes<=Number(targets.target_accept_minutes),completion:metrics.completion_rate==null?null:metrics.completion_rate>=Number(targets.target_completion_rate),dispute:metrics.dispute_rate==null?null:metrics.dispute_rate<=Number(targets.target_dispute_rate_max)}; const status=Object.values(checks).every(v=>v===true)?'met':'missed'; res.json({success:true,status,market:{id:m.id,name:m.name},targets,metrics,checks,incidents}); }
  catch(e){res.status(500).json({success:false,error:e.message});}
});
router.get('/:id/incidents',async(req,res)=>{try{const [rows]=await pool.execute('SELECT * FROM sla_incidents WHERE market_id=? ORDER BY created_at DESC LIMIT 100',[req.params.id]);res.json({success:true,incidents:rows});}catch(e){res.status(500).json({success:false,error:e.message});}});
router.post('/:id/incidents',verifyToken,requireAdmin,async(req,res)=>{try{const {severity='degraded',message,zone=null}=req.body||{};if(!['none','degraded','outage'].includes(severity)||!message)return res.status(400).json({success:false,error:'severity and message are required'});const [r]=await pool.execute('INSERT INTO sla_incidents (market_id,zone,severity,message,created_by) VALUES (?,?,?,?,?)',[req.params.id,zone,severity,message,req.user.id]);res.status(201).json({success:true,id:r.insertId});}catch(e){res.status(500).json({success:false,error:e.message});}});
router.post('/:id/incidents/:incidentId/resolve',verifyToken,requireAdmin,async(req,res)=>{try{const [r]=await pool.execute('UPDATE sla_incidents SET resolved_at=NOW() WHERE id=? AND market_id=? AND resolved_at IS NULL',[req.params.incidentId,req.params.id]);res.json({success:r.affectedRows>0});}catch(e){res.status(500).json({success:false,error:e.message});}});
router.get('/:id',async(req,res)=>{try{const m=await loadMarket(req.params.id);if(!m)return res.status(404).json({success:false,error:'Market not found'});res.json({success:true,market:m});}catch(e){res.status(500).json({success:false,error:e.message});}});


router.get('/:id/trust-policy', verifyToken, async (req,res)=>{
  try {
    const m=await loadMarket(req.params.id);
    if(!m) return res.status(404).json({success:false,error:'Market not found'});
    res.json({success:true,market:{id:m.id,display_name:m.display_name,require_verified_runners:Boolean(m.require_verified_runners),verification_mode:m.verification_mode||'manual',insurance_mode:m.insurance_mode||'off'}});
  } catch(e){res.status(500).json({success:false,error:e.message});}
});

module.exports=router;
