# My Errand — Stage 5

Stage 5 adds the partner event layer and operator queues without changing the Stage 1–4 money invariants.

## Database

Apply after the previous migrations:

```bash
npm run db:stage5
```

This creates webhook subscriptions, the event outbox, delivery attempts/dead letters, and links notifications to source events.

## Webhooks

Business clients can register up to the configured webhook limit. Secrets are encrypted at rest using key material derived from the existing JWT secret (or optional `WEBHOOK_ENCRYPTION_KEY`) and are shown only once when created.

Production webhook URLs must use HTTPS. Localhost HTTP is permitted only outside production for development/testing.

## Notifications

The existing notification bell reads persistent in-app notifications. Stage 5 generates them from the event outbox for runner acceptance, delivery, disputes, resolutions, releases, and refunds. Duplicate processing is protected by `source_event_id`.

Email is optional and uses the project's existing Nodemailer transport only when its existing mail environment variables are configured. No SMS provider is required.

## Operator queues

Admin → Operations exposes:

- open disputes
- stuck holds
- due releases
- paid/unaccepted jobs nearing expiry
- webhook dead letters

Money actions call the existing `errandMoney` functions; there is no second release/refund implementation.

## Worker

The server runs the existing money worker plus a lightweight event/webhook worker. Webhook HTTP delivery is deliberately outside request/state-transition execution.

## Tests

Run:

```bash
npm test
```

The Stage 5 contract suite verifies the outbox schema, separation of HTTP delivery from state transitions, notification coverage, admin queues, and preservation of the money engine.
