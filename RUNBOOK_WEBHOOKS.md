# Runbook: Webhooks

## What happened
A webhook is retrying or dead-lettered.

## Operator checks
Check event ID, destination, response code, attempts, and last error without exposing the secret or sensitive payload.

## Safe action
Allow the worker to retry. Replay a dead-letter event only through the existing eventOutbox replay service.

## Escalation
Escalate persistent destination failures, signature failures, or suspected SSRF/security issues.

## What NOT to do
Do not edit delivery rows to mark them delivered. Do not paste webhook secrets into logs or tickets.
