-- My Errand Phase 0-2 money/state migration.
-- Prefer scripts/apply-money-state.js for safe conditional application.
USE errandsplace;

ALTER TABLE errands
  MODIFY COLUMN status ENUM('pending','paid','accepted','picked_up','delivered','completed','cancelled','disputed','assigned','in_progress') NOT NULL DEFAULT 'pending';

ALTER TABLE errands ADD COLUMN paid_at TIMESTAMP NULL;
ALTER TABLE errands ADD COLUMN picked_up_at TIMESTAMP NULL;
ALTER TABLE errands ADD COLUMN delivered_at TIMESTAMP NULL;
ALTER TABLE errands ADD COLUMN disputed_at TIMESTAMP NULL;

CREATE TABLE IF NOT EXISTS errand_holds (
  id INT AUTO_INCREMENT PRIMARY KEY,
  errand_id INT NOT NULL,
  client_id INT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  status ENUM('held','released','refunded') NOT NULL DEFAULT 'held',
  held_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at TIMESTAMP NULL,
  refunded_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_errand_hold (errand_id),
  INDEX idx_hold_status (status),
  INDEX idx_hold_client (client_id),
  CONSTRAINT fk_hold_errand FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE CASCADE,
  CONSTRAINT fk_hold_client FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS errand_disputes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  errand_id INT NOT NULL,
  opened_by INT NOT NULL,
  reason_code VARCHAR(64) NOT NULL,
  note TEXT NOT NULL,
  status ENUM('open','resolved') NOT NULL DEFAULT 'open',
  resolution_code VARCHAR(64) NULL,
  resolution_note TEXT NULL,
  resolved_by INT NULL,
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dispute_errand (errand_id),
  INDEX idx_dispute_status (status),
  CONSTRAINT fk_dispute_errand FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE CASCADE,
  CONSTRAINT fk_dispute_opener FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_dispute_resolver FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE wallet_transactions
  ADD COLUMN actor_id INT NULL,
  ADD COLUMN reason TEXT NULL,
  ADD COLUMN is_demo TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE wallet_transactions
  MODIFY COLUMN transaction_type ENUM('deposit','withdrawal','transfer','earning','payment','refund','fee','conversion','escrow_hold','escrow_release','gift_card_issue','gift_card_redeem') NOT NULL;

-- Preserve existing legacy rows. New money logic uses canonical status values.
UPDATE errands SET paid_at = COALESCE(paid_at, updated_at) WHERE payment_status IN ('paid','escrowed','released','refunded') AND paid_at IS NULL;
UPDATE errands SET accepted_at = COALESCE(accepted_at, assigned_at) WHERE status IN ('assigned','in_progress','completed') AND accepted_at IS NULL;
UPDATE errands SET picked_up_at = COALESCE(picked_up_at, started_at) WHERE status IN ('in_progress','completed') AND picked_up_at IS NULL;
UPDATE errands SET completed_at = COALESCE(completed_at, updated_at) WHERE status = 'completed' AND completed_at IS NULL;
