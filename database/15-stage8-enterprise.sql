-- Stage 8: enterprise organizations, API keys, sandbox, business receipts, provider modes.

CREATE TABLE IF NOT EXISTS organizations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  market_id VARCHAR(80) NULL,
  owner_user_id INT NOT NULL,
  sandbox_flag BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_org_owner(owner_user_id), INDEX idx_org_market(market_id),
  CONSTRAINT fk_org_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS organization_members (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  user_id INT NOT NULL,
  role ENUM('owner','dispatcher') NOT NULL DEFAULT 'dispatcher',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_org_member (organization_id,user_id),
  INDEX idx_org_member_user(user_id),
  CONSTRAINT fk_org_member_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_org_member_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS organization_api_keys (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  key_prefix VARCHAR(24) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rotated_at TIMESTAMP NULL,
  last_used_at TIMESTAMP NULL,
  UNIQUE KEY uq_org_api_key_hash(key_hash),
  INDEX idx_org_api_key_org(organization_id,active),
  CONSTRAINT fk_org_api_key_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_org_api_key_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE errands ADD COLUMN org_id BIGINT NULL;
ALTER TABLE errands ADD COLUMN po_number VARCHAR(120) NULL;
ALTER TABLE errands ADD COLUMN cost_center VARCHAR(120) NULL;
CREATE INDEX idx_errands_org ON errands(org_id, created_at);

ALTER TABLE markets ADD COLUMN verification_mode ENUM('manual','vendor','off') NOT NULL DEFAULT 'manual';
UPDATE markets SET verification_mode = CASE WHEN require_verified_runners = TRUE THEN 'manual' ELSE 'off' END;

ALTER TABLE users ADD COLUMN active_org_id BIGINT NULL;

CREATE TABLE IF NOT EXISTS organization_audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT NULL,
  actor_user_id INT NULL,
  action VARCHAR(80) NOT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_org_audit(organization_id,created_at),
  CONSTRAINT fk_org_audit_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
  CONSTRAINT fk_org_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);
