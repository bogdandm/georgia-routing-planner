# Georgia Routing Planner: High-Level Plan

## 1. Product definition

Build a desktop-first, local-first planning and exploration application focused on
hiking in Georgia. The application combines recent and historical Sentinel-2 imagery,
hiking-relevant OpenStreetMap features, 3D terrain, an existing GPX library, and manual
straight-line planning.

The MVP is a static web application. It must remain useful without accounts, automatic
routing, or a proprietary backend.

Tracks have two explicit sources. A curated catalog is committed to the repository and
served as versioned static assets by the same GitHub Pages deployment as the
application. Separately, GPX files imported by a user remain private in that browser's
IndexedDB unless the user explicitly exports them. There is no runtime catalog-editing
or upload service and local imports are never uploaded automatically.

## 2. Product and workspace principles

The reviewed Penpot concepts are authoritative for layout, feature placement, control
grouping, and interaction hierarchy. Repository documentation remains authoritative for
data, privacy, architecture, and failure contracts. When UI/UX prose conflicts with the
reviewed design, update the prose to match the design.

### 2.1 The map is the persistent workspace

The map remains mounted and consumes the available canvas while feature navigation,
sidebars, detail panes, dialogs, and developer tools change around it. Controls support
the map rather than compete with it.

### 2.2 Local first

User-imported GPX files, personal organization, saved markers, and saved Create GPX
drafts stay in the browser unless the user explicitly exports them.

### 2.3 No hidden magic

Straight segments are visibly straight, imagery dates and cloud cover are visible, and
calculated elevation states its source.

### 2.4 Consistent statistics

Catalog tracks and Create GPX drafts use the same versioned distance and elevation
calculation policy.

### 2.5 Static by default

Do not introduce a backend until a required feature cannot be implemented safely as a
static application.

### 2.6 Readable engineering

Domain behavior is expressed in small TypeScript classes and use cases, not embedded in
framework event handlers or state stores.

### 2.7 Compact feature navigation

The quick-access rail has four primary feature destinations: `Tracks`, `Satellite`,
`Markers`, and `Layers`. `Diagnostics` (when developer mode is active) and `Settings`
are global rail actions. Manual planning is entered only through `Create GPX` inside
Tracks; there is no Plan tab, rail item, or separate planning destination. The active
feature owns a contextual sidebar, and selected tracks or imagery may open an adjacent
detail pane without replacing the map.

Use Material UI as the component foundation. Do not spend MVP time on custom animation,
ornamental transitions, or a bespoke component system.

### 2.8 Diagnosable by design

A user must be able to export enough structured evidence to investigate failures without
opening browser developer tools.

## 3. Primary user flows

### 3.1 Explore imagery

#### 3.1.1 Enter the Satellite workspace

Open `Satellite` from the rail without remounting the map. The last settled view or the
Georgia-wide default remains visible.

#### 3.1.2 Configure the search

Use the compact `Viewport | <coordinates>` selector. Viewport is the default source; a
saved Marker can become the source when marker data exists. Configure date range,
cloud-cover threshold, and Sentinel-2 L1C/L2A product choice before searching.

#### 3.1.3 Compare acquisitions and scenes

Search acquisitions intersecting the selected area. Group availability by acquisition
date and compare concrete scenes by platform, product level, cloud cover, viewport/area
coverage, and scene-edge warnings. Partial coverage must remain explicit.

#### 3.1.4 Apply and inspect imagery

Apply one concrete true-color scene rather than silently mosaicking candidates. Show its
footprint and adjacent metadata, including acquisition time, tile/orbit/product
identity, coverage, and attribution. Provide fit-footprint and hide-imagery actions.
Keep hiking-relevant OSM layers above imagery, and allow terrain/pitch changes without
losing the applied scene or other workspace state.

### 3.2 Browse the track library

#### 3.2.1 Enter Tracks

Open `Tracks` from the rail. The contextual sidebar exposes `Create GPX`, Import GPX,
library search/filter/sort, folders, and track results.

#### 3.2.2 Keep source ownership explicit

Browse the read-only curated GitHub Pages catalog and GPX tracks retained in the browser
in one library. Global and Local source labels remain visible. Personal organization
never modifies global catalog assets.

#### 3.2.3 Browse and organize folders

Browse curated categories and personal nested folders. Personal folders support explicit
placement and manual ordering for global or local tracks.

