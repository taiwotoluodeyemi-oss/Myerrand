# Stage 6 Growth

## Referrals
Each user may have one referral code. A referee may have one attribution. Self-referrals are rejected. The referrer receives the configured `referral_bonus` spendable credit only after the referee completes a first job. The reward is ledger-backed and does not touch errand holds.

## Promotions
Promo redemption credits the user's spendable wallet using ledger reason `promo_credit`. Redemption is bounded by `max_redemptions`, one redemption per user/code, and optional expiry. Promo credits cannot release runner funds or bypass an errand hold.

## Zone waitlist
The waitlist captures a requested zone plus email or phone. It is storage-only until a messaging provider is deliberately configured.
