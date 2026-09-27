-- P8 security hardening: additive only. Run after Stage 8 migrations.

CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_logs(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(admin_id, created_at);

-- Webhook secrets should be encrypted with a dedicated WEBHOOK_ENCRYPTION_KEY in production.
-- No secret values are stored in this migration.
