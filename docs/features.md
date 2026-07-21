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
- Durable settings: developer mode, collapsed navigation, and Sentinel imagery render
  mode/stretch preferences in Dexie.
- Settings uses compact `General`, `Rendering`, and `Storage` tabs. Storage shows only
  the measurements the browser supplies: origin usage and quota, IndexedDB, Cache
  Storage, localStorage, residual origin data, and Chromium's optional JavaScript heap
  estimate in megabytes.
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
earlier months cover their complete UTC month. The provider search loads the complete
0–100% scene-cloud range. The cloud slider filters scene cards client-side while every
loaded acquisition date remains visible in the calendar; dates at or below the threshold
receive the orange highlight. Selecting a date above the threshold temporarily reveals
its selected scene card; de-applying it or selecting another scene restores the filter.
After the first search, calendar arrows load a displayed month only when that month has
not completed successfully for the submitted point, viewport, and product. Successful
months, including empty ones, are reused when navigating back. Newly loaded scene groups
are appended to the right results pane without replacing other months or resetting the
displayed calendar month.

Scenes sort by acquisition time and cards group by month in the right pane. The calendar
annotates each loaded day with the scene-cloud average weighted by each scene's viewport
coverage. Days at or below the current cloud slider receive a subtle orange highlight;
non-matching days retain only their cloud percentage without a tile outline. After
locally loaded cards are revealed, the same load-more action fetches the next missing
preceding month and appends it, continuing back through the Sentinel-2 archive.
Whole-card click selects, expands metadata, and applies that concrete scene through the
shared map adapter. TiTiler normally renders a validated L2A item's separate red, green,
and blue reflectance COGs as georeferenced Web Mercator tiles below hiking references.
Settings exposes persistent reflectance ceiling, gamma, and saturation controls for this
hosted rendering path. Fresh storage and reset use a reflectance ceiling of 11000, gamma
2.25, and saturation 2.50; saved tuning takes precedence.

The real polygon or multipolygon footprint is a separate orange outline above hiking
geometry and below labels. Selecting a different scene immediately removes the current
scene and footprint, restores the vector basemap, and loads only the requested scene. A
failed application reports a safe, clickable error. The detail distinguishes rejected
values, rate limiting, renderer availability, and an unclassified unusable tile without
exposing provider URLs.

A render dropdown mirrored in Settings > Rendering and Satellite selects `Auto`,
`Server`, or `Direct`. Auto switches a hosted-renderer 429 or CORS-opaque status-zero
failure to direct range reads of the scene's pre-rendered 8-bit visual COG without
retrying TiTiler. Server never falls back, and Direct bypasses TiTiler entirely. The
visual COG is displayed as supplied; reflectance, gamma, and saturation controls are not
applied to it. Tiles become visible individually while the vector basemap remains
available below them, and satellite rendering has no application deadline.

A successful automatic fallback replaces Ready with a persistent, non-blocking warning
that TiTiler is unavailable and the alternative imagery provider is being activated or
is active. Choosing Direct explicitly does not show that warning. The warning clears
when a later server render succeeds, the user explicitly changes rendering mode, or
imagery is removed. A mode change cancels the partial replacement and reapplies the same
selected scene while keeping the current scene available until the replacement produces
data. The mode choice is stored immediately, including during a pending or failed
render. Marker targeting remains unavailable.

Storage reporting is read-only. Browser-managed HTTP and MapLibre tile caches are not
exposed through the web storage APIs, so the application neither claims their size nor
offers a misleading clear action. Replaced Sentinel raster sources are removed from the
live MapLibre map after a successful swap, and failed staging sources are discarded.

Clicking a loaded calendar date selects the scene with the highest viewport coverage for
that date, reveals its batch if needed, expands its card, and scrolls it into view.
Coverage ties retain the existing acquisition-time order. The shortcut never reopens a
results pane that the user closed. The same shortcut applies the selected scene through
the card command path.

The expanded applied card shows validated acquisition, tile, orbit, product,
edge-distance, and attribution evidence. `Fit footprint` preserves pitch and bearing;
`Hide imagery` stops the raster without discarding results, selection, or the footprint.
Clicking the already applied scene card de-applies it, removes its raster and footprint,
and clears the saved applied scene. After refresh, a restored scene opens the Images
pane as one selected entry so it can be de-applied without repeating a catalog search.
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

