# Admin MFA

Admin accounts require a successful TOTP challenge before routes protected by `requireAdmin` are accessible. Enrollment is password-authenticated and must be confirmed with a TOTP code. Ten single-use recovery codes are issued at enrollment and can be regenerated only after MFA verification.

## Endpoints
- `GET /api/auth/admin/mfa/status`
- `POST /api/auth/admin/mfa/enroll` — returns the secret/otpauth URI once; do not log it.
- `POST /api/auth/admin/mfa/enroll/verify` — activates MFA and returns one-time recovery codes.
- `POST /api/auth/admin/mfa/challenge` — accepts TOTP or a recovery code and returns an MFA-verified token.
- `POST /api/auth/admin/mfa/recovery/regenerate` — requires an MFA-verified admin session.

MFA secrets are encrypted at rest. Set `MFA_ENCRYPTION_KEY` in production; development derives a key from `JWT_SECRET`. Recovery codes are stored only as SHA-256 hashes.

Existing non-admin login is unchanged. Admin password login remains valid for authentication, but admin operations return `ADMIN_MFA_REQUIRED` until enrollment/challenge succeeds.

## Brute-force protection

MFA challenge, enrollment verification, and recovery-code attempts use database-backed progressive lockout. Five failures in the active 15-minute window trigger a lock; repeated failures increase the lock exponentially up to an action-specific cap. Successful verification clears that action's failure bucket. HTTP 429 is returned while locked.