#### 3.2.4 Search, filter, and sort results

Search the combined library and filter or sort by visible map area, name, date added,
recorded duration when available, region, length, ascent, maximum elevation, route
shape, source, and curated tags. Results expose compact metrics and colored tags.

#### 3.2.5 Select and preview a track

Selecting a result renders its simplified geometry and selection legend on the map.
Fit-on-map acts on the selected geometry without fetching every original GPX file.

#### 3.2.6 Inspect track details and elevation

Open an adjacent selected-track detail pane with source, route shape, recorded point
count, calculation policy, tags, metrics, folder action, and download action. Its
contextual elevation profile states terrain provenance and sampling policy. Load or
download the full original GPX only when requested. No empty global elevation panel is
shown when no track or Create GPX geometry exists.

### 3.3 Create GPX

#### 3.3.1 Start from Tracks

Start manual planning only with `Create GPX` in Tracks. The command begins a workflow;
it does not navigate to a Plan tab or introduce another top-level feature.

#### 3.3.2 Edit geometry

Add, move, remove, and reorder waypoints. Connect consecutive points with straight
geodesic segments and make that non-routing behavior explicit.

#### 3.3.3 Edit and persist GPX content

Add waypoint names, notes, and display styles. Save the draft locally, reopen it from
Tracks, or export a standards-compliant GPX file.

#### 3.3.4 Calculate contextual metrics

Sample terrain along segments and show distance, ascent/descent, minimum/maximum
elevation, and an elevation profile inside the Create GPX workflow. Reuse the same
versioned policy and visual vocabulary as selected-track details.

### 3.4 Import a local GPX

1. Select or drag a GPX file into the application.
2. Validate and preview it before saving.
3. Extract its name, bounds, distance, optional timestamps/duration, elevation data, and
   validation warnings using the same versioned calculation policies as the static
   catalog.
4. Store it in IndexedDB and include it in the combined track catalog only when the user
   explicitly chooses to retain it.

Import is a Tracks workflow. Show retention/privacy guidance at the preview or confirm
step rather than as a generic banner that consumes the workspace when no import is
active.

### 3.5 Save and revisit a marker

#### 3.5.1 Add and organize markers

Open `Markers` from the rail. Add a marker from the map or sidebar, search and sort
saved markers, organize them into groups, and distinguish all markers from markers in
the current view.

#### 3.5.2 Edit marker details

Edit name, icon, color, coordinates, preferred map scale, and optional terrain-derived
elevation in the contextual details stack. Reopen the marker later to restore its saved
location and scale.

#### 3.5.3 Use a marker in another workflow

Use a saved marker as the target for Satellite search, or copy its coordinate and
supported style/provenance into `Create GPX`. Marker and waypoint identities remain
separate; later marker edits do not mutate the copied waypoint.

### 3.6 Diagnose a problem

#### 3.6.1 Enter Settings and Diagnostics

Open Settings from its global bottom-rail action or enable developer mode with the
documented URL parameter. When enabled, Diagnostics appears as a separate global rail
action; it is not a Tracks/Satellite/Markers/Layers subsection.

#### 3.6.2 Inspect and export evidence

Reproduce the problem while a bounded diagnostic session records structured events.
Inspect map, network, storage, data, performance, and error summaries, then export one
sanitized diagnostics bundle. Geometry and other potentially personal data remain
excluded unless the user explicitly opts in.

### 3.7 Control map layers

Open `Layers` from the rail to control supported visibility, opacity, and ordering
within the typed map-layer bands. The layer surface must preserve provider attribution
and the required relationship among satellite imagery, hiking references, tracks/Create
GPX geometry, markers, and interaction highlights. Do not implement a generic layer
editor or invent detailed controls before a reviewed Layers mockup exists.

## 4. Technical architecture

### 4.1 Layers

```text
presentation
  React composition, Material UI, feature integration, MapLibre adapter

application
  use-case classes, commands/queries, orchestration, result types

domain
  RoutePlan, Waypoint, Track, ElevationProfile, value objects, domain services

ports
  ElevationProvider, SatelliteCatalogGateway, TrackCatalogRepository,
  RoutePlanRepository, Clock, IdGenerator

infrastructure
  Earth Search/STAC HTTP adapter, terrain adapter, static catalog adapter,
  GPX parser/writer, Dexie repositories, browser file adapter

diagnostics
  structured logger, sinks, redaction, snapshots, support-bundle exporter
```