Layers groups durable controls under explicit source headings: Copernicus Sentinel-2,
the configured terrain provider, and OpenStreetMap. The checkboxes cover Satellite
imagery, Scene footprint, Relief shading, Elevation isolines, Hiking paths, Roads, and
Places and POIs, plus Natural features and Restricted areas. The single **Natural
features** checkbox controls vegetation, glacier, wetland, and water-body polygons;
waterway lines and labels remain navigation context. The OpenStreetMap controls remain a
single flat list with one shared opacity slider. While satellite imagery is visible, the
slider scales the five controlled OpenStreetMap feature families together while
preserving their relative visual weights and individual visibility choices. It is
disabled in vector-only mode. Every map data source added to the application must appear
under its provider heading in Layers; each user-visible feature family from that source
receives an explicit control unless it is part of the required base canvas. Each logical
ID maps to an allowlisted set of stable MapLibre layer IDs; arbitrary native IDs never
cross the UI boundary. Satellite controls remain disabled until a scene is applied.
Hiding imagery retains the applied scene and does not remove its footprint, search
results, or attribution contract. Relief and isoline visibility are independent of 3D
terrain mode and satellite availability. Base land remains visible and cannot be
disabled. Per-layer opacity, drag ordering, and custom layers are unavailable. Checkbox
state, shared OpenStreetMap opacity, and the last successfully applied scene are stored
locally and restored after refresh. The last successful imagery stretch is stored with
those preferences and applied before a saved scene is restored.

## Persistent map controls

- Place-or-coordinate search is overlaid on the map. Submitted place searches begin in
  the visible viewport, then repeatedly double the bounded search area up to a 500 km
  radius from the original viewport center. Results from every area are appended as they
  arrive and deduplicated, so a nearby street name does not hide a more distant
  settlement with the same name. Direct coordinates remain local and do not contact the
  place provider. The result list shows each match's geodesic distance from that center.
  It shows settlements, administrative place boundaries, mountains, and water features
  by default. Squares, streets, businesses, and other POIs remain behind an explicit
  **Show other results** action. A fixed-height, full-width progress bar shows outward
  expansion against the 500 km maximum without shifting completed results. Map pan,
  zoom, and camera controls do not dismiss results or cancel an active search.
  Nominatim's open-ended OSM tags are shown as readable labels; only explicitly reviewed
  geographic tags enter the default list and unknown tags stay in other results.
- A lightweight line below search reports readiness, pending work, or safe failures;
  selecting an error opens its complete safe detail.
- Navigation collapses with a short transition to only the clickable GR mark. The GR
  square keeps the exact same size and viewport position in both states so the remaining
  navigation appears to retract into that fixed anchor.
- Settings is non-modal and does not dim or block the map, allowing imagery stretch to
  be judged while a slider is adjusted.
- Settings > Rendering controls the default-enabled invalid DEM repair, minor contour
  spacing, and whether relief shading sits above satellite imagery. Index contours
  remain labeled at 200 m intervals.
- Native zoom and compass/navigation controls remain on the right.
- The 2D/3D selector is a separate control group immediately below the compass stack.
- Clicking the map opens an anchored, accessible point-inspection popup with formatted
  coordinates, terrain elevation, and the nearest validated OSM point of interest within
  100 m. While any part of that popup intersects the map viewport, the next map click
  only closes it; a subsequent click opens a new inspection. If camera movement puts the
  popup entirely outside the viewport, the next click immediately replaces it.
- Attribution remains visible in every feature section and terrain mode.
- Selection legends, elevation charts, and imagery footprints appear only when their
  corresponding geometry exists.

