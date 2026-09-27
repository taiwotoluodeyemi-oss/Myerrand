# Verification

My Errand Stage 7 uses a manual-first verification framework. Runner `verification_status` is `pending`, `approved`, or `rejected`.

## Manual path

1. Runner submits an ID document through `/api/verification/submit`.
2. The document is stored under the private application upload path; its path is metadata only.
3. An admin reviews the queue and uses `/api/verification/admin/:runner_user_id/decision`.
4. `approved` permits acceptance in markets where `require_verified_runners=true`.
5. `rejected` or `pending` blocks acceptance in those markets.

The older `background_check_status` fields are kept synchronized for compatibility with existing data/routes. No live KYC vendor is required.

## Product rule

Verification is a product access control, not a legal determination of identity, criminal history, or suitability. Market settings determine whether approval is required.
