# Privacy Data Map

This is an operational inventory, not a legal determination. **Requires legal review** for applicable jurisdiction, lawful basis, notices, cross-border transfer rules, statutory retention periods, and data-subject rights.

| Domain | Examples stored | Classification | Operational purpose | Minimization/control |
|---|---|---|---|---|
| Clients | name, email, phone, addresses, account status | operational / sensitive where applicable | account and errand delivery | deactivation anonymizes profile fields |
| Runners | profile, service zones, emergency contact, verification status | operational / sensitive | dispatch, safety, verification | verification documents are private and retention-tagged |
| Businesses | organization name, references, contact/account metadata | operational | enterprise dispatch | organization scoping |
| Organizations | organization metadata, members, API credentials metadata | operational / sensitive credential metadata | enterprise access | secrets hashed, shown once; access isolated |
| Payments | payment intents, wallet transactions, gateway references | financial | accounting/reconciliation | financial records preserved; exact retention requires legal review |
| Errands | addresses, descriptions, status, market/zone, payment state | operational | marketplace execution | exports exclude unnecessary identity fields |
| Disputes | dispute reason, status, resolution metadata | operational / financial | dispute handling | access restricted and audited |
| Verification | document path, verification decision/notes, provider status | sensitive | runner verification | raw ID is not included in normal/admin list responses; direct document access is admin-only and audited |
| Policy acceptance | user, policy type/version, timestamp, limited request metadata | operational | evidence of version acceptance | versioned acceptance records retained; exact period requires legal review |
| Notifications | user target, type, message, event metadata | operational | user communication | deactivation minimizes retained notification content where supported |

Raw government-ID files are not intended to be public assets. **Requires legal review** of storage location, encryption, access controls, vendor processing, and retention/deletion schedules.
