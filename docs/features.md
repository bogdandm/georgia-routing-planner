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
  opens author, repository, API, and data-source information. `Help` sits last and opens
  the [help screen](#help-screen).
- **Route planning:** starts from `Plan route` in the Tracks header. There is no
  separate planning destination.
- **Contextual sidebar:** the left panel changes with the active feature section.
- **Detail pane:** selected track and imagery details sit beside the sidebar at 1900 CSS
  pixels and above, and overlay the sidebar below that width.
- **Persistent map:** the map stays mounted as the primary canvas across rail changes,
  detail selection, dialogs, and developer tools.

Each workspace destination has a URL anchor: `#tracks`, `#markers`, `#layers`,
`#satellite`, `#weather`, or `#user`. Loading an anchored URL restores that tab, and
changing tabs updates the anchor. The Satellite image comparison has its own anchor,
`#satellite/compare`, kept in step the same way (see [Comparison](#comparison)).

## Smartphone workspace

Below 900 CSS pixels, the map is the default surface. **Open workspace** reveals the
full-height rail and contextual tools without remounting the map; **Show map** and the
Trail Planner logo return to the same map. An active track appears over the map as a
collapsed disclosure with distance, recorded time, ascent, and descent, drawn over a
decorative grade-colored profile when elevation is usable. An unsaved preview's
disclosure also offers **Track name** and **Save**; a route plan's disclosure offers
**Undo** and the **Routes | Line** next-segment mode. Expanding it reveals the full
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
chooser, the image comparison shortcut (desktop), and the ruler.

Navigation collapses to the clickable Trail Planner logo, which keeps the same size and
position in both states. With an active track, the collapsed state also shows the
decorative profile-and-stats summary. During route planning, **Undo** and the **Routes |
Line** next-segment mode sit below it, so planning continues without reopening the
panel.

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

### Help screen

**Help** in the rail opens a dialog with the map legend and the keyboard and mouse
controls. From 1200 CSS pixels the legend sits on the left and the controls on the
right, separated by a vertical divider; narrower viewports stack them. Devices whose
primary pointer is coarse, such as phones and tablets, show only the legend. On desktop,
**Take a tour!** closes the dialog and starts the onboarding tour; the smartphone
workspace shows the dialog full screen without it.

The legend lists areas, lines, and points with swatches drawn from the same generated
images and palette as the basemap style, with area signs enlarged for legibility. The
controls list every global shortcut, Escape, the map's own camera keys, and the mouse
gestures, grouped as Workspace, Tracks, Map, Map camera, and Mouse (see
[keyboard shortcuts and map controls](./keyboard-and-map-controls.md)). Keys use the
current platform's labels, with the macOS modifiers ⌘, ⌃, and ⇧ drawn as icons. Mouse
gestures are drawn with Kenney's CC0 _Input Prompts_ glyphs, with the pressed button or
turned wheel highlighted: a mouse with movement arrows and the left or middle button
pressed for drags, the scroll wheel, and the right button.

### Onboarding tour

The first desktop visit opens a tour unless it starts from a shared-track link. Each
step switches to one section and shows all its hints at once: the step's controls are
spotlighted over a dimmed workspace, with short callouts that favor icon-only buttons
and hidden actions such as right-click point actions. Steps cover the map controls and
lower rail, Help, Tracks, Track details, Markers, Layers, Satellite, Weather, and User.
Hints whose controls are absent, hidden, or off-screen are omitted. While a step is
shown, collapsed navigation, track details over the Tracks list, and Satellite results
stay hidden without changing their saved state.

The first step centres the right-click hint over the map. The second step shows the
[help screen](#help-screen) content over the map.

Track details imports the bundled example `public/onboarding/sakhizare-from-above.gpx`
as an unsaved preview, which is never stored or synchronized. Leaving that step or
closing the tour discards it. The step is left out when the tour would replace an
unsaved preview, shared track or shared-track link, route plan, or multi-track
selection.

**Next**, **Back**, the arrow keys, **Skip tour**, **Done**, and Escape navigate or
close the tour; closing returns to the section open before it. Closing stores completion
in `ui.preferences`, and **Take a tour!** on the help screen opens it again. Smartphones
do not show the tour; switching to the smartphone layout closes it without storing
completion.

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

Below the account controls, in every account state, the **Data** section offers **Export
data as gzip** and **Import data from gzip**. Export downloads
`trail-planner-data-<date>.tar.gz` with every saved track as a GPX file inside a
directory per folder, plus track metadata with folders, markers, and settings as JSON
and a `hash.json` with SHA-256 checksums of all of them; calculated elevation and
synchronization state are not included. Import asks for confirmation, verifies the
checksums, validates the whole archive, and then restores it in one step: tracks,
folders, and markers from the archive replace local items with the same ID, other local
items stay, and archived settings replace the local ones. The page then reloads. A
rejected archive changes nothing. See [data archive](./data-model.md#data-archive).

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
stores the calculated DEM projection separately; otherwise the DEM projection becomes
the canonical elevation. The original file bytes are discarded after parsing.

GPX import also reads bounded root `<wpt>` elements as track markers, up to 100 per
track. Blank names become `Marker N`; invalid or excess waypoints are skipped with
warnings and never count as track geometry. FIT, KML, shared tracks, and route plans do
not create track markers.

Files whose `creator` names Komoot are planned tours, not recordings: their point
timestamps start at the export moment and follow Komoot's pace model. Import keeps them
only when the start lies within 07:00–12:00 in the time zone of the track start and the
elapsed time lies within 80–120 % of the DIN 33466 hiking estimate from the source
distance and elevation; otherwise it drops every timestamp, so the track has no recorded
start time or pace. Komoot planning-point waypoints named `Position N` or
`N <truncated address>…` are skipped without warnings; other waypoints import normally.

#### Route planning

**Plan route** opens a new unsaved-track pane and takes ownership of map clicks. The
first click sets the start; each later click adds a point after the insertion point,
which starts at the end of the plan. The pane lists the plan's points in a **Points**
section (see [Track points](#track-points)); its insertion row chooses **Routes** or
**Line** for new legs, and every leg between points keeps its own visible **Routes |
Line** switch. **Routes** snaps the points to the detail-vector street network and
searches a walkable connection in a browser worker; **Line** draws a direct segment.
Routed legs prefer the fastest hiking time over the shortest distance, so they avoid
needless climbs; without terrain data they fall back to distance only. Consecutive legs
waiting for the router, such as both sides of an inserted point, are routed in one
request on one graph. A pending routed leg reports tile download, graph construction,
route terrain loading, and search progress while further clicks queue behind it.
**Undo** and Mod+Z (Cmd+Z on macOS, Ctrl+Z elsewhere, except while typing in a field;
see [keyboard shortcuts](./keyboard-and-map-controls.md#keyboard-shortcuts)) undo the
last edit, including an insertion, move, deletion, mode switch, or **Clear**. Routing
has a one-minute limit; a failed request undoes the edit that needed it and names the
points without a nearby trail. Missing provider topology shows an unavailable state;
there is no backend or fallback routing service. Topology rules are in
[runtime flows](./runtime-flows.md#browser-route-planning).

After each accepted edit the browser samples terrain and recomputes metrics and the
profile. A terrain failure keeps geometry and distance and still allows saving. Save
locks editing while it writes through the local-track repository; the result behaves
like any saved track. Unsaved plans activate the leave-site guard. On desktop with the
navigation collapsed and in the smartphone disclosure, compact controls offer Undo and
the mode of new points.

#### Library and folders

Rows show a fixed-size simplified shape thumbnail (orange for a loop, blue for one-way),
the name, recorded duration, distance, and elevation gain. A loop ends within 1 km of
its start and within half its length; thumbnails are computed and cached in the browser.
Favorite and delete controls appear on hover or focus on desktop and stay visible on
smartphones; active favorites always show. Deletion is two-stage inline confirmation
from the row or from **Delete track** in the detail action menu; pointer exit, Escape,
or click-away cancels it.

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

Selecting a track draws it in bright blue with a green Play start and a red Stop finish
marker, fits its bounds around the open panes, and opens a detail pane with metrics,
actions, provenance, and an elevation profile. Activating the selected track again
repeats the same camera fit without reloading the track. In 3D the fit also turns the
camera to a 45° pitch with the start at the bottom of the screen: a one-way track faces
its finish, while a loop faces its point farthest from the start, so its finish stays at
the bottom too. The stats grid shows duration, distance, average speed, **Start time**,
and **Elevation gain**/**Elevation loss**; tracks with source elevation also list the
calculated DEM gain and loss. The start time appears only with recorded time, as
`DD.MM.YYYY HH:mm` in the browser time zone, and wraps between date and time in a narrow
pane. Without recorded time, duration is an **Estimated time** (`≈`) from DIN 33466
hiking rates: 4 km/h horizontally, 300 m/h ascent, and 500 m/h descent, with the larger
of the horizontal and vertical times counted fully and the smaller by half. Breaks are
not included. Missing measurements are omitted. Source file, point/segment counts, and
the saved timestamp follow. Closing the track removes its geometry without moving the
camera. From 900 through 1899 CSS pixels, **Back to tracks** restores the prior list
state; at 1900 and above the pane stays adjacent and uses **Close track**.

The header offers **Download GPX** and a **Track actions** menu with favorite,
**Download KML**, **Share…** (opens the Share dialog), **Rename** (an inline name
editor), **Create reversed track**, and **Delete track**. Downloads preserve segments,
name, canonical elevation, and aligned timestamps. GPX also writes track markers as root
`<wpt>` elements before `<trk>`; KML is geometry-only.

**Create reversed track** saves the track walked the other way as a new track named
"_name_ (reversed)" in the same folder, then opens it. Segment and point order flip,
track markers are copied, and start and end landmarks swap. Gain and loss swap exactly,
and the estimated time is recalculated for the new direction. Recorded time carries over
only when the track is completely flat (known source and DEM gain and loss are all
zero): timestamps mirror around the recording window, keeping duration and pauses.
Otherwise timestamps are dropped and the duration becomes an **Estimated time**.

With usable elevation, the map colors every non-flat climb/descent grade subsegment of
the active track, leaving flat spans blue; chart hover stays panel-only. Hovering or
focusing a Climbs & Descents row dims the track outside that climb or descent on the
map. Selecting a row fits the map to the segment; in 3D the camera also turns to face
from its start toward its finish at a 45° pitch, so the start sits at the bottom of the
screen and the finish at the top. The interactive profile has axes, tooltip, and a map
marker at the highlighted point. When every profile point has recorded time,
**Elevation**/**Speed** and **Distance**/**Time** toggles directly below the chart,
right-aligned to the plot edge, switch it: Time plots against elapsed recorded time,
including pauses, and Speed plots a Gaussian-smoothed speed (σ of 90 seconds or 1/240 of
the duration, whichever is longer) so per-fix GPS jitter does not dominate; a stop
recorded without fixes, such as an auto-pause, drops to zero speed, and hovering it
points at the fix where it began. The tooltip then also shows elapsed time and smoothed
speed. Tracks without complete recorded time show elevation over distance only, and the
view choice lasts while the chart stays open. Source elevation drives the profile,
grades, and climbs unless it has no complete run, in which case the DEM profile is used.
On desktop and tablet, a lower-right grade legend explains the colors; its dismissal
persists and the profile chart offers **Show track grade legend** to restore it.

Editable single tracks show a collapsed **Markers** section below **Weather forecast**,
with an add action, map navigation, inline rename, and two-stage deletion. Only the
active editable track renders its markers, smaller than saved markers. Track markers are
stored in track content and synchronize as track metadata without changing geometry or
content hashes.

With a profile, track marker names in the list and on the map include their passage time
from **Route timing**. Each marker uses the nearest discrete route sample, not a
projected position on a segment; ties use the first point in route order. A time is
shown only when that point is at most 500 m away. This association does not move or
rewrite the marker's saved coordinates. Start, pace, recorded-time choice, elapsed-time
display, and the time-marker visibility setting all apply; hiding times keeps the
markers.

Tracks with an elevation profile show **Route timing** below Climbs & Descents,
independently of the **Weather forecast** section beneath it. Its map-time options,
**Route start** and **Adjust pace** controls remain available while the forecast is
collapsed. The timeline follows recorded timestamps when the track has recorded time and
otherwise the DIN 33466 estimate, so climbs advance more slowly than flat walking.
**Ignore recorded time**, offered on timed tracks, selects the estimate instead,
totalling the DIN 33466 time of the track's distance and stored ascent and descent.
**Route start** sets the start from 00:00 to 23:30 in half-hour steps. It defaults to
the recorded start's local time at the route start, rounded to the nearest half-hour, or
to 09:00 without one. **Adjust pace** scales hiking time from ×0.5 (faster) to ×2
(slower) on release. These settings are remembered in this browser for each saved track
and reset to the defaults for a reversed copy; an unsaved track keeps them while it is
open and carries them over when saved. They are not synchronized to the account and do
not change the track's recorded or estimated time.

Timing includes the full route even if elevation is available only in its middle.
Complete profiles reuse filtered elevation; incomplete profiles retain the original
route points and timestamps. Estimated timing counts horizontal travel through missing
elevation without inventing vertical changes. Disconnected segments never contribute a
climb or descent between their endpoints.

#### Route lighting

**Route timing** also places the hike on a calendar day. **Hike date** follows the date
selected in **Weather forecast**, and choosing a date within the forecast week selects
it there too. A date outside that week, such as next summer, is remembered with the
track's route start and pace instead. **Today** returns to today, and a recorded track
offers **Recording date** for the day its file was recorded. The hike date and the date
of the map's sun shadows are kept as one: opening a track or changing its hike date,
including picking a forecast day while the hike follows the forecast, moves the map's
sun shadows to that date at their current local time of day, so a winter visit can check
summer light, and picking another date in the map's sun panel moves the hike date there.
Clock times use the time zone at the route start.

Light along the route comes from the terrain-shadow model behind the map's sun shadows:
at every route station and the moment the hiker passes it, the visible fraction of the
solar disk above the marched terrain horizon, averaged over seven ground points within
50 m. Stations are at most 25 m or 10 minutes apart, so stops and overnight breaks are
sampled through time; long routes use up to 400. Each moment is split into **In the
sun**, **In the shade** (the Sun is above the horizon but terrain hides it), **Blue
hour** (after sunset until the Sun is 6° below the horizon), and **After dark**. These
kinds follow the Sun's elevation, never the map's shading brightness, which keeps night
deliberately light so relief stays readable. Saved tracks store their lighting in this
browser; it is recomputed when the geometry, hike date, route start, pace, or
recorded-time choice changes, which mostly costs DEM tile loads. Failed DEM loads, and
routes scattered so widely that they need more than 160 DEM tiles, show that the light
could not be calculated instead of guessing sunlight.

Between the sun graph and the light list of **Route timing**, a full-width strip colors
the hike by its light with the same light model as the map: sunlight takes the Sun's
color, reddened by air mass so the golden hour shows, shade takes the sky's color dimmed
by the station's open sky, so a gorge reads darker than a boulder's shadow, and the sky
light fades through twilight to a dark night floor, far darker than the map's readable
night. It runs over hike time with the local clock hours as labels. Half-sun icons with
their times mark each sunrise and sunset the hike passes on the strip, and dashed lines
mark them on the profile on both axes; a hike timed by its recording keeps its stops in
place there at any pace. Hovering the strip traces that route point on the map and reads
out the time, distance, and light there, and a click goes to that point.

**Color the map track by light**, among the map options of **Route timing**, paints the
active track on the map in the strip's colors instead of its grade colors: each step
between route points takes the light at its midpoint. It is remembered in this browser
for each track like its route start and pace, and is disabled when terrain light is off
or could not be calculated. Grade colors remain while the light is calculated and in
multi-track view. The colors replace the **Elevation gradient** overlay, so that layer's
visibility still applies, and hovering a Climbs & Descents row still shows its grades.

**Route timing** opens with a Garmin-style sun graph of the start day: the Sun's
elevation on a true scale against the horizon, down to the end of astronomical twilight,
with twilight bands, sunrise and sunset marks with their times, the hike's span
highlighted, and the day length, the pace the timeline uses, and the hike's start and
finish. The Sun's dot and readout stand at the map's sun-shadow time of day; hovering
reads any other time, and a click moves the map's sun shadows there. Below it and the
light strip, all four light kinds are listed in aligned columns with their hours and
minutes, using accessible secondary text for those the hike does not meet; the light the
hike finishes in notes how long before or after that day's sunset it ends. Rows keep
their place while the light is calculated. The date, route start, and pace controls
follow, then the map time and light options. Without terrain light, a sentence states
the finish's sunset margin instead.

Every track detail section (Track details, Elevation profile, Climbs & Descents, Route
timing, Markers, Points, and Source details) is a disclosure whose state is remembered
in this browser for all tracks, with a full-width divider between sections. The
forecast's **By elevation** and **Along the route** are plain subheadings that are
always shown while **Weather forecast** is open. Editing points or revealing one from
the chart opens **Points** without changing that choice.

**Weather forecast** starts collapsed; whether it is expanded is remembered in this
browser for every track, and forecasts load only while it is open. It begins with seven
forecast dates from today; choosing one remembers its weekday for all tracks, and the
next Saturday is selected until then. **By elevation** shows the daytime forecast at the
highest, median-elevation, and lowest profile points. **Along the route** uses **Route
timing** to show where the hiker is every three hours and at the finish, each with the
forecast from its arrival hour until the next checkpoint; the finish covers its arrival
hour. Arrivals after midnight use the next date's forecast hours. Forecast checkpoints
are offered only for day hikes shorter than 30 km and 12 hours; slowing a track past 12
hours hides them until the pace is reduced. This restriction does not hide the timing
controls or map labels. Cards reuse the 7-day forecast rows from Weather and request
each location with its profile elevation. Clicking a loaded forecast row opens Weather
with the full forecast at that location and elevation, labelled with the card's point or
time. Failed track forecasts retry automatically as in Weather when the app becomes
visible again.

#### Time markers

A track with an elevation profile is labelled on the map with clock times from the same
timeline as **Route timing**: its route start and pace, recorded timestamps unless
**Ignore recorded time** is selected, and otherwise the DIN 33466 estimate. The start
and finish show their exact `HH:mm` beside the Play and Stop markers, extending away
from each other east or west; a loop shows the start time on the right and finish on the
left. Each full hour between them shows `HH:00` where the hiker is at that time, and an
hour in a break between recorded segments stays at the earlier segment's end. Unlike the
forecast timeline, any track length qualifies. Clock times wrap at midnight; elapsed
times keep counting past 24 hours. Labels are white text on white-bordered rounded
rectangles in the track colour, follow the Local GPX opacity and visibility, and are not
drawn in satellite comparison panes. They draw above map labels, which give way to them.
Endpoint times always show; hourly times give way to the endpoints and each other.

**Show times on the map**, the first control in **Route timing**, turns the labels on or
off for one track and is remembered in this browser like its route start and pace.
**Count map times from 00:00 at the start** shows elapsed rather than clock times on the
map, without changing the forecast's arrival times. It is disabled when map times are
off. Tracks without their own visibility choice follow **Time markers** in Layers, on by
default. Multi-track view labels every selected track with its own stored settings.

#### Track points

Saved tracks end with a collapsed **Points** section after Weather on desktop and
tablet; smartphones show it only for route plans, which list it expanded below the
profile. Each row shows a blue point marker, the point number, and its distance along
the track with its elevation beside it; the list fills the rest of the pane, and rows
are windowed and memoized, so tracks with many thousands of points scroll smoothly.
Clicking a row selects the point, Shift+click extends the selection from the last
clicked point, and dragging over rows or across the elevation profile selects a run
live. The selection is highlighted on the map and as a band on the elevation profile.
The point under the pointer is shared by the list, the map, and the profile: a hovered
row, map point, or profile position is drawn as an orange marker with a white ring on
the map and on the profile, while selected points ring in blue.

The pencil beside the heading starts editing a saved track. Editing hides every section
except the stats, the elevation profile, and Points, pins **Undo**, **Cancel**, and
**Save** to the bottom of the pane, and draws every stored point as a small dot. A
caption under the compact Points heading names the range-selection gestures. Between
rows a vertical line styled like the map track stands for the leg to the next point,
orange where it follows trails; boundaries between independent segments show no line. A
left map click selects the nearest point within a few pixels instead of opening point
details, and Shift+click on the map (also in 3D, where a moved Shift drag still orbits)
extends the selection from the same anchor as the list. Hovering a row offers **Move**
and **Delete**; Move hands the next map click to the point, which keeps its recorded
time. Hovering a leg offers **+ Add** and a **Routes | Line** switch, and short legs
before the first and after the last point add points at either end. While adding, an
insertion row in the list chooses Routes or Line, each map click inserts a point after
the previous one, and **Done** or Escape stops. **Delete** removes the selection and
selects the two points that now meet, scrolling the list to them, so the joined leg's
mode is easy to change. Route plans use the same list with the switch always visible on
every leg; only their clicked points are listed, never the router's intermediate points.

An unmodified left-button drag on an editable map point moves it without changing the
click behavior. Dragging a **Line** leg inserts a bend point between its endpoints,
including the original solid edges of a recorded track before any edits. A floating
white point with a blue outline follows the nearest bend position when hovering over an
eligible edge; it is hidden over existing anchors, routed legs, gaps, and during
dragging. **Routes** legs and gaps cannot be split this way. The map previews the new
geometry while dragging; release applies one edit and one **Undo** restores the original
geometry. Escape or focus loss cancels an unfinished drag. Recorded time stays on a
moved point, but its old elevation is discarded. Drag hits use the camera's projected
pixel positions in both 2D and 3D. A rendered-feature query rejects presses away from
editable geometry before projecting the track, including on terrain. Repeated-world and
off-map releases wrap longitude back into the stored coordinate range.

While editing, any selection made through the map, list, or profile shows one delete
icon beside the last selected point on the map, including a selection spanning many
points. The icon and the Delete key remove the same selected range as the list's
**Delete** action. Escape clears the shared selection. Text fields, menus, and modal
dialogs keep their keyboard behavior; deleting is unavailable while saving.

After each edit the browser recomputes terrain, metrics, the profile, and climbs as in
planning; moved and added points take the calculated DEM elevation, so the profile spans
the edited stretch. Save replaces the stored geometry of the same track, keeping its
name, folder, favorite, and markers; recorded elevation stays canonical when it still
forms a profile, otherwise the calculated DEM elevation is stored. A synchronized track
is replaced in place on every device, and its public link keeps working and shows the
edited geometry once the edit is synchronized. Cancel discards the edits after
confirmation, and unsaved edits activate the leave-site guard.

#### Multi-track view

The multi-track toggle enables a session-only mode in which row clicks add or remove
tracks in click order. Selected tracks share one bright-blue scene with grade overlays
where profiles exist, and each track keeps its own start and finish markers. The
read-only pane shows a **Selected tracks** header with **Download selected tracks**,
combined statistics, then statistics and a profile per track. The download is
`selected-tracks.zip` with one GPX per track, named from the track with deterministic
`Stem (2).gpx` suffixes for collisions. On smartphones, row clicks keep the list open
and **Show map** reveals a combined disclosure. An empty selection closes the pane; the
mode is never persisted.

#### Public track links

The **Share** dialog (rail **Share**, or **Share…** in **Track actions**) lists the
tracks drawn on the map below its map section: the open track, or every multi-track
selection. A short note above the table says each track is shared separately and the map
link never includes tracks. Each row has a switch in the **Share** column and **Copy
link**, which confirms the copy in place with **Copied**. Opening the dialog loads each
row's status. Only a signed-in owner's synchronized saved track can be shared; other
rows stay disabled with the reason. Disabling keeps the track synchronized. A track link
is the dialog's map link plus `#tracks/share/1.<token>`, keeping the capability out of
request paths and referrers. A recipient needs no account and sees the owner's current
snapshot read-only; the map starts with the link's layer and 2D/3D mode, then fits to
the track once both it and any 3D transition are ready. **Save a copy** creates an
independent local track.

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
the name and the same cells replaces the marker symbol until Markers closes. Overlays
exist only for markers within half a view of the settled camera on every side, plus the
overlay whose 24-hour table is open, because each mounted overlay costs browser style
work on every rendered camera frame. A pan that reaches markers beyond that margin shows
their overlays once the camera settles; until then they show neither overlay nor symbol.
A cell opens the floating 24-hour table used by Weather, starting at the interval
boundary; its **Open in Weather** loads the full forecast at the marker.

The weather-settings action names the selected weekdays in the same date order as the
list columns. **Refresh marker weather** beside it reloads every marker forecast. Failed
marker forecasts retry automatically as in Weather when the app becomes visible again.

### Layers

Layers groups controls under source headings: Weather, Local GPX, Satellites, the
terrain provider, and **OpenStreetMap via OpenFreeMap + OSM Shortbread**. Every map data
source must appear under its provider heading, with an explicit control for each
user-visible feature family outside the base canvas. Logical IDs map to allowlisted
MapLibre layer IDs; native IDs never reach the UI.

- **Weather:** turning the weather map on routes to the Weather tab; turning it off and
  its opacity work here.
- **Local GPX:** Imported tracks, the default-on **Elevation gradient**, one opacity for
  the active preview, saved selection, and gradient, and the default-on **Time markers**
  for tracks without their own choice.
- **Satellites:** **Google satellite imagery**, **Bing aerial imagery**, **Esri World
  Imagery**, **NAPR Orthophoto**, **Soviet topographic maps**, then Sentinel-2
  **Satellite imagery** and **Scene footprint**, enabled once a scene is applied. The
  raster sources are mutually exclusive and may all be off. NAPR orthophotos render the
  newest available aerial pixels from 2025, then 2020, then 2016–2017. Soviet
  topographic maps render 1:10,000 scans where available over a nationwide 1:25,000
  fallback. Hiding Sentinel imagery keeps the scene, footprint, and results.
- **Terrain:** relief shading with its sun-shadow or classic style, elevation isolines,
  and contour spacing.
- **OpenStreetMap:** **OSM detail**, Hiking paths, Roads, Places and POIs, Natural
  features with its indented **Area patterns** (the GOST forest, swamp, scrub, planting,
  scree, and cemetery signs and the protected-area NR sign, usable only while Natural
  features is on; 2D and 3D keep separate saved choices, and 3D starts with them off
  because each pattern adds work to every draped terrain texture), Restricted areas,
  Protected areas (outline, NR sign while Area patterns is on, and name), and one
  opacity that applies to OSM layers and isolines while a raster is active.

Visibility, opacities, imagery choice, rendering mode, stretch, and terrain preferences
persist locally. Sentinel scene data is never persisted; imagery starts empty unless a
share URL requests a scene. Per-layer opacity, drag ordering, and custom layers are not
offered.

The quick map-layer chooser lists **Vector OSM**, **Google Satellite**, **Bing Aerial**,
**Esri World Imagery**, **NAPR Orthophoto**, and **Soviet Topographic** (with an
adjacent help item that opens a scanned 1966 guide to Soviet topographic map symbols in
a new tab), then **OSM overlay** and **Weather** checkboxes, and a final row with
**Sentinel-2** (activates the applied scene or opens Satellite) and **Layers tab**.
Vector OSM shows the vector map at full opacity without changing the saved overlay
setting. The chooser is non-modal and belongs to the map: it stays open while choices
are toggled, the layer button, Escape, or any press outside it closes it, and that press
still reaches the map, so panning or clicking the map works immediately. It closes when
an entry opens a workspace panel, and workspace panels drawn above the map also cover
it.

### Satellite

The search area is a compact `Point | <coordinates>` selector. Point uses the viewport
center at submission; **Search satellite scenes here** in the map point actions sets a
read-only Custom point until the map moves or Point is chosen. A Marker option is shown
disabled. Only L2A scenes are searched; the catalog returns scenes whose footprint
intersects the point, and the submitted viewport is kept for coverage.

The sidebar has an acquisition calendar, a **Maximum cloud** slider (default 50%,
persisted), **Search images**, and rendering settings. The calendar month is the search
month; months are fetched on demand with a short debounce, cached per search, and
cancelled when superseded. Days with imagery show viewport-coverage-weighted cloud; days
at or below the slider are highlighted orange and days above it neutral, while the
slider also filters cards client-side. Clicking a day selects and applies its
highest-coverage scene. Sentinel-2 satellites share a ground track that repeats every 10
days, but each satellite keeps its own cadence (Sentinel-2A often acquires only every
second cycle). Once the loaded acquisitions span one full cycle and reach within a cycle
of today, each satellite's acquisitions from the last 60 days are projected forward with
their shortest observed gap: upcoming days without imagery get a dashed, non-selectable
outline. Predictions are deterministic for the loaded acquisitions and may miss changes
to a satellite's acquisition plan or the polar-season start and end. In both the scene
and Mosaic calendars, today's UTC day number sits on a small translucent circle,
independent of the day frames. Calendar controls include previous/next month and year
arrows, a current-month shortcut, and a non-modal month-year picker; months outside the
archive are disabled, and a year step clamps to the nearest available month.

Results open in an adjacent pane grouped by month, newest first, with acquisition time
in the search point's local time zone, product level, cloud, and viewport coverage. A
warning appears when the scene edge is within 5 km of the search point. **Load more
images** reveals further cards and then earlier months; a sparse pane auto-loads a few
more months. Clicking a card selects, expands, and applies that scene; clicking the
applied card removes its imagery. The expanded card shows acquisition, tile, orbit,
product, edge distance, and attribution, plus **Fit footprint** and **Share link** once
applied, and **Compare** on desktop. At desktop widths the Satellite session survives
rail changes.

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

#### Comparison

On desktop, **Compare** on an expanded card adds the scene to a comparison tray of up to
four images; **Compared** removes it, and compared cards show a compare icon. The tray
pinned to the bottom of the results pane shows the count with **Clear** and **Compare**,
which needs at least two images and opens them with scenes in acquisition order and
static basemaps after them: two side by side, three or four in a 2×2 grid. **Compare**
in the Satellite header, and the compare button below the map-layer chooser in the
right-side controls from any section, open Satellite with a 2×2 grid, with the tray's
images first and plain maps in the other cells. Once a layout is picked in the sidebar,
all of them open in that layout instead (2×1 still becomes 2×2 for three or four
images). Either way, a tray scene whose footprint no longer overlaps the main map's view
is left out, so after panning elsewhere its pane opens as a plain map; static basemaps
cover all of Georgia and always stay.

Comparison replaces the map with the grid. The rail is hidden and a narrow sidebar sits
beside the grid instead of floating over it, so every pane is fully visible; the results
pane is hidden. The sidebar heading counts the shown images beside a **2×1** | **2×2**
layout switch; **2×1** is unavailable while three or four images are shown, and
switching to it moves the shown images, in grid order, into the two remaining maps. The
pick is stored in this browser. The sidebar lists the shown images: a scene with its
date, local time, and cloud, a static basemap by its name. Each has a remove button that
turns that pane back into a plain map; below are **Share link** (two or more images),
**Clear**, and **Back to search**. Each listed scene with a supported raster has a
progress bar for its pane's imagery: it waits for the first tile request, then counts
settled (loaded or failed) of requested tiles in the current view, and reads **Imagery
loaded** once the pane is idle. When a pane falls back from TiTiler, the sidebar shows a
warning that direct imagery is active and slower.

Each pane is a 2D, north-up map. A scene pane shows its scene with the default
OpenStreetMap overlay (labels, roads, and objects) at the saved overlay opacity and
layer choices and the scene footprint; natural features (vegetation, water bodies,
glaciers) are off there so their fills cannot hide the land cover being compared. A pane
without an image is the plain vector map with the main map's layer choices, relief
shading, and isolines. A static basemap pane shows Google Satellite, Bing Aerial, Esri
World Imagery, the NAPR orthophoto, or the Soviet topographic map with the same overlay
and layer choices as a scene pane. Static basemaps chosen on the main map are not shown
in the grid. Every pane draws the imported track as the main map does; markers and
weather are not shown. The panes share one camera. Over a pane the pointer is a large
sky-blue crosshair with a center dot; the other panes show a small white crosshair at
the same point.

A scene pane's label shows the year in bold, the day and month, and the local time and
cloud, all in the scene's local time zone; a static basemap pane's label shows its name,
and a plain pane's label reads **Pick image date**. Clicking a label opens the
acquisition calendar for that pane's visible area on the month any pane's calendar
showed last, else the scene's month, else the current one; a day shows that day's
best-coverage scene in the pane, unless another pane already shows it. Loaded months are
kept for the page session per visible area, so paging back or reopening a calendar on
the same view does not query the catalog again. Labels end with a dropdown arrow and a
layers button whose menu matches the quick layer chooser: **Vector OSM** turns the pane
back into a plain map, and each static basemap shows on that pane; a basemap another
pane already shows is unavailable there. A scene or static basemap label also starts
with a dotted drag handle, outlines itself on hover, and shows the grab cursor; dragging
it onto another pane swaps the two positions. Panes read the rendering mode and stretch
when they open; in Auto, a throttled pane alone switches to direct reads. While the grid
is open, the page-wide MapLibre raster request limit is raised so four panes load in
parallel. The attribution sits flush with the grid's bottom-right corner, as on the main
map.

Leaving Satellite, a smartphone-width window, or **Back to search** closes the grid,
returns the shown images to the tray, and moves the main map to the compared area. The
URL anchor follows the grid: opening it adds a `#satellite/compare` history entry and
closing it a `#satellite` one, so browser Back and Forward close and reopen it; a
reopened grid keeps its positions and layout unless the tray changed meanwhile, and
scenes that no longer reach the view still leave empty panes. On desktop, a URL with
that anchor opens the grid, as **Compare** in the Satellite header does, once the main
map is ready. **Share link** copies a 2D link with `compare=<key>,…` in pane order,
where a key is a scene key or a static basemap ID; opening it on desktop shows the grid
in that order once at least two images resolve, and otherwise shows a notice and the
shared location. Comparison state is never persisted.

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

Only the latest point request updates the panel; Retry and the header's **Refresh
forecast** repeat the current point. A failed forecast is retried automatically once the
app has been visible again for 3 seconds after returning from another browser tab, a
minimized window, or the mobile background. The model update time and
`Weather data by Open-Meteo` attribution stay at the panel bottom. Forecast responses
are session-only. ECMWF IFS values are model forecasts, not station observations.

## Persistent map controls

- **Search:** place-or-coordinate search starts in the viewport and doubles the area up
  to a 500 km radius, appending deduplicated results with their distance. Coordinates
  stay local. Unlabeled pairs are `latitude, longitude`, matching **Copy coordinates**;
  hemisphere forms accept decimal degrees (`41.88919° N, 43.74222° E`) and degrees,
  minutes, and seconds (`42°14'44.24"N 44°37'23.10"E`) in either axis order.
  Settlements, boundaries, mountains, and water features show by default; other results
  sit behind **Show other results**. Map movement does not dismiss or cancel a search.
  Up to two matching saved tracks are listed as well.
- **Status line:** below search, reports readiness, pending work, and safe failures;
  selecting an error opens its safe detail. It is the only surface for map and imagery
  errors. While visible relief or 3D terrain waits for DEM tiles for more than a moment
  it shows **Loading terrain…** with an indeterminate bar, then returns to Ready. Under
  Ready, a **Contours · …** line reports contour generation workload.
- **Point inspection:** a map click, a place-search result, or a coordinate search opens
  an anchored popup with coordinates, terrain elevation, and the nearest map feature
  with its distance. For a search, the nearest feature is looked up once the camera
  arrives and the destination's basemap tiles load; other layers do not delay it. When
  the provider's original name differs from the displayed name, it appears as a second
  line in the same **Nearby map feature** group, without its own label. **Google
  Search** searches the original name; **Google Search (En)** searches the preferred
  English/display name. If a variant is missing, its search uses the available name
  instead. Neither search adds a country. Coordinate links to external maps belong to
  point actions, not the desktop inspection popup. While the popup is visible, the next
  map click only closes it.
- **Sun shadows:** sun shadows are the default style of relief shading; the classic
  fixed-light hillshade is the alternative. The sun button directly below the map-layer
  chooser opens a compact non-modal panel; opening it does not turn shadows on. Its
  **Sun shadows** switch chooses between the two styles and is on only while relief
  shading is shown; turning it on also shows hidden relief shading unless the weather
  map hides terrain. A browser whose layer choices were saved before sun shadows became
  the default switches to them once and shows a notice with an arrow pointing at the sun
  button: relief is now shaded with sun shadows, rendering can be heavy on weak CPUs,
  and the classic hillshade returns from the sun panel or Layers. **Use classic
  shading** switches back and **Got it** keeps the shadows; either, opening the sun
  panel, or any style change hides the notice for good. The panel holds the **Sun
  shadows** switch with an icon-only **Lighting tuning** button to its right (named in
  its tooltip and accessibility label), a date field, a time-of-day slider in whole
  minutes that applies on release or keyboard change, and **Now**. **Lighting tuning**
  is a temporary developer panel, opened right below the control rail beside the sun
  panel and kept open while the map and the sun panel are used: collapsible sections of
  sliders (value shown beside each) and color pickers for the shadow opacity, highlight
  strength (`sunHighlightOpacity`), neutral physical brightness (initially 1), fixed
  exposure in EV, independent shadow strength and smooth highlight rolloff, sky-light
  share, sky occlusion, night and diffuse sky light, the night top light and its focus,
  twilight sky alpenglow, shadow soft edge, the five source colors, and the sky,
  horizon, and fog colors with their glow, antisolar, and fog/horizon blends. Values
  named after their project constants are kept in `localStorage` across reloads;
  **Before** shows the defaults without losing them, **After** restores them, and any
  edit returns to **After**. Double-clicking an item resets it; **Reset all**, **Reset
  section**, and **Copy configuration** (a JSON object of every value) complete it.
  Color and tone controls recolor cached linear source masks; values marked GPU
  recompute lighting once the slider is released. Exposure is shared by all tiles and
  playback frames. `D` switches between shadows and the classic hillshade from anywhere.
  `[` and `]` move the time one minute earlier or later, 10 minutes with Shift, also
  while held, never past either end of the shown day's range; they turn hidden shadows
  on, and a closed panel appears without taking focus until a second after the last key
  release, unless the sun button is pressed meanwhile to keep it open. While shadows for
  one minute are still being drawn, further changes from the keys or the panel only move
  the shown time, and shadows then draw for the latest minute, so holding a key moves at
  key-repeat speed; with Alt (Option on macOS) every step is drawn in turn. Date and
  time are local wall time at the map center (the browser's zone until the first
  viewport settles), with the zone's GMT offset and that day's sunrise and sunset at the
  center shown below. The slider runs from two hours before the first whole minute after
  sunrise to two hours after the last whole minute before sunset, kept within the local
  day; on a day without both (polar day or night) it spans 00:00 to 23:59. **Now** after
  dark (outside sunrise–sunset at the map center) uses 11:00 of that day instead, so the
  map never shows fully shaded. Any other instant outside the range (such as a date
  change or a key step past its end) moves to its nearest end at the map center before
  shadows draw; while the Sun is below the horizon the whole map is in shade. **Play the
  day**, left of the slider and available while shadows are on, computes shadows for as
  many frames as a 10-minute schedule would have, but spaced unevenly: every minute
  around sunrise and sunset, growing to 30 minutes at midday and toward the dark ends of
  the range, for the shown day over the visible tiles, from the current time to the end
  of the range and then from its start, showing a percentage and a cancel button. It
  loops the frames in that order at about 6–7 frames per second, each frame shown only
  once its tiles are drawn, and starts before the computation ends once the remaining
  frames are estimated to be ready before the animation reaches them; **Stop** ends it.
  Any map move, a change in the panel or by key, or turning shadows off stops playback.
  Larger views get sparser frames, so tiles times frames between 45 minutes before
  sunrise and 45 minutes after sunset stay within 2100; only a view where even 24 such
  frames would exceed it shows a note to zoom in instead, until the map moves, and a
  failed computation shows an error note. Browsers that cannot render floating-point
  targets in a worker (WebGL2 with `EXT_color_buffer_float` and `OffscreenCanvas`) see a
  disabled switch with an explanation and the classic hillshade. The style, the default
  time, and the answered notice persist; the instant and playback are session state, and
  every session, including one after a reload with shadows on, starts at the default
  time of today at the map center (11:00 on a day without sunrise and sunset), whatever
  the user's clock says. The overlay is described in
  [Map, terrain, and persistence](#map-terrain-and-persistence).
- **Map capture:** the camera button below the sun button opens a compact panel. **Take
  a screenshot** copies a PNG of the map as currently drawn to the clipboard: the
  rendered map with its labels, tracks, and shading, without controls, panels, markers,
  popups, or the Sun disk overlay, at the canvas's device-pixel size. The panel reports
  whether the copy succeeded. **Record a video of the day**, available while sun shadows
  are on, steps through the frames of **Play the day** for the shown day from its first
  to its last minute, captures each once all its tiles are drawn, and downloads
  `sun-shadows-<date>.mp4`: H.264 video without sound at a constant 30 frames per
  second, each minute shown for 150 ms as in playback, a format that social networks and
  messengers accept for upload. Frames have the same content as the screenshot and are
  scaled to fit 1920×1080 in the map's orientation (smaller maps keep their size). The
  panel shows a blinking red recording light with **Recording…**, a progress bar, the
  percent done and the time left at the pace so far (once three seconds have passed),
  and **Cancel**; a camera move, a time chosen in the sun panel, **Play the day**, or
  turning shadows off stops the recording and says so. Unless a time was chosen in the
  sun panel, the map returns to the minute shown before the recording, however it ended.
  Closing the panel keeps the recording running. **Record a track video**, available
  while sun shadows are on and a single track with route timing is open, downloads
  `<track name>-<hike date>-<start time>.mp4` (for example
  `Sakhizare-2026-07-11-08-00.mp4`, the start in the route's time zone, characters a
  file name cannot hold replaced as in a GPX download) in the same format: a 25-second
  time-lapse of the hike from the start to the finish of [Route timing](#tracks) (date,
  start hour, pace, recorded or estimated time). The icon toggle to the right of that
  button, **Change the lighting**, is on by default; turned off, the shadows stay at the
  minute shown in the sun panel for the whole video while the clock still runs, which
  records far faster. An orange point on the track marks where the hiker is at each
  moment, shown even while imported tracks are hidden. The camera keeps the map's
  current zoom, limited to 12–16, and its tilt, limited to 60°, and follows the hiker's
  path averaged over a second (never more than 120 px off), so it glides over the
  track's kinks while the point stays near the middle. It faces the course of the
  elevation profile's climb, descent, or flat stretch the point is in, measured over 7 %
  of the route (0.4–1.2 km) each side within that stretch and smoothed over about a
  second and a half, so switchbacks do not swing it; it starts turning toward the next
  stretch before the point gets there and is more than halfway round when it arrives. In
  3D, tilted 15° or more, it also turns aside wherever sight lines over the route's
  bare-earth terrain, loaded as for the route lighting, show relief hiding the point or
  the next 500 m of the route, and wherever the slope under the next 300 m faces away
  from it, as a descent seen down its fall line, whose switchbacks fold onto each other:
  then it looks at the slope from the side. It turns up to 45° on climbs and flat
  stretches and 120° on descents, never more than 150° from the view a descent started
  with, so it never spins round to look back up the slope, and no faster than 50° a
  second. The point may drop behind small bumps for about a third of a second at most;
  if the terrain cannot be loaded, the camera keeps to the course. The point is already
  moving in the first frame, eases in over two seconds and out before the finish, and
  the finish is held for the last second. It travels the route at an even speed, nudged
  by the hike's pace: a stretch walked faster plays somewhat faster, but never more than
  1.35 times the average, and a slower one never below 0.75 times it. In recorded time,
  a stop (staying within 25 m for at least 3 minutes, or a recorder paused for a minute
  or more) shows the point resting for up to 0.6 seconds while the clock and the light
  run on; stops together take at most a quarter of the video, and waiting before the
  start or after the finish is left out. The last frame is the real finish. Sun shadows
  show the moment's minute; like the sun panel they draw only from two hours before
  sunrise to two hours after sunset, so night hours keep that edge's night look. A plate
  in the lower-left corner shows the local date and time in the route's time zone above
  the distance and climb so far (the climb ends at the track's ascent), with a wide, low
  elevation profile beside them filled up to the hiker; at 1080p it is about 640 × 82
  px. Moving the map stops the recording and keeps the new view; otherwise the camera
  returns to where it was. The two recordings never run at once.
- **Image comparison:** on desktop, the compare button below the camera button opens the
  Satellite comparison grid from any section (see [Comparison](#comparison)).
- **Ruler:** the last button of that group toggles a session-only measurement; pressing
  it again ends and discards the measurement. While it is on, primary map clicks add
  numbered blue points joined by straight lines; it takes clicks from route planning and
  an enabled weather map, while marker placement and a one-shot weather pick keep
  precedence. There is no separate panel: a dashed line follows the cursor from the last
  point, and a large label below the cursor shows the total distance through the cursor
  and the terrain elevation difference between the first point and the cursor. On
  coarse-pointer devices, which have no cursor, the label sits on the last tapped point
  once there are two points and shows the measured total and the elevation difference
  from the first point. Route planning uses the same cursor label with the distance of
  the pending segment only.
- **Point actions:** right-click opens copy coordinates, **Copy link**, **Share…**,
  create a marker, search satellite scenes here, open the current view in Google Maps or
  Yandex Maps, **Open in Wikiloc**, show the weather forecast, copy a weather-map link,
  and open meteoblue.com or windy.com. External maps receive the current center and zoom
  converted from MapLibre's 512 px scale to the providers' 256 px scale, rounded to
  their supported integer range. Google opens a view without a pin; Yandex also marks
  the clicked point. Their URL controls do not transfer rotation, pitch, or exact
  viewport bounds. Wikiloc accepts only a bounding box, so its link carries a 640×480 px
  box at the current zoom, symmetric around the clicked point in Web Mercator; Wikiloc
  fits it into its map centered on that point, on `ru.wikiloc.com` for the Russian
  interface and `www.wikiloc.com` otherwise. **G** opens Google Maps and **Y** opens
  Yandex Maps at the current center without a pin; point actions show these shortcuts as
  hints. Every external link reads the live camera at activation, including movement
  before a settled snapshot is published. External map links do not depend on a nearby
  named feature. On coarse-pointer devices a tap or search instead opens a bottom sheet
  with the details and the same actions. A search move lands with the point above the
  sheet, in 2D and 3D; a tapped point under the sheet moves above it. Closing a sheet
  that moved the map recenters it on the full screen.
- **Sharing:** one **Share** dialog builds a link to the current map. The rail **Share**
  action opens it on the map center; **Share…** in the point actions opens it on the
  clicked point with the current zoom. Its **Map view** section always carries the
  center and zoom, and can also carry the visible static raster layer (Google, Bing,
  Esri, NAPR orthophoto, or Soviet topographic maps), the visible Sentinel-2 scene, and
  in 3D terrain the 3D mode with bearing and pitch. Each part has an **Include in link**
  checkbox, unavailable while the map does not show it; turning all three off shares
  coordinates only. The choices persist in this browser, and **Copy link** in the point
  actions copies a link to the clicked point with them without opening the dialog;
  Ctrl+C (⌘C on macOS) does the same for the current view and shows the copied link.
  **Copy map link** next to the link field confirms the copy in place with **Copied**
  for two seconds; the map link never includes tracks. Links keep the page's other query
  parameters and its workspace-tab hash, except that an open shared-track link is
  reduced to Tracks; a shared Sentinel-2 scene opens Satellite. A recipient's map
  switches to the shared satellite layer, scene, and 3D view, and the shared satellite
  layer replaces their own layer choice. Below the whole map section, a **Tracks** table
  lists the tracks drawn on the map (see [public track links](#public-track-links)).
- **Camera:** mouse, touch, and map-keyboard camera controls, the right-side control
  column, and the global keyboard shortcuts are described in
  [keyboard shortcuts and map controls](./keyboard-and-map-controls.md). The 2D command
  resets pitch and bearing.
- Attribution remains visible in every section and terrain mode.

## Map, terrain, and persistence

The hiking basemap combines OpenFreeMap for hiking layers and OSM Shortbread for land,
buildings, and streets; see [map providers](./map-providers.md). Labels prefer
`name:en`, then `name:latin`, before native names, and labels of up to 40 characters are
romanized with the track-naming rules above, so they never show Georgian or Cyrillic
script; longer labels are shown as published. On places whose native name is Georgian,
the national-system `q` of an English name is written `k` unless `u` follows
(`Qelitsadi Lake` → `Kelitsadi Lake`); track names keep the OSM English spelling. When
satellite imagery is visible, vegetation and land-use fills and their signs are removed.
Military areas show a red perimeter; the map does not claim to identify all private
land. Protected land (national parks, nature reserves, and other protected areas except
protected landscapes) has a green outline from z7, a sparse translucent green "NR" sign
from z9 (sparser from z13), and from z8 its name at the provider's label point inside
each part of the area, all kept over imagery. Land country borders are solid black
lines. Lines of disputed territories below country level are a bold red dash; like the
other borders, they have no own toggle and follow the OSM overlay opacity over imagery.
Passes are crosses, cliffs are brown GOST toothed lines pointing downhill, and land
cover carries sparse GOST signs: blue dashes for swamps, trees for forest (type is not
in the data), dot clumps for scrub, dots for scree, crosses for cemeteries, and one
regular circle grid for every planting (orchards, vineyards, nurseries). Fords, huts,
shelters, camp sites, drinking water, viewpoints, guideposts, castles and fortresses,
and ruins have their own icons, intermittent streams are dashed, and hotels and guest
houses are not drawn. Invalid configuration prevents the map from mounting with a safe
fatal message; a single vector-source failure is recoverable.

Relief shading, 3D terrain, and client-generated contours (labeled 200 m index lines,
minor spacing 20–100 m, default 50 m) use the Mapterhorn DEM as published, without
client-side repair. Contour work runs in a terrain worker and falls back to inline work
with a Layers warning if the worker cannot recover. The 2D/3D control reuses the same
map and DEM source; failed 3D activation returns to 2D and reports in the status line.
Under Relief shading, **Shading** chooses **Sun shadows** (default) or **Classic**, the
same choice as the sun panel switch, usable while relief shading is shown. **Default
time**, usable with sun shadows, sets where each session opens: **Sunrise** or
**Sunset** and a slider offset in 15-minute steps (from 2 hours before to 6 hours after
sunrise, or 6 hours before to 2 hours after sunset; default 3 hours after sunrise).
Switching the anchor mirrors the offset, and a released change also moves the shown
instant to that time of its day. **Elevation tiles** chooses 512 px (default) or 256 px
declared DEM tiles; it is saved in the browser and applies to relief and 3D at once.
Reloads restore the last settled mode: 2D keeps center and zoom, 3D also keeps bearing
and pitch and re-enters terrain once the map is ready. Details are in
[runtime flows](./runtime-flows.md).

Sun shadows shade relief for the real position of the Sun at the chosen instant. Each
pixel gets its own solar azimuth and elevation (NOAA/Meeus solar coordinates with
atmospheric refraction). Its brightness is the slope's lighting toward the Sun (the
terrain normal against the Sun direction, with flat ground in full sun as the neutral
level and suns below 10° darkening flat ground gradually) multiplied by the visible
fraction of the solar disk above the terrain horizon, traced along the great circle with
Earth curvature and terrestrial refraction. The horizon never sinks below the sea-level
horizon, so high summits keep the first and last light for several minutes while the
valleys are already below the Sun's level. A configurable share of the illumination
comes from the sky, joined after sunset by diffuse light as from thin cloud, so relief
stays readable inside cast shadows. It fades gradually over civil twilight into a faint
night sky. Surrounding terrain hides part of that sky, so gorges and deep valleys
receive less than ridges and open slopes. Cast-shadow edges are softened over a few
pixels.

Direct sunlight and sky illumination remain separate, unclamped floating-point energies.
The direct source receives the clear-air Rayleigh sunlight color, white at high Sun and
yellow, orange, then red along longer atmospheric paths. Its contribution is zero where
terrain or the sea-level horizon hides the solar disk; brightness from the sky cannot be
mistaken for sunlight. The diffuse source has the configured day, golden-hour, twilight,
or night sky chromaticity. Early-twilight alpenglow changes that sky color and therefore
obeys its occlusion; it is not an extra rose fill.

Both source colors are combined in linear RGB before fixed exposure and one display tone
map. Only the final raster is reduced to 8-bit sRGB RGBA. There is no separate orange
low-Sun glow, inferred direct-sun share, tint-coverage cap, or sunset-specific highlight
shoulder.

This is a relative lighting model, not absolute radiometry or a full HDR MapLibre scene.
The existing slope normalization, wrapped sky light, exaggerated sky normals, and
configurable night light remain approximations. MapLibre's normal raster overlay cannot
multiply linear light by the underlying basemap's colors. The overlay is calibrated
against a middle-grey reference surface; arbitrary imagery and map colors remain an
approximation, further softened by layer opacity. A physically correct albedo response
would require access to the basemap render target and a different composition path. Sun
shadows draw only while relief shading is shown, so hiding it, or the weather map hiding
terrain, hides them too. While they draw, the fixed-light hillshade is hidden and
returns with the classic style; a browser that cannot compute shadows keeps the
hillshade. The raster is drawn above relief, satellite imagery, land cover, contours,
and lakes, so water bodies are shaded too, but below buildings, labels, and tracks; it
drapes over 3D terrain and is not drawn in comparison panes. Relief and cast shadows are
computed from z7 up to z12, then overzoomed. Below z7, which in 3D also covers the
distance toward the horizon, the layer shades flat sea-level ground for the same
instant, without relief and in neutral tones only, so low zooms and distant terrain
follow daylight and night without colored twilight rings across the planet. In 3D the
map draws no world copies, which MapLibre would drape over each other.

While sun shadows draw, the 3D sky above the horizon and the haze over distant terrain
follow the Sun at the map center for the same instant: blue by day, twilight blue after
sunset, and dark by the end of civil twilight. Near sunset and sunrise they also follow
the camera direction: looking toward the Sun, the horizon and haze take the color of
direct sunlight (the same atmosphere as the shadow tones, seen from the center's
height); looking away, the horizon turns rose like the Belt of Venus and the haze stays
only faintly warm. MapLibre draws one gradient for the whole screen, so the sky changes
as the camera rotates rather than across one view. MapLibre shows the haze only from
about 60° pitch, fully from 70°. Without sun shadows the map keeps its plain background
above the horizon.

In 3D the Sun itself is drawn as a disk with a soft glow in the color of its light, at
its true position for the camera. It is cut along the skyline of the terrain the map
actually draws, so it sets behind ridges, and it fades as less of the disk stays
visible.

Shadow accuracy is limited by the data and the model:

- The DEM is the Copernicus GLO-30 surface model via Mapterhorn (about 30 m source), so
  forest canopy and buildings partly count as terrain. A z12 pixel is about 14 m at 42°
  N.
- Distant occluders are read from coarser zooms (about 57 m pixels at z10 and 228 m at
  z8), which can slightly lower distant peaks; shadows longer than 100 km are cut.
- Below about 1° of solar elevation refraction depends on the weather, so shadows near
  sunrise and sunset are approximate.
- The sunlight color assumes clear air: dust, haze, and smoke make real sunsets redder
  and dimmer, and the color varies smoothly over about four pixels.
- Near borders the time-zone lookup can pick a neighbouring country's zone (Kazbegi and
  Tusheti resolve to Europe/Moscow, GMT+3, instead of Asia/Tbilisi); the displayed
  offset always matches the instant the shadows use.
- Desktop Chrome is the supported target.

Map errors are classified and shown in the status line; offline messaging promises only
that already rendered areas may stay visible. Retry and recovery rules are in
[runtime flows](./runtime-flows.md#provider-and-webgl-failures).

## Diagnostics and developer mode

Diagnostics are local, bounded, and redacted before storage. The drawer is non-modal and
closes only from its header or the Diagnostics rail button. Its tabs are Overview,
Sentinel query, Map, Logs, and Health. The Map tab shows exact local camera state,
source and layer IDs, terrain, failures, WebGL capabilities, and temporary debug flags
that reset when developer mode ends: MapLibre tile boundaries and collision boxes, and
**Show route search**, which requests each new routed leg's explored search arcs and
draws them under the route plan, one color per search direction. The Sentinel query tab
shows a memory-only timeline of the current or last search and render operation with
per-step state and duration, without payloads, geometry, or URLs.

Exported bundles use schema version 3 with build/runtime data, events, health results,
notes, and a map snapshot whose coordinates are rounded to 0.1 degree; the inspection
CLI in `tools/diagnostics` migrates versions 1 and 2. Provider reachability checks run
only on request.

The Overview tab's **Run 3D benchmark** compares rendering across computers. It switches
to 3D at a fixed scene over Tbilisi looking toward the horizon (z14.26, pitch 75°, the
maximum), where dense streets, buildings, and labels fill the view, loads the tiles
once, then measures a still view, an orbit, a zoom out and back across the detail-layer
zooms, and a pan. The map repaints every frame during each phase, so pauses in the
camera script never read as freezes, while time without any frame, including at the
start or end of a phase, does. Each phase reports frame rate, frame-interval
percentiles, freezes over 100 ms and 500 ms, MapLibre's main-thread time per frame, GPU
time per frame when the browser exposes WebGL timer queries, WebGL calls per frame, and
long tasks. The verdict uses the camera-motion phases, from the worst phase's 95th
percentile frame interval and the freezes over 500 ms summed across them: Good within 34
ms with no freeze, Okay within 100 ms with at most one, Bad within 250 ms with at most
three, and Potato for anything worse. A separate WebGL context then measures fill rate,
draw-call cost, and one draped terrain texture at 1024 and 2048 px, which tells
fill-limited GPUs from call-limited ones; it reports nothing rather than a number when
the browser cannot allocate or finish that work. The drawer shows the verdict with the
key numbers, the running step with its elapsed time, and downloads the full JSON report.
Loading the scene waits at most 30 s and each phase at most 10 s; the report records
whether loading finished, and the drawer warns when measurements include tile loading.
Browsers pause rendering in hidden tabs, so hiding the tab stops the run with an
explanation, and closing the map stops it too. Afterwards the user's 2D/3D mode and
camera are restored; neither the temporary 3D mode nor benchmark camera moves are
persisted. Reports contain browser, screen, GPU, and visible layer IDs but no user
camera, tracks, markers, or URLs, and are never uploaded.

The sun-shadow variant runs the same phases with shadows on, then times shadow updates
over two fixed Caucasus scenes (first view, ten minutes later, and back) and an orbit.
Each update reports the shadow tiles computed and taken from the cache, and per stage
the tile count, total, and maximum time: the worker's GPU queue wait, the wait there for
a camera move to end, DEM mosaic assembly, sky view, visibility, and shade passes and
the readback copy (GPU time from WebGL timer queries, absent without them), the GPU
fence wait, the CPU readback, mask compression or expansion, flat-ground drafts,
coloring, and `createImageBitmap`.

## Configuration

`VITE_MAP_PROVIDER_CONFIGURATION` is optional public JSON validated by Zod. Endpoints
must be HTTPS or application-relative; template tokens, tile sizes, zoom ranges, layer
mappings, and attribution are validated, and errors report an issue count without
echoing the payload. `VITE_*` configuration must never contain secrets.