Map interaction keeps MapLibre's camera behavior while adapting the desktop orbit
gesture to the middle mouse button: left drag pans, the wheel and double-click zoom,
arrow keys pan, `+`/`-` zoom, and Shift+arrow keys rotate or pitch after the canvas
receives focus. Middle drag is disabled in flat 2D. In 3D it rotates and pitches at a
restrained sensitivity around the terrain point beneath the initial press; each pointer
update is one zero-duration MapLibre camera command with that geographic `around`
anchor. A small blue-ring MapLibre marker identifies that pivot only while the middle
button remains pressed; it follows terrain and disappears when covered, released, or
returned to 2D. Right drag is left to the browser and does not move the camera. MapLibre
retains projection, terrain anchoring, camera limits, movement events, and the native
compass reset. The explicit 2D command returns pitch to zero and bearing to north, while
3D restores the last useful terrain pitch. Settled results continue through the existing
map-view persistence queue.

## Hiking basemap

The pure style factory maps validated OpenMapTiles source-layer names to land, water,
boundaries, vegetation, glaciers, provider-identified restricted land, roads, paths,
steps, hiking POIs, peaks, and labels. Source/layer IDs and ordering are stable
contracts. Unsupported hiking route relations are not invented.

One semantic palette owns all map colors. The vector-only mode uses a warm neutral-grey
base with opaque land-cover fills so overlapping source polygons cannot create
accidental shades. Grass and farmland stay close to the neutral base instead of reading
as yellow surfaces; forests and scrub carry the stronger green distinction. When
satellite imagery is visible, vegetation, land-use, park, and glacier fills are removed;
the imagery supplies that surface context while orange transport lines, blue contours,
and white label halos retain contrast. The style does not derive decorative boundaries
from tiled surface polygons; the intentional red military perimeter is the only
restricted-area outline. Imported and user-created GPX tracks reserve a brighter blue
than the contour family so route geometry remains distinguishable.

Waterway lines and water-body polygons use the same blue. Waterways render first, so
lake and reservoir polygons cover river centerlines where the geometries overlap.

Labels prefer `name:en`, then the provider's `name:latin` transliteration, before legacy
English and native-name fallbacks. A native Georgian label can therefore remain when the
source supplies neither an English name nor a Latin transliteration; the client does not
invent spellings at render time.

Military polygons are shown with a medium red perimeter and no fill. The current
OpenMapTiles land-use schema does not expose a general private-access or ownership
field, so the map does not claim to identify every private or otherwise closed property.

- Default vector source: OpenFreeMap TileJSON; attribution stays visible.
- Invalid configuration: MapLibre does not mount; a safe fatal message is shown.
- Vector/glyph failures: the existing canvas remains usable and the aggregated safe
  failure appears only in the shared status below search.
- Tests: pure style assertions plus synthetic MVT/glyph Chromium coverage.

## Map-view persistence

The map starts only after the last valid camera and terrain mode are read, preventing a
visible jump from the Georgia overview to the saved position. `moveend` sends settled
map views to a debounced persistence queue; successful 2D/3D transitions publish their
mode explicitly. Animation-frame events are never persisted. A restored 3D view enables
terrain as soon as the native map is ready instead of leaving a pitched flat view.

- Stored value: schema-version 2 `map.camera` record containing camera and terrain mode
  in the existing Dexie settings table. A schema-version 1 camera migrates to 3D when it
  has a positive pitch and otherwise migrates to 2D.
- Validation: finite values are clamped to supported longitude, latitude, zoom, bearing,
  and pitch ranges.
- Corrupt value: delete it, log a repair event, and use the Georgia overview.
- Failed or non-settling storage: show a warning and mount with the overview after a
  bounded wait.
- Teardown: flush the most recent pending camera without blocking React unmount.

## 2D and 3D terrain

The configured `raster-dem` source is always available to low-contrast relief shading.
Client-side contour generation reads bounded DEM tiles and renders subdued minor lines
plus emphasized, labeled 200 m index lines from zoom 11. Minor spacing defaults to 50 m
and supports 20, 25, 40, 50, or 100 m so every choice divides the index cadence.

DEM repair and contour calculation normally run in one dedicated terrain worker. Camera
movement continues DEM work but defers newly requested contours until movement settles;
existing contour tiles remain under MapLibre's normal retention rules. If the worker
channel or returned data cannot recover after one restart, the same calculations
continue inline for that page session and Settings > Rendering shows a non-blocking
compatibility warning that movement may be slower. Provider, decode, and calculation
failures remain isolated to their individual requests and do not switch execution mode.
A successful worker session has no warning; a new page session tries the worker again.

