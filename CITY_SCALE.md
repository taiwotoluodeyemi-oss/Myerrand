# My Errand — City Scale (Stage 3)

## Zone operating rule
Run each zone independently. A zone is not considered healthy because demand exists; use the scoreboard and launch-ready supply.

### Expansion gate
A new zone can be logged as an expansion only when:
1. Source zone is GREEN on the 30-day scoreboard.
2. Target zone exists in the configured primary-market zone list.
3. Target zone has at least `SUPPLY_GATE_RUNNERS` (15) launch-ready runners.
4. The operator records a note in `expansion_events`.

The application rejects an expansion event when these conditions are not met.

### Zone controls
- `launch_focus`: operator's current supply/demand focus.
- `pause_demand`: warns/blocks new client creation in that zone.
- Maximum active launch-focus zones: 5.

## Matching
Runner available jobs default to the runner's service zones. Matching prefers a same-zone job; when coordinates are available the feed can use them for proximity ordering, otherwise newest jobs are used.

## City rollup
The city scoreboard aggregates the same underlying zone metrics and shows the per-zone breakdown. If paid-job sample size is below 10, the health result is **Insufficient data** rather than a fabricated KPI.
