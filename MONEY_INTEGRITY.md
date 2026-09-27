# Money Integrity Hardening

## Scope

This pass hardens the existing P8 accounting architecture. `services/errandMoney.js` remains the authority for errand holds, release, refund and dispute freeze. It was not replaced.

## Guarantees added

- Wallet mutations run inside database transactions.
- Wallet rows are locked with `FOR UPDATE` before balance decisions.
- Wallet-to-wallet transfers lock both wallets in deterministic ID order to reduce deadlock risk.
- Negative balances are rejected by the centralized financial service.
- Amounts are validated server-side to positive, two-decimal values.
- Payment intents have unique references and are locked during completion.
- Paystack verification and webhook completion share one idempotent accounting path.
- Demo deposits use the same wallet/ledger accounting path as live deposits.
- Merchant `Idempotency-Key` creation is committed in the same transaction as the errand, preventing a job from being created without its replay record.
- Existing unique constraints protect one hold per errand, referral reward per referee and promo redemption per user/promo.
- A unique gateway reference constraint is added when the database has no historical duplicates; the migration stops rather than deleting or rewriting financial history if duplicates exist.
- Reconciliation produces a report and never silently changes balances.

## RELEASE XOR REFUND

The existing `errandMoney` implementation continues to serialize hold operations with a row lock. A hold that is `released` cannot be refunded, and a hold that is `refunded` cannot be released. Disputed holds remain frozen for automatic processing.

## Idempotency

Use `Idempotency-Key` for retriable merchant creation and deposit initiation where the client can safely replay the same business operation. Payment references are unique and payment completion is locked by reference.

## Reconciliation

Admin endpoint:

`GET /api/admin/financial-reconciliation`

Optional `?currency=NGN` filters the report. The report compares wallet balances against ledger-derived balances and compares hold totals with corresponding hold/release/refund ledger totals. A discrepancy is reported; it is never automatically repaired.

### Important legacy-data limitation

Ledger-derived reconciliation assumes the ledger contains the complete opening history for the wallet. Older wallets may contain balances created before the canonical ledger path existed. Those can appear as discrepancies and must be reviewed rather than silently normalized.

## Failure behavior

A database error rolls back the transaction. A payment operation that has not committed cannot leave its wallet credit behind. A committed idempotency record represents the completed operation and allows a retry to return the existing result.
