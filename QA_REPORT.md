# My Errand — Final Regression & Security QA Report

## Scope
Full regression and security QA pass against the P12 production candidate tree. The audit covered the requested functional areas, security controls, financial integrity controls, and the existing automated test suite. Functionality was not changed during the initial audit.

## Test execution

### Automated regression
- Test command: `node --test tests/*.test.js`
- Result: **154 total tests; 150 passed; 3 failed; 1 skipped**.
- The 3 failures are **environment/dependency failures**, not asserted application failures:
  - `tests/money-engine.test.js`: `Cannot find module 'mysql2'`.
  - `tests/smoke.test.js` / auth middleware load: `Cannot find module 'jsonwebtoken'`.
  - `tests/smoke.test.js` / app load: `Cannot find module 'express'`.
- A dependency-independent regression run excluding those two runtime-blocked files completed successfully:
  - **149 tests; 148 passed; 0 failed; 1 skipped**.
- The skipped test is the existing JWT runtime test in `auth-security.test.js`, which explicitly requires the installed `jsonwebtoken` package.
- Financial concurrency/live-MySQL tests are intentionally skipped when `MYSQL_HOST` and `MYSQL_PASSWORD` are absent; they were not represented as passing.

### Affected-suite revalidation after the prior P12 notifier regression fix
- Stage 6 + webhook operations + Operations Center: **23/23 passed**.
- No new functionality was introduced for the current QA pass.

## Requested audit matrix

| # | Area | QA status | Evidence / limitation |
|---|---|---|---|
| 1 | Registration | PASS (contract) | Auth/security suite; registration route reviewed. Live DB flow requires MySQL. |
| 2 | Login | PASS (contract) | Auth security tests; live HTTP execution blocked by missing Express/jsonwebtoken. |
| 3 | Client dashboard | NOT FULLY EXECUTED | Route/service surface present; browser/E2E runtime not available. |
| 4 | Runner dashboard | NOT FULLY EXECUTED | Route/service surface present; browser/E2E runtime not available. |
| 5 | Business dashboard | NOT FULLY EXECUTED | Merchant/org surface reviewed; browser/E2E runtime not available. |
| 6 | Create errand | PASS (contract) | Stage/merchant/idempotency tests and static money guards. |
| 7 | Quote | PASS (contract) | Pricing tests and authenticated quote route reviewed. |
| 8 | Pay | PASS (contract) | Money-path/static integrity checks; live payment DB not available. |
| 9 | Hold | PASS (contract) | Row-lock/transaction/idempotency guards present and tested statically. |
| 10 | Accept | PASS (contract) | Errand state-machine tests. |
| 11 | Pickup | PASS (contract) | Errand state-machine tests. |
| 12 | Delivery | PASS (contract) | Errand state-machine tests. |
| 13 | Completion | PASS (contract) | Errand state-machine tests. |
| 14 | Release | PASS (contract) | Release idempotency/freeze guards and money authority checks. |
| 15 | Refund | PASS (contract) | Refund idempotency/freeze guards and money authority checks. |
| 16 | Dispute | PASS (contract) | Stage tests and dispute freeze guards. |
| 17 | Dispute resolution | PASS (contract) | Stage/Operations Center tests; live DB not available. |
| 18 | Wallet | PASS (contract) | Wallet/money-path tests; live DB not available. |
| 19 | Deposit | PASS (contract) | Payment-intent/idempotency static guards. |
| 20 | Transfer | PASS (contract) | Wallet route/security surface reviewed. |
| 21 | Zones | PASS | Zone operations tests. |
| 22 | Markets | PASS | City/market tests and route review. |
| 23 | Scoreboard | PASS | Zone/city scoreboard tests. |
| 24 | Merchant API | PASS | Enterprise API security suite: 10/10. |
| 25 | Organizations | PASS (contract) | Organization membership/isolation tests. |
| 26 | Dispatcher | PASS (contract) | Organization role/scoping surface reviewed. |
| 27 | API keys | PASS | Enterprise API security: hashing, expiry, revoke/rotation and mode isolation. |
| 28 | Sandbox | PASS | Sandbox/live isolation test passed. |
| 29 | Webhooks | PASS | Webhook operations: 7/7. SSRF protection test passed. |
| 30 | Notifications | PASS | Stage 6 notification/outbox contracts; optional external notifier is best-effort. |
| 31 | Verification | PASS (contract) | Verification route/auth/upload constraints reviewed. |
| 32 | Policy acceptance | PASS (contract) | Privacy/policy controls suite passed. |
| 33 | Promo/referral | PASS (contract) | Growth and stage tests; unique constraints reviewed. |
| 34 | Payment disputes | PASS (contract) | Admin-only payment-dispute routes and stage coverage. |
| 35 | Delivery receipt | PASS (contract) | Merchant receipt route is organization-scoped. |
| 36 | Admin operations | PASS | Operations Center: 7/7. |
| 37 | Health endpoints | PASS (static) | `/health`, `/health/db`, `/health/dependencies`, `/api/health` defined; live server smoke blocked by missing Express. |

