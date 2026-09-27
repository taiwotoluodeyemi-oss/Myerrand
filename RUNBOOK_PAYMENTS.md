# Runbook: Payments

## What happened
A payment is failed, stuck, or inconsistent with the errand/ledger state.

## Operator checks
- Check Operations Center payment queue and system health.
- Confirm provider status/reference and the payment intent state.
- Check the related hold and ledger entries.

## Safe action
Use the existing payment/errand money service or the documented worker. Reconcile before any manual intervention.

## Escalation
Escalate provider errors, ledger mismatches, or unresolved money discrepancies to the financial owner.

## What NOT to do
Do not edit wallet balances or payment status directly in SQL. Do not copy provider secrets into tickets.
