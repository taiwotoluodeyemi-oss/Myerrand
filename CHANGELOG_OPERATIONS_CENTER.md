# Operations Center Changelog

## P12
- Added normalized Admin Operations Center queues.
- Added pagination, search, date, market and zone filters.
- Added audit logging for supported operational actions.
- Reused existing money and webhook services; no financial logic was duplicated in admin routes.
- Added production runbooks for payments, disputes, webhooks, incidents, and account security.

- Added `OPERATIONS_CENTER.md` documenting queue semantics, filters and safe actions.

## Regression fix
- Restored the Stage 6 notifier failure marker (`optional notifier failed`) while preserving sanitized persisted error details.
- Revalidated Operations Center, Stage 6, and webhook contract suites after the fix.
