-- Stage 7: verification gate, policy versioning, liability acknowledgement, trust analytics.

ALTER TABLE runners ADD COLUMN verification_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending';
ALTER TABLE runners ADD COLUMN verification_updated_at TIMESTAMP NULL;
ALTER TABLE runners ADD COLUMN verification_notes TEXT NULL;
UPDATE runners SET verification_status = CASE
  WHEN background_check_status = 'approved' THEN 'approved'
  WHEN background_check_status = 'rejected' THEN 'rejected'
  ELSE 'pending' END
WHERE verification_status = 'pending';
UPDATE runners SET verification_updated_at = COALESCE(verification_updated_at, background_check_date);
UPDATE runners SET verification_notes = COALESCE(verification_notes, background_check_notes);

ALTER TABLE markets ADD COLUMN require_verified_runners BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE markets ADD COLUMN display_name VARCHAR(160) NULL;
ALTER TABLE markets ADD COLUMN insurance_mode ENUM('off','ack_only') NOT NULL DEFAULT 'off';
UPDATE markets SET require_verified_runners = TRUE, display_name = COALESCE(display_name, name) WHERE id = 'ng-lagos';
UPDATE markets SET display_name = COALESCE(display_name, name) WHERE display_name IS NULL;

CREATE TABLE IF NOT EXISTS policy_versions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  policy_type ENUM('terms','privacy','escrow_disclosure','runner_agreement') NOT NULL,
  version VARCHAR(40) NOT NULL,
  body TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_policy_version (policy_type, version),
  INDEX idx_policy_active (policy_type, active, created_at)
);

CREATE TABLE IF NOT EXISTS policy_acceptances (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  policy_type ENUM('terms','privacy','escrow_disclosure','runner_agreement') NOT NULL,
  policy_version VARCHAR(40) NOT NULL,
  accepted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  UNIQUE KEY uq_policy_acceptance (user_id, policy_type, policy_version),
  INDEX idx_policy_accept_user (user_id, policy_type, accepted_at),
  CONSTRAINT fk_policy_accept_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS liability_acknowledgements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  market_id VARCHAR(80) NOT NULL,
  version VARCHAR(40) NOT NULL,
  accepted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  UNIQUE KEY uq_liability_ack (user_id, market_id, version),
  INDEX idx_liability_user_market (user_id, market_id),
  CONSTRAINT fk_liability_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_liability_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
);

INSERT IGNORE INTO policy_versions (policy_type,version,body) VALUES
('terms','2026-09','Working draft terms: use the platform lawfully, provide accurate information, honor payments and assigned errands, and comply with applicable law.'),
('privacy','2026-09','Working draft privacy policy: My Errand processes account, errand, wallet metadata and optional verification data to operate the marketplace and protect users.'),
('escrow_disclosure','2026-09','Client funds are held for the errand. After delivery, funds remain held during the release window; an open dispute freezes release/refund until resolution.'),
('runner_agreement','2026-09','Runner agreement: accept only errands you can fulfil, follow platform safety rules, and understand that runner payout is released according to the escrow rules unless a dispute is resolved otherwise.');
