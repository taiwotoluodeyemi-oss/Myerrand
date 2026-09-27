-- My Errand Stage 5: webhook outbox, webhook subscriptions/deliveries, and event-linked notifications.
-- Additive only. Run after database/11-stage4-market-merchant.sql.

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  url VARCHAR(2048) NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_status VARCHAR(30) NULL,
  last_error TEXT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_webhook_sub_user (user_id, active),
  CONSTRAINT fk_webhook_sub_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS webhook_outbox (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_key VARCHAR(190) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  errand_id INT NULL,
  payload_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  INDEX idx_webhook_outbox_pending (processed_at, created_at),
  INDEX idx_webhook_outbox_errand (errand_id),
  UNIQUE KEY uq_webhook_event_key (event_key),
  CONSTRAINT fk_webhook_outbox_errand FOREIGN KEY (errand_id) REFERENCES errands(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  outbox_id BIGINT NOT NULL,
  subscription_id BIGINT NOT NULL,
  status ENUM('pending','delivered','dead') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT NULL,
  response_code INT NULL,
  sent_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_webhook_delivery (outbox_id, subscription_id),
  INDEX idx_webhook_delivery_due (status, next_attempt_at),
  INDEX idx_webhook_delivery_dead (status, created_at),
  CONSTRAINT fk_webhook_delivery_outbox FOREIGN KEY (outbox_id) REFERENCES webhook_outbox(id) ON DELETE CASCADE,
  CONSTRAINT fk_webhook_delivery_sub FOREIGN KEY (subscription_id) REFERENCES webhook_subscriptions(id) ON DELETE CASCADE
);

ALTER TABLE notifications ADD COLUMN source_event_id BIGINT NULL;
ALTER TABLE notifications ADD UNIQUE KEY uq_notification_source (source_event_id, user_id, type);
