# Implemented features

This is the implemented Phase 1 inventory. Later roadmap features are listed only to
make current boundaries explicit.

## Desktop workspace

The Material UI shell provides Tracks, Plan, and Satellite sections, a persistent map,
an elevation panel placeholder, settings, and an opt-in developer drawer. The three
product sections are deliberate empty states until their roadmap phases.

- Owner: `src/presentation/shell`.
- Durable setting: developer-mode preference in Dexie.
- Fallback: `?developer=1` enables diagnostics even when stored settings cannot load.
- Failure boundary: uncaught React errors render a support-bundle fallback.

## Hiking basemap

The pure style factory maps validated OpenMapTiles source-layer names to land, water,
boundaries, roads, paths, steps, hiking POIs, peaks, and labels. Source/layer IDs and
ordering are stable contracts. Unsupported hiking route relations are not invented.

- Default vector source: OpenFreeMap TileJSON; attribution stays visible.
- Invalid configuration: MapLibre does not mount; a safe fatal message is shown.
- Vector/glyph failures: the existing canvas remains usable and an aggregated warning
  offers an explicit retry.
- Tests: pure style assertions plus synthetic MVT/glyph Chromium coverage.

## Camera persistence

The map starts only after the last valid camera is read, preventing a visible jump from
the Georgia overview to the saved position. `moveend` sends settled cameras to a
debounced persistence queue; animation-frame events are never persisted.

- Stored value: versioned `map.camera` record in the existing Dexie settings table.
- Validation: finite values are clamped to supported longitude, latitude, zoom, bearing,
  and pitch ranges.
- Corrupt value: delete it, log a repair event, and use the Georgia overview.
- Failed or non-settling storage: show a warning and mount with the overview after a
  bounded wait.
- Teardown: flush the most recent pending camera without blocking React unmount.

## 2D and 3D terrain

The 2D/3D control operates on the same MapLibre instance and style. Enabling 3D adds one
configured `raster-dem` source, applies terrain, restores a useful pitch, and waits for
the source to become usable. Disabling terrain returns pitch to zero while retaining
center, zoom, and bearing.

- Duplicate clicks share one in-flight transition.
- Conflicting transitions fail explicitly instead of racing.
- DEM error, cancellation, or timeout removes the failed source, returns to 2D, and
  preserves camera intent.
- Retry reuses the same facade and map rather than remounting either.

## Failure and offline feedback

Map errors are classified as vector, glyph/sprite, terrain, style, WebGL, or unknown.
Equivalent recoverable errors are counted in capped buckets and logged at a bounded
interval. Style startup and WebGL loss are fatal; provider-tile and DEM errors are
degraded states. Offline messaging promises only that already rendered areas may remain
visible, not full offline map support.

## Diagnostics and developer mode

Diagnostics are local, bounded, and redacted before storage in the event ring buffer.
The developer Map view shows exact local camera state, ordered source/layer IDs,
terrain, failures, idle time, WebGL capabilities, and temporary debug flags. Debug flags
reset when developer mode ends.

Schema-version 2 exports include build/runtime data, bounded events, health results,
notes, and a serializable map snapshot. Exported longitude/latitude are rounded to 0.1
degree; route geometry, raw provider URLs, tokens, headers, paths, and filenames are
excluded. The inspection CLI migrates supported version 1 bundles.

Local checks cover browser APIs, WebGL, map readiness, IndexedDB, and quota. Vector and
terrain reachability run only on explicit request and accept an `AbortSignal`; normal
startup never waits for them.

## Configuration and security

`VITE_MAP_PROVIDER_CONFIGURATION` is optional public JSON validated by Zod. Endpoints
must be HTTPS or application-relative; terrain template tokens, supported encoding, tile
sizes, zoom ranges, policy limits, layer mappings, and attribution are validated. Safe
errors report an issue count without echoing the payload. `VITE_*` configuration must
never contain secrets.

## Deferred features

| Feature                                        | Planned phase/status                       |
| ---------------------------------------------- | ------------------------------------------ |
| Searchable GPX catalog and track display       | Later phase; current tab is an empty state |
| Local GPX import                               | Later phase; control is disabled           |
| Manual waypoint planning and GPX export        | Later phase; no routing engine exists      |
| Elevation calculations and chart               | Later phase; panel is a placeholder        |
| Sentinel-2 scene selection/rendering           | Later phase; COG feasibility only          |
| Offline region downloads, accounts, cloud sync | Explicit MVP non-goals                     |