Dependencies point inward. Domain code imports no React, Material UI, MapLibre, browser
API, Zustand, TanStack Query, or Dexie package.

### 4.2 Example domain/application types

- `RoutePlan`
- `Waypoint`
- `RouteSegment`
- `Distance`
- `ElevationSample`
- `ElevationProfile`
- `TrackMetadata`
- `TrackFolder`
- `TrackPlacement`
- `SavedMarker`
- `MapLayerDefinition`
- `SatelliteScene`
- `AddWaypointToPlan`
- `MoveWaypoint`
- `RemoveWaypoint`
- `CalculatePlanMetrics`
- `ImportGpxTrack`
- `ExportPlanAsGpx`
- `SearchTrackCatalog`
- `SearchSatelliteScenes`

Use immutable value objects where they prevent invalid states. DTOs and persisted
records remain plain readonly TypeScript data. Prefer composition and interfaces over
class inheritance.

### 4.3 React integration

- React components are functional and declarative; class components are not used.
- An application composition root constructs repositories and use cases with explicit
  constructor injection.
- A typed React context exposes application services.
- Feature hooks translate user commands into named use-case calls.
- Zustand contains only transient session state such as selected track ID and map
  interaction mode.
- TanStack Query contains remote/static query state and cache; it does not contain
  domain rules.
- MapLibre imperative operations are isolated behind a map adapter/facade.

### 4.4 Async policy

- Use `async`/`await` in application and infrastructure code.
- Pass `AbortSignal` through remote operations.
- TanStack Query owns request cancellation and retry policy.
- Configure `ky` consistently in one HTTP client factory. Avoid retrying the same
  request independently in both `ky` and TanStack Query.
- Parse and validate every external response with Zod before it enters the application
  layer.
- Do not nest promise chains or place multi-step async workflows in React event
  handlers.

### 4.5 Developer mode and diagnostics

Developer mode is a supported production feature, not a development-only console. It
must be cheap when disabled, bounded when enabled, and safe to share by default.

#### Activation

- Locally persisted activation preference.
- Documented URL flag for cases where the primary application cannot initialize.
- Optional `Start diagnostic recording` action that clears the ring buffer and marks a
  reproducible session boundary.
- Recording state must be exposed to the user while active.

#### Structured logging

Implement a typed `DiagnosticLogger` abstraction with `trace`, `debug`, `info`, `warn`,
and `error` levels. Each event contains:

- Timestamp and monotonic elapsed time.
- Stable event name and schema version.
- Level, subsystem, and human-readable message.
- Operation/correlation ID where applicable.
- Sanitized structured context.
- Normalized error type, message, code, and stack when available.

Use a bounded in-memory ring buffer. Optionally retain a small capped recent-session
buffer in IndexedDB so a crash/reload does not destroy the only evidence. Expose an
explicit maximum size/retention policy.

Do not scatter direct `console.log` calls throughout the application. In developer mode,
a console sink may mirror structured events for convenience. The structured logger
remains the source of exported evidence.

#### Instrumentation coverage

- Application startup phases, configuration parsing, service construction, and database
  migrations.
- Global `error` and `unhandledrejection` events plus React error-boundary details.
- Named application use cases with start/success/failure/cancel and duration.
- `ky` request method, sanitized URL/origin, status, duration, byte size when available,
  retry/cancel state, and provider request ID.
- TanStack Query key category, state transitions, cache freshness, failures, and
  cancellation without dumping full response bodies.
- MapLibre lifecycle, WebGL capability/context loss, camera snapshot, active style,
  ordered layers, sources, terrain state, source/tile errors, and last idle time.
  Throttle high-frequency map events.
- GPX import validation steps, point/segment counts, bounds, warnings, calculation
  algorithm version, and processing time.
- Catalog version, counts, rejected/warned items, filter timing, and selected track
  identifiers.
- Elevation provider, sample counts, missing samples, smoothing version, min/max, and
  processing time.
- Dexie database/schema version, table counts, migration outcome, and browser storage
  quota estimate.
- Render/navigation performance, long tasks where supported, memory information where
  safely exposed by Chrome, and important Web Vitals-like timings.

Do not log every animation frame, map render event, coordinate sample, or full GPX/STAC
payload. Summarize and sample high-volume data.

