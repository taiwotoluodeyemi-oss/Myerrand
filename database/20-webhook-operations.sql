-- P9: production-safe asynchronous webhook/notification operations.
-- Additive migration; webhook delivery is strictly outside money/state transactions.
USE errandsplace;

ALTER TABLE webhook_subscriptions
  ADD COLUMN IF NOT EXISTS previous_secret_ciphertext TEXT NULL,
  ADD COLUMN IF NOT EXISTS previous_secret_expires_at TIMESTAMP NULL;

ALTER TABLE webhook_deliveries
  MODIFY COLUMN status ENUM('pending','processing','delivered','retrying','dead_letter') NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_claim
  ON webhook_deliveries(status, next_attempt_at, locked_at);

CREATE TABLE IF NOT EXISTS notification_failures (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT NULL,
  event_type VARCHAR(80) NULL,
  user_id BIGINT NULL,
  channel VARCHAR(30) NOT NULL DEFAULT 'in_app',
  error_code VARCHAR(80) NULL,
  error_message VARCHAR(1000) NULL,
  attempts INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notification_failures_created (created_at),
  INDEX idx_notification_failures_event (event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_outbox_unprocessed
  ON webhook_outbox(processed_at, created_at);
