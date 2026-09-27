# KYC, Push and Insurance Adapters

Stage 8 uses Noop-first adapters. Without provider environment configuration, the adapters return `not_configured` and do not block core product flows.

## Providers
- KYC: `KYC_PROVIDER_URL`
- Push: `PUSH_PROVIDER_URL`
- Insurance: `INSURANCE_PROVIDER_URL`

These URLs are optional integration endpoints. Secrets/credentials are not required for the Noop path.

## Verification mode
Markets expose `verification_mode`: `manual`, `vendor`, or `off`.

Manual admin approval remains available in every mode. A Noop vendor does not grant verification automatically; the runner remains pending until an authorized admin approves them when verification is required.

## Insurance
Insurance integration is never represented as active coverage unless a configured provider explicitly returns a bound/active result. Noop returns `not_configured`.