#### Diagnostic capabilities

Provide access to:

- App/build version, commit, build time, environment, current URL, supported
  capabilities, configuration summary, and recent fatal error.
- Non-destructive self-tests for WebGL/terrain capability, catalog integrity, IndexedDB
  read/write, available storage, one elevation sample, and provider reachability/CORS.
  Tests must be non-destructive and distinguish unavailable, degraded, and failed
  states.
- Searchable/filterable structured events with copyable details.
- Camera, active style/layers/sources, terrain/WebGL state, tile/source errors, and
  supported MapLibre boundary/collision diagnostics.
- Recent sanitized requests, timing, status, cancellation, and rate or quota responses.
- IndexedDB version/table counts, storage estimate, catalog/cache versions, and safe
  clear/rebuild operations.
- Selected track/plan summary, validation warnings, calculation versions, and provider
  provenance without full private geometry.
- Startup milestones, slow operations, long tasks, and bounded timing aggregates.
- Supported local diagnostic/experimental overrides with a reset operation.

#### Diagnostics bundle

Export a versioned JSON file initially; add ZIP only if attachments/size require it. The
bundle contains:

- Manifest and diagnostics schema version.
- App version, commit hash, build timestamp, and dependency/runtime summary.
- Browser, OS/platform, locale, viewport, device pixel ratio, WebGL capability, and
  storage estimates.
- Sanitized runtime configuration and data-provider endpoints.
- Structured log ring buffer and recorded-session boundaries.
- Normalized recent errors.
- Map, query-cache, catalog, database, and performance snapshots.
- User-written reproduction notes entered before export.

Default redaction removes tokens, authorization headers, cookies, query secrets,
file-system paths, raw response bodies, GPX XML, full route geometry, timestamps from
personal tracks, and free-form imported metadata. Before export, disclose what will be
included. Adding current plan/track geometry requires a separate explicit opt-in and
warning.

No diagnostic data is uploaded automatically. The user owns and manually shares the
exported file.

Provide a Node-side `diagnostics:inspect` tool in the repository. It validates an
exported bundle with the versioned Zod schema, applies compatibility migrations where
supported, and prints a compact report of errors, failed health checks, slow operations,
provider failures, storage state, map state, and likely next investigation steps. It
must never execute content from a bundle or print fields that the exporter classifies as
sensitive.

If React cannot mount, the bootstrap fallback must still expose the build version,
normalized startup error, clear-local-state guidance, and a minimal diagnostics export
capability.

## 5. Data plan

### 5.1 Static curated GPX catalog source

The maintainer selects and categorizes the curated GPX collection, then commits it to
the GitHub repository under a stable data directory outside normal application source
modules. A Node-based catalog tool validates those inputs and generates the static
assets included in the GitHub Pages build. This is build-time repository preparation,
not a runtime publishing or upload service.

Suggested source shape:

```text
data/
  tracks/
    <stable-name>.gpx
  track-metadata.csv
  catalog-folders.json
  catalog-overrides.json
```

Suggested generated shape:

```text
public/catalog/
  manifest.json
  tracks.json
  folders.json
  track-previews.geojson
  validation-report.json
public/tracks/
  <stable-id>.gpx
```

The generated catalog is read-only in the deployed application. Full GPX assets are
fetched only when the user selects, views, or downloads a track. File-system paths are
not catalog identities; stable IDs and metadata define categorization.

### 5.2 Static catalog build

For every GPX file:

1. Parse tracks, routes, waypoints, elevation, and optional timestamps.
2. Reject invalid coordinates and report malformed segments.
3. Normalize names and create a stable non-path-derived ID.
4. Read the catalog-added time from curated metadata and extract optional recorded
   start/end time and elapsed duration when valid timestamps exist. Never derive the
   catalog-added time from the nondeterministic build clock.
5. Compute bounds, center, distance, loop-ness, and point counts.
6. Resample elevation from the selected DEM for cross-file consistency.
7. Smooth elevation according to one versioned calculation policy.
8. Calculate ascent, descent, and minimum/maximum elevation.
9. Generate simplified preview geometry at one or more tolerances.
10. Detect exact and likely duplicates.
11. Merge curated folder/category metadata and write deterministic sorted output.

The tool must be repeatable: identical inputs produce byte-stable generated metadata
where timestamps are not intentionally included.

