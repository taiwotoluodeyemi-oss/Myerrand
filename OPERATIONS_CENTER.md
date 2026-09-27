# Admin Operations Center

## Purpose
The Operations Center gives a small production team one authenticated, MFA-protected view of operational work without introducing a second financial or webhook implementation.

Endpoint: `GET /api/admin/operations-center`

Actions: `POST /api/admin/operations-center/action`

## Queues
- open disputes
- stuck holds
- failed payments
- failed webhooks
- dead-letter events
- unaccepted paid errands
- verification queue
- payment disputes
- high-dispute users
- system health

Queue records expose age, severity, market, zone, responsible action, and current state where those fields exist. Payment-provider intents may not have market/zone data and therefore return null rather than guessing.

## Filters
`page`, `page_size` (maximum 100), `search`, `from`, `to`, `market`, and `zone` are accepted. Filters are parameterized and queue SQL is bounded.

## Safe actions
Only these actions are exposed:
- `process_due_money` -> existing `processDueRefunds` / `processDueReleases`
- `process_webhooks` -> existing `processWebhookOutbox`
- `replay_webhook` -> existing `replayDeadLetter`

All actions are audited. No wallet, hold, ledger, payment, or errand financial mutation is implemented in the admin route itself.
