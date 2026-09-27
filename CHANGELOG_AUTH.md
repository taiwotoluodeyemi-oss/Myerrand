# Authentication Security Hardening

## P8 security pass

- Hardened JWT issuance and verification with issuer/audience validation and shorter default expiry.
- Added server-side auth-version session invalidation.
- Added explicit `/api/auth/logout` session revocation while preserving existing frontend logout behavior.
- Added progressive login lockout and authentication rate limits.
- Strengthened password policy and bcrypt cost factor.
- Hardened password-reset token generation, storage, expiry, single-use behavior, and transactional consumption.
- Hardened email-verification token consumption against concurrent reuse.
- Added additive authentication-security database migration.
- Added authentication security tests.
- Added audit events for password change, reset success, logout, and locked login attempts.
- No wallet, errand-hold, RELEASE/REFUND, ledger, or payment-port logic was rewritten.

## Test status

`node --test tests/auth-security.test.js`: **9 passed, 1 skipped**. The skipped runtime JWT test requires installed npm dependencies; the current packaging environment does not contain `node_modules`.
