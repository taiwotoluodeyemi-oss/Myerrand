# Stage 8 Enterprise

Organizations are an optional layer for business clients. Existing solo business users can continue using the JWT merchant API without an organization.

## Organizations
- `owner` manages the organization and API keys.
- `dispatcher` can create/list organization business errands.
- `org_id` on errands is nullable for backward compatibility.
- `sandbox_flag=true` forces organization deposits through the demo provider.

## API keys
Organization API keys are generated once, hashed with SHA-256 at rest, and shown in plaintext only on creation/rotation. Send them as `X-API-Key`. Rotation disables the old key immediately.

JWT authentication remains supported.

## Business fields
Business errands may carry `po_number` and `cost_center`. Completed business errands have a print-friendly HTML delivery receipt at the merchant receipt endpoint.

No new payment, messaging, KYC or insurance vendor is required for the core path.