For the initial collection size, viewport search uses summary bounds and simplified
preview geometry in memory. Add a generated spatial or tile index only after measurement
shows that the simple search is insufficient.

### 5.3 Curated-source safety review

- Confirm redistribution rights for every source file.
- Remove unwanted author, device, email, and sensitive timestamp metadata from the
  static copies served by GitHub Pages.
- Review home/private start and finish locations.
- Preserve provenance and attribution in catalog metadata where required.
- Never expose source repository paths in generated URLs.

This review applies only to tracks deliberately selected for the public static catalog.
It never scans, transforms, or uploads a user's browser-local tracks.

### 5.4 User-created data

Dexie stores:

- Saved route plans.
- Locally imported track summaries and full GPX content that the user elects to retain.
- Personal folders and explicit placement/order for curated or local tracks.
- Saved markers with name, icon, color, coordinates, optional elevation, and preferred
  map scale.
- Presentation preferences, layer preferences, and the last settled map camera so the
  application reopens at the previous position.
- Cached catalog metadata with a schema/data version.
- Developer-mode preferences and, if enabled, a strictly capped recent diagnostic
  buffer.

Database migrations are explicit and tested. Destructive migrations require an
export/backup path or a clear user confirmation.

The permanent storage and entity contracts are defined in
[`docs/data-model.md`](docs/data-model.md).

## 6. Map and imagery plan

### 6.1 Layer composition

- Keep stable typed layer bands in this order: background, satellite imagery, OSM
  reference overlays, track previews/selected tracks, Create GPX geometry, saved
  markers/waypoints, and interaction highlights.
- Keep sources, rendering adapters, layer visibility/opacity state, and attribution
  separate so new imagery or overlay providers can be added without changing domain
  entities.
- Do not persist arbitrary MapLibre objects. Persist only validated serializable layer
  preferences and reconstruct native sources/layers through the map facade.

### 6.2 OSM

- Use a MapLibre-compatible vector tile source.
- Build a hiking-focused transparent overlay style rather than placing a complete opaque
  street style over satellite imagery.
- Keep OSM attribution visible.
- Make tile/style endpoints configuration-driven so a provider can be changed without
  rewriting features.

### 6.3 Sentinel-2

- Query an anonymous STAC service for the static MVP.
- Restrict results to Sentinel-2 L1C and L2A collections.
- Search by viewport or by a bounded area around a saved marker, plus date range and
  cloud-cover metadata.
- Group matching scenes by acquisition date and retain availability and cloud-cover
  summaries for comparison.
- Initially render true-color imagery only.
- Show acquisition date, product level, product/scene identifier, footprint/coverage,
  and cloud-cover metadata.
- Select a concrete scene explicitly in the MVP rather than silently mosaicking scenes;
  uncovered portions of the viewport remain visible and understandable.
- Keep imagery loading behind a `SatelliteCatalogGateway` and raster-source adapter so a
  future CDSE processing service can replace it.

### 6.4 Terrain and elevation

- Use one raster DEM source for visual terrain and route calculations where technically
  practical.
- Sample manual route segments at a documented interval, initially 30-50 m.
- Apply a deterministic smoothing and positive-gain threshold policy.
- Version the elevation algorithm so catalog data can be regenerated when it changes.
- Label elevation as terrain-derived, not device/barometric elevation.
- Retain MapLibre's existing terrain/pitch capability, but defer richer 3D overlays,
  models, and 3D marker behavior beyond the MVP.

## 7. Automatic testing strategy

Testing is built into every phase. A feature is not complete when it merely works
manually; its domain behavior, important user-visible states, failure modes, and
critical browser workflow need an automated safety net.

### 7.1 Test layers

#### Domain and application unit tests

Run with Vitest and no React, DOM, network, IndexedDB, or MapLibre initialization. Use
constructor-injected fakes for ports. Cover:

- Route-plan and waypoint invariants.
- Geodesic distance and segment calculations.
- Elevation resampling, smoothing, ascent/descent, and missing-data behavior.
- Track filtering, sorting, loop classification, and duplicate decisions.
- GPX import/export application workflows.
- Cancellation, typed errors, and use-case orchestration.
- Diagnostics redaction and schema compatibility.

These tests should be fast enough to run continuously in watch mode.

#### Infrastructure integration tests

Test real adapters against local controlled dependencies:

