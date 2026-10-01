# Features and workspace UX

This document describes the implemented workspace: layout, feature placement, control
grouping, and interaction behavior. [UI design guidelines](./ui-design.md) define
reusable presentation conventions; [data model](./data-model.md) owns persisted records
and privacy; [runtime flows](./runtime-flows.md) own internal sequencing and failure
mechanics; [map providers](./map-providers.md) own provider choice and limits. Correct
this document whenever it no longer describes the interface.

## Workspace vocabulary

- **Feature rail:** `Tracks`, `Markers`, `Layers`, `Satellite`, and `Weather` are the
  primary feature sections, in that order.
- **Global rail actions:** `User` appears immediately above `Settings`; `Diagnostics` is
  available when developer mode is enabled. `About this site` sits below Settings and
  opens author, repository, API, and data-source information.
- **Route planning:** starts from `Plan route` in the Tracks header. There is no
  separate planning destination.
- **Contextual sidebar:** the left panel changes with the active feature section.
- **Detail pane:** selected track and imagery details sit beside the sidebar at 1900 CSS
  pixels and above, and overlay the sidebar below that width.
- **Persistent map:** the map stays mounted as the primary canvas across rail changes,
  detail selection, dialogs, and developer tools.

Each workspace destination has a URL anchor: `#tracks`, `#markers`, `#layers`,
`#satellite`, `#weather`, or `#user`. Loading an anchored URL restores that tab, and
changing tabs updates the anchor.

## Smartphone workspace

Below 900 CSS pixels, the map is the default surface. **Open workspace** reveals the
full-height rail and contextual tools without remounting the map; **Show map** and the
Trail Planner logo return to the same map. An active track appears over the map as a
collapsed disclosure with distance, recorded time, ascent, and descent, drawn over a
decorative grade-colored profile when elevation is usable. An unsaved preview's
disclosure also offers **Track name** and **Save**. Expanding it reveals the full
editor; collapsing keeps the active track, while closing clears it.

An action whose result is on the map closes the workspace, and a map action whose result
is in a panel opens it. Opening a saved track, starting a route plan, importing a file,
panning to a track or marker, arming marker placement, route-plan **Undo** and
**Clear**, **Center map on forecast location**, applying Sentinel imagery, **Fit
footprint**, and **Show mosaic** all return to the map; reopening the workspace restores
the previous list or results. Settings controls keep the workspace open. From Weather,
**Select forecast point** closes the workspace and the chosen point reopens it on the
forecast. A shared-track link keeps the map first; an invalid link opens Tracks to show
its error. This presentation state is not stored.

## Desktop workspace

From 900 through 1899 CSS pixels, a selected track or imagery result overlays only the
contextual sidebar while the rail stays interactive. At 1900 CSS pixels and above, the
rail, sidebar, and detail pane form one floating surface above the full-viewport map.
Changing sections or opening a pane never changes the map viewport. One right-side
control column holds zoom, compass, geolocation, the 2D/3D selector, the quick map-layer
chooser, and the ruler.

Navigation collapses to the clickable Trail Planner logo, which keeps the same size and
position in both states. With an active track, the collapsed state also shows the
decorative profile-and-stats summary.

- Owner: `src/presentation/shell`; visual tokens in
  `src/presentation/theme/appColors.ts` and the Material UI theme.
- Settings is non-modal with `General` and `Storage` tabs. General offers
  English/Русский language selection and developer diagnostics. Without an explicit
  choice, the first English or Russian browser language is used, falling back to
  English. UI strings use Lingui catalogs in `src/locales`.
- Storage shows only browser-supplied measurements: origin usage and quota, IndexedDB,
  Cache Storage, localStorage, residual origin data, and Chromium's optional JavaScript
  heap estimate. Browser HTTP and MapLibre tile caches are not measurable, so no size or
  clear action is offered for them.
- `?developer=1` enables diagnostics even when stored settings cannot load.
- Uncaught React errors render a support-bundle fallback.

