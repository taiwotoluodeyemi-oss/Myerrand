# Change Log — Phase 0–2 Money/State Safety

## Baseline audit
- **Pay:** `routes/errands.routes.js` `/pay/:errand_id` previously called `utils/wallet-utils.processErrandPayment`, moving spendable → client escrow.
- **Cancel/refund:** the cancel route previously manipulated escrow/spendable wallet balances directly and inserted its own refund transaction.
- **Complete/release:** `/complete`, `/status`, and `/update-progress` previously called `releaseEscrowFunds` directly or marked `payment_status=released`, allowing money movement to happen outside a single errand-hold record.
- **Statuses:** the database/application primarily used `pending → assigned → in_progress → completed`, with payment tracked separately. The new canonical lifecycle is `pending → paid → accepted → picked_up → delivered → completed`; `assigned` and `in_progress` remain accepted as legacy values and are mapped in code.
- **Multiple money paths:** yes. Payment, cancellation, and completion had separate balance/transaction behavior. This pass consolidates errand money movement in `services/errandMoney.js`.

## What is reused
- Existing MySQL `wallets` and `wallet_transactions` tables.
- Existing spendable/escrow/withdrawable wallet types.
- Existing Paystack/demo deposit implementation.
- Existing errand routes, authentication, runner verification, progress/file uploads and client dashboards.

## What was added/consolidated
- `services/errandMoney.js`: one hold/release/refund engine plus due processors.
- `services/errandState.js`: canonical state validation, actor checks and transition timestamps.
- `config/marketplace.js`: pinned money/state constants.
- `errand_holds` and `errand_disputes` additive tables.
- Errand timestamps: `paid_at`, `picked_up_at`, `delivered_at`, `disputed_at`.
- Ledger metadata: `actor_id`, `reason`, `is_demo`.
- Admin dispute open/resolve and due-money processing routes.
- Explicit runner acceptance agreement.
- Short money documentation and contract tests.

## Important migration note
Existing rows are not deleted or reset. Legacy `assigned`/`in_progress` values remain valid for compatibility; new transitions use canonical values.


## Stage 2 — One-zone operating system
- Added configurable primary-market country/city/zones and additive errand location/channel fields.
- Added runner service-zone storage and registration validation.
- Added zone-filtered runner discovery with same-zone preference.
- Added admin supply readiness endpoint and 15-runner launch gate.
- Added 7/30-day zone scoreboard with median acceptance, accept/completion/dispute rates and honest Insufficient data handling.
- Added business errand reference and contact phone requirements.
- Added client errand timeline and escrow/hold state surface.
- Did not change errandMoney release/refund invariants.


## Stage 7 — Verification, Policy and Trust
- Added manual-first runner `verification_status` with admin approve/reject and legacy background-check compatibility.
- Added market-level verified-runner accept gates.
- Added versioned terms, privacy, escrow disclosure and runner agreement acceptance logs.
- Added policy re-acceptance enforcement before client payment and runner acceptance.
- Added `off` / `ack_only` liability acknowledgement mode without claiming insurance coverage.
- Added admin funnel, dispute-reason, verification-funnel and CSV trust read models.
- Added market display-name branding metadata.
- Errand hold/release/refund engine was not rewritten.

## Stage 8 Enterprise
- Added optional organization owner/dispatcher accounts.
- Added hashed organization API keys with one-time display and rotation.
- Merchant API accepts JWT or organization API key.
- Added sandbox organization demo-deposit enforcement.
- Added business PO/cost-center fields and completed-job HTML delivery receipt.
- Added Noop-first KYC, Push and Insurance adapters and market verification mode.
- Existing solo business and money-engine paths remain compatible.

## Admin MFA hardening
- Added mandatory TOTP MFA gate for admin operations.
- Added encrypted MFA enrollment secret and one-time recovery codes.
- Added MFA challenge, recovery, status and recovery-code regeneration endpoints.
- Added additive `database/19-admin-mfa.sql` migration.
- Added admin MFA audit events and session claim enforcement.
- Added `tests/admin-mfa.test.js` and `test:admin-mfa` script.

- Added database-backed progressive lockout for admin MFA challenge, enrollment verification, and recovery-code attempts.
