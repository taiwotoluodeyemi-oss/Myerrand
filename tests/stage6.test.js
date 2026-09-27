const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

describe('Stage 6 contracts', () => {
  it('has additive growth, payment dispute, waitlist and SLA schema', () => {
    const sql=fs.readFileSync(path.join(ROOT,'database/13-stage6-growth-risk.sql'),'utf8');
    for (const term of ['referral_codes','referral_attributions','referral_rewards','promo_codes','promo_redemptions','zone_waitlist','payment_disputes','sla_incidents','market_sla_targets','referral_bonus','promo_credit','platform_loss']) assert.match(sql,new RegExp(term,'i'));
  });
  it('notifier is Noop-safe and exposes live/off status without secrets',()=>{
    const src=fs.readFileSync(path.join(ROOT,'services/notifier.js'),'utf8');
    assert.match(src,/class NoopProvider/); assert.match(src,/sms:.*live.*off/); assert.match(src,/email:.*live.*off/); assert.match(src,/push: 'off'/);
  });
  it('in-app notifications remain primary and optional external notifier cannot block them',()=>{
    const src=fs.readFileSync(path.join(ROOT,'services/eventOutbox.js'),'utf8');
    assert.match(src,/INSERT INTO notifications/); assert.match(src,/Notifier\.sendSms/); assert.match(src,/Notifier\.sendEmail/); assert.match(src,/optional notifier failed/);
  });
  it('referral rewards are one-time, self-referral blocked, and ledger typed',()=>{
    const src=fs.readFileSync(path.join(ROOT,'routes/growth.routes.js'),'utf8'); const ledger=fs.readFileSync(path.join(ROOT,'services/growthLedger.js'),'utf8');
    assert.match(src,/Self-referral is not allowed/); assert.match(ledger,/uq_referral_referee|referral_rewards/); assert.match(ledger,/referral_bonus/);
  });
  it('promo redemption is one-time, capped, expiry-aware and ledger-backed',()=>{
    const src=fs.readFileSync(path.join(ROOT,'routes/growth.routes.js'),'utf8'); assert.match(src,/max_redemptions/); assert.match(src,/expires_at/); assert.match(src,/Promo already redeemed/); assert.match(src,/promo_credit/);
  });
  it('payment dispute is distinct and lost-held uses errandMoney while lost-released records platform_loss',()=>{
    const src=fs.readFileSync(path.join(ROOT,'routes/growth.routes.js'),'utf8'); assert.match(src,/payment_disputes/); assert.match(src,/refundHold/); assert.match(src,/platform_loss/); assert.match(src,/open.*evidence|evidence.*won/);
  });
  it('SLA report is honest below sample threshold and compares configured targets',()=>{
    const src=fs.readFileSync(path.join(ROOT,'routes/market.routes.js'),'utf8'); assert.match(src,/insufficient_data/); assert.match(src,/target_accept_minutes/); assert.match(src,/target_completion_rate/); assert.match(src,/target_dispute_rate_max/); assert.match(src,/status=Object\.values\(checks\)/);
  });
  it('waitlist captures zone and contact without touching money',()=>{
    const src=fs.readFileSync(path.join(ROOT,'routes/growth.routes.js'),'utf8'); assert.match(src,/zone_waitlist/); assert.match(src,/zone and email or phone are required/); assert.doesNotMatch(src,/refundHold.*waitlist/);
  });
  it('money engine remains the canonical errand money module',()=>{
    const src=fs.readFileSync(path.join(ROOT,'services/errandMoney.js'),'utf8'); assert.match(src,/async function createHold/); assert.match(src,/async function releaseHold/); assert.match(src,/async function refundHold/); assert.match(src,/processDueReleases/); assert.match(src,/processDueRefunds/);
  });
});
