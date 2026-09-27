-- Admin-only MFA. Additive migration; no existing rows are removed.
USE errandsplace;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_enc TEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enrolled_at DATETIME NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_verified_at DATETIME NULL;
CREATE INDEX IF NOT EXISTS idx_users_mfa_enabled ON users(mfa_enabled, user_type);
CREATE TABLE IF NOT EXISTS admin_mfa_recovery_codes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  code_hash CHAR(64) NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_mfa_code (user_id, code_hash),
  INDEX idx_admin_mfa_recovery_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS admin_mfa_audit (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(80) NOT NULL,
  success TINYINT(1) NOT NULL DEFAULT 1,
  ip VARCHAR(64) NULL,
  details JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_mfa_audit_user (user_id, created_at),
  INDEX idx_admin_mfa_audit_action (action, created_at)
);

CREATE TABLE IF NOT EXISTS admin_mfa_rate_limits (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  key_hash CHAR(64) NOT NULL,
  action VARCHAR(32) NOT NULL,
  user_id INT NULL,
  ip VARCHAR(64) NULL,
  failed_count INT NOT NULL DEFAULT 0,
  window_started_at DATETIME NOT NULL,
  locked_until DATETIME NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_admin_mfa_rate_key (key_hash),
  INDEX idx_admin_mfa_rate_user (user_id, action),
  INDEX idx_admin_mfa_rate_locked (locked_until),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
