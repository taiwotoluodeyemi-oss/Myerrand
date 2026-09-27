# Authentication & Account Security

## Implemented

- Passwords remain bcrypt-hashed; the authentication path now uses cost factor 12.
- Password policy is at least 10 characters with upper/lowercase, number, and special character.
- Login, registration, password reset, password-reset confirmation, and email-verification requests are rate-limited.
- Login has progressive account throttling: 5 failed attempts trigger a 15-minute lock; 10 trigger a 1-hour lock.
- Login failure responses do not reveal whether an email exists.
- Password-reset tokens are generated with `crypto.randomBytes(32)`, stored only as SHA-256 hashes, expire after one hour, are single-use, and are consumed under a database row lock.
- Email-verification tokens use the same hashed/single-use pattern and are consumed transactionally.
- Production never returns reset or verification tokens in HTTP responses.
- JWTs use HS256 only and now carry issuer/audience claims plus an auth-version claim.
- Protected requests validate JWT expiry, issuer, audience, account status, role consistency, auth version, and password-change time.
- Password changes, password resets, logout, and deactivation invalidate prior sessions by incrementing `auth_version`.
- Logout now invalidates the server-side JWT session version while still allowing the existing client-side token cleanup.
- API-key authentication remains rate-limited by the merchant route limiter.
- Security events are written through the existing audit service.

## Migration

Run:

```bash
npm run db:auth-security
```

This applies `database/18-auth-security.sql`. It is additive and does not delete users or financial records.

## JWT configuration

Recommended production values:

```env
JWT_SECRET=<long-random-secret>
JWT_EXPIRY=2h
JWT_ISSUER=my-errand-api
JWT_AUDIENCE=my-errand-web
```

The issuer/audience values must match between token issuance and verification.

## Admin authentication

Admin accounts use the same hardened JWT authentication and rate-limited login path. Role authorization is enforced separately by admin middleware. A dedicated MFA provider is not introduced in this pass, so production admin MFA remains a deployment-level follow-up risk.

## Known limitations

- The browser continues to store the access token in `localStorage`; moving to HttpOnly secure cookies would require a coordinated frontend authentication migration.
- No external MFA/KYC vendor was introduced.
- Full runtime authentication tests require the project's npm dependencies and a test database. The included static/security tests can run without those dependencies.
