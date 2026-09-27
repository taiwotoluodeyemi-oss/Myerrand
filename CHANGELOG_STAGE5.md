# CHANGELOG — Stage 5

## Added
- Durable webhook event outbox for errand state changes and money outcomes.
- HMAC-SHA256 webhook signing and encrypted-at-rest webhook secrets.
- Up to five active webhook subscriptions per business client by default.
- Three-attempt webhook retry policy with dead-letter status.
- Merchant webhook list, disable, and test-ping endpoints.
- Event-linked in-app notifications for accept, delivery, dispute, resolution, release, and refund.
- Optional dispute/resolution email using the existing Nodemailer transport when configured.
- Admin operations queues for disputes, stuck holds, due releases, expiring paid jobs, and webhook dead letters.
- Safe operator actions to process due money, process webhooks, and retry dead-letter deliveries.
- `PARTNER_INTEGRATION.md` and `STAGE5_README.md`.

## Safety
- Errand state transitions enqueue database events; they do not perform outbound webhook HTTP calls.
- Webhook failures therefore cannot block state transitions.
- Existing `errandMoney` remains the only release/refund path.
- No new required API keys or paid providers.
