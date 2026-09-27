# Data Retention

Retention metadata is operational guidance, not a statement of statutory compliance. **Requires legal review** before production retention periods are treated as legal requirements.

The database migration `21-privacy-controls.sql` creates `privacy_retention_policies` so periods can be configured without hard-coding them into application behavior.

Current operational defaults:

- Account profile: 365 days; deactivation anonymizes unnecessary profile data immediately.
- Errand operational data: 730 days.
- Financial ledger: 2555 days (legal/accounting review required).
- Payment gateway records: 2555 days (legal/accounting review required).
- Verification documents: 90 days (legal review required).
- Verification decisions: 730 days (legal review required).
- Policy acceptance: 2555 days (legal review required).
- Notifications: 365 days.

Financial, tax, dispute, fraud-prevention, and regulatory records may need preservation after account deactivation. The deactivation workflow therefore does not delete core ledger/payment records.
