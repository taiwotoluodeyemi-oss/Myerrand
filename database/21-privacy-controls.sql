-- P11 privacy/compliance operations. Operational controls only; not a legal-compliance certification.
USE errandsplace;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at DATETIME NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS anonymized_at DATETIME NULL;
ALTER TABLE runners ADD COLUMN IF NOT EXISTS anonymized_at DATETIME NULL;
ALTER TABLE runners ADD COLUMN IF NOT EXISTS verification_retention_until DATETIME NULL;
ALTER TABLE policy_acceptances ADD COLUMN IF NOT EXISTS accepted_ip_hash CHAR(64) NULL;

CREATE TABLE IF NOT EXISTS privacy_retention_policies (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  data_category VARCHAR(100) NOT NULL,
  classification ENUM('public','operational','financial','sensitive') NOT NULL,
  retention_days INT NULL,
  reason VARCHAR(255) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_privacy_retention_category(data_category)
);

CREATE TABLE IF NOT EXISTS privacy_access_audit (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_user_id INT NULL,
  target_type VARCHAR(80) NOT NULL,
  target_id BIGINT NULL,
  purpose VARCHAR(255) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_privacy_access_created(created_at),
  INDEX idx_privacy_access_target(target_type,target_id),
  CONSTRAINT fk_privacy_access_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO privacy_retention_policies (data_category,classification,retention_days,reason) VALUES
('account_profile','operational',365,'Retain only as long as needed for account support and abuse prevention; deactivation anonymizes it.'),
('errand_operational_data','operational',730,'Operational history and dispute support.'),
('financial_ledger','financial',2555,'Financial/accounting record retention period requires legal review.'),
('payment_gateway_records','financial',2555,'Payment reconciliation and dispute handling; requires legal review.'),
('verification_documents','sensitive',90,'Short-lived manual-review material; exact period requires legal review.'),
('verification_decisions','sensitive',730,'Trust/safety audit trail; exact period requires legal review.'),
('policy_acceptance','operational',2555,'Proof of version acceptance; exact period requires legal review.'),
('notifications','operational',365,'User notification history; minimize content on deactivation.')
ON DUPLICATE KEY UPDATE classification=VALUES(classification),retention_days=VALUES(retention_days),reason=VALUES(reason);
