const { pool } = require('../config/db.mysql');

async function buildFinancialReconciliation({currency=null, actorId=null}={}) {
  const params=[]; const where=currency ? 'WHERE w.currency=?' : ''; if(currency) params.push(String(currency).toUpperCase());
  const [wallets]=await pool.execute(`SELECT w.id,w.user_id,w.wallet_type,w.currency,w.balance FROM wallets w ${where} ORDER BY w.currency,w.id`,params);
  const [ledger]=await pool.execute(`SELECT w.id wallet_id, SUM(CASE WHEN wt.to_wallet_id=w.id THEN wt.amount ELSE 0 END) credits, SUM(CASE WHEN wt.from_wallet_id=w.id THEN wt.amount ELSE 0 END) debits FROM wallets w LEFT JOIN wallet_transactions wt ON (wt.to_wallet_id=w.id OR wt.from_wallet_id=w.id) AND wt.status='completed' WHERE 1=1 ${currency?'AND w.currency=?':''} GROUP BY w.id`,params);
  const ledgerByWallet=new Map(ledger.map(x=>[Number(x.wallet_id),x]));
  const walletRows=wallets.map(w=>{const l=ledgerByWallet.get(Number(w.id))||{credits:0,debits:0}; const ledgerBalance=Number(l.credits||0)-Number(l.debits||0); const balance=Number(w.balance||0); return {...w,balance,ledger_credits:Number(l.credits||0),ledger_debits:Number(l.debits||0),ledger_balance:ledgerBalance,discrepancy:Number((balance-ledgerBalance).toFixed(2))};});
  const discrepancies=walletRows.filter(w=>Math.abs(w.discrepancy)>0.009);
  const [[holds]]=await pool.execute(`SELECT COALESCE(SUM(CASE WHEN status='held' THEN amount ELSE 0 END),0) held_amount, COALESCE(SUM(CASE WHEN status='released' THEN amount ELSE 0 END),0) released_amount, COALESCE(SUM(CASE WHEN status='refunded' THEN amount ELSE 0 END),0) refunded_amount, COUNT(*) total_holds FROM errand_holds ${currency?'WHERE currency=?':''}` ,currency?[String(currency).toUpperCase()]:[]);
  const [[ledgerTotals]]=await pool.execute(`SELECT COALESCE(SUM(CASE WHEN transaction_type='escrow_hold' THEN amount ELSE 0 END),0) ledger_held, COALESCE(SUM(CASE WHEN transaction_type='escrow_release' THEN amount ELSE 0 END),0) ledger_released, COALESCE(SUM(CASE WHEN transaction_type='refund' THEN amount ELSE 0 END),0) ledger_refunded FROM wallet_transactions WHERE status='completed' ${currency?'AND currency=?':''}`,currency?[String(currency).toUpperCase()]:[]);
  const holdDiscrepancies={held:Number(holds.held_amount)-Number(ledgerTotals.ledger_held),released:Number(holds.released_amount)-Number(ledgerTotals.ledger_released),refunded:Number(holds.refunded_amount)-Number(ledgerTotals.ledger_refunded)};
  const holdLedgerMismatch=Object.values(holdDiscrepancies).some(v=>Math.abs(Number(v))>0.009);
  const report={generated_at:new Date().toISOString(),currency:currency?String(currency).toUpperCase():null,wallets:walletRows,totals:{wallet_balance:walletRows.reduce((a,w)=>a+w.balance,0),ledger_net:walletRows.reduce((a,w)=>a+w.ledger_balance,0),held_amount:Number(holds.held_amount),released_amount:Number(holds.released_amount),refunded_amount:Number(holds.refunded_amount),ledger_held:Number(ledgerTotals.ledger_held),ledger_released:Number(ledgerTotals.ledger_released),ledger_refunded:Number(ledgerTotals.ledger_refunded)},discrepancies:{wallets:discrepancies,hold_vs_ledger:holdDiscrepancies},discrepancy_count:discrepancies.length+(holdLedgerMismatch?1:0)};
  await pool.execute('INSERT INTO reconciliation_runs (actor_id,currency,discrepancy_count,report_json) VALUES (?,?,?,?)',[actorId||null,report.currency,report.discrepancy_count,JSON.stringify(report)]);
  return report;
}
module.exports={buildFinancialReconciliation};
