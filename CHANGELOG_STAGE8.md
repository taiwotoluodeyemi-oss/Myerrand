# Stage 8 Changelog

- Added optional organizations with owner/dispatcher membership.
- Added hashed, one-time-display organization API keys and rotation.
- Extended merchant authentication to JWT or organization API key.
- Added nullable `org_id`, `po_number`, and `cost_center` to business errands.
- Added sandbox organization deposit enforcement through the demo payment port.
- Added completed business delivery receipt HTML.
- Added Noop-first KYC, Push and Insurance adapters.
- Added market `verification_mode` (`manual|vendor|off`).
- Kept manual verification approval and the existing errand money engine unchanged.
