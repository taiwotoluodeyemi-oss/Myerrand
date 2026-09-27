# Webhook Operations Changelog — P9

## Production-safe asynchronous notifications

### Added

- Explicit webhook delivery states: `pending`, `processing`, `delivered`, `retrying`, `dead_letter`.
- Atomic delivery claiming to reduce concurrent duplicate delivery.
- Recovery of abandoned `processing` rows.
- Bounded retry attempts with exponential/backoff schedule.
- Durable event ID header: `X-MyErrand-Event-Id`.
- HMAC-SHA256 webhook signatures.
- Previous-secret grace signing during webhook secret rotation.
- Owner-protected organization webhook secret rotation.
- Replay of dead-letter deliveries without creating a new event.
- Notification failure records surfaced in Admin Ops.
- Safer webhook destination validation on every delivery attempt.
- HTTPS-only production delivery and redirect blocking.
- Safe webhook failure messages that omit request payloads and secrets.
- Additive migration: `database/20-webhook-operations.sql`.

### Safety guarantees

- Webhook delivery never runs inside the errand-state or money transaction.
- Existing transactional outbox insertion remains part of the relevant state/money transaction where a transaction connection is available.
- Webhook/notification failure is caught and recorded asynchronously.
- Duplicate delivery is constrained by the existing `(outbox_id, subscription_id)` unique key and atomic processing claim.

### Verification

The P9 webhook regression suite covers delivery success/failure paths, retry/dead-letter/replay behavior, duplicate protection, HMAC/event identity, SSRF protections, secret rotation, notification Ops visibility, and isolation from money/state transitions.
