# Enterprise / API Security — P8

## Scope

P8 enterprise access is organization-scoped and production-safe for both JWT merchant access and organization API credentials.

### API key lifecycle

- Secrets are generated from 32 random bytes and stored only as SHA-256 hashes.
- Plaintext keys are returned only on creation or rotation.
- Keys are listed by metadata only: prefix, mode, timestamps, expiry, revocation state, and last use.
- Owners can rotate or revoke keys. Dispatchers cannot create, rotate, or revoke them.
- Keys may expire with `expires_in_days` (1–3650 days).
- `last_used_at`, `created_at`, `revoked_at`, `rotated_at`, and `expires_at` are retained.
- Live organizations receive `me_live_*` credentials; sandbox organizations receive `me_test_*` credentials.
- Authentication rejects expired, revoked, inactive, or mode-incompatible credentials.

### Authentication context

Merchant requests authenticated by an API key carry:

- `organizationId`
- `userId` for the member who created the credential, while that membership remains active
- `memberRole`
- `apiKeyId`
- `mode` (`live` or `sandbox`)

JWT requests retain their authenticated user context. Organization-scoped JWT requests must pass organization membership checks.

## Organization isolation

Organization-scoped merchant reads use `org_id` directly for API-key requests. An API key cannot select another organization, inspect another organization's errands, webhooks, members, or credentials.

JWT users can access only organizations for which they have membership. Solo JWT merchant data remains user-scoped.

Organization webhooks now have an optional `organization_id`; organization operations are queried by organization rather than merely by `user_id`.

## Dispatcher permissions

Dispatchers may:

- create business errands for organizations where they are members;
- list permitted organization business errands;
- retrieve errand status and permitted receipt data.

Dispatchers may not:

- create, rotate, or revoke organization API keys;
- release or refund money;
- modify financial balances;
- approve verification;
- change market configuration.

API-key lifecycle routes explicitly require the `owner` membership role.

## Merchant API controls

- Rate limiting is applied to the merchant API. API-key limits are keyed by a SHA-256 fingerprint of the credential; JWT requests are keyed by IP.
- Merchant payloads are capped at 64 KiB by default before JSON parsing.
- Required fields and important string lengths are validated.
- List endpoints use bounded pagination: default 20, maximum 100.
- Production errors return safe generic messages instead of internal exception text.
- `Idempotency-Key` values are validated and are bound to a canonical SHA-256 request fingerprint.

### Idempotency

For a given authenticated principal:

1. Same key + same method/path/body/organization/mode returns the stored response.
2. Same key + a materially different request returns HTTP 409.
3. The idempotency record stores the request fingerprint and original status code.

Do not reuse an idempotency key for a different operation.

## Sandbox

Sandbox organizations are explicit security boundaries:

- Their credentials use `me_test_*` and authenticate only against sandbox organizations.
- Live credentials authenticate only against live organizations.
- A sandbox API key cannot select a different organization.
- A sandbox organization is constrained to its configured market; cross-market access is rejected.
- Sandbox deposits continue through the demo payment path and are recorded as `is_demo=true`.
- Pre-P8 sandbox keys that cannot be safely converted to the new `me_test_*` format are revoked by the migration rather than being silently upgraded.

## Audit logging

Merchant API requests write to `api_audit_logs` with organization, API-key ID, actor, auth mode, request ID, method, path, action, status, IP, mode, and timestamp. Secrets are never written to the audit record.

Existing `audit_logs` remains the platform-wide security audit stream for API-key lifecycle events.

## Database migration

Apply:

`database/19-enterprise-api-security.sql`

after the existing Stage 8 and security-hardening migrations.

The migration is additive. It adds API-key expiry/revocation/mode fields, organization webhook ownership, idempotency request fingerprints, and a dedicated API audit table.

## Operational notes

Recommended production environment variables:

- `MERCHANT_RATE_LIMIT_PER_MINUTE=60`
- `MERCHANT_MAX_PAYLOAD_BYTES=65536`

A deployment should run the enterprise security test suite before enabling production merchant credentials.
