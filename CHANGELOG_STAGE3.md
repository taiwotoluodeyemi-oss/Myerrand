# CHANGELOG — Stage 3

- Added persistent `market_zones` flags for launch focus and demand pause.
- Added multi-zone admin table with 7/30-day health, supply and operational metrics.
- Added city rollup and per-zone breakdown.
- Added expansion checklist and gated `expansion_events` logging.
- Added maximum active launch-zone guard (5).
- Kept runner feed zone-preferred and newest-first fallback.
- Added operational exception endpoint for `no_show` / `address_not_found`; it opens the existing dispute path and never moves money outside `errandMoney`.
- Added Stage 3 migration/script and CITY_SCALE.md.
- Phase 2 money engine was not rewritten.
