# MFA Rate-Limit Hardening

- Added database-backed progressive lockout for admin MFA TOTP challenges, enrollment verification, and recovery-code attempts.
- Rate-limit state is keyed by action + admin user + request IP and survives process restarts/multiple workers.
- Default threshold is 5 failures within 15 minutes, followed by exponential lockout capped per action.
- Successful verification clears the relevant failure bucket.
- Locked requests return HTTP 429 with a retry-after value.
- Recovery-code attempts use a stricter starting lock and longer maximum lock.
- Added additive `admin_mfa_rate_limits` migration.
- Added brute-force resistance tests.