### User

**User** is a lower-rail action. With public Supabase configuration, a user can create
an email/password account and enable **Sync across devices**, which is off by default;
the app stays local-first. Saved tracks, track folders, and saved markers synchronize.
Signing in to a new or different account keeps valid browser data and prepares it for
upload while downloading that account's data. If synchronized tracks or markers were
deleted from the cloud, an **Items deleted from cloud** dialog lists them unchecked;
**Delete**, **Restore**, or **Delete selected, upload the rest again** applies the
choice, and unchecked items upload again.

The signed-in panel shows the email, the full User ID for support, compressed usage
against the quota including reservations, **Sync now**, and an item-count progress line
while synchronizing. The User rail icon shows an orange dot while synchronization runs
or needs a decision, red after failure, and green after success. After three HTTP 500
responses the page stops sending synchronization requests until reload. See
[runtime flows](./runtime-flows.md#explicit-cross-device-synchronization).

## Feature surfaces

### Tracks

Tracks combines the browser-local track library with flat folders. The sidebar header
places the multi-track toggle immediately before `Plan route`; the scrollable content
owns file import, search, sorting, folder management, and the track list. Import privacy
guidance appears at the preview step rather than as a permanent banner.

#### Import

One `.gpx`, `.fit`, or `.kml` file is imported from the picker row or by dropping it
anywhere in the app onto the drop card that appears during a file drag. FIT Activity and
Course files must pass Garmin SDK integrity validation and contain geographic records.
KML accepts `LineString`, `MultiGeometry`, `gx:Track`, and `gx:MultiTrack` without
fetching external resources; KMZ and geometry-free files are unsupported. An accepted
file opens Tracks with a **New track** preview pane. File and parse errors appear in the
import zone and dismiss after five seconds; validation warnings show their parser code
and point/segment context. Unsaved previews activate the leave-site guard.

The embedded or filename-derived name stays editable and is never replaced
automatically. An optional English place candidate appears as a separate **English place
name** field and needs an explicit apply. Multiple segments are named as one journey:

- One-way: `Start → Finish`, plus `via Landmark` when a dominant summit has one
  (`Juta → Roshka via Chaukhi Pass`).
- Closed tracks that mostly retrace their way back: `Landmark from Start`; other closed
  tracks: `Landmark loop from Start`. The landmark is at the dominant summit or, without
  one, the point farthest from the start.
- Missing parts are omitted, a landmark repeating an endpoint is dropped, a one-way
  track ending in its starting settlement reads as `Landmark from Start`, and the
  `via`/`from` part is dropped above 80 characters.

Endpoints prefer a city, town, village, or hamlet within 1 km, then a ranked landmark,
then a settlement within 3 km; districts and municipalities never name a track.
Landmarks rank passes, saddles, and peaks within 1 km, then lakes, glaciers, and
waterfalls, then huts, viewpoints, historic sites, shelters, places of worship, and
settlements within 2 km, weighting each class by distance. Labels without an English or
Latin name are romanized: Georgian as on road signs, without apostrophes and with `ყ` as
`k` (`ყელიდა` → `Kelida`); Cyrillic by BGN/PCGN without diacritics or soft/hard-sign
marks. Passes gain a `Pass` suffix and peaks an `Mt.` prefix when missing. A failed
lookup is skipped, and a warning names the failed lookup and its reason, including
HTTP 429. When source elevation is usable, Save keeps the source points as canonical and
stores the calculated Terrarium projection separately; otherwise the Terrarium
projection becomes the canonical elevation. The original file bytes are discarded after
parsing.

GPX import also reads bounded root `<wpt>` elements as track markers. Blank names become
`Marker N`; invalid or excess waypoints are skipped with warnings and never count as
track geometry. FIT, KML, shared tracks, and route plans do not create track markers.

#### Route planning

**Plan route** opens a new unsaved-track pane and takes ownership of map clicks. The
first click sets the start; each later click adds a leg in the persistent **Next
segment: Routes | Line** mode. **Routes** snaps both ends to the detail-vector street
network and searches a walkable connection in a browser worker; **Line** adds a direct
segment. A pending routed leg reports tile download, graph construction, and search
progress, disables conflicting controls, and is cancelled by Undo or Clear. Routing has
a one-minute limit; a failed leg keeps the plan and offers a direct-line fallback
without changing the mode. Missing provider topology shows an unavailable state; there
is no backend or fallback routing service. Topology rules are in
[runtime flows](./runtime-flows.md#browser-route-planning).

After each accepted edit the browser samples terrain and recomputes metrics, profile,
grades, and climbs/descents. A terrain failure keeps geometry and distance and still
allows saving. Save locks editing while it writes through the local-track repository;
the result behaves like any saved track. Unsaved plans activate the leave-site guard.

#### Library and folders

Rows show a simplified shape thumbnail (orange for a loop, blue for one-way), the name,
recorded duration, distance, and elevation gain. A loop ends within 1 km of its start
and within half its length; thumbnails are computed and cached in the browser. Favorite
and delete controls appear on hover or focus on desktop and stay visible on smartphones;
active favorites always show. Deletion is two-stage inline confirmation from the row or
from **Delete track** in the detail action menu; pointer exit, Escape, or click-away
cancels it.

Sorting offers Newest, Oldest, Name, and Distance from map center, persisted locally.
Favorites sort first, and the sort applies inside every folder. Users create, rename,
re-icon, delete, collapse, and reorder flat folders; the icon picker offers the folder
glyph plus the marker icon catalog. Tracks and folders move by pointer, delayed touch,
or keyboard drag. Unfiled tracks list below the folders, and deleting a folder moves its
tracks there. New imports enter the **Imports** folder, which can be renamed, re-iconed,
and reordered but not deleted; saved route plans stay unfiled. Folder identity, order,
icon, and track placement synchronize with the account; the last synchronized reorder
wins as a whole. Collapsed folders are remembered in this browser only.

The track search field filters saved tracks by name, and the map search also lists up to
two matching saved tracks. The last opened saved track reopens after restart when still
valid.

#### Track detail

Selecting a track draws it in bright blue, fits its bounds around the open panes, and
opens a detail pane with metrics, actions, provenance, and an elevation profile. The
stats grid shows duration, distance, average speed, and **Elevation gain**/**Elevation
loss**; tracks with source elevation also list the calculated Terrarium gain and loss.
Without recorded time, duration is an **Estimated time** (`≈`) from DIN 33466 hiking
rates: 4 km/h horizontally, 300 m/h ascent, and 500 m/h descent, with the larger of the
horizontal and vertical times counted fully and the smaller by half. Breaks are not
included. Missing measurements are omitted. Source file, point/segment counts, and the
saved timestamp follow. Closing the track removes its geometry without moving the
camera. From 900 through 1899 CSS pixels, **Back to tracks** restores the prior list
state; at 1900 and above the pane stays adjacent and uses **Close track**.

The header offers **Download GPX** and a **Track actions** menu with favorite,
**Download KML**, sharing, **Rename** (an inline name editor), and **Delete track**.
Downloads preserve segments, name, canonical elevation, and aligned timestamps. GPX also
writes track markers as root `<wpt>` elements before `<trk>`; KML is geometry-only.

With usable elevation, the map colors every non-flat climb/descent grade subsegment of
the active track, leaving flat spans blue; chart and Climbs & Descents hover stay
panel-only. The interactive distance profile has axes, tooltip, and a map marker at the
highlighted point. Source elevation drives the profile, grades, and climbs unless it has
no complete run, in which case the Terrarium profile is used. On desktop and tablet, a
lower-right grade legend explains the colors; its dismissal persists and the profile
chart offers **Show track grade legend** to restore it.

Editable single tracks show a collapsed **Markers** section with an add action, map
navigation, inline rename, and two-stage deletion. Only the active editable track
renders its markers, smaller than saved markers. Track markers are stored in track
content and synchronize as track metadata without changing geometry or content hashes.

Tracks with an elevation profile show a **Weather forecast** section below Markers. It
starts collapsed; whether it is expanded is remembered in this browser for every track,
and forecasts load only while it is open. It begins with seven forecast dates from
today; choosing one remembers its weekday for all tracks, and the next Saturday is
selected until then. **By elevation** shows day and night forecasts at the highest,
median-elevation, and lowest profile points. **Along the route** assumes a 09:00 local
start and shows where the hiker is every three hours and at the finish, each with the
forecast at that location from its arrival hour until the next checkpoint; the finish
covers its arrival hour. The pace follows recorded timestamps when the track has
recorded time and otherwise the DIN 33466 estimate, so climbs advance more slowly than
flat walking. The timeline is offered only for day hikes shorter than 30 km and 10
hours. Cards reuse the 7-day forecast rows from Weather and request each location with
its profile elevation.

#### Multi-track view

The multi-track toggle enables a session-only mode in which row clicks add or remove
tracks in click order. Selected tracks share one bright-blue scene with grade overlays
where profiles exist. The read-only pane shows a **Selected tracks** header with
**Download selected tracks**, combined statistics, then statistics and a profile per
track. The download is `selected-tracks.zip` with one GPX per track, named from the
track with deterministic `Stem (2).gpx` suffixes for collisions. On smartphones, row
clicks keep the list open and **Show map** reveals a combined disclosure. An empty
selection closes the pane; the mode is never persisted.

#### Public track links

A signed-in owner of a synchronized saved track uses **Share** in **Track actions**.
Opening the menu loads the current status. The **Share** toggle enables or disables
public access; enabling copies the link, and **Copy share link** retrieves it later.
Disabling keeps the track synchronized. Links use `#tracks/share/1.<token>`, keeping the
capability out of request paths and referrers. A recipient needs no account and sees the
owner's current snapshot read-only; **Save a copy** creates an independent local track.

### Markers

Markers is a library of named map points. **New marker** starts placement mode, and
**Create marker here** is available from the map point actions. A map click opens the
editor prefilled with the nearest inspected POI name; the user confirms the name, one of
130 searchable Pinhead icons in category tabs with a recently used section, and one of
ten theme colors before anything is stored.

The list uses the Tracks row pattern and sorts by newest, name, color, icon, or distance
from the map center (persisted); icon sorting follows catalog order, then distance. Rows
show the current distance, navigate the map, and support rename, appearance changes, and
two-stage deletion. Markers are stored in IndexedDB, synchronize with the account when
sync is enabled, and render as MapLibre symbols. Malformed stored rows are omitted and
logged.

The header's weather-settings action chooses one or two local weekdays (Saturday and
Sunday initially; none disables forecasts) and one interval: the Weather daylight
period, the night period, or a custom whole-hour range that may cross midnight. **Show
forecasts on the map** completes this browser-local preference.

While Markers is open, each marker gets one forecast at its coordinate; its terrain
elevation is resolved once and stored on the marker. The list labels each forecast date
column once, in date order, and each row shows one clickable cell per date with icon,
temperature range, and precipitation. With map display enabled, a compact overlay with
the name and the same cells replaces the marker symbol until Markers closes. A cell
opens the floating 24-hour table used by Weather, starting at the interval boundary; its
**Open in Weather** loads the full forecast at the marker.

### Layers

Layers groups controls under source headings: Weather, Local GPX, Satellites, the
terrain provider, and **OpenStreetMap via OpenFreeMap + OSM Shortbread**. Every map data
source must appear under its provider heading, with an explicit control for each
user-visible feature family outside the base canvas. Logical IDs map to allowlisted
MapLibre layer IDs; native IDs never reach the UI.

- **Weather:** turning the weather map on routes to the Weather tab; turning it off and
  its opacity work here.
- **Local GPX:** Imported tracks, the default-on **Elevation gradient**, and one opacity
  for the active preview, saved selection, and gradient.
- **Satellites:** **Google satellite imagery**, **Bing aerial imagery**, **Esri World
  Imagery**, **NAPR Orthophoto**, then Sentinel-2 **Satellite imagery** and **Scene
  footprint**, enabled once a scene is applied. The imagery sources are mutually
  exclusive and may all be off. NAPR renders the newest available aerial pixels from
  2025, then 2020, then 2016–2017. Hiding Sentinel imagery keeps the scene, footprint,
  and results.
- **Terrain:** relief shading, elevation isolines, contour spacing, and invalid-DEM
  repair.
- **OpenStreetMap:** **OSM detail**, Hiking paths, Roads, Places and POIs, Natural
  features, Restricted areas, and one opacity that applies to OSM layers and isolines
  while a raster is active.

Visibility, opacities, imagery choice, rendering mode, stretch, and terrain preferences
persist locally. Sentinel scene data is never persisted; imagery starts empty unless a
share URL requests a scene. Per-layer opacity, drag ordering, and custom layers are not
offered.

The quick map-layer chooser lists **Vector OSM**, **Google Satellite**, **Bing Aerial**,
**Esri World Imagery**, and **NAPR Orthophoto**, then **OSM overlay** and **Weather**
checkboxes, and a final row with **Sentinel-2** (activates the applied scene or opens
Satellite) and **Layers tab**. Vector OSM shows the vector map at full opacity without
changing the saved overlay setting.

### Satellite

The search area is a compact `Point | <coordinates>` selector. Point uses the viewport
center at submission; **Search satellite scenes here** in the map point actions sets a
read-only Custom point until the map moves or Point is chosen. A Marker option is shown
disabled. Only L2A scenes are searched; the catalog returns scenes whose footprint
intersects the point, and the submitted viewport is kept for coverage.

The sidebar has an acquisition calendar, a **Maximum cloud** slider (default 50%,
persisted), **Search images**, and rendering settings. The calendar month is the search
month; months are fetched on demand with a short debounce, cached per search, and
cancelled when superseded. Days show viewport-coverage-weighted cloud and are
highlighted when at or below the slider, which filters cards client-side. Clicking a day
selects and applies its highest-coverage scene. Calendar controls include a
current-month shortcut and a non-modal month-year picker; months outside the archive are
disabled.

Results open in an adjacent pane grouped by month, newest first, with acquisition time
in the search point's local time zone, product level, cloud, and viewport coverage. A
warning appears when the scene edge is within 5 km of the search point. **Load more
images** reveals further cards and then earlier months; a sparse pane auto-loads a few
more months. Clicking a card selects, expands, and applies that scene; clicking the
applied card removes its imagery. The expanded card shows acquisition, tile, orbit,
product, edge distance, and attribution, plus **Fit footprint** and **Share link**. At
desktop widths the Satellite session survives rail changes.

TiTiler normally renders the L2A red, green, and blue reflectance COGs below hiking
layers, with persistent reflectance-ceiling, gamma, and saturation controls; the
footprint is an orange outline. The render selector offers `Auto`, `Server`, and
`Direct`: Auto switches a TiTiler 429 or status-zero failure to direct reads of the
scene's visual COG and shows a persistent warning; Server never falls back; Direct skips
TiTiler. Stretch controls do not apply to the visual COG. Changing the mode reapplies
the scene through the new provider. A switch moves relief shading above the imagery.
Failures show a safe, clickable error without provider URLs.

#### Mosaic

The **Mosaic** toggle beside the heading switches to a viewport-filling L2A mosaic. Its
calendar selects an inclusive end date; dates before the Sentinel-2 archive start (23
June 2015) and future dates are disabled. Mosaic offers the render selector only.

**Show mosaic** needs a settled 2D map. It searches the viewport backwards from the end
date without a cloud filter, keeping newer scenes only when they add coverage, until the
viewport is fully covered, the archive is exhausted, or a bounded scene budget is
reached. Scenes appear as each loads; the status line shows progress, and the sidebar
shows coverage, rendered-image count, and date range afterwards. Changing the date
cancels work and clears the mosaic; moving the map refreshes it for the next settled
viewport. Mosaic and a single scene are mutually exclusive, and Mosaic disables 3D.
Mosaic state is transient and never shared in URLs. See
[runtime flows](./runtime-flows.md#sentinel-mosaic).

### Weather

Weather does not change map clicks by default. **Select forecast point** in its header
gives the next map click to Weather, with a crosshair cursor. The header overflow menu
links the selected point to Meteoblue and Windy. Marker placement and point selection
are mutually exclusive, and a hidden route draft does not capture clicks.

**Show weather map** enables one combined ECMWF IFS 0.25° layer of clouds,
precipitation, and wind arrows, fetched from Open-Meteo directly in the browser. It
temporarily turns off relief shading and isolines and restores them afterwards. While it
is on, every map click moves the forecast point, except explicit marker placement. The
weather stack sits below roads, paths, labels, routes, and markers; its color scales are
defined in `src/presentation/weather/weatherMapStyle.ts`.

A forecast-frame control below the status line offers a two-row day calendar and the
selected day's actual forecast times; clouds, precipitation, and wind always share one
frame. On tablet and desktop it also shows a legend and a Windy link for detailed wind.
The Ready line reports loading progress. Opacity persists locally; the enabled state,
forecast point, and frame are kept in the URL and restored on reload.

A completed forecast places one map marker with the **Now · next 3 h** Meteocon,
temperature, and precipitation. The panel shows a clickable location row (named POI
within 500 m, otherwise the coordinate, plus elevation) that recenters the map, then a
summary card with the current period and the day and night outlook, a 24-hour hourly
table, and a seven-day outlook. Weather artwork is one monochrome Meteocon per
condition; precipitation takes priority, and significant fog, haze, or poor visibility
selects a complete Meteocon instead of an extra badge. Icons expose labels on hover,
focus, and tap.

The hourly table has exactly 24 one-hour columns from the current local hour with rows
Time, Weather, Temp (°C), Precip (mm), Wind (m/s), Gusts (m/s), Cloud (%), and
Visibility (km), with a temperature curve and precipitation bars. It scrolls with
buttons or mouse drag and can expand to show all columns. Wind direction is not shown.

The seven-day outlook shows one card per date with Day and Night rows. Night `D` runs
from the end of daylight on `D` to the start of daylight on `D+1`, so local midnight
never splits a night; an eighth fetched date completes the last night. Each row shows
the dominant sky, precipitation pattern, temperature, wind, and gust ranges in m/s, and
the precipitation total. Activating a row opens a non-modal floating 24-hour table for
that period that closes on Escape, outside click, or panel scroll.

Only the latest point request updates the panel; Retry repeats the current point. The
model update time and `Weather data by Open-Meteo` attribution stay at the panel bottom.
Forecast responses are session-only. ECMWF IFS values are model forecasts, not station
observations.

## Persistent map controls

- **Search:** place-or-coordinate search starts in the viewport and doubles the area up
  to a 500 km radius, appending deduplicated results with their distance. Coordinates
  stay local; unlabeled pairs are `latitude, longitude`, matching **Copy coordinates**.
  Settlements, boundaries, mountains, and water features show by default; other results
  sit behind **Show other results**. Map movement does not dismiss or cancel a search.
  Up to two matching saved tracks are listed as well.
- **Status line:** below search, reports readiness, pending work, terrain workload, and
  safe failures; selecting an error opens its safe detail. It is the only surface for
  map and imagery errors.
- **Point inspection:** a map click or place-search result opens an anchored popup with
  coordinates, terrain elevation, and the nearest map feature with its distance; named
  features link to English Wikipedia and Google Search. While the popup is visible, the
  next map click only closes it.
- **Ruler:** the ruler button below the map-layer chooser toggles a session-only
  measurement; pressing it again ends and discards the measurement. While it is on,
  primary map clicks add numbered blue points joined by straight lines; it takes clicks
  from route planning and an enabled weather map, while marker placement and a one-shot
  weather pick keep precedence. There is no separate panel: a dashed line follows the
  cursor from the last point, and a large label below the cursor shows the total
  distance through the cursor and the terrain elevation difference between the first
  point and the cursor. Route planning uses the same cursor label with the distance of
  the pending segment only.
- **Point actions:** right-click opens copy coordinates, copy a 2D point link, create a
  marker, search satellite scenes here, show the weather forecast, copy a weather-map
  link, and open meteoblue.com or windy.com. On coarse-pointer devices a tap instead
  opens a bottom sheet with the details and the same actions.
- **Sharing:** the map share dialog copies a 2D center-and-zoom link, optionally with
  the selected satellite scene (included by default), and a 3D link with bearing and
  pitch while terrain is active.
- **Camera:** left drag pans; middle drag or Shift+left drag rotates and pitches in 3D
  around the terrain point under the press, marked by a small pivot ring; keyboard pans,
  zooms, and orbits once the canvas has focus. Box zoom and right drag are off; pitch is
  capped at 75 degrees. The 2D command resets pitch and bearing.
- Attribution remains visible in every section and terrain mode.

## Map, terrain, and persistence

The hiking basemap combines OpenFreeMap for hiking layers and OSM Shortbread for land,
buildings, and streets; see [map providers](./map-providers.md). Labels prefer
`name:en`, then `name:latin`, before native names; the client does not invent spellings.
When satellite imagery is visible, vegetation and land-use fills are removed. Military
areas show a red perimeter; the map does not claim to identify all private land. Invalid
configuration prevents the map from mounting with a safe fatal message; a single
vector-source failure is recoverable.

Relief shading and client-generated contours (labeled 200 m index lines, minor spacing
20–100 m, default 50 m) use the shared DEM with conservative repair. Contour work runs
in a terrain worker and falls back to inline work with a Layers warning if the worker
cannot recover. The 2D/3D control reuses the same map and DEM source; failed 3D
activation returns to 2D and reports in the status line. Reloads start in 2D: only
center and zoom persist. Details are in [runtime flows](./runtime-flows.md).

Map errors are classified and shown in the status line; offline messaging promises only
that already rendered areas may stay visible. Retry and recovery rules are in
[runtime flows](./runtime-flows.md#provider-and-webgl-failures).

## Diagnostics and developer mode

Diagnostics are local, bounded, and redacted before storage. The drawer is non-modal and
closes only from its header or the Diagnostics rail button. Its tabs are Overview,
Sentinel query, Map, Logs, and Health. The Map tab shows exact local camera state,
source and layer IDs, terrain, failures, WebGL capabilities, and temporary debug flags
that reset when developer mode ends. The Sentinel query tab shows a memory-only timeline
of the current or last search and render operation with per-step state and duration,
without payloads, geometry, or URLs.

Exported bundles use schema version 3 with build/runtime data, events, health results,
notes, and a map snapshot whose coordinates are rounded to 0.1 degree; the inspection
CLI in `tools/diagnostics` migrates versions 1 and 2. Provider reachability checks run
only on request.

## Configuration

`VITE_MAP_PROVIDER_CONFIGURATION` is optional public JSON validated by Zod. Endpoints
must be HTTPS or application-relative; template tokens, tile sizes, zoom ranges, layer
mappings, and attribution are validated, and errors report an issue count without
echoing the payload. `VITE_*` configuration must never contain secrets.
