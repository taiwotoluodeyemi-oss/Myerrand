# My Errand — Controlled Production Deployment Runbook

## 0. Release gate

Do not deploy while any CRITICAL/HIGH finding exists. Before launch, close the AMBER verification items in `PRODUCTION_READINESS.md` that require live infrastructure.

## 1. Build environment

Use a trusted CI/release machine with network access and Node/npm versions supported by the project.

```bash
npm ci
cd client && npm ci && cd ..
npm run build
```

Confirm `client/dist/` exists. Do not copy `node_modules`, `.env`, credentials or private keys into the release archive.

## 2. Environment

Copy `.env.example` to the secret store/environment configuration. Never commit the populated `.env`.

Production minimums:

- `NODE_ENV=production`
- strong random `JWT_SECRET`
- `ALLOW_CODESPACES=false`
- `ALLOW_DEMO_LOGIN=false`
- `ALLOW_INSECURE_EMAIL_VERIFY=false`
- verified remote MySQL TLS via `MYSQL_CA_PATH`
- real payment-provider credentials where live payments are enabled
- `WEBHOOK_ENCRYPTION_KEY` and `MFA_ENCRYPTION_KEY`
- production `CLIENT_URL` / `FRONTEND_URL`

## 3. Database backup

Before migrations, create a consistent database backup using the organization's approved MySQL backup mechanism. Record timestamp, database identifier, backup identifier, retention policy and restore owner.

Example logical backup when permitted by the database operator:

```bash
mysqldump --single-transaction --routines --triggers "$MYSQL_DATABASE" > pre-release.sql
```

Do not place credentials in shell history or source control. Prefer the platform secret manager/credential injection.

## 4. Migration process

Use a staging database first. Apply the base schema, then the additive migrations in dependency order:

1. `database/04-production-align.sql`
2. `database/05-qa-alignment.sql`
3. `database/06-gift-card-commerce.sql`
4. `database/07-pricing-engine.sql`
5. `database/08-money-state.sql`
6. `database/09-zone-ops.sql`
7. `database/10-city-scale.sql`
8. `database/11-stage4-market-merchant.sql`
9. `database/12-stage5-events.sql`
10. `database/13-stage6-growth-risk.sql`
11. `database/14-stage7-trust-policy.sql`
12. `database/15-stage8-enterprise.sql`
13. `database/16-security-hardening.sql`
14. `database/17-money-integrity.sql`
15. `database/18-auth-security.sql`
16. `database/19-admin-mfa.sql`
17. `database/19-enterprise-api-security.sql`
18. `database/20-webhook-operations.sql`
19. `database/21-privacy-controls.sql`

Where an `scripts/apply-*.js` wrapper exists, use the corresponding wrapper with the production environment loaded. Review each migration result before proceeding.

## 5. Migration rollback

Migrations are intentionally additive and do not provide a blanket destructive down-migration. If a release must be rolled back:

1. Stop application traffic/workers if the defect can mutate data.
2. Preserve logs and the failing release artifact.
3. Restore the pre-release database backup when data/schema rollback is required.
4. Deploy the previously approved application candidate.
5. Run health checks and financial reconciliation before reopening traffic.
6. Do not manually delete financial rows to force a rollback.

## 6. Startup

```bash
NODE_ENV=production npm start
```

Verify:

```bash
curl -fsS https://YOUR_HOST/health
curl -fsS https://YOUR_HOST/api/health
curl -fsS https://YOUR_HOST/health/db
curl -fsS https://YOUR_HOST/health/dependencies
```

Expected: basic health endpoints return 200; DB/dependency health must reflect the actual production dependencies.

## 7. Payment verification

Before enabling real payment traffic:

- perform one controlled Paystack sandbox lifecycle;
- send a duplicate signed callback;
- verify only one wallet credit occurs;
- test a failed provider response;
- confirm the payment intent and wallet ledger reconcile.

## 8. Financial release gate

Run concurrent staging scenarios:

- duplicate payment;
- duplicate hold;
- release twice;
- refund twice;
- release vs refund race;
- dispute vs release race;
- transaction rollback after a simulated failure;
- post-scenario wallet/ledger reconciliation.

Do not launch until the results are recorded as passing.

## 9. Monitoring

Watch:

- request IDs and structured error logs;
- database health;
- payment failures;
- webhook retry/dead-letter counts;
- stuck holds;
- open disputes;
- financial reconciliation;
- process restarts and graceful shutdown events.

## 10. Emergency rollback

If money integrity, authentication, organization isolation, or payment processing is compromised:

1. Stop new traffic.
2. Preserve logs/audit records.
3. Disable affected payment/webhook integrations if necessary.
4. Restore the last known-good application and, only if required, database backup.
5. Verify health and reconciliation.
6. Reopen traffic only after the incident owner signs off.
