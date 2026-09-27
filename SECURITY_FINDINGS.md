# My Errand — Security Findings

## Summary

| Severity | Confirmed findings | Status |
|---|---:|---|
| CRITICAL | 0 | No confirmed critical issue |
| HIGH | 0 | No confirmed high issue |
| MEDIUM | 0 | No confirmed medium issue |
| LOW | 1 | Documented below |

## LOW-01 — Public registration error can expose backend error text

**Severity:** LOW  
**Area:** Registration / error handling  
**Evidence:** `routes/auth.routes.js` returns `Registration failed: ` plus `error.message` on an unexpected registration failure.

**Impact:** Unexpected database/provider errors could expose implementation details to an unauthenticated caller. This is information disclosure rather than direct account or financial compromise.

**Disposition:** Not changed during this pass because the requested remediation scope was CRITICAL and HIGH issues only. A production-hardening follow-up should return a generic public error and keep the detailed exception only in structured server logs.

## No CRITICAL/HIGH findings

The following controls were specifically checked and did not produce a confirmed critical/high issue:

- JWT algorithm, issuer, audience, account status, auth-version, and password-change invalidation.
- Admin route authentication and role enforcement.
- Organization membership checks and organization-scoped merchant API access.
- API-key hashing, expiry, revocation, rotation, and sandbox/live mode separation.
- Parameterized SQL in audited request-driven query paths.
- Webhook SSRF protections including DNS resolution against private/local destinations and redirect handling.
- Global and endpoint-specific rate limiting.
- Money-operation row locking and transactional rollback paths.
- Release/refund idempotency and dispute freezing.
- Upload size/count and extension/MIME restrictions.

## Verification limitations

Some runtime security assertions could not be executed because npm dependency installation timed out in the QA environment. The JWT runtime test and live MySQL concurrency tests therefore remain open verification items rather than being marked green.
