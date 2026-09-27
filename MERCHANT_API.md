# Merchant API

Authenticate with the existing JWT (`Authorization: Bearer <token>`).

- `POST /api/merchant/errands` — create a business errand. Required: `title`, `pickup_address`, `delivery_address`, `reference`, `phone`; optional `zone`, `market_id`, coordinates.
- `GET /api/merchant/errands` — list the authenticated user's business errands.
- `GET /api/merchant/errands/:id` — retrieve one own business errand and timeline fields.

Use `Idempotency-Key: <unique-key>` on create. Retrying the same key for the same user returns the original response rather than creating another errand. Requests are rate limited.

## Stage 8 enterprise authentication
Business merchant routes accept either the existing JWT or an organization `X-API-Key`. Organization API keys are created/rotated through `/api/orgs/:id/api-keys`; the plaintext key is shown only once.

Organization business errands may include `org_id`, `po_number`, and `cost_center`. Solo business users may omit `org_id`.

Completed business errands expose a print-friendly HTML delivery receipt through `/api/merchant/errands/:id/receipt`.
