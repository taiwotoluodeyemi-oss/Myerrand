# MFA Hardening

- Added admin-only TOTP MFA with enrollment and challenge.
- Added encrypted MFA secrets and one-time hashed recovery codes.
- Added MFA session claim and admin-route enforcement.
- Added recovery-code regeneration requiring an MFA-verified admin session.
- Added security audit events for enrollment, challenge success/failure, recovery use, and regeneration.
- Added additive database migration `database/19-admin-mfa.sql`.
- No money-engine or wallet logic changed.
