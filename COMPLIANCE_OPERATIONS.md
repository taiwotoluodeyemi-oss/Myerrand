# Compliance Operations

These controls are operational safeguards only. **They do not mean My Errand is legally compliant. Requires legal review.**

## Operational controls

- Data inventory and classification are documented in `PRIVACY_DATA_MAP.md`.
- Retention periods are configurable in `privacy_retention_policies`.
- Account deactivation disables authentication, anonymizes unnecessary profile information, removes runner verification-document references, and preserves financial records.
- Policy acceptance records capture user, policy, version, and timestamp.
- Escrow disclosure is exposed from the active `escrow_disclosure` policy and is included in payment-intent responses when available.
- Market support contacts remain configurable through market configuration.
- Sensitive verification-document access is admin-only and written to `privacy_access_audit` / security audit logs.
- Trust CSV export intentionally excludes names, emails, phones, addresses, client IDs, and runner IDs.
- Privacy export is scoped to the authenticated user and contains operational errand fields rather than unnecessary profile information.

## Access review

Administrators can review recent sensitive-record access through `GET /api/privacy/admin/access-audit` (admin MFA remains required by the existing admin middleware).

## Account deactivation

`POST /api/privacy/deactivate` and the existing `POST /api/auth/deactivate` require explicit confirmation. MySQL mode anonymizes unnecessary profile data and preserves financial/accounting history.

## Legal review checklist

- Applicable privacy/data-protection law and regulator requirements
- Lawful basis and consent/notice wording
- Data-subject access/correction/deletion rights
- Financial/tax/AML/fraud retention requirements
- Government-ID/KYC storage and vendor requirements
- Cross-border transfers and subprocessors
- Encryption/key-management requirements
- Breach/incident notification obligations
- Market-specific support/contact requirements
