# My Errand — Money Rules (Phase 0–2)

## Source of truth
All errand payment/hold/release/refund movement belongs in `services/errandMoney.js`.
Legacy `utils/wallet-utils.js` function names are compatibility wrappers only.

## Pay / hold
1. Client pays from the **spendable** wallet.
2. The same amount is moved into the client's escrow wallet.
3. Exactly one `errand_holds` row is created for the errand.
4. The hold starts as `held`; it is not runner earnings.

## Release
A held errand may release when it is `delivered` or `completed`, has no open dispute, and `delivered_at + 24h <= now`.
The runner receives the existing `runner_payout` amount (or the held amount when no payout breakdown exists). The hold is then `released` and cannot be refunded.

Admin `release_to_runner` may release immediately, but still uses the same engine.

## Refund
A held errand may refund for:
- client cancellation while paid and not accepted;
- client cancellation while accepted and not picked up;
- paid and never accepted after 48 hours;
- admin `refund_to_client` / `cancel_no_pay`.

The hold returns to client spendable balance and becomes `refunded`. A refunded hold cannot release.

## Disputes
Disputes can be opened by the client or runner from accepted/picked_up/delivered/completed (subject to the 24-hour completed window). An open dispute freezes automatic money processing. Admin resolution uses the same money engine.

## Ledger
Hold, release and refund actions append `wallet_transactions` rows with errand ID, actor, reason and `is_demo`. Existing deposit/transfer records remain supported.

## Idempotency
`errand_holds.errand_id` is unique. Repeated release/refund calls return an idempotent result when the hold is already in the requested terminal state. Cross-direction operations are rejected.
