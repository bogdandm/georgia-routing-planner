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

The Material UI shell is a map-first desktop workbench. The map always fills the
viewport; the rail, contextual sidebar, and detail pane form one floating surface above
it. Changing sections or opening a pane therefore never changes the map viewport. Native
map navigation remains on the right, and the 2D/3D selector sits directly below it. The
shell uses the shared sky-blue, blue-green, deep-space, amber, and orange palette with
derived surface, border, status, and tag colors.

The current shell implements all four rail destinations and honest empty or disabled
states for unavailable feature behavior. It has no full-width app bar, empty global
elevation placeholder, or generic always-visible privacy notice.

- Owner: `src/presentation/shell`.
- Visual tokens: `src/presentation/theme/appColors.ts` and the Material UI theme.
- Durable settings: developer-mode and collapsed-navigation preferences in Dexie.
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

Satellite uses a compact `Point | <coordinates>` search-area selector. Point uses the
submitted viewport center; Marker becomes available when a saved marker can supply the
search target. The catalog returns only scenes whose footprint intersects that immutable
point, while the full submitted viewport is retained for client-side coverage. The
sidebar shows a read-only acquisition calendar, an L2A scene-cloud slider, and the
latest-images action. Users do not construct a date range. L1C is not exposed in the
current MVP UI.

Results live in an adjacent right pane and compare acquisition date, platform, product
level, cloud cover, and coverage. Cards within one acquisition day sort by acquisition
time descending. Date and time share one line, localized with the IANA time zone
resolved offline from the submitted search coordinates; platform text is omitted. The
first eight latest images are visible initially; `Load more images` reveals the next
bounded set and then continues into preceding calendar months using the submitted
viewport and filters. A warning appears only when the scene border is less than 5 km
from the submitted search anchor. Scene cards are the selection and future apply target;
there is no separate Apply button or tile/orbit tag row. Coverage at 50% or below is a
yellow tag; higher coverage is plain text. Cloud cover at 70% or higher is a red tag;
lower cloud values are plain text. Every card remains an individual scene; mosaics are
not currently composed.

The displayed calendar month is the search month. The current month ends at today;
earlier months cover their complete UTC month. After the first search, calendar arrows
load a displayed month only when that month has not completed successfully for the
submitted point, viewport, product, and cloud criteria. Successful months, including
empty ones, are reused when navigating back. Newly loaded scene groups are appended to
the right results pane without replacing other months or resetting the displayed
calendar month.

Scenes sort by acquisition time and cards group by month in the right pane. The calendar
annotates each loaded day with the scene-cloud average weighted by each scene's viewport
coverage. Days at or below the current cloud slider receive a subtle orange highlight;
non-matching days retain only their cloud percentage without a tile outline. After
locally loaded cards are revealed, the same load-more action fetches the next missing
preceding month and appends it, continuing back through the Sentinel-2 archive.
Whole-card click selects, expands metadata, and applies that concrete scene through the
shared map adapter. A validated L2A item is rendered from its separate red, green, and
blue reflectance COGs as correctly georeferenced Web Mercator tiles below hiking
references. The full reflectance range is mapped before display gamma so snow detail is
not lost through the already stretched 8-bit TCI asset. The real polygon or multipolygon
footprint is a separate orange outline above hiking geometry and below labels. While a
replacement is loading the prior usable image remains present; a failed replacement
reports a safe error and leaves that prior image available. Marker targeting remains
unavailable.

Clicking a loaded calendar date selects the scene with the highest viewport coverage for
that date, reveals its batch if needed, expands its card, and scrolls it into view.
Coverage ties retain the existing acquisition-time order. The shortcut never reopens a
results pane that the user closed. The same shortcut applies the selected scene through
the card command path.

The expanded applied card shows validated acquisition, tile, orbit, product,
edge-distance, and attribution evidence. `Fit footprint` preserves pitch and bearing;
`Hide imagery` stops the raster without discarding results, selection, or the footprint.
The Satellite sidebar and results stay mounted but hidden across rail changes, so a user
can inspect Layers and return without losing the search session.

