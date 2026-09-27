-- Stage 6: notifier providers, payment disputes, growth credits, waitlist, SLA incidents.
USE errandsplace;

ALTER TABLE wallet_transactions
  MODIFY COLUMN transaction_type ENUM('deposit','withdrawal','transfer','earning','payment','refund','fee','conversion','escrow_hold','escrow_release','gift_card_issue','gift_card_redeem','referral_bonus','promo_credit','platform_loss') NOT NULL;

CREATE TABLE IF NOT EXISTS growth_config (
  id TINYINT PRIMARY KEY,
  credit_value DECIMAL(15,2) NOT NULL DEFAULT 500,
  credit_currency VARCHAR(10) NOT NULL DEFAULT 'NGN'
);
INSERT IGNORE INTO growth_config (id,credit_value,credit_currency) VALUES (1,500,'NGN');

CREATE TABLE IF NOT EXISTS referral_codes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  code VARCHAR(32) NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_referral_user (user_id),
  CONSTRAINT fk_referral_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS referral_attributions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  referrer_user_id INT NOT NULL,
  referee_user_id INT NOT NULL,
  code VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_referral_attribution_referee (referee_user_id),
  CONSTRAINT fk_ref_attr_referrer FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ref_attr_referee FOREIGN KEY (referee_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  referrer_user_id INT NOT NULL,
  referee_user_id INT NOT NULL,
  errand_id INT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_referral_referee (referee_user_id),
  CONSTRAINT fk_ref_reward_referrer FOREIGN KEY (referrer_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ref_reward_referee FOREIGN KEY (referee_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ref_reward_errand FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS promo_codes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  credit_type ENUM('fixed','percent') NOT NULL,
  credit_value DECIMAL(15,4) NOT NULL,
  max_redemptions INT NOT NULL DEFAULT 1,
  expires_at TIMESTAMP NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  promo_id BIGINT NOT NULL,
  user_id INT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_promo_user (promo_id,user_id),
  CONSTRAINT fk_promo_redemption_promo FOREIGN KEY (promo_id) REFERENCES promo_codes(id) ON DELETE CASCADE,
  CONSTRAINT fk_promo_redemption_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS zone_waitlist (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  zone VARCHAR(120) NOT NULL,
  market_id VARCHAR(80) NULL,
  name VARCHAR(160) NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_waitlist_zone (market_id,zone,created_at)
);

CREATE TABLE IF NOT EXISTS payment_disputes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  errand_id INT NULL,
  deposit_id VARCHAR(160) NULL,
  opened_by INT NOT NULL,
  case_type VARCHAR(40) NOT NULL DEFAULT 'payment_dispute',
  status ENUM('open','evidence','won','lost','withdrawn') NOT NULL DEFAULT 'open',
  reason_code VARCHAR(80) NOT NULL,
  note TEXT NOT NULL,
  resolution_note TEXT NULL,
  resolved_by INT NULL,
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_payment_dispute_status (status,created_at),
  INDEX idx_payment_dispute_errand (errand_id),
  CONSTRAINT fk_payment_dispute_errand FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE SET NULL,
  CONSTRAINT fk_payment_dispute_opener FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_payment_dispute_resolver FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sla_incidents (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  market_id VARCHAR(80) NOT NULL,
  zone VARCHAR(120) NULL,
  severity ENUM('none','degraded','outage') NOT NULL DEFAULT 'degraded',
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  created_by INT NULL,
  INDEX idx_sla_incident_market (market_id,created_at),
  CONSTRAINT fk_sla_incident_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE,
  CONSTRAINT fk_sla_incident_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS market_sla_targets (
  market_id VARCHAR(80) PRIMARY KEY,
  target_accept_minutes DECIMAL(10,2) NOT NULL DEFAULT 20,
  target_completion_rate DECIMAL(8,4) NOT NULL DEFAULT 0.85,
  target_dispute_rate_max DECIMAL(8,4) NOT NULL DEFAULT 0.05,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sla_target_market FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
);

INSERT IGNORE INTO market_sla_targets (market_id) SELECT id,20,0.85,0.05 FROM markets;
