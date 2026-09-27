# My Errand — Final Risk Register

| ID | Severity | Status | Issue | Affected component | Evidence | Risk | Required remediation | Verification |
|---|---|---|---|---|---|---|---|---|
| R-01 | AMBER | Open | Runtime dependency installation did not complete in QA; Express/mysql2/jsonwebtoken remained unavailable. | Backend + tests | `npm ci --ignore-scripts --no-audit --no-fund` timed out; 3 test cases failed to start. | Runtime boot and some financial/auth tests are not independently verified in this environment. | Run `npm ci` from a networked, trusted build environment and retain lockfile integrity. | `npm ci` succeeds; `npm ls --depth=0`; smoke test and server boot pass. |
| R-02 | AMBER | Open | Frontend production build was not executed. | `client/` Webpack build | `client/dist` absent; `webpack` unavailable. | Frontend packaging could fail at release time. | Run `npm ci` in root and client, then `npm run build`. | Build exits 0 and `client/dist` is generated. |
| R-03 | AMBER | Open | Live MySQL financial concurrency/reconciliation tests were not executed. | Wallet/errand money/ledger | Money integrity suite explicitly skips live DB scenario without MySQL credentials. | Race/rollback behavior remains unverified against the actual DB engine. | Execute isolated staging MySQL concurrency suite and reconciliation. | All concurrent money scenarios pass and reconciliation is zero-difference. |
| R-04 | AMBER | Open | Live Paystack sandbox/provider tests were not executed. | PaymentPort / wallet Paystack routes | Static tests verify signatures, amount/currency matching and idempotency; no provider call was made. | Provider integration/configuration failures could surface only after deployment. | Execute Paystack sandbox initialize/verify/webhook duplicate/failure tests. | Sandbox payment lifecycle and duplicate callback tests pass. |
| R-05 | AMBER | Open | Browser-level dashboard E2E was not executed. | Client dashboards | No browser runtime was available in this QA environment. | UI regressions in client/runner/business dashboards may remain. | Run authenticated browser E2E against staging. | Registration through dashboard/errand lifecycle completes in browser. |
| R-06 | AMBER | Open | Backup/restore drill is documented but not executed against production backup infrastructure. | Database operations | No backup service/restore target was supplied to QA. | Recovery time/data loss assumptions remain unverified. | Perform and record a restore drill before launch. | Restored DB passes schema, health and financial reconciliation checks. |
| R-07 | LOW | Open | Unexpected registration errors can expose backend `error.message`. | `routes/auth.routes.js` | Existing QA finding from final regression. | Limited information disclosure to unauthenticated callers. | Return a generic production error and retain detailed exception only in logs. | Inject controlled registration failure and confirm generic response/no stack/detail. |

## Confirmed severity totals

- CRITICAL: 0
- HIGH: 0
- MEDIUM: 0 confirmed
- LOW: 1
- AMBER operational/release risks: 6

No RED application-security finding was confirmed in this gate.