- Mock Service Worker intercepts STAC, COG metadata, and provider HTTP requests at the
  network boundary. Include success, malformed JSON, invalid schema, timeout,
  cancellation, rate limit, CORS-like failure, and server-error fixtures.
- `fake-indexeddb` runs Dexie repository and migration tests in Node.
- File/DOM fixtures exercise GPX parsing, validation, sanitization, and writing.
- Catalog tooling runs against a small checked-in corpus containing valid, malformed,
  duplicate, reversed, multi-segment, missing-elevation, and privacy metadata examples.
- Golden catalog outputs are compared byte-for-byte where deterministic output is
  required.

#### React component tests

Use React Testing Library and `user-event`. Render components with fake application
services at the composition boundary. Test what a user sees and does:

- Loading, empty, ready, partial, disabled, and error states.
- Track filters and selection.
- Create GPX commands, validation, confirmation, and keyboard behavior.
- Developer-mode activation, recording, health results, and export confirmation.
- Accessible names, focus management, and important screen-reader announcements.

Do not assert private hook state, third-party component internals, or large snapshots.

#### Map adapter tests

Most map behavior should target a small `MapPort`/facade interface and use a fake in
unit/component tests. Test the real MapLibre adapter in Chromium for:

- Source and layer creation/order.
- Camera persistence and bounds fitting.
- 2D/3D terrain transitions.
- Waypoint click/drag translation.
- Style reload recovery.
- WebGL/source failure capture and diagnostics.

Avoid pixel-perfect assertions over live third-party tiles. For deterministic
screenshots, use local fixed vector/raster fixtures or mask the map canvas.

#### Browser end-to-end tests

Playwright starts the production build under a GitHub Pages-like subpath and uses
Chromium only. Network routes serve local fixtures. Critical tests cover:

- Cold application start and a direct URL reload.
- Browse/filter/select a catalog track.
- Import a GPX fixture and handle an invalid file.
- Add, move, reorder, and remove waypoints in Create GPX.
- Calculate metrics and inspect the elevation profile.
- Save, reload, export, and reimport a Create GPX draft.
- Change Sentinel scenes without losing an active Create GPX draft.
- Toggle terrain without recreating application state.
- Recover from provider, storage, and map failures.
- Record/export diagnostics and prove secret/geometry redaction.

### 7.2 Accessibility and visual checks

- Run automated axe checks on application startup and critical workflows.
- Test keyboard-only use of global and feature actions, selection, confirmation, and
  planner workflows.
- Keep a small set of stable Playwright screenshots for application startup and
  important non-map states. Screenshot updates require deliberate review.
- Do not treat automated accessibility checks as complete accessibility proof; manually
  verify the critical keyboard flows before releases.

### 7.3 Coverage policy

Start with enforceable thresholds rather than an aspirational 100%:

- Global statements/lines/functions: 80%.
- Global branches: 75%.
- Domain and application statements/lines: 90%.
- Domain and application branches: 85%.

Generated code, static fixtures, type-only modules, and trivial composition files may be
excluded with documented configuration. Do not add meaningless tests or ignore
directives merely to satisfy a percentage. Risky calculations, migrations, redaction,
and parsers require direct behavioral tests regardless of coverage.

Thresholds can increase once a stable baseline exists; lowering them requires a
documented reason.

### 7.4 Fixtures and determinism

- Check in small synthetic fixtures with no real personal GPX data.
- Freeze clocks and ID generators through injected ports when output depends on time or
  randomness.
- Do not call public services from CI.
- Do not rely on test execution order.
- Restore fake timers, global objects, browser storage, and request handlers after each
  test.
- Use stable coordinates and tolerances for floating-point assertions.
- A flaky test is a defect. Fix or quarantine it with an issue and owner; do not
  normalize repeated blind reruns.

### 7.5 Continuous integration

GitHub Actions runs automatically on every pull request and push to the protected
default branch:

1. Check out the exact commit and install the supported Node LTS plus pnpm.
2. Run `pnpm install --frozen-lockfile`.
3. Run format, lint, and strict type checks.
4. Run unit/component/integration tests with coverage and enforce thresholds.
5. Run catalog tests against the synthetic fixture corpus.
6. Build production assets with the GitHub Pages base path.
7. Serve the built assets and run Playwright Chromium plus axe checks.
8. Upload test reports, coverage, Playwright traces, screenshots, and videos only on
   failure or according to a bounded retention policy.

