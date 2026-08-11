# Features and workspace UX

This document describes the implemented application and the reviewed complete system
concept. It distinguishes unavailable behavior so the mockups are not mistaken for
working functionality.

## Design authority and vocabulary

This document is authoritative for layout, feature placement, control grouping, and
interaction hierarchy. [UI design guidelines](./ui-design.md) define reusable
presentation conventions. Repository documentation and code remain authoritative for
data, privacy, architecture, and failure contracts. Correct this document whenever it no
longer describes the reviewed interface.

- **Feature rail:** `Satellite`, `Tracks`, `Layers`, and `Markers` are the primary
  top-level feature sections.
- **Global rail actions:** `User` appears immediately above `Settings`; `Diagnostics` is
  available when developer mode is enabled. The `About this site` action sits below
  Settings and opens public author, repository, API, and data-source information.
- **Route planning workflow:** browser route planning begins from `Plan route` in the
  Tracks header. There is no Plan tab, Plan rail item, or independent planning
  destination.
- **Contextual sidebar:** the left panel changes with the active feature section.
- **Detail pane:** selected track and imagery details are adjacent to the contextual
  sidebar at widths of 1900 CSS pixels and above, and overlay that sidebar below 1900
  pixels without replacing or remounting the map.
- **Persistent map:** the map remains the primary canvas across rail changes, detail
  selection, dialogs, and developer tools.

## Smartphone workspace

Below 900 CSS pixels, the map is the default surface. **Open workspace** reveals the
full-height feature rail and contextual tools without remounting the map; **Show map**
and the Trail Planner logo return to the same map. An active saved track appears over
the map as a collapsed disclosure containing the same distance, recorded-time, ascent,
and descent statistics used by the full editor. Tapping its active saved-track row opens
the editor. An unsaved preview uses a taller disclosure with editable **Track name** and
**Save** controls above its decorative profile and metrics. When the active track has a
usable elevation profile, its grade-colored graph is drawn decoratively behind these
compact stats without chart interaction. Expanding the disclosure reveals the full
editor; collapsing preserves the active track, while closing clears it. Selecting
Sentinel imagery closes the smartphone workspace so the map immediately shows the
applied scene; reopening the workspace restores the existing imagery results. This
transient presentation state is not stored as a navigation preference or URL entry.

## Desktop workspace

At widths from 900 CSS pixels through 1899 pixels, a selected track or imagery result
overlays only the contextual sidebar while the rail stays interactive. At 1900 CSS
pixels and above, the rail, contextual sidebar, and detail pane form one floating
surface above the full-viewport map. Changing sections or opening a pane never changes
the map viewport. One right-side vertical rail contains zoom, compass, geolocation, 2D,
3D, and the quick map-layer preset chooser. The shell uses the shared sky-blue,
blue-green, deep-space, amber, and orange palette with derived surface, border, status,
and tag colors.

When navigation is collapsed on desktop with an active track, the same decorative
profile-and-stats summary sits between the fixed Trail Planner logo and the navigation
expansion affordance. Without an active track summary, the Trail Planner logo and
expansion affordance remain the compact collapsed control.

The current shell exposes Tracks, Satellite, Markers, Layers, and User as interactive
rail destinations. It has no full-width app bar, empty global elevation placeholder, or
generic always-visible privacy notice.

- Owner: `src/presentation/shell`.
- Visual tokens: `src/presentation/theme/appColors.ts` and the Material UI theme.
- Durable preferences: developer mode, collapsed navigation, marker sorting, Sentinel
  imagery rendering, and terrain overlays in Dexie.
- Settings uses compact `General` and `Storage` tabs. Storage shows only the
  measurements the browser supplies: origin usage and quota, IndexedDB, Cache Storage,
  localStorage, residual origin data, and Chromium's optional JavaScript heap estimate
  in megabytes.
- Fallback: `?developer=1` enables diagnostics even when stored settings cannot load.
- Failure boundary: uncaught React errors render a support-bundle fallback.

### User

