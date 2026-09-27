require('dotenv').config();
const { pool } = require('../config/db.mysql');

(async()=>{
  const statements = [
    `CREATE TABLE IF NOT EXISTS financial_operations (id BIGINT AUTO_INCREMENT PRIMARY KEY, operation_key VARCHAR(255) NOT NULL, operation_type VARCHAR(64) NOT NULL, status ENUM('processing','completed','failed') NOT NULL DEFAULT 'processing', result_json JSON NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMP NULL, UNIQUE KEY uq_financial_operation_key (operation_key), INDEX idx_financial_operation_status (status, created_at))`,
    `CREATE TABLE IF NOT EXISTS payment_intents (id BIGINT AUTO_INCREMENT PRIMARY KEY, reference VARCHAR(255) NOT NULL, user_id INT NOT NULL, amount DECIMAL(15,2) NOT NULL, currency VARCHAR(10) NOT NULL, provider VARCHAR(40) NOT NULL, status ENUM('initialized','completed','failed') NOT NULL DEFAULT 'initialized', is_demo TINYINT(1) NOT NULL DEFAULT 0, gateway_transaction_id VARCHAR(255) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TIMESTAMP NULL, UNIQUE KEY uq_payment_intent_reference (reference), INDEX idx_payment_intent_user (user_id, created_at), CONSTRAINT fk_payment_intent_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS reconciliation_runs (id BIGINT AUTO_INCREMENT PRIMARY KEY, run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, actor_id INT NULL, currency VARCHAR(10) NULL, discrepancy_count INT NOT NULL DEFAULT 0, report_json JSON NOT NULL, INDEX idx_reconciliation_run_at (run_at), CONSTRAINT fk_reconciliation_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL)`,
  ];
  for (const sql of statements) await pool.query(sql);
  const [idx] = await pool.query(`SELECT COUNT(*) n FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='wallet_transactions' AND index_name='uq_wallet_gateway_reference'`);
  if (Number(idx[0].n)===0) {
    const [dups]=await pool.query(`SELECT COUNT(*) n FROM (SELECT payment_gateway,gateway_transaction_id FROM wallet_transactions WHERE payment_gateway IS NOT NULL AND gateway_transaction_id IS NOT NULL AND gateway_transaction_id<>'' GROUP BY payment_gateway,gateway_transaction_id HAVING COUNT(*)>1) d`);
    if(Number(dups[0].n)>0) throw new Error('Duplicate gateway payment references exist; migration stopped without deleting or rewriting financial history. Reconcile those rows first.');
    await pool.query(`ALTER TABLE wallet_transactions ADD UNIQUE KEY uq_wallet_gateway_reference (payment_gateway, gateway_transaction_id)`);
  }
  for (const [table,index,ddl] of [
    ['wallet_transactions','idx_wallet_errand_type','ALTER TABLE wallet_transactions ADD INDEX idx_wallet_errand_type (errand_id, transaction_type, created_at)'],
    ['errand_holds','idx_hold_status_due','ALTER TABLE errand_holds ADD INDEX idx_hold_status_due (status, held_at, released_at, refunded_at)'],
  ]) { const [r]=await pool.query(`SELECT COUNT(*) n FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?`,[table,index]); if(Number(r[0].n)===0) await pool.query(ddl); }
  console.log('Money integrity migration applied');
})().catch(e=>{console.error('Money integrity migration failed:',e.message);process.exitCode=1}).finally(async()=>{try{await pool.end()}catch{}});
