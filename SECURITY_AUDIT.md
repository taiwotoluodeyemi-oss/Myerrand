# P8 Production Security Audit

## Scope
Authentication, authorization, financial mutation boundaries, IDOR, API keys, webhooks, uploads, CORS, TLS, error exposure, rate limiting, secrets and audit logging. The P8 money invariant was preserved.

## CRITICAL

### Fixed — cross-account errand listing
The general errand listing endpoint could return unscoped records when no `user_type` filter was supplied. It is now scoped to the authenticated client/runner; administrators retain administrative visibility.

### Fixed — unpaid runner assignment path
Runner discovery/assignment could include pending/unpaid errands. Assignment now requires `paid` + `payment_status='escrowed'`.

### Fixed — webhook SSRF controls
Webhook delivery now rejects local/private destinations, checks DNS results, and disables redirects. Registration uses the same safety validation.

## HIGH

### Fixed — financial mutation boundary
Wallet balance mutation was consolidated behind `services/financialService.js` for non-errand financial flows. Errand holds remain exclusively in `services/errandMoney.js`. Controllers no longer directly increment/decrement wallet balances in the hardened financial routes.

### Fixed — production MySQL TLS verification
Remote production MySQL connections now require a CA certificate instead of silently using `rejectUnauthorized=false`. Development can retain the fallback.

### Fixed — production error disclosure
The global handler and hardened route responses no longer expose raw internal exception messages in production. Development retains diagnostics.

### Fixed — upload restrictions
Errand and verification uploads have size limits plus MIME/extension allowlists. Verification remains private and admin-gated; raw government-ID files are not exposed through the React static directory.

### Fixed — API-key handling
Organization keys remain hashed at rest, are shown once, and rotation disables the previous key. Authentication is rate-limited before the merchant authentication path. Creation/rotation are audited.

### Fixed — JWT verification
Production requires `JWT_SECRET`; token verification explicitly accepts HS256 only.

## MEDIUM

- Registration now has a dedicated rate limit.
- CORS wildcard production entries for arbitrary `*.pages.dev`, `*.vercel.app`, and `*.netlify.app` origins were removed; configured origins remain supported.
- Payment reference verification is scoped to the authenticated account when the server-generated reference contains a user ID.
- Security audit events were added for login failures, API-key creation/rotation, verification decisions, organization membership changes and admin money resolution.

## LOW / OPERATIONAL

- Password hashing remains bcrypt and should be reviewed periodically for cost-factor upgrades.
- A trusted reverse-proxy configuration should set `TRUST_PROXY` only when the deployment topology is known.
- Webhook encryption should use a dedicated production `WEBHOOK_ENCRYPTION_KEY`; do not rely on the development fallback.

## Already protected

- SQL uses parameterized queries in the inspected routes/services.
- Errand ownership checks exist on pay, cancel, tracking, progress and runner-location operations.
- Notification reads/updates are scoped to the authenticated user.
- Organization membership checks restrict organization resources.
- The errand money engine uses database transactions and row locks for hold/release/refund.
- Disputed holds remain frozen by the existing money engine.

## Needs verification in deployment

- Reverse-proxy/TLS termination and HTTP-to-HTTPS enforcement.
- MySQL user privileges: application account should not have schema-admin privileges.
- Database backups, restore testing, encryption at rest and secret rotation.
- Real object-storage/private-file policy if uploads move away from local disk.
- Production monitoring/alerting for authentication failures, money failures, stuck holds, webhook dead letters and database errors.

## Test limitation

The new static security suite passes. Full existing regression execution is currently blocked in this build environment because the archive's installed `node_modules` is incomplete (`mysql2`, `jsonwebtoken`, and `express` are missing) and network package installation timed out. No passing result is claimed for those blocked runtime tests.
