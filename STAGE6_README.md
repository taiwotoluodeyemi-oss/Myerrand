# Stage 6 README

Stage 6 adds ledger-safe referrals/promos, a zone waitlist, optional notification adapters, payment-dispute cases, and honest market SLA reporting.

## Notifications
In-app notifications always remain available. SMS uses `SMS_WEBHOOK_URL` only when configured; email uses the existing SMTP variables only when configured. Otherwise adapters are Noop/off and never block product actions.

## Migration
Run `npm run db:stage6` after Stage 5.

## Tests
Run `node --test tests/stage6.test.js tests/stage5.test.js tests/money-engine.test.js`.
