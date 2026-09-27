-- P8 enterprise/API production security hardening. Additive only.


UPDATE organization_api_keys k
JOIN organizations o ON o.id=k.organization_id
SET k.mode=CASE WHEN o.sandbox_flag=TRUE THEN 'sandbox' ELSE 'live' END
WHERE k.mode IS NULL OR k.mode='live';

-- Plaintext sandbox keys cannot be reconstructed after creation. Revoke any
-- pre-P8 sandbox keys rather than allowing a me_live_* credential to cross modes.
UPDATE organization_api_keys k
JOIN organizations o ON o.id=k.organization_id
SET k.active=FALSE, k.revoked_at=COALESCE(k.revoked_at,NOW())
WHERE o.sandbox_flag=TRUE AND k.mode='sandbox';

CREATE INDEX idx_org_api_key_expiry ON organization_api_keys(organization_id,active,expires_at);
CREATE INDEX idx_org_api_key_revoked ON organization_api_keys(revoked_at);

ALTER TABLE webhook_subscriptions
  ADD COLUMN organization_id BIGINT NULL;

UPDATE webhook_subscriptions w
JOIN users u ON u.id=w.user_id
SET w.organization_id=u.active_org_id
WHERE w.organization_id IS NULL AND u.active_org_id IS NOT NULL;

CREATE INDEX idx_webhook_org ON webhook_subscriptions(organization_id,active);

-- Existing user-owned webhook subscriptions remain valid. Organization-owned
-- subscriptions are additionally constrained by the application layer to the
-- authenticated organization/API-key context.

ALTER TABLE merchant_idempotency
  ADD COLUMN request_hash CHAR(64) NULL,
  ADD COLUMN status_code SMALLINT NOT NULL DEFAULT 201;

CREATE INDEX idx_merchant_idem_hash ON merchant_idempotency(user_id,request_hash);

-- Dedicated enterprise API audit trail. Existing audit_logs remains the
-- platform-wide security audit stream.
CREATE TABLE IF NOT EXISTS api_audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  organization_id BIGINT NULL,
  api_key_id BIGINT NULL,
  actor_user_id BIGINT NULL,
  auth_mode ENUM('jwt','api_key') NOT NULL,
  request_id VARCHAR(100) NULL,
  method VARCHAR(10) NOT NULL,
  path VARCHAR(512) NOT NULL,
  action VARCHAR(120) NOT NULL,
  status_code SMALLINT NULL,
  ip VARCHAR(64) NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_api_audit_org_created (organization_id,created_at),
  INDEX idx_api_audit_key_created (api_key_id,created_at),
  INDEX idx_api_audit_actor_created (actor_user_id,created_at)
);