If the initial cards do not occupy most of the adjacent pane, the UI automatically
reveals another local set or fetches preceding months, with a small bounded number of
automatic month requests. The same load-more button remains available for further manual
archive traversal.

Each primary workspace destination has a shareable URL anchor: `#tracks`, `#satellite`,
`#markers`, or `#layers`. Loading an anchored URL restores that tab, and changing tabs
updates the anchor.

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

Layers groups durable controls under explicit source headings: Copernicus Sentinel-2
through the configured satellite catalog, and OpenStreetMap through the configured
vector provider. The checkboxes cover Satellite imagery, Scene footprint, Hiking paths,
Roads, and Places and POIs. Each logical ID maps to an allowlisted set of stable
MapLibre layer IDs; arbitrary native IDs never cross the UI boundary. Satellite controls
remain disabled until a scene is applied. Hiding imagery retains the applied scene and
does not remove its footprint, search results, or attribution contract. Base land and
water remain visible and cannot be disabled. Opacity, drag ordering, custom layers are
unavailable. Checkbox state and the last successfully applied scene are stored locally
and restored after refresh.

## Persistent map controls

- Place-or-coordinate search is overlaid on the map. The current search field is
  disabled.
- A lightweight line below search reports readiness, pending work, or safe failures.
- Navigation collapses with a short transition to only the clickable GR mark.
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

The diagnostics drawer is a persistent, non-modal workspace surface: it has no backdrop
or elevation shadow and does not close on Escape, backdrop interaction, or section
changes. The header close control and the active Diagnostics rail button are the only
normal close actions, so the map and feature controls remain usable while diagnostics
are observed. Drawer tabs use their own compact light-surface treatment rather than the
dark navigation-rail tab styling.

The `Sentinel query` tab exposes one local current-or-last-operation timeline. It always
lists viewport capture, criteria construction, STAC request, pagination, validation,
scene mapping, coverage/grouping, visual-asset selection, decode/reprojection, and map
application. Each row shows an explicit waiting, running, completed, failed, cancelled,
or skipped state and a monotonic duration that refreshes while work is active. Search
and imagery-application operations publish their transitions in real time. The render
operation records visual-asset selection, provider reprojection, and MapLibre
application without exporting the COG or tile URL. The timeline is memory-only and does
not expose raw payloads, exact geometry, provider URLs, headers, tokens, or raw
failures.

Schema-version 2 exports include build/runtime data, bounded events, health results,
notes, and a serializable map snapshot. Exported longitude/latitude are rounded to 0.1
degree; route geometry, raw provider URLs, tokens, headers, paths, and filenames are
excluded. The inspection CLI migrates supported version 1 bundles.

Local checks cover browser APIs, WebGL, map readiness, IndexedDB, and quota. Vector and
terrain reachability run only on explicit request and accept an `AbortSignal`; normal
startup never waits for them.

## Configuration and security

`VITE_MAP_PROVIDER_CONFIGURATION` is optional public JSON validated by Zod. Endpoints
must be HTTPS or application-relative; terrain and satellite renderer template tokens,
supported tile sizes, zoom ranges, policy limits, layer mappings, and attribution are
validated. The Sentinel renderer template accepts `{z}`, `{x}`, `{y}`, and an encoded
`{itemUrl}`. Safe errors report an issue count without echoing the payload. `VITE_*`
configuration must never contain secrets.

## Current capability boundary

The application does not currently provide GPX catalog loading, GPX import, Create GPX
editing/export, track elevation charts, saved-marker management, interactive layer
management, offline-region downloads, accounts, or cloud synchronization. Satellite
provides live viewport search for L2A scenes with a scene-cloud control. Successful
results are grouped by UTC acquisition day and show a thumbnail, local acquisition time,
processing level, cloud, viewport coverage, and sub-5-km edge warning. Selecting a card
renders one georeferenced true-color scene and its footprint; Layers can hide or restore
the raster and related logical map groups.
