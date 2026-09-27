# Policy Versioning

Active policy types:

- `terms`
- `privacy`
- `escrow_disclosure`
- `runner_agreement`

Each active policy has a version. Acceptance is recorded against the exact version, user, timestamp, IP address (when available), and user agent.

## Gates

- Client payment requires current `terms`, `privacy`, and `escrow_disclosure` acceptance.
- Runner acceptance requires current `terms`, `privacy`, and `runner_agreement` acceptance.
- When a version changes, the user must accept the new version before the gated action continues.

Use `/api/policies/current` to display the current versions and `/api/policies/accept` to record a user acceptance.

These are product controls; the policy text must receive jurisdiction-specific legal review before public launch.
