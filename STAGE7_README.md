# Stage 7 — Trust Infrastructure

## Apply

After Stage 6, run:

```bash
npm run db:stage7
```

The migration is additive and backfills `verification_status` from the existing `background_check_status`.

## Verification

Use `/api/verification/admin/pending` and `/api/verification/admin/:runner_user_id/decision`. A market with `require_verified_runners=true` blocks runner acceptance until `verification_status=approved`.

## Policies

Current versions are available at `/api/policies/current`. Authenticated users can accept a version at `/api/policies/accept`. Client payment and runner acceptance check the current versions.

## Liability

`insurance_mode=off` has no acknowledgement gate. `insurance_mode=ack_only` requires `/api/policies/liability/ack` before runner acceptance. This records acknowledgement only and never represents insurance coverage.

## Trust analytics

Admin endpoints:

- `/api/admin/trust/funnel`
- `/api/admin/trust/policy-acceptances`
- `/api/admin/trust/export`

The export is CSV and is read-only.

## Tests

```bash
npm run test:stage7
```