While terrain work is active, the Ready status below search also shows the execution
mode, exact number of queued contour jobs against the 32-job bound, and any currently
active work. The secondary line is absent when the worker is idle. This workload summary
is transient and contains no tile coordinates or provider URLs.

Relief normally sits below satellite imagery; the Rendering setting moves it above the
active raster without remounting MapLibre. Contours remain above both and below OSM
roads, paths, labels, and POIs. Preferences are validated and stored locally with the
existing map-layer record. Provider failure leaves unrelated layers and controls usable.

The 2D/3D control operates on the same MapLibre instance and shared DEM source. Enabling
3D applies terrain, restores a useful pitch, and waits for the source to become usable.
Disabling terrain returns pitch and bearing to zero while retaining center and zoom.

- Duplicate clicks share one in-flight transition.
- Conflicting transitions fail explicitly instead of racing.
- DEM error, cancellation, or timeout returns to 2D and preserves camera intent; the
  controller keeps ownership of the shared source so relief can recover on later tiles.
- Failed 3D enable requests retry twice with bounded backoff, reusing the same facade
  and map rather than remounting either. Exhausted failures remain in the shared status
  line below search; the map does not mount a separate warning or retry banner.

Before the shared DEM source is decoded by MapLibre, the client repairs only transparent
or configured-invalid values and isolated extreme local outliers. Decisions at tile
borders use neighboring source pixels. Valid terrain is not smoothed, and the same
corrected PNG cache supplies relief, 3D, and elevation isolines.

## Failure and offline feedback

Map errors are classified as vector, glyph/sprite, satellite raster, terrain, style,
WebGL, or unknown. Satellite raster failures expose a safe transport reason and exact
HTTP status when MapLibre provides one. Rate limits and status-zero/no-response failures
do not retry the hosted renderer because a cross-origin 429 without CORS headers is
indistinguishable from a connection failure in application code. In Auto mode both
switch the existing source to direct pre-rendered visual-COG rasterization; Server mode
reports the failure without fallback. Server responses and identifiable network failures
schedule one deduplicated exponential refresh of the failed tiles, capped at three
attempts; other client errors and unclassified failures also do not retry automatically.
Equivalent recoverable errors are counted in capped buckets and logged at a bounded
interval. Style startup and WebGL loss are fatal; provider-tile and DEM errors are
degraded states. A pending scene also retries retryable transient failed tiles. If a
transient tile still fails after retries, the usable partial raster is promoted after
the bounded retries; the safe failure class remains visible. Non-retryable or
whole-source failures preserve the vector basemap. For active imagery, successful
source-data for each failed canonical tile must clear the controller's pending set
before a loaded source starts the stability window. Only that tile-confirmed recovery
restores the ready lifecycle when no other failure remains and clears the user-facing
error. This prevents the status from blinking while other tiles from the same source are
still failing. Offline messaging promises only that already rendered areas may remain
visible, not full offline map support. Map lifecycle and imagery errors do not create a
wide map banner: the shared line below search is their single UI surface. Ready remains
background-free; pending and error states use a lightly translucent surface for map
contrast, and selecting an error reveals its complete safe detail. Hovering any
truncated status message reveals the full text in a multiline tooltip. The non-ready
surface transitions quickly and remains translucent enough to preserve map context.
Pending text uses the dark primary color and a medium weight rather than the muted Ready
treatment, preserving legibility over imagery. Status padding is invariant so state
changes never shift the icon or text. Its compact terrain line appears only for active
work or a live contour backlog, without turning normal background work into an error or
blocking the rest of the map.

## Diagnostics and developer mode

Diagnostics are local, bounded, and redacted before storage in the event ring buffer.
The developer Map view shows exact local camera state, ordered source/layer IDs,
terrain, failures, idle time, WebGL capabilities, and temporary debug flags. Each
failure includes its source ID, safe reason, HTTP status when known, occurrence count,
last occurrence, recovery state, and retry attempt. Debug flags reset when developer
mode ends.

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
