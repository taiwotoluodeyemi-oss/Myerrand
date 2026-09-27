# Changelog — Observability

## P10 — Production Observability

- Added JSON Winston application logging.
- Added request correlation IDs via `X-Request-Id`.
- Added safe request context fields: user, organization, market and zone.
- Added request latency and status metrics.
- Added categorized request error logging.
- Added `/health`, `/health/db`, and `/health/dependencies`.
- Added live operational and financial metrics using existing MySQL infrastructure.
- Added financial integrity alert checks for negative wallets, orphaned/released-refunded holds, missing ledger entries, stuck payments and repeated verification failures.
- Added admin observability endpoint and dashboard panel.
- Added graceful shutdown for HTTP, Socket.IO, workers and MySQL.
- Added unhandled exception/rejection handling.
- Added observability regression tests for DB failure, malformed requests, payment failure, webhook failure, unexpected exceptions and shutdown contracts.
