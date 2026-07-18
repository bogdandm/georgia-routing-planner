# Features and workspace UX

This document describes the implemented application and the reviewed complete system
concept. It distinguishes unavailable behavior so the mockups are not mistaken for
working functionality.

## Design authority and vocabulary

The reviewed
[Penpot workspace concepts](https://design.penpot.app/#/workspace?team-id=e53c2c6b-a0fc-80ee-8008-585e71ddb1af&project-id=e53c2c6b-a0fc-80ee-8008-586356e1ef5a&file-id=dd49d952-2105-80b2-8008-587f93c8a333&page-id=dd49d952-2105-80b2-8008-587f93c8a334)
are authoritative for layout, feature placement, control grouping, and interaction
hierarchy. Repository documentation and code remain authoritative for data, privacy,
architecture, and failure contracts. When those sources disagree about UI/UX, the
reviewed design wins and this document must be corrected.

- **Feature rail:** `Tracks`, `Satellite`, `Markers`, and `Layers` are the primary
  top-level feature sections.
- **Global rail actions:** `Diagnostics` is available when developer mode is enabled;
  `Settings` is always a global action.
- **Create GPX workflow:** manual waypoint planning begins from `Create GPX` in Tracks.
  “Plan” and “route plan” may name domain data, but there is no Plan tab, Plan rail
  item, or independent planning destination.
- **Contextual sidebar:** the left panel changes with the active feature section.
- **Detail pane:** selected track and imagery details may open adjacent to the
  contextual sidebar without replacing or remounting the map.
- **Persistent map:** the map remains the primary canvas across rail changes, detail
  selection, dialogs, and developer tools.

## Desktop workspace

The Material UI shell is a map-first desktop workbench. The compact rail and contextual
sidebar occupy the left edge; the persistent map uses the remaining viewport. Native map
navigation remains on the right, and the 2D/3D selector sits directly below it. The
shell uses the shared sky-blue, blue-green, deep-space, amber, and orange palette with
derived surface, border, status, and tag colors.

The current shell implements all four rail destinations and honest empty or disabled
states for unavailable feature behavior. It has no full-width app bar, empty global
elevation placeholder, or generic always-visible privacy notice.

- Owner: `src/presentation/shell`.
- Visual tokens: `src/presentation/theme/appColors.ts` and the Material UI theme.
- Durable setting: developer-mode preference in Dexie.
- Fallback: `?developer=1` enables diagnostics even when stored settings cannot load.
- Failure boundary: uncaught React errors render a support-bundle fallback.

## Feature surfaces

### Tracks

Tracks combines the read-only global catalog and browser-local GPX tracks in one
library. The contextual sidebar contains `Create GPX`, Import GPX, search, filter, sort,
curated categories, personal nested folders, and global/local track results. Personal
folders store a user's organization without modifying global assets.

Selecting a track draws its geometry on the map and opens an adjacent detail pane with
source, tags, metrics, folder/download actions, calculation provenance, and a contextual
elevation profile. The full original GPX is loaded only when requested. Import retention
and privacy guidance appears at the relevant preview/confirmation step instead of as a
permanent workspace banner.

The current implementation shows the Tracks structure and disabled actions but does not
load a catalog, import GPX, manage folders, or open track details.

### Create GPX

`Create GPX` starts the manual waypoint workflow from Tracks. Users add, move, remove,
and reorder waypoints connected by visibly straight geodesic segments. The workflow owns
waypoint names, notes, appearance, distance/elevation metrics, local draft saving, and
GPX export. Its elevation chart uses the same calculation and provenance vocabulary as
selected-track details.

The current implementation exposes a disabled `Create GPX` action; waypoint editing,
calculation, persistence, and export are unavailable.

### Satellite

Satellite uses a compact `Viewport | <coordinates>` search-area selector. Viewport is
the default source; Marker becomes available when a saved marker can supply the search
target. The sidebar also contains date range, cloud threshold, L1C/L2A choice, and the
search action.

Results compare acquisition date, platform, product level, cloud cover, coverage, and
scene-edge warnings. Applying a concrete scene draws its true-color imagery and
footprint without resetting other workspace state. The adjacent metadata pane exposes
acquisition, tile/orbit/product identity, attribution, fit-footprint, and imagery
visibility actions.

The current implementation shows live viewport coordinates and the compact selector.
Marker targeting, date/product filters, search, results, metadata, and imagery rendering
are unavailable.

### Markers

Markers supports adding, searching, sorting, grouping, and filtering saved markers,
including a current-view subset. Selected marker details edit name, icon, color,
coordinates, terrain-derived elevation, and preferred map scale.

A marker can become a Satellite search target or be copied into Create GPX. Copying
transfers coordinates and supported appearance/provenance values; marker and waypoint
identities remain separate, so subsequent marker edits do not mutate the waypoint.

The current implementation provides the Markers rail destination and an empty state;
marker creation, persistence, organization, editing, and cross-feature actions are
unavailable.

### Layers

Layers controls supported visibility, opacity, and ordering within typed map-layer
bands. Changes affect the persistent map while preserving attribution and the required
relationship among satellite imagery, hiking references, tracks/Create GPX geometry,
markers, and interaction highlights. It is not a generic unrestricted layer editor.

The current implementation provides the Layers rail destination and an empty state;
interactive layer management is unavailable.

## Persistent map controls

- Place-or-coordinate search is overlaid on the map. The current search field is
  disabled.
- Native zoom and compass/navigation controls remain on the right.
- The 2D/3D selector is a separate control group immediately below the compass stack.
- Attribution remains visible in every feature section and terrain mode.
- Selection legends, elevation charts, and imagery footprints appear only when their
  corresponding geometry exists.

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

## Current capability boundary

The application does not currently provide GPX catalog loading, GPX import, Create GPX
editing/export, track elevation charts, saved-marker management, interactive layer
management, Sentinel-2 search/rendering, offline-region downloads, accounts, or cloud
synchronization.
