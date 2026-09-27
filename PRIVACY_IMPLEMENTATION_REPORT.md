# P11 Privacy / Compliance Operations Report

## Scope

P11 adds operational privacy/data-governance controls to P10. It does **not** certify My Errand as legally compliant. Jurisdiction-specific requirements, lawful bases, notices, retention obligations, KYC rules, deletion exceptions, and cross-border processing **require legal review**.

## Implemented

- Data inventory and classification documentation.
- Configurable retention metadata in `privacy_retention_policies`.
- Privacy-aware account deactivation/anonymization for MySQL accounts.
- Preservation of financial/accounting records during deactivation.
- Verification-document retention metadata and deletion of the stored document reference/file during account deactivation.
- Admin-only verification document access with sensitive-access auditing.
- Privacy-safe authenticated errand CSV export.
- Privacy-safe admin trust export with unnecessary identity fields removed.
- Policy version acceptance remains recorded by user, policy, version and timestamp.
- Escrow disclosure is surfaced from the active policy and included in payment-intent responses.
- Market support contact remains configuration-driven.
- Mongo deactivation remains supported, with explicit operational audit logging; Mongo personal-data anonymization parity requires application-specific review if Mongo is enabled.

## API additions

- `GET /api/privacy/mine`
- `POST /api/privacy/deactivate` with `{"confirm":"DELETE"}`
- `GET /api/privacy/export/errands`
- `GET /api/privacy/admin/access-audit` (admin MFA protected)

## Database

Migration: `database/21-privacy-controls.sql`

New operational metadata:

- `users.deactivated_at`
- `users.anonymized_at`
- `runners.anonymized_at`
- `runners.verification_retention_until`
- `privacy_retention_policies`
- `privacy_access_audit`

## Verification

Focused privacy tests: **8/8 passed**.

Combined P8/P9/P10/P11 regression set: **62 passed, 1 skipped**. The skipped test requires installed `jsonwebtoken`; it is an environment dependency, not a test failure.

Changed JavaScript files passed syntax checks.

## Legal-review items

- Exact statutory retention periods.
- Whether and when government-ID documents may be retained.
- Lawful basis/consent and privacy notice language.
- Data-subject access, correction, portability and erasure obligations.
- Financial/tax/AML/fraud retention exceptions.
- Cross-border transfers and subprocessors.
- Encryption/key-management requirements for sensitive verification data.
- Breach/incident reporting obligations.
- Market-specific support/contact and regulatory requirements.