**User** is a standalone lower-rail action. With valid public Supabase configuration, an
ordinary user can create an email/password account and enable **Sync across devices**.
Synchronization is disabled by default and remains local-first. Signing in to a new or
different account preserves valid browser tracks and prepares them for upload while
downloading that account's remote tracks. Current synchronized geometry retains finite
source elevation exactly. Legacy remote-only geometry remains elevation-missing; it is
never filled from a terrain provider automatically. If a same-account track was deleted
from the cloud, a global **Tracks deleted from cloud** dialog opens with every affected
track unchecked. **Delete**, **Restore**, and **Delete selected, upload the rest again**
state the selected decision; unchecked tracks upload again. The signed-in panel exposes
the full support User ID, exact compressed usage, reservation-aware quota progress, a
**Sync now** action, and per-track transfer progress while synchronization runs. The
lower-rail User icon shows an orange dot while synchronization is active or needs a
deletion decision, red after failure, and green after success. Three HTTP 500 responses
exhaust the page-lifetime server-error budget; the worker sends no further
synchronization requests until the page reloads.

## Feature surfaces

### Tracks

Tracks combines the implemented browser-local track library with reviewed global catalog
and folder behavior. The contextual sidebar header places the pressed multi-track
selection control immediately before `Plan route`; its scrollable content owns file
import, search, sort, and local track results. Catalog, personal folders, tags, filters,
and batch import remain reviewed but unavailable.

Selecting a track draws its geometry on the map and opens an adjacent detail pane with
source, tags, metrics, folder/download actions, calculation provenance, and a contextual
elevation profile. Curated source GPX is loaded only when requested. Import retention
and privacy guidance appears at the relevant preview/confirmation step instead of as a
permanent workspace banner. The multi-track control enables a session-only mode whose
saved-track row clicks add or remove tracks in click order. Every selected track appears
in one combined bright-blue map scene, while the read-only detail pane shows complete
combined statistics followed by a named divider, normal statistics, and elevation
profile for each track. It omits the ordinary title, metadata, provenance, analysis, and
editing actions. At intermediate desktop widths, **Back to tracks** preserves the
pressed mode and ordered selection, and adding another track reopens the pane. On
smartphones, row clicks keep the list open; **Show map** reveals the combined compact
disclosure, which opens the multi-track pane without clearing the selection. An empty
selection closes the pane and clears the map. The mode and its selected-track list are
never persisted across reload.

The implemented local workflow imports one `.gpx`, `.fit`, or `.kml` file from the
contained picker row or its browse button. FIT Activity and Course files must pass
Garmin SDK integrity validation and contain geographic records. KML accepts line-based
`LineString`, `MultiGeometry`, `gx:Track`, and `gx:MultiTrack` content without fetching
external resources; KMZ and geometry-free files remain unsupported. During a file drag
anywhere in the application, an opaque elevated drop card appears above the current
workspace content, including non-Tracks tabs and collapsed desktop navigation. It has no
full-screen dimming or map-covering hit area; only a drop on the card imports the file.
An accepted import opens Tracks, expands desktop navigation, and exposes the **New
track** detail pane. Import validates and previews the file's metadata in that pane. The
editable embedded or filename-derived name is never replaced automatically.
File-selection and parsing errors appear inside the import zone and dismiss after five
seconds; persistent track/storage errors remain in the panel. The stored source filename
remains visible after rename, and structured validation warnings show their parser code,
explanation, and available point/segment context. An optional English place candidate
appears separately and requires an explicit apply action between the editable track-name
field and the adjacent read-only **English place name** field. For a track with a
dominant interior summit, that candidate uses the nearest named OSM feature across
supported POI, natural, and place categories rather than a hard-coded feature type.
Mountain passes gain a `Pass` suffix and named peaks or volcanoes gain an `Mt.` prefix
when the source name does not already include one. Save retains the exact normalized
source points and a separate browser-calculated Terrarium projection, independent line
segments, source filename/format metadata, and versioned metrics in this browser; the
original file bytes are discarded after parsing. Unsaved previews activate the native
leave-site guard.

**Plan route** opens a new unsaved-track detail pane and gives route planning ownership
of map clicks. The first click sets the start waypoint; each later click adds an ordered
leg. **Next segment: Routes | Line** persists across clicks. **Routes** snaps both ends
to the configured transportation topology and searches the shortest walkable connection
in a browser worker; **Line** preserves the clicked endpoints as one direct segment.
Accepted legs remain visible as a single planned line with numbered waypoints. While a
routed leg is pending, the detail pane reports tile downloads as a completed share, then
graph construction and route search as named phases. Conflicting mode and Save controls
are disabled; Undo or Clear cancels the request before changing accepted geometry.
Calculation has a one-minute overall limit. A timeout or other failed routed leg keeps
the existing plan and offers a direct-line fallback without silently changing the
selected mode.

