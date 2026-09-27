# Money Hardening Changelog

## Financial integrity pass

- Added `financial_operations` for durable idempotency coordination.
- Added `payment_intents` with unique payment references and locked completion state.
- Added reconciliation run storage and an admin financial reconciliation report.
- Added gateway-reference uniqueness protection with a safe migration guard for historical duplicates.
- Added indexes for hold due-processing and wallet transaction/errand reconciliation.
- Hardened wallet credit/debit/transfer transactions with row locks and server-side amount/currency validation.
- Made wallet transfers acquire locks in deterministic order.
- Unified Paystack webhook and verification crediting through the idempotent payment port.
- Made demo deposits use the same transactional accounting path as live deposits.
- Made merchant idempotency atomic with merchant errand creation.
- Disabled the legacy direct wallet-balance mutation helper.
- Added money-integrity tests and a real-MySQL concurrency test harness that is skipped when no database is configured.

## Preserved

- `services/errandMoney.js` remains the errand money authority.
- RELEASE XOR REFUND invariant unchanged.
- Dispute freeze unchanged.
- No multi-market, webhook, enterprise, KYC or unrelated feature work was introduced.
