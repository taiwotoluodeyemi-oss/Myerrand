require('dotenv').config();
const { pool } = require('../config/db.mysql');

async function columnExists(table, column) {
  const [rows] = await pool.execute(`SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=? LIMIT 1`, [table,column]);
  return rows.length > 0;
}
async function addColumn(table, column, ddl) {
  if (!(await columnExists(table,column))) await pool.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
async function main(){
  await addColumn('runners','verification_status',"ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending'");
  await addColumn('runners','verification_updated_at','TIMESTAMP NULL');
  await addColumn('runners','verification_notes','TEXT NULL');
  await addColumn('markets','require_verified_runners','BOOLEAN NOT NULL DEFAULT FALSE');
  await addColumn('markets','display_name','VARCHAR(160) NULL');
  await addColumn('markets','insurance_mode',"ENUM('off','ack_only') NOT NULL DEFAULT 'off'");
  await pool.execute(`UPDATE runners SET verification_status=CASE WHEN background_check_status='approved' THEN 'approved' WHEN background_check_status='rejected' THEN 'rejected' ELSE 'pending' END WHERE verification_status='pending'`);
  await pool.execute(`UPDATE runners SET verification_updated_at=COALESCE(verification_updated_at,background_check_date), verification_notes=COALESCE(verification_notes,background_check_notes)`);
  await pool.execute(`UPDATE markets SET require_verified_runners=TRUE, display_name=COALESCE(display_name,name) WHERE id='ng-lagos'`);
  await pool.execute(`UPDATE markets SET display_name=COALESCE(display_name,name) WHERE display_name IS NULL`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS policy_versions (id BIGINT AUTO_INCREMENT PRIMARY KEY, policy_type ENUM('terms','privacy','escrow_disclosure','runner_agreement') NOT NULL, version VARCHAR(40) NOT NULL, body TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_policy_version(policy_type,version), INDEX idx_policy_active(policy_type,active,created_at))`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS policy_acceptances (id BIGINT AUTO_INCREMENT PRIMARY KEY,user_id INT NOT NULL,policy_type ENUM('terms','privacy','escrow_disclosure','runner_agreement') NOT NULL,policy_version VARCHAR(40) NOT NULL,accepted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,ip_address VARCHAR(64) NULL,user_agent VARCHAR(512) NULL,UNIQUE KEY uq_policy_acceptance(user_id,policy_type,policy_version),INDEX idx_policy_accept_user(user_id,policy_type,accepted_at),CONSTRAINT fk_policy_accept_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS liability_acknowledgements (id BIGINT AUTO_INCREMENT PRIMARY KEY,user_id INT NOT NULL,market_id VARCHAR(80) NOT NULL,version VARCHAR(40) NOT NULL,accepted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,ip_address VARCHAR(64) NULL,user_agent VARCHAR(512) NULL,UNIQUE KEY uq_liability_ack(user_id,market_id,version),INDEX idx_liability_user_market(user_id,market_id),CONSTRAINT fk_liability_user FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,CONSTRAINT fk_liability_market FOREIGN KEY(market_id) REFERENCES markets(id) ON DELETE CASCADE)`);
  const seeds=[
    ['terms','2026-09','Working draft terms: use the platform lawfully, provide accurate information, honor payments and assigned errands, and comply with applicable law.'],
    ['privacy','2026-09','Working draft privacy policy: My Errand processes account, errand, wallet metadata and optional verification data to operate the marketplace and protect users.'],
    ['escrow_disclosure','2026-09','Client funds are held for the errand. After delivery, funds remain held during the release window; an open dispute freezes release/refund until resolution.'],
    ['runner_agreement','2026-09','Runner agreement: accept only errands you can fulfil, follow platform safety rules, and understand that runner payout is released according to the escrow rules unless a dispute is resolved otherwise.']
  ];
  for (const row of seeds) await pool.execute('INSERT IGNORE INTO policy_versions(policy_type,version,body) VALUES (?,?,?)',row);
  console.log('Stage 7 database migration applied.');
  await pool.end();
}
main().catch(async e=>{console.error(e);try{await pool.end();}catch(_){}process.exit(1)});
