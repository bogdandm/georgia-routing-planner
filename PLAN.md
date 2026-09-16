# Marker weather forecast

## Goal

Add persistent marker-weather preferences, selected weekday interval forecasts,
marker-list and map summaries, reusable interval previews, and a direct handoff to the
Weather tab. Reuse the Weather tab's existing daylight/night aggregation semantics.

## Design

- Persist one marker-weather preference record in the existing Dexie settings table.
  Empty weekdays disable forecasts; defaults are Saturday and Sunday, daytime, with map
  summaries enabled.
- Store resolved elevation on each saved marker. A schema migration upgrades legacy
  marker records with an unresolved elevation; the first successful forecast persists
  the resolved value and later requests reuse it.
- Extend the existing point-weather use case with caller-provided elevation and a pure
  selected-weekday interval aggregator. Day and night use the current Weather tab
  periods; custom intervals select whole local hours and may cross midnight.
- Let `MarkersWorkspaceProvider` own preference loading, bounded forecast requests,
  forecast state, preview selection, and elevation persistence. No second global state
  owner.
- Reuse one weather-period row presentation in the seven-day forecast and marker
  preview. Map summaries remain DOM markers because they are interactive and the
  saved-marker collection is already bounded operationally.

## Commits

1. Persist marker elevation and marker-weather preferences; add interval aggregation and
   focused domain/persistence coverage.
2. Load marker forecasts and add settings, list summaries, previews, Weather-tab
   handoff, and focused component coverage.
3. Add map summaries, durable documentation, final cleanup, and verification.

## Verification

- Focused Vitest files for weather aggregation, persistence, marker workspace, map
  workspace, and Weather panel request reuse.
- Final `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test:coverage`, and
  `git diff --check`.
- No live server, browser, or Playwright run unless separately requested.
