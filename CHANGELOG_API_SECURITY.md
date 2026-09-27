# API Security Changelog — P8

## Added

- Production-safe organization API-key lifecycle:
  - SHA-256 hashes at rest
  - one-time plaintext display
  - owner-only creation, rotation, and revocation
  - optional expiry
  - `created_at`, `expires_at`, `last_used_at`, `rotated_at`, `revoked_at`
  - explicit `live` / `sandbox` mode
- `me_live_*` and `me_test_*` credential separation.
- API-key authentication context containing organization, member, key ID, role, and mode.
- Organization-scoped merchant reads and webhook ownership.
- Dedicated `api_audit_logs` request trail.
- Merchant payload-size protection before JSON parsing.
- Bounded merchant pagination.
- Per-credential/IP merchant rate limiting.
- Safe production merchant errors.
- Canonical request fingerprints for idempotency.
- Rejection of materially different requests that reuse an idempotency key.
- Sandbox/live credential isolation and market-scope enforcement.
- API-key revocation endpoint.
- Enterprise security regression tests.

## Migration

Run `database/19-enterprise-api-security.sql` after the existing P8 Stage 8 migrations.

Pre-P8 sandbox API keys are revoked during migration because their plaintext values are unavailable for safe conversion from `me_live_*` to `me_test_*`.

## Compatibility

- Existing JWT merchant authentication remains supported.
- Existing solo merchant users may continue using JWT without an organization.
- Existing nullable `errands.org_id` behavior remains supported.
- Existing user-owned webhooks remain supported; organization webhooks gain explicit `organization_id` isolation.
