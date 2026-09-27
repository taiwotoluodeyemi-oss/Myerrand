# Security Hardening Changelog

## P8 security pass

- Added centralized role helpers and HS256-only JWT verification.
- Scoped general errand listings to the authenticated account.
- Prevented runners from assigning unpaid/pending errands.
- Added centralized `financialService` for wallet credits, debits and transfers; errand hold logic remains in `errandMoney`.
- Added production webhook SSRF protections and disabled redirects.
- Added dedicated registration rate limiting.
- Removed broad wildcard production CORS origins.
- Required verified TLS CA configuration for remote production MySQL.
- Hardened upload MIME/extension checks.
- Reduced production exception disclosure.
- Added security audit events for key administrative/security operations.
- Added additive security audit indexes and `.env.example` guidance.
- Repaired an existing duplicated/truncated `scripts/fixed-max-budget-column.js` so the repository parses cleanly.

### Money invariant
No changes were made to the fundamental errand hold rule: one active hold, then RELEASE XOR REFUND; disputed holds remain frozen.
