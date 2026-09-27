# CHANGELOG_STAGE7

## Verification
- Added runner `verification_status`: `pending`, `approved`, `rejected`.
- Existing manual admin approval/rejection remains the primary verification path.
- Existing background-check fields are synchronized for compatibility.
- Markets can require approved runner verification before acceptance.

## Policy versioning
- Added active versions for terms, privacy, escrow disclosure and runner agreement.
- Added immutable acceptance records with user, version and timestamp metadata.
- Client payment requires current client policies.
- Runner acceptance requires current runner policies.
- Version changes therefore require fresh acceptance.

## Liability acknowledgement
- Added market `insurance_mode`: `off` or `ack_only`.
- `ack_only` records an acknowledgement before runner acceptance.
- No insurance coverage is asserted or created by this feature.

## Trust analytics
- Added funnel: created → paid → accepted → completed.
- Added dispute reason breakdown.
- Added verification funnel.
- Added admin CSV export.
- Added market display-name metadata for light branding.

## Money safety
`services/errandMoney.js` was not changed in Stage 7. Existing hold → release XOR refund rules remain the sole errand money path.
