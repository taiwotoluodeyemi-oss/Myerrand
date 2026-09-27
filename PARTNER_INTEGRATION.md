# Partner Integration — Stage 5

## Recommended flow

1. Create a business errand through the existing JWT merchant API.
2. Register a webhook at `POST /api/merchant/webhooks`. Use an HTTPS URL in production.
3. Store the returned secret immediately; list endpoints never return it again.
4. Treat webhooks as best-effort notifications. Keep the existing merchant GET endpoint as the polling fallback.
5. Verify `X-MyErrand-Signature: sha256=<hex>` using HMAC-SHA256 over the exact request body.
6. Use `X-MyErrand-Event` to route events.

## Events

`paid`, `accepted`, `picked_up`, `delivered`, `completed`, `cancelled`, `disputed`, and `resolved` are emitted for errand state events. `release` and `refund` are emitted for money outcomes.

## Delivery behavior

- State changes do not perform outbound HTTP requests.
- Events are stored in the database outbox.
- A worker creates one delivery per active subscription.
- Failed delivery attempts retry up to 3 times with backoff.
- After the third failed attempt the delivery becomes a dead letter for operator review.
- Webhook failure therefore does not roll back an errand transition or money transaction.

## Test ping

`POST /api/merchant/webhooks/:id/test` queues a signed test event.