Required checks block merging. Deployment runs only after the same commit passes all
required checks. A lightweight post-deployment smoke test verifies the Pages URL, asset
base path, build version, and bootstrap without querying external data providers.

## 8. Delivery phases

Phases group capabilities and dependencies; they are not a requirement to implement
every group in numeric order. After the completed map foundation, the active delivery
focus advances the viewport-based Sentinel-2 imagery slice before the catalog, track,
Create GPX, and saved-marker groups. Marker-targeted imagery search remains dependent on
the saved-marker capability, and detailed Layers controls remain dependent on a reviewed
Layers prototype. The active work breakdown and current verification state live in
[`PLAN.md`](./PLAN.md).

### Phase 0: repository and quality scaffold

Deliver:

- React + TypeScript + Vite project.
- Application composition with Material UI and a persistent map entry point.
- Strict TypeScript, ESLint, Prettier, Vitest, Playwright, and CI.
- Mock Service Worker, fake IndexedDB, synthetic fixture foundations, coverage
  enforcement, and a GitHub Actions required-check workflow.
- GitHub Pages base-path configuration.
- Architecture folders and composition root.
- Structured logger, global error capture, React error boundary, build metadata, and the
  initial developer-mode activation path.
- Minimal bootstrap-failure report/export and diagnostics-bundle inspection CLI.

Acceptance:

- `pnpm check` and `pnpm build` pass from a clean checkout.
- Coverage thresholds are enforced and a Playwright Chromium smoke test runs against the
  production build without public network access.
- The application deploys and reloads correctly under a GitHub Pages subpath.
- An intentional startup/component error appears in developer mode and a sanitized
  diagnostics file can be exported.
- `pnpm diagnostics:inspect -- <bundle.json>` validates that file and reports the
  intentional failure.

### Phase 1: map foundation

Deliver:

- MapLibre React viewport.
- Compact workspace shell with Tracks, Satellite, Markers, and Layers rail destinations,
  global Settings/opt-in Diagnostics actions, and honest deferred sidebars.
- OSM vector basemap/overlay with attribution.
- Camera persistence.
- 2D/3D terrain toggle.
- Layer loading and error feedback.
- Map/WebGL/source diagnostics and bounded event instrumentation.

Acceptance:

- Current Chrome can pan, zoom, rotate, pitch, and toggle terrain smoothly.
- Map lifecycle code is isolated from the rest of the application state.
- Changing rail sections, dialogs, or Diagnostics does not remount the map.

### Phase 2: static GPX catalog build

Deliver:

- GPX audit/index CLI.
- Deterministic catalog and simplified preview output.
- Validation and duplicate report.
- Initial curated track, folder/category, time, and metrics schemas.
- Catalog audit report accessible from developer mode.

Acceptance:

- All source tracks are accounted for as valid, rejected, or warned.
- The browser loads one index and does not fetch all original GPX files.

### Phase 3: track catalog

Deliver:

- Catalog loading, filters, visible-map search, previews, selection, details, and
  original GPX download.
- Local GPX parse/validate/preview/retain workflow with no network upload.
- One combined view over read-only curated tracks and retained local tracks.
- Curated categories plus personal nested folders, explicit placement/order, sorting,
  and filtering.
- Elevation summary/profile for selected tracks.
- Tracks contextual sidebar and adjacent selected-track detail pane match the reviewed
  workspace hierarchy.

Acceptance:

- Filtering 1,200 entries feels immediate.
- Selecting a track loads only the data needed for that track.
- A retained local track survives reload and can be removed without affecting the
  curated static catalog.
- Personal organization survives reload without attempting to modify GitHub assets.

### Phase 4: Create GPX and saved markers

Deliver:

- Add/move/remove/reorder waypoint interaction.
- `Create GPX` entry inside Tracks with no separate Plan navigation destination.
- Straight geodesic segments.
- Distance and elevation sampling.
- Elevation profile linked to the map position.
- Local save/load and GPX export.
- Create/edit/delete saved markers with icons, colors, coordinates, terrain-derived
  elevation, and preferred map scale.
- Markers sidebar with search, groups/current-view results, and contextual detail
  editing.
- Convert or copy a saved marker into a planning waypoint without coupling their
  identities.

Acceptance:

