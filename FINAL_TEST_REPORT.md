# My Errand — Final Test Report

## Executed

### Full regression
`node --test tests/*.test.js`

**154 total tests: 150 passed, 3 failed, 1 skipped.**

The three failures were startup failures caused by unavailable installed dependencies, not failed application assertions:

1. `tests/money-engine.test.js` — `Cannot find module 'mysql2'`.
2. `tests/smoke.test.js` — auth middleware could not load `jsonwebtoken`.
3. `tests/smoke.test.js` — application could not load `express`.

The single skipped test is the existing JWT runtime test that explicitly skips when `jsonwebtoken` is not installed.

### Dependency-independent regression
The previously completed dependency-independent run recorded:

**149 tests: 148 passed, 0 failed, 1 skipped.**

### Affected P12 suites
- Stage 6 + webhook operations + Operations Center: **23/23 passed**.
- Enterprise/API security suite: **10/10 passed**.
- Operations Center: **7/7 passed**.
- Webhook operations: **7/7 passed**.
- Money integrity static suite: **6/6 passed**.

## Not executed / not green

- Production frontend Webpack build: dependency environment unavailable.
- Live backend boot/HTTP smoke: Express unavailable.
- Live MySQL money/concurrency/reconciliation: no usable MySQL test environment.
- Paystack sandbox calls and provider failure injection: no provider credentials/environment.
- Browser-level authenticated dashboard E2E: no browser/staging environment.
- Production backup/restore drill: no production backup target.

These are verification limitations, not invented passes.
