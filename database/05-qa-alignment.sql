
-- Authoritative alignment for My Errand App (idempotent where possible)

-- Wallets: allow multiple types per user
ALTER TABLE wallets DROP INDEX user_id;
-- ignore error if FK prevents; try rename unique
ALTER TABLE wallets ADD UNIQUE KEY uniq_user_type_currency (user_id, wallet_type, currency);

-- Errands payment helpers
ALTER TABLE errands ADD COLUMN is_paid TINYINT(1) DEFAULT 0;
ALTER TABLE errands ADD COLUMN accepted_at TIMESTAMP NULL;

-- Runners verification
ALTER TABLE runners ADD COLUMN background_check_status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE runners ADD COLUMN background_check_date TIMESTAMP NULL;
ALTER TABLE runners ADD COLUMN background_check_notes TEXT NULL;
ALTER TABLE runners ADD COLUMN identity_verified TINYINT(1) DEFAULT 0;
ALTER TABLE runners ADD COLUMN id_document_path VARCHAR(512) NULL;

-- Messages: support both content and read_at used by routes
ALTER TABLE messages ADD COLUMN content TEXT NULL;
ALTER TABLE messages ADD COLUMN read_at TIMESTAMP NULL;
-- Backfill content from message if present
UPDATE messages SET content = message WHERE content IS NULL AND message IS NOT NULL;

-- Notifications
ALTER TABLE notifications ADD COLUMN read_at TIMESTAMP NULL;

-- Wallet transactions
ALTER TABLE wallet_transactions ADD COLUMN processed_at TIMESTAMP NULL;
ALTER TABLE wallet_transactions ADD COLUMN original_amount DECIMAL(15,2) NULL;
ALTER TABLE wallet_transactions ADD COLUMN original_currency VARCHAR(10) NULL;
ALTER TABLE wallet_transactions ADD COLUMN exchange_rate DECIMAL(12,6) DEFAULT 1;
ALTER TABLE wallet_transactions ADD COLUMN conversion_fee DECIMAL(15,2) DEFAULT 0;

-- Withdrawal methods
CREATE TABLE IF NOT EXISTS withdrawal_methods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  method_type VARCHAR(50) NOT NULL,
  method_name VARCHAR(255),
  account_details TEXT,
  is_verified TINYINT(1) DEFAULT 0,
  is_default TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wm_user (user_id)
);

-- Gift cards
CREATE TABLE IF NOT EXISTS gift_cards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'USD',
  status VARCHAR(32) DEFAULT 'active',
  issued_by INT NULL,
  redeemed_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  redeemed_at TIMESTAMP NULL,
  INDEX idx_gc_code (code)
);

-- Progress
CREATE TABLE IF NOT EXISTS errand_progress (
  id INT AUTO_INCREMENT PRIMARY KEY,
  errand_id INT NOT NULL,
  runner_id INT NOT NULL,
  status_note VARCHAR(255),
  notes TEXT,
  latitude DECIMAL(10,8) NULL,
  longitude DECIMAL(11,8) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ep_errand (errand_id)
);

CREATE TABLE IF NOT EXISTS errand_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  errand_id INT NOT NULL,
  uploader_id INT NOT NULL,
  file_path VARCHAR(512) NOT NULL,
  file_name VARCHAR(255),
  mime_type VARCHAR(128),
  file_size INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ef_errand (errand_id)
);


-- Align progress file columns with routes/errands.routes.js
ALTER TABLE errand_progress ADD COLUMN notes TEXT NULL;
ALTER TABLE errand_files ADD COLUMN progress_id INT NULL;
ALTER TABLE errand_files ADD COLUMN file_type VARCHAR(32) NULL;
ALTER TABLE errand_files ADD COLUMN file_name VARCHAR(255) NULL;
ALTER TABLE errand_files ADD COLUMN file_size INT NULL;
ALTER TABLE errand_files ADD COLUMN mime_type VARCHAR(128) NULL;

-- Users soft-delete / verification flags
ALTER TABLE users ADD COLUMN is_active TINYINT(1) DEFAULT 1;
ALTER TABLE users ADD COLUMN email_verified TINYINT(1) DEFAULT 0;
ALTER TABLE users ADD COLUMN status VARCHAR(32) DEFAULT 'active';

-- Ratings dual naming
ALTER TABLE ratings ADD COLUMN rated_id INT NULL;
ALTER TABLE ratings ADD COLUMN ratee_id INT NULL;
ALTER TABLE ratings ADD COLUMN review TEXT NULL;
ALTER TABLE ratings ADD COLUMN comment TEXT NULL;
