# Webhook & Notification Operations — P9

## Reliability contract

Webhook and notification delivery is asynchronous and **must never participate in the success/failure decision of an errand state transition or money transaction**.

State transitions and money operations enqueue the durable outbox event on the same database transaction where a connection is available. HTTP delivery, SMS/email, in-app notification fan-out, retries, and observability happen after that transaction.

A delivery failure therefore cannot roll back a successful errand transition, escrow hold, release, refund, or other ledger operation.

## Webhook lifecycle

Each delivery follows:

`pending → processing → delivered`

or, after a failure:

`processing → retrying → processing → delivered`

After the bounded retry budget is exhausted:

`processing → dead_letter`

Workers atomically claim rows before delivery, so two workers cannot normally deliver the same delivery concurrently. Stuck `processing` rows are recovered after two minutes.

The current default retry budget is three attempts with the configured bounded delays (`5s`, `30s`, `120s`).

## Event identity and duplicate protection

- Every outbox row has a durable numeric event ID.
- Every `(outbox_id, subscription_id)` pair is unique.
- Webhook requests carry `X-MyErrand-Event-Id`.
- Reprocessing an existing delivery reuses the original event and delivery IDs rather than creating a new event.
- Dead-letter replay is therefore idempotent at the MyErrand delivery layer, while receivers should still deduplicate by event ID because HTTP delivery is inherently at-least-once.

## HMAC signing

The exact JSON request body is signed with HMAC-SHA256 using the webhook secret:

`X-MyErrand-Signature: sha256=<hex>`

During secret rotation, the new secret is primary and the previous secret remains usable for outbound signature verification for 24 hours. During that grace period the request includes `X-MyErrand-Signature-Previous` as well. This lets a receiver deploy the new secret without creating a delivery gap.

Webhook secrets are encrypted at rest and are never returned by list endpoints.

## Secret rotation

`POST /api/merchant/webhooks/:id/rotate-secret`

For organization-owned webhooks, the organization owner is required. The new secret is returned once. The previous secret is retained for a 24-hour grace window and then naturally stops being emitted.

## SSRF controls

Webhook destinations are validated before delivery:

- HTTPS is required in production.
- Credentials in the URL are rejected.
- localhost and local/private IP literals are rejected in production.
- DNS resolution is checked and private/local results are rejected.
- Redirects are disabled (`maxRedirects: 0`), so a public destination cannot redirect the worker to an internal address.
- Requests use an 8-second timeout.

The destination is revalidated on every delivery attempt, not only when the webhook is created.

## Sensitive-data logging policy

Webhook secrets, API keys, authorization headers, and webhook payload bodies are not written to logs. Delivery failures are reduced to a safe status/code message before persistence in the delivery row.

Notification failures are recorded in `notification_failures` for Ops visibility without storing the sensitive notification payload.

## Ops and replay

Admin Ops exposes:

- dead-letter webhook deliveries
- notification failures
- existing dispute/money queues

Dead-letter replay:

`POST /api/admin/ops/webhook-dead-letter/:id/retry`

Replay resets the existing delivery to `retrying`, resets its attempt budget, and reopens the existing outbox event. It does not create a duplicate business event.

## Operational testing matrix

The regression suite covers:

- successful delivery
- timeout/HTTP failure handling
- malformed/unsafe destinations
- retry state and bounded backoff
- dead-letter transition
- dead-letter replay
- duplicate delivery protection
- event IDs and HMAC signatures
- secret rotation grace period
- notification failure visibility
- state/money paths remaining independent from HTTP delivery

## Migration

Apply `database/20-webhook-operations.sql` using:

`npm run db:webhook-operations`

This migration is additive and upgrades the existing delivery enum/columns while adding notification failure observability.