The worker fetches bounded MVT coverage from the configured detail-vector TileJSON and
decodes the same `streets` layer used for visible roads and paths at detailed map zooms.
Every provider road kind participates except construction/proposed and explicit non-road
or rail features. Explicit `foot=no` or `foot=private` remains rejected when a
replacement provider supplies it; the default Shortbread schema does not publish access
values. Exact source vertices and eligible geometric crossings, branches, overlaps, and
two-grid-unit near touches become route junctions; available layer and bridge/tunnel
differences remain disconnected. Routing does not query MapLibre's visible tile cache
and does not use a backend, proxy, routing service, or Overpass. Missing or unusable
provider topology produces an actionable unavailable state; it never falls back to an
unrelated external service.

After every accepted geometry edit, the browser samples terrain elevation and computes
the same track metrics, elevation profile, grades, and climbs/descents used by imported
tracks. A terrain failure leaves the accepted geometry and distance metrics intact, with
no elevation profile; the route can still be saved. Saving locks route edits and map
clicks while it validates and atomically writes the generated points through the
existing local-track repository. The result then behaves like any other saved local
track. Unsaved plans are transient and activate the same leave-site guard as imported
previews.

Saved track cards show icon-led recorded duration, distance, and source elevation gain
when available. The detail pane's primary stats grid presents duration, distance,
derived average speed, and authoritative source **Elevation gain**/**Elevation loss**
only. Separate text rows for **Elevation gain (calculated)** and **Elevation loss
(calculated)** appear below the point/segment count, outside that grid. Missing
measurements are omitted; source file, point, segment, and save metadata, including a
`DD.MM.YYYY HH:mm:ss` saved timestamp, remain below it. Saved tracks are searchable by
name, reopen after close, and rename only from the detail header's **Rename** action.
That action replaces the saved title with a bounded name editor; the preview retains its
body **Track name** field and English-name application flow. Each saved-track row keeps
favorite and icon-only delete controls in the DOM, revealing inactive controls on
pointer hover or keyboard focus; active favorites remain visible. Row selection and
hover color cover the entire row, including its action column. Deletion uses two-stage
inline confirmation: the row delete icon becomes a destructive confirmation icon, while
**Delete track** in the detail action menu replaces that menu trigger with **Confirm
delete**. Pointer exit, Escape, and click-away cancel either confirmation without
mutation. Users can favorite a track from its list row or detail header; downloads
remain in the detail header's compact action menu. Favorites sort before other tracks,
with newest imports first inside each group. The latest opened saved track reopens after
restart when its content is still valid. A compact local-retention notice stays pinned
to the Tracks panel bottom. Catalog, folders, tags, filters, batch import,
whole-workspace dropping, and manual GPX authoring remain unavailable. A newly imported
or reopened track renders as bright-blue independent lines and fits its complete bounds
with padding for the master/detail surfaces. With usable elevation, the map overlays
every non-flat climb/descent grade subsegment across the active track, leaving flat
spans bright blue. The overlay is not narrowed by chart or Climbs & Descents segment
hover/selection; those interactions remain panel-only. Closing the track removes the
active geometry without deleting a saved record or moving the camera. Every saved track
can be downloaded locally as GPX or KML. Generated files preserve independent segments,
saved name, available point elevation, and reliably aligned timestamps without writing
GPX or KML description elements; conversion never uploads the source.

Tracks with usable elevation show an interactive distance profile with labeled axes,
grid, axis tooltip, and a map marker synchronized to the highlighted chart point. Parsed
source elevation remains authoritative for that profile, grades, and climb/descent
analysis; the calculated Terrarium profile is used only when the source has no complete
elevation run. The profile does not repeat the ascent/descent metrics already shown in
the stats grid.

From 900 through 1899 CSS pixels, an open track detail pane overlays Tracks tools and
**Back to tracks** restores the prior import, search, and list state. At 1900 CSS pixels
and above, the track pane remains adjacent and uses **Close track**. Favorite and delete
row actions remain visible on smartphones; desktop rows reveal them on hover or focus.
Two-stage inline deletion behaves the same at every width.

### Satellite

Satellite uses a compact `Point | <coordinates>` search-area selector. Point uses the
submitted viewport center. Choosing **Search satellite images** from the map context
menu sets a read-only Custom point as the search center until the map moves or the user
chooses Point. Marker remains unavailable as a Satellite target; saved markers currently
support map navigation but do not feed Satellite criteria. The catalog returns only
scenes whose footprint intersects that immutable point, while the full submitted
viewport is retained for client-side coverage. The sidebar shows a read-only acquisition
calendar, an L2A scene-cloud slider, and the latest-images action. Users do not
construct a date range. L1C is not exposed in the current MVP UI.

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
0–100% scene-cloud range. The cloud slider defaults to 50%, persists locally across page
reloads, and filters scene cards client-side while every loaded acquisition date remains
visible in the calendar; dates at or below the threshold receive the orange highlight.
Selecting a date above the threshold temporarily reveals its selected scene card;
de-applying it or selecting another scene restores the filter. After the first search,
calendar arrows load a displayed month only when that month has not completed
successfully for the submitted point, viewport, and product. Successful months,
including empty ones, are reused when navigating back. Newly loaded scene groups are
appended to the right results pane without replacing other months or resetting the
displayed calendar month. Month navigation remains available during these loads; a short
pause before each request lets users move across several months without fetching every
intermediate month, and a newer selection cancels a superseded month request. Calendar
controls provide tooltips, a double-chevron shortcut returns directly to the current
month, and the visibly marked month-year dropdown opens a floating year selector with a
12-month grid for direct navigation without shifting the calendar. Months outside the
Sentinel archive or after the current month are disabled. The picker is non-modal:
clicking another calendar or sidebar control closes it and performs that action.

Scenes sort by acquisition time and cards group by month in the right pane. The calendar
annotates each loaded day with the scene-cloud average weighted by each scene's viewport
coverage. Days at or below the current cloud slider receive a subtle orange highlight;
non-matching days retain only their cloud percentage without a tile outline. After
locally loaded cards are revealed, the same load-more action fetches the next missing
preceding month and appends it, continuing back through the Sentinel-2 archive.
Whole-card click selects, expands metadata, and applies that concrete scene through the
shared map adapter. TiTiler normally renders a validated L2A item's separate red, green,
and blue reflectance COGs as georeferenced Web Mercator tiles below hiking references.
The Satellite sidebar exposes persistent reflectance ceiling, gamma, and saturation
controls below the render selector for this hosted rendering path. Fresh storage and
reset use a reflectance ceiling of 11000, gamma 2.25, and saturation 2.50; saved tuning
takes precedence.

The real polygon or multipolygon footprint is a separate orange outline above hiking
geometry and below labels. Selecting a different scene immediately removes the current
scene and footprint, restores the vector basemap, and loads only the requested scene. A
failed application reports a safe, clickable error. The detail distinguishes rejected
values, rate limiting, renderer availability, and an unclassified unusable tile without
exposing provider URLs.

A render dropdown in Satellite selects `Auto`, `Server`, or `Direct`. Auto switches a
hosted-renderer 429 or CORS-opaque status-zero failure to direct range reads of the
scene's pre-rendered 8-bit visual COG without retrying TiTiler. Server never falls back,
and Direct bypasses TiTiler entirely. The visual COG is displayed as supplied;
reflectance, gamma, and saturation controls are not applied to it. Tiles become visible
individually while the vector basemap remains available below them, and satellite
rendering has no application deadline.

A successful automatic fallback replaces Ready with a persistent, non-blocking warning
that TiTiler is unavailable and the alternative imagery provider is being activated or
is active. Choosing Direct explicitly does not show that warning. The warning clears
when a later server render succeeds, the user explicitly changes rendering mode, or
imagery is removed. A mode change removes both provider raster slots, restores the full
vector basemap, and reapplies the same selected scene through only the newly selected
provider. The mode choice is stored immediately, including during a pending or failed
render. Saved-marker targeting remains unavailable in Satellite.

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
and clears the transient selection. At desktop widths, the Satellite sidebar and results
stay mounted but hidden across rail changes, so a user can inspect Layers and return
without losing the search session.

If the initial cards do not occupy most of the adjacent pane, the UI automatically
reveals another local set or fetches preceding months, with a small bounded number of
automatic month requests. The same load-more button remains available for further manual
archive traversal.

Each primary workspace destination has a shareable URL anchor: `#tracks`, `#satellite`,
`#markers`, `#layers`, or `#user`. Loading an anchored URL restores that tab, and
changing tabs updates the anchor.

Regular map sharing is always available and encodes a 2D center and zoom; context-menu
point links follow the same flat-camera contract and do not include satellite imagery.
When a scene is selected, the share dialog enables its **Include selected satellite
image** checkbox by default; clearing it omits the scene from both links. Included
scenes use the current selection even while its raster is still rendering and open on
the Satellite section. The selected scene row also provides **Share link** for the same
2D map-and-scene URL; clicking the rest of an applied row removes that imagery. A
separate 3D link is enabled only while terrain mode is active and additionally encodes
bearing and pitch. Opening that link selects the 3D control immediately, but starts
terrain only after the base style can safely accept new sources. Shared terrain and
satellite tiles then load alongside basemap and relief tiles, so one source cannot hold
the others behind the map's loading state.

### Markers

Markers is a browser-local library of named map points. **New marker** starts placement
mode, and **Create marker here** is also available from the map context menu. A map
click opens the editor with the nearest inspected POI name when available; the user
confirms the name, one of 117 Pinhead map icons organized in category tabs, and one of
ten shared-theme colors before anything is stored.

The contextual sidebar lists saved markers using the same row interaction pattern as
Tracks. It sorts by newest, name, color, or distance from the current map center; shows
the current distance; navigates the map from a row; and supports rename, appearance
changes, and two-step inline deletion. Markers remain in IndexedDB across browser
restarts and render as MapLibre symbols with their selected icon, color, and name.
Malformed stored rows are omitted and reported through bounded local diagnostics.

Marker search, grouping, filtering, coordinate/elevation/scale editing, remote
synchronization, Satellite targeting, and copying into Create GPX are not currently
available.

### Layers

Layers groups durable controls under explicit source headings: Local GPX, Satellites,
the configured terrain provider, and **OpenStreetMap via OpenFreeMap + OSM Shortbread**.
OpenFreeMap supplies hiking-specific map layers and labels. The default-on **OSM
detail** checkbox controls Shortbread brownfield and building context; Shortbread roads
and detailed paths remain under the existing Roads and Hiking paths controls. Satellites
starts with optional **Google satellite imagery** and **NAPR Orthophoto** basemaps,
followed by **Copernicus Sentinel-2 via Earth Search**, whose **Satellite imagery** and
**Scene footprint** controls remain disabled until a scene is applied. NAPR is one
logical multi-year orthophoto mosaic: newest available aerial pixels render from 2025,
then 2020, then nationwide 2016–2017 coverage. Google, NAPR, and Sentinel imagery are
mutually exclusive checkboxes: choosing one immediately clears the other two, while
every imagery source may be off. Google and NAPR are disabled by default, and each
explicit choice is retained in this browser's IndexedDB preferences. The shared
OpenStreetMap opacity slider enables whenever any raster is selected and scales every
OpenStreetMap reference layer and elevation isoline once active raster content has
switched the map into satellite visual mode; vector paints remain fully opaque while
static raster tiles first load.

The quick chooser presents **Vector OSM** (no raster and opaque vectors), **Google
Satellite Hybrid** (Google imagery with opaque vectors), **Google Satellite** (Google
imagery without vectors), **NAPR Orthophoto Hybrid** (NAPR imagery with opaque vectors),
**NAPR Orthophoto** (NAPR imagery without vectors), and **Sentinel-2 Hybrid** (an
applied Sentinel scene with opaque vectors). A preset changes only the
Google/NAPR/Sentinel raster selection and shared OpenStreetMap opacity: all independent
Layers toggles, imported-track opacity, terrain preferences, and an applied Sentinel
scene remain intact. Choosing Sentinel-2 Hybrid without an applied scene opens the
Satellite workspace so the user can select one; NAPR presets do not require a scene.

The remaining checkboxes cover Imported tracks, its default-on **Elevation gradient**,
Relief shading, Elevation isolines, Hiking paths, Roads, and Places and POIs, plus
Natural features and Restricted areas. The gradient colors climb and descent grades
across the active track; its durable checkbox remains independently editable while
Imported tracks gates its effective map visibility. When the colored overlay is visible,
desktop and tablet maps show a compact lower-right profile-shaped, stepped color scale.
Labels sit at numerically positioned color boundaries around 0% grade; thresholds that
do not change color are omitted. Smartphones omit the scale. The base bright-blue
geometry and gradient share the imported-track opacity control. The single **Natural
features** checkbox controls vegetation, glaciers, wetlands, rivers, water bodies, and
their water labels. The terrain provider also owns the invalid-DEM repair switch and a
compact contour-distance slider. Every map data source added to the application must
appear under its provider heading in Layers; each user-visible feature family from that
source receives an explicit control unless it is part of the required base canvas. Each
logical ID maps to an allowlisted set of stable MapLibre layer IDs; arbitrary native IDs
never cross the UI boundary. Hiding Sentinel imagery retains the applied scene and does
not remove its footprint, search results, or attribution contract. Relief and isoline
visibility are independent of 3D terrain mode and satellite availability. Base land
remains visible and cannot be disabled. Per-layer opacity, drag ordering, and custom
layers are unavailable. Checkbox state, shared OpenStreetMap opacity, the shared
imported-track opacity, rendering mode, imagery stretch, and terrain-overlay preferences
are stored locally and restored after refresh. Imported-track visibility and opacity
affect the active preview and saved selection together; they do not create per-track
presentation records. Satellite scene metadata and assets are never persisted locally;
imagery starts empty unless an explicit share URL requests a scene.

## Persistent map controls

- Place-or-coordinate search is overlaid on the map. Submitted place searches begin in
  the visible viewport, then repeatedly double the bounded search area up to a 500 km
  radius from the original viewport center. Results from every area are appended as they
  arrive and deduplicated, so a nearby street name does not hide a more distant
  settlement with the same name. Direct coordinates remain local and do not contact the
  place provider. Unlabeled decimal pairs use `latitude, longitude`, matching the map's
  **Copy coordinates** output; explicit latitude/longitude labels remain accepted in
  either order. The result list shows each match's geodesic distance from that center.
  It shows settlements, administrative place boundaries, mountains, and water features
  by default. Squares, streets, businesses, and other POIs remain behind an explicit
  **Show other results** action. A fixed-height, full-width progress bar shows outward
  expansion against the 500 km maximum without shifting completed results. Map pan,
  zoom, and camera controls do not dismiss results or cancel an active search.
  Nominatim's open-ended OSM tags are shown as readable labels; only explicitly reviewed
  geographic tags enter the default list and unknown tags stay in other results.
- A lightweight line below search reports readiness, pending work, or safe failures;
  selecting an error opens its complete safe detail.
- Navigation collapses with a short transition to only the clickable Trail Planner logo.
  The Trail Planner square keeps the exact same size and viewport position in both
  states so the remaining navigation appears to retract into that fixed anchor.
- Settings is non-modal and does not dim or block the map.
- Layers exposes default-enabled invalid DEM repair and minor contour spacing under the
  terrain provider. Satellite owns the imagery stretch and the switch that moves relief
  shading above imagery. Index contours remain labeled at 200 m intervals.
- Native zoom and compass/navigation controls remain on the right.
- The 2D/3D selector is a separate control group immediately below the compass stack.
- Clicking the map opens an anchored, accessible point-inspection popup with formatted
  coordinates, terrain elevation, and the nearest supported named OSM map feature in the
  currently loaded vector data. Selection has no fixed distance cutoff; the geodesic
  distance remains visible so the user can judge relevance. Supported feature sources
  include places, peaks, and points of interest. Named results include direct English
  Wikipedia article and Google Search links that open in a new tab. While any part of
  that popup intersects the map viewport, the next map click only closes it; a
  subsequent click opens a new inspection. If camera movement puts the popup entirely
  outside the viewport, the next click immediately replaces it.
- Attribution remains visible in every feature section and terrain mode.
- Selection legends, elevation charts, and imagery footprints appear only when their
  corresponding geometry exists.

Map interaction keeps MapLibre's camera behavior while adapting desktop orbit gestures
to middle drag and Shift+left drag: ordinary left drag pans, the wheel and double-click
zoom, arrow keys pan, `+`/`-` zoom, and Shift+arrow keys rotate or pitch after the
canvas receives focus. Box zoom is unavailable. Both orbit gestures are consumed without
camera movement in flat 2D. In 3D either rotates and pitches at a restrained sensitivity
around the terrain point beneath the initial press; each pointer update is one
zero-duration MapLibre camera command with that geographic `around` anchor. A small
blue-ring MapLibre marker identifies that shared pivot only while the initiating button
remains pressed; it follows terrain and disappears when covered, released, or returned
to 2D. The 3D camera can pitch down to 75 degrees. Right drag is disabled in both modes,
while right click continues to open the map's contextual actions. MapLibre retains
projection, terrain anchoring, camera limits, movement events, and the native compass
reset. The explicit 2D command returns pitch to zero and bearing to north, while 3D
restores the last useful terrain pitch. Settled results continue through the existing
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

- Default vector sources: OpenFreeMap TileJSON for hiking-specific layers and OSM
  Shortbread TileJSON for land, building, and street detail; their combined attribution
  stays visible.
- Invalid configuration: MapLibre does not mount; a safe fatal message is shown.
- Either vector-source failure is recoverable when an existing map canvas remains
  usable; the aggregated safe failure appears only in the shared status below search.
- Tests: pure style assertions plus synthetic MVT/glyph Chromium coverage.

## Map-view persistence

The map starts only after the last valid center and zoom are read, preventing a visible
jump from the Georgia overview to the saved position. `moveend` sends settled map views
to a debounced persistence queue, but the repository deliberately discards terrain mode,
bearing, and pitch. Animation-frame events are never persisted.

- Stored value: schema-version 3 `map.camera` record containing longitude, latitude, and
  zoom in the existing Dexie settings table. Schema-version 1 and 2 cameras load with
  zero bearing and pitch instead of restoring their former terrain orientation.
- Validation: finite center and zoom values are clamped to supported ranges before a
  flat camera is returned.
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
continue inline for that page session and Layers shows a non-blocking compatibility
warning that movement may be slower. Provider, decode, and calculation failures remain
isolated to their individual requests and do not switch execution mode. A successful
worker session has no warning; a new page session tries the worker again.

While terrain work is active, the Ready status below search also shows the execution
mode, exact number of queued contour jobs against the 32-job bound, and any currently
active work. The secondary line is absent when the worker is idle. This workload summary
is transient and contains no tile coordinates or provider URLs.

Relief normally sits below satellite imagery; the Satellite switch moves it above the
active raster without remounting MapLibre. Contours remain above both and below OSM
roads, paths, labels, and POIs. Preferences are validated and stored locally with the
existing map-layer record. Provider failure leaves unrelated layers and controls usable.

The 2D/3D control operates on the same MapLibre instance and shared DEM source. Enabling
3D levels the camera before applying terrain, waits for the source to become usable, and
then restores a useful pitch without persisting the intermediate view. Disabling terrain
levels the camera before removing its terrain elevation reference, while retaining
center and zoom. Ordinary reloads also restart in 2D: durable camera state contains only
center and zoom, never terrain mode, bearing, or pitch.

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
replace the hosted source with direct pre-rendered visual-COG rasterization; Server mode
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

The application does not currently provide GPX catalog loading, Create GPX
editing/export, marker search/grouping/cross-feature targeting, or offline-region
downloads. Saved-marker creation, local persistence, sorting, map rendering, navigation,
rename, appearance editing, and deletion are available. Optional email/password accounts
can explicitly synchronize elevation-free track copies when public Supabase
configuration is present. Satellite provides live viewport search for L2A scenes with a
scene-cloud control. Successful results are grouped by UTC acquisition day and show a
thumbnail, local acquisition time, processing level, cloud, viewport coverage, and
sub-5-km edge warning. Selecting a card renders one georeferenced true-color scene and
its footprint; Layers can hide or restore the raster and related logical map groups.
