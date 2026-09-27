# My Errand — Money Test Report

## Result

### Dependency-independent checks
- `tests/money-path.test.js`: **13 passed, 0 failed**; live MySQL scenario skipped.
- `tests/money-integrity.test.js`: **6 passed, 0 failed**; MySQL concurrency scenario skipped.
- Financial portions of stage/enterprise tests also passed in the dependency-independent regression run.

### Runtime-blocked check
- `tests/money-engine.test.js`: **FAILED TO START**, not an application assertion failure.
- Root cause: `Cannot find module 'mysql2'` from `config/db.mysql.js`.
- A real MySQL environment was not available for end-to-end financial race tests.

## Controls verified from source/tests

1. Hold creation locks the errand and existing hold rows and runs wallet movement in a transaction.
2. A released hold cannot be refunded.
3. A refunded hold cannot be released.
4. Repeating release after release returns an idempotent result.
5. Repeating refund after refund returns an idempotent result.
6. Disputed/open-dispute holds are frozen except explicit admin-resolution paths.
7. Escrow balance is checked before release/refund movement.
8. Wallet mutations and ledger entries are performed within the same transaction.
9. Merchant idempotency records are written inside the errand transaction.
10. Deposit/payment intent handling uses locking/idempotency controls.
11. Financial reconciliation reporting exists and is exposed to authenticated admin operations.

## Required pre-release live tests

Run against an isolated staging MySQL database with the production schema:

- two simultaneous identical payments
- two simultaneous holds for one errand
- simultaneous release/release
- simultaneous refund/refund
- simultaneous release/refund
- dispute creation racing release
- duplicate gateway callback
- transaction failure after wallet mutation but before commit
- ledger-vs-wallet reconciliation after each scenario

These scenarios were **not** marked green because the required MySQL environment was unavailable.
