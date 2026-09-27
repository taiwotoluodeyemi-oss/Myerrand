# Runbook: Incidents

## What happened
System health is degraded, unavailable, or reporting financial/queue anomalies.

## Operator checks
Check `/health`, `/health/db`, `/health/dependencies`, Operations Center system health, logs, queue depth, and recent deployment/configuration changes.

## Safe action
Stabilize first: stop unsafe changes, preserve request IDs, and use existing workers/services for recovery.

## Escalation
Escalate database outages, money-integrity alerts, repeated provider failures, or security incidents to the incident owner.

## What NOT to do
Do not disable authentication, bypass MFA, or mutate financial records as an incident workaround.
