# My Errand Observability

## Production model

Observability uses the existing Node/Express + Winston + MySQL stack only. No paid monitoring service is required.

### Structured request logs

Every request receives an `X-Request-Id` correlation ID. The JSON log record contains timestamp, route, method, status, duration, and safe user/organization/market/zone context when available.

Request bodies, authorization headers, cookies, API keys, JWTs and payment/webhook secrets are never logged by the request logger.

### Error categories

Application errors are classified as:

- `AUTH_ERROR`
- `PAYMENT_ERROR`
- `MONEY_ERROR`
- `DATABASE_ERROR`
- `WEBHOOK_ERROR`
- `VALIDATION_ERROR`
- `EXTERNAL_PROVIDER_ERROR`

### Health

- `/health` — cheap process/liveness check.
- `/health/db` — executes `SELECT 1`; returns `503` when MySQL is unavailable.
- `/health/dependencies` — reports configured provider readiness without exposing credentials.

### Metrics

Process-local counters cover requests, errors, login failures, payment failures and webhook failures. The admin observability snapshot supplements these with live MySQL-derived metrics for deposits, holds, releases, refunds, disputes, stuck payments, webhook queue depth, dead letters, stuck holds and active users.

Process-local counters reset on restart; database-derived operational health survives process restarts.

### Financial alerts

The admin observability snapshot flags:

- negative wallet balances
- orphaned holds
- released-and-refunded holds
- holds without a corresponding completed ledger entry
- stuck payment intents
- repeated failed verification events

Alert records contain identifiers and amounts needed for operations, not credentials or full sensitive identity data.

### Admin dashboard

`GET /api/admin/observability` exposes operational health to authenticated admins. The existing Admin Operations panel displays health, queue depth, active users, business counters and financial alerts.

### Failure isolation

Logging, metrics, health reporting and notification failure recording are best-effort. They are not part of money/state transactions. Existing outbox creation remains transactional with the relevant errand/money transition; delivery is asynchronous.

### Shutdown and process safety

SIGTERM/SIGINT stop recurring workers, stop accepting new HTTP connections, close Socket.IO and close the MySQL pool. Uncaught exceptions and unhandled rejections are recorded and trigger the same bounded graceful shutdown path.