- A Create GPX draft survives a page reload and remains reachable from Tracks.
- A saved marker restores its location and preferred map scale after reload.
- Exported GPX reimports without geometry loss.
- Calculation services have deterministic unit tests.

### Phase 5: Sentinel-2 imagery

Deliver:

- STAC search limited to Sentinel-2 L1C/L2A by viewport, date, and cloud cover; add the
  saved-marker search source when the saved-marker capability exists.
- Date-grouped acquisition availability and cloud-cover summaries.
- Explicit scene selection and true-color raster display.
- Scene footprint/coverage, product level, imagery metadata, and attribution.
- Cancellable loading and actionable errors.
- Sanitized request tracing, provider timing, and quota/rate-limit diagnostics.
- Compact Satellite search sidebar, adjacent results/metadata pane, and typed
  imagery/reference visibility and opacity capabilities while preserving layer ordering.
  Add detailed Layers UI only after its own reviewed prototype exists.

Acceptance:

- A user can select a different acquisition without resetting the map or an active
  Create GPX draft.
- Acquisition choices make partial coverage and cloud cover explicit rather than
  implying that one scene covers the entire viewport.
- Secrets are absent from source code and production assets.

### Phase 6: polish and release

Deliver:

- Keyboard and assistive-technology accessibility.
- Loading/empty/error states.
- Chrome performance profiling.
- Data-source documentation, privacy statement, and attribution audit.
- Production GitHub Pages workflow.
- Final diagnostics redaction review, reproduction-notes flow, and support-bundle
  compatibility test.

Acceptance:

- Critical flows pass Playwright Chromium tests.
- Initial load does not download the full GPX collection.
- No uncaught errors occur in the supported workflows.
- A diagnostics bundle from each critical failure fixture contains enough evidence to
  distinguish configuration, provider, parsing, storage, map, and calculation failures
  without exposing private track data.

## 9. Estimated effort

For one developer using Codex assistance:

| Area                                            |                           Expected effort |
| ----------------------------------------------- | ----------------------------------------: |
| Scaffold, architecture, and application startup |                                  3-5 days |
| Map, OSM layers, and terrain                    |                                  4-7 days |
| Catalog audit/index build tooling               | 3-7 days, depending on source consistency |
| Catalog interaction and elevation profile       |                                  4-7 days |
| Create GPX, saved markers, and persistence      |                                  4-7 days |
| Sentinel scene selection/rendering              |                                  4-8 days |
| Testing, accessibility, performance, deployment |                                 5-10 days |

These ranges are planning estimates, not commitments. The first technical spike should
retire the largest uncertainties before detailed estimates are made.

## 10. Main risks and mitigations

| Risk                                          | Mitigation                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Sentinel COG performance or CORS behavior     | Prove one real scene in Phase 1/technical spike; retain a replaceable raster adapter.                                                        |
| Inconsistent elevation gain                   | Use one versioned DEM sampling/smoothing policy and regenerate the catalog.                                                                  |
| MapLibre/React lifecycle complexity           | Keep a dedicated map facade and integration tests; do not let native map objects leak into domain code.                                      |
| GPX source quality and duplicates             | Produce a non-destructive validation report before serving static catalog assets or renaming files.                                          |
| Excessive frontend state complexity           | Separate remote, transient presentation, persisted, and domain state; do not add Redux/NgRx-style machinery without demonstrated need.       |
| Static provider dependence                    | Put all endpoints behind configuration and ports; never hard-code provider behavior into use cases.                                          |
| Problems cannot be reproduced remotely        | Ship production developer mode, structured correlation IDs, health snapshots, and a one-file sanitized diagnostics export.                   |
| Diagnostic logs leak personal data or secrets | Allowlist exported fields, centrally redact, exclude geometry/payloads by default, cap retention, and test redaction with secret fixtures.   |
| Frontend regressions are found only manually  | Require layered automatic tests and protected CI checks; keep map/provider tests deterministic with local fixtures.                          |
| Browser tests become slow or flaky            | Keep most rules below the browser layer, use Chromium only, intercept external requests, retain failure traces, and treat flakes as defects. |

## 11. Deferred ideas

- Route comparison and overlap analysis.
- Photos and route notes.
- Offline regional packages.
- Accounts and shared links.
- Server-side Sentinel processing and additional band combinations.
- Automatic routing, only if it becomes a real user need.

Komoot, Wikiloc, and Strava are intentionally outside the current plan.