## Security audit

### Tested / verified
- IDOR: organization and errand scoping controls are present; enterprise suite passed.
- Privilege escalation: admin and organization-owner gates are enforced in reviewed routes.
- Unauthorized API access: merchant API key/JWT authentication paths are protected.
- Invalid JWT: auth contract tests passed; live JWT test skipped because `jsonwebtoken` is unavailable.
- Revoked/expired API key: enterprise security suite passed.
- Organization isolation: passed.
- SQL injection: reviewed dynamic SQL paths use parameter binding; no request-parameter interpolation into SQL was found in the audited route/service search.
- XSS: no React `dangerouslySetInnerHTML` sink was found. The only `innerHTML` use is a fixed local fallback error string in `client/src/main.jsx`.
- CSRF: API authentication uses an `Authorization: Bearer` header rather than an authentication cookie. Cookie parsing exists, but the reviewed auth middleware does not authenticate from cookies; therefore the classic ambient-cookie CSRF path is not the primary auth mechanism.
- SSRF webhook: private/local address resolution protection and redirect handling passed the webhook test.
- Rate limiting: global API, login/registration, merchant, MFA, and password-reset limiters are present and tested by their respective suites.
- Mass assignment: reviewed route inputs are destructured/allowlisted rather than blindly spreading request bodies into persistence updates.
- File upload abuse: size limits, file count limits, extension/MIME allowlists, generated filenames, and authenticated ownership checks are present.

## Financial audit
- Duplicate payment/idempotency: payment-intent and gateway/idempotency guards are present.
- Duplicate hold: unique errand-hold constraint plus row locking.
- Release twice: idempotent released-state guard.
- Refund twice: idempotent refunded-state guard.
- Release/refund race: `FOR UPDATE` row locking plus transactions in `errandMoney`.
- Dispute freeze: release/refund are blocked for disputed/open-dispute errands except explicit admin-resolution paths.
- Concurrent requests: static guards passed; live concurrency test could not execute without MySQL credentials/server.
- Transaction rollback: hold/release/refund paths explicitly begin, commit, rollback, and release connections.
- Ledger reconciliation: reconciliation service, migration, and admin endpoint are present and covered by financial-integrity tests.

## Findings summary
- CRITICAL: **0**
- HIGH: **0**
- MEDIUM: **0 confirmed**
- LOW: **1**
- Environment/test blockers: **2 test files / 3 failed test cases**

See `SECURITY_FINDINGS.md` and `MONEY_TEST_REPORT.md` for details.

## Deployment blockers
1. **Dependency installation must succeed before production release.** The current QA container could not complete `npm install`; consequently Express, jsonwebtoken, and mysql2 were unavailable for runtime tests.
2. **A real isolated MySQL environment is required to close the live financial concurrency/reconciliation portion of the QA gate.**
3. Browser-level dashboard/E2E testing was not executed in this server-side QA environment.

No CRITICAL or HIGH application finding was identified that required a code fix during this pass.
