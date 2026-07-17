# Georgia Routing Planner: High-Level Plan

## 1. Product definition

Build a desktop-first, local-first planning and exploration application focused
on hiking in Georgia. The application combines recent and historical Sentinel-2
imagery, hiking-relevant OpenStreetMap features, 3D terrain, an existing GPX
library, and manual straight-line planning.

The MVP is a static web application. It must remain useful without accounts,
automatic routing, or a proprietary backend.

## 2. Product principles

1. **The map is the workspace.** Controls should support the map rather than
   compete with it.
2. **Local first.** User-imported GPX files and saved plans stay in the browser.
3. **No hidden magic.** Straight segments are visibly straight, data dates and
   cloud cover are visible, and calculated elevation states its source.
4. **Consistent statistics.** Catalog tracks and new plans use the same distance
   and elevation calculation policy.
5. **Static by default.** Do not introduce a backend until a required feature
   cannot be implemented safely as a static application.
6. **Readable engineering.** Domain behavior is expressed in small TypeScript
   classes and use cases, not embedded in JSX, hooks, or state stores.
7. **Use an existing design system.** Material UI supplies the visual language;
   custom CSS stays small.
8. **Diagnosable by design.** A user must be able to export enough structured
   evidence to investigate failures without opening browser developer tools.

## 3. Primary user flows

### 3.1 Explore imagery

1. Open the application at the last used view or a Georgia-wide default.
2. Choose a Sentinel-2 acquisition date and maximum cloud cover.
3. View the raster imagery with transparent hiking-relevant OSM layers above it.
4. Toggle terrain and adjust pitch/bearing without losing selected layers.

### 3.2 Browse the track library

1. Open the `Tracks` tab.
2. Filter by visible map area, region, length, ascent, maximum elevation, route
   shape, and curated tags.
3. Hover or select a result to highlight its simplified preview.
4. Open the full track, inspect statistics and elevation, and download the
   original GPX if desired.

### 3.3 Create a manual plan

1. Open the `Plan` tab and start a new plan.
2. Click the map to add waypoints; drag to move and use the keyboard or control
   buttons to remove/reorder them.
3. Connect consecutive points with straight geodesic segments.
4. Sample terrain along the segments and show distance, ascent/descent, and an
   elevation profile.
5. Add names, notes, and marker types.
6. Save locally or export to GPX.

### 3.4 Import a local GPX

1. Select or drag a GPX file into the application.
2. Validate and preview it before saving.
3. Store it locally only when the user explicitly chooses to retain it.

### 3.5 Diagnose a problem

1. Enable developer mode from Settings or a documented URL parameter.
2. Reproduce the problem while a bounded diagnostic session records structured
   events.
3. Inspect map, network, storage, data, performance, and error summaries in the
   developer drawer.
4. Export one sanitized diagnostics bundle and attach it to a bug report.
5. Explicitly opt in if track geometry or other potentially personal data is
   needed; it is excluded by default.

## 4. GUI plan

### 4.1 Desktop layout

```text
+----------------------------------------------------------------------------------+
| Georgia Routing Planner | Layers | 2D/3D | Import | Export | Settings             |
+----------------------------+-----------------------------------------------------+
| Tracks | Plan | Satellite  |                                                     |
|----------------------------|                                                     |
| Search / active controls   |                                                     |
|                            |                     MAP                             |
| Track or waypoint list     |                                                     |
|                            |                                                     |
| Context actions            |                                                     |
+----------------------------+-----------------------------------------------------+
| Distance | +Elevation | -Elevation | Min/Max        [collapsible elevation chart] |
+----------------------------------------------------------------------------------+
```

### 4.2 Material UI components

- `AppBar` and `Toolbar` for global actions.
- Permanent/resizable `Drawer` on wide screens; temporary drawer as a fallback
  on narrow screens.
- `Tabs` for Tracks, Plan, and Satellite.
- `List`, `ListItemButton`, `Chip`, and `Tooltip` for catalog results.
- `Slider`, `Select`, `Autocomplete`, and `TextField` for filters.
- `ToggleButtonGroup` for 2D/3D and layer mode.
- `Dialog` for import validation, settings, and confirmations.
- `Snackbar` and `Alert` for recoverable feedback.
- `Skeleton` and progress indicators for remote imagery/catalog state.
- MUI X line chart for elevation.
- A right-side developer `Drawer` with virtualized structured logs, diagnostic
  tabs, recording controls, copy-summary, export, and clear actions.

### 4.3 Styling policy

- Start from one Material UI theme with restrained earth/satellite colors.
- Define all design tokens in `src/app/theme`.
- Use an 8 px spacing rhythm and Material component sizes.
- Use `sx` for small local adjustments; extract repeated patterns into themed
  components or CSS modules.
- Do not build custom buttons, fields, tabs, dialogs, tooltips, or menus when a
  Material UI component exists.
- Do not adopt Tailwind alongside Material UI; two styling systems would create
  unnecessary cognitive overhead.
- Bundle icons and required fonts or use system fonts; do not make the shell
  depend on third-party font availability.

## 5. Technical architecture

### 5.1 Layers

```text
presentation
  React components, feature hooks, MapLibre adapter, MUI theme

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

Dependencies point inward. Domain code imports no React, MapLibre, browser API,
MUI, Zustand, TanStack Query, or Dexie package.

### 5.2 Example domain/application types

- `RoutePlan`
- `Waypoint`
- `RouteSegment`
- `Distance`
- `ElevationSample`
- `ElevationProfile`
- `TrackMetadata`
- `SatelliteScene`
- `AddWaypointToPlan`
- `MoveWaypoint`
- `RemoveWaypoint`
- `CalculatePlanMetrics`
- `ImportGpxTrack`
- `ExportPlanAsGpx`
- `SearchTrackCatalog`

Use immutable value objects where they prevent invalid states. DTOs and persisted
records remain plain readonly TypeScript data. Prefer composition and interfaces
over class inheritance.

### 5.3 React integration

- React components are functional and declarative; class components are not used.
- An application composition root constructs repositories and use cases with
  explicit constructor injection.
- A typed React context exposes application services.
- Feature hooks translate UI events into named use-case calls.
- Zustand contains only transient UI/session state such as active tab, selected
  track ID, open panels, and map interaction mode.
- TanStack Query contains remote/static query state and cache; it does not contain
  domain rules.
- MapLibre imperative operations are isolated behind a map adapter/facade.

### 5.4 Async policy

- Use `async`/`await` in application and infrastructure code.
- Pass `AbortSignal` through remote operations.
- TanStack Query owns request cancellation and retry policy.
- Configure `ky` consistently in one HTTP client factory. Avoid retrying the same
  request independently in both `ky` and TanStack Query.
- Parse and validate every external response with Zod before it enters the
  application layer.
- Do not nest promise chains or place multi-step async workflows in JSX handlers.

### 5.5 Developer mode and diagnostics

Developer mode is a supported production feature, not a development-only console.
It must be cheap when disabled, bounded when enabled, and safe to share by default.

#### Activation

- Settings toggle, persisted locally.
- Documented URL flag for cases where the UI fails before settings can open.
- Optional `Start diagnostic recording` action that clears the ring buffer and
  marks a reproducible session boundary.
- A visible indicator while recording is active.

#### Structured logging

Implement a typed `DiagnosticLogger` abstraction with `trace`, `debug`, `info`,
`warn`, and `error` levels. Each event contains:

- Timestamp and monotonic elapsed time.
- Stable event name and schema version.
- Level, subsystem, and human-readable message.
- Operation/correlation ID where applicable.
- Sanitized structured context.
- Normalized error type, message, code, and stack when available.

Use a bounded in-memory ring buffer. Optionally retain a small capped recent-session
buffer in IndexedDB so a crash/reload does not destroy the only evidence. Provide
clear controls and an explicit maximum size/retention policy.

Do not scatter direct `console.log` calls throughout the application. In developer
mode, a console sink may mirror structured events for convenience. The structured
logger remains the source of exported evidence.

#### Instrumentation coverage

- Application startup phases, configuration parsing, service construction, and
  database migrations.
- Global `error` and `unhandledrejection` events plus React error-boundary details.
- Named application use cases with start/success/failure/cancel and duration.
- `ky` request method, sanitized URL/origin, status, duration, byte size when
  available, retry/cancel state, and provider request ID.
- TanStack Query key category, state transitions, cache freshness, failures, and
  cancellation without dumping full response bodies.
- MapLibre lifecycle, WebGL capability/context loss, camera snapshot, active
  style, ordered layers, sources, terrain state, source/tile errors, and last idle
  time. Throttle high-frequency map events.
- GPX import validation steps, point/segment counts, bounds, warnings, calculation
  algorithm version, and processing time.
- Catalog version, counts, rejected/warned items, filter timing, and selected
  track identifiers.
- Elevation provider, sample counts, missing samples, smoothing version, min/max,
  and processing time.
- Dexie database/schema version, table counts, migration outcome, and browser
  storage quota estimate.
- Render/navigation performance, long tasks where supported, memory information
  where safely exposed by Chrome, and important Web Vitals-like timings.

Do not log every animation frame, map render event, coordinate sample, or full
GPX/STAC payload. Summarize and sample high-volume data.

#### Developer drawer

Provide these views:

- **Overview:** app/build version, commit, build time, environment, current URL,
  supported capabilities, configuration summary, and recent fatal error.
- **Health:** one-click self-tests for WebGL/terrain capability, catalog integrity,
  IndexedDB read/write, available storage, one elevation sample, and provider
  reachability/CORS. Tests must be non-destructive and distinguish unavailable,
  degraded, and failed states.
- **Logs:** searchable/filterable structured events with copy details.
- **Map:** camera, active style/layers/sources, terrain/WebGL state, tile/source
  errors, and toggles for MapLibre tile boundaries/collision diagnostics where
  supported.
- **Requests:** recent sanitized requests, timing, status, cancellation, and rate
  or quota responses.
- **Storage:** IndexedDB version/table counts, storage estimate, catalog/cache
  versions, and safe clear/rebuild actions.
- **Data:** selected track/plan summary, validation warnings, calculation versions,
  and provider provenance without full private geometry.
- **Performance:** startup milestones, slow operations, long tasks, and bounded
  timing aggregates.
- **Flags:** supported local diagnostic/experimental overrides with a reset action.

React Query Devtools may be lazy-loaded only when developer mode is active. They
are a convenience, not a replacement for the exportable application diagnostics.

#### Diagnostics bundle

Export a versioned JSON file initially; add ZIP only if attachments/size require it.
The bundle contains:

- Manifest and diagnostics schema version.
- App version, commit hash, build timestamp, and dependency/runtime summary.
- Browser, OS/platform, locale, viewport, device pixel ratio, WebGL capability,
  and storage estimates.
- Sanitized runtime configuration and data-provider endpoints.
- Structured log ring buffer and recorded-session boundaries.
- Normalized recent errors.
- Map, query-cache, catalog, database, and performance snapshots.
- User-written reproduction notes entered before export.

Default redaction removes tokens, authorization headers, cookies, query secrets,
file-system paths, raw response bodies, GPX XML, full route geometry, timestamps
from personal tracks, and free-form imported metadata. The export UI shows what
will be included. Adding current plan/track geometry requires a separate explicit
checkbox and warning.

No diagnostic data is uploaded automatically. The user owns and manually shares
the exported file.

Provide a Node-side `diagnostics:inspect` tool in the repository. It validates an
exported bundle with the versioned Zod schema, applies compatibility migrations
where supported, and prints a compact report of errors, failed health checks,
slow operations, provider failures, storage state, map state, and likely next
investigation steps. It must never execute content from a bundle or print fields
that the exporter classifies as sensitive.

If React cannot mount, the bootstrap fallback page should still show the build
version, normalized startup error, clear-local-state guidance, and a minimal
diagnostics export action.

## 6. Data plan

### 6.1 GPX catalog source

Keep original files under a stable data directory outside normal application
source modules. A Node-based catalog tool runs before production builds.

Suggested source shape:

```text
data/
  tracks/
    <stable-name>.gpx
  track-metadata.csv
  catalog-overrides.json
```

Suggested generated shape:

```text
public/catalog/
  tracks.json
  track-previews.geojson
  validation-report.json
public/tracks/
  <stable-id>.gpx
```

### 6.2 Catalog pipeline

For every GPX file:

1. Parse tracks, routes, waypoints, elevation, and optional timestamps.
2. Reject invalid coordinates and report malformed segments.
3. Normalize names and create a stable non-path-derived ID.
4. Compute bounds, center, distance, loop-ness, and point counts.
5. Resample elevation from the selected DEM for cross-file consistency.
6. Smooth elevation according to one versioned calculation policy.
7. Calculate ascent, descent, and minimum/maximum elevation.
8. Generate simplified preview geometry at one or more tolerances.
9. Detect exact and likely duplicates.
10. Merge curated metadata and write deterministic sorted output.

The tool must be repeatable: identical inputs produce byte-stable generated
metadata where timestamps are not intentionally included.

### 6.3 Privacy and publishing audit

- Confirm redistribution rights for every source file.
- Remove unwanted author, device, email, and timestamp metadata from published
  copies.
- Review home/private start and finish locations.
- Preserve provenance and attribution in catalog metadata where required.
- Never expose unpublished source paths in generated URLs.

### 6.4 User-created data

Dexie stores:

- Saved route plans.
- Locally imported tracks the user elects to retain.
- UI preferences and last map view.
- Cached catalog metadata with a schema/data version.
- Developer-mode preferences and, if enabled, a strictly capped recent diagnostic
  buffer.

Database migrations are explicit and tested. Destructive migrations require an
export/backup path or a clear user confirmation.

## 7. Map and imagery plan

### 7.1 OSM

- Use a MapLibre-compatible vector tile source.
- Build a hiking-focused transparent overlay style rather than placing a complete
  opaque street style over satellite imagery.
- Keep OSM attribution visible.
- Make tile/style endpoints configuration-driven so a provider can be changed
  without rewriting features.

### 7.2 Sentinel-2

- Query an anonymous STAC service for the static MVP.
- Filter by viewport, date range, collection, and cloud-cover metadata.
- Initially render true-color imagery only.
- Show acquisition date, product/scene identifier, and cloud-cover metadata.
- Keep imagery loading behind a `SatelliteCatalogGateway` and raster-source
  adapter so a future CDSE processing service can replace it.

### 7.3 Terrain and elevation

- Use one raster DEM source for visual terrain and route calculations where
  technically practical.
- Sample manual route segments at a documented interval, initially 30-50 m.
- Apply a deterministic smoothing and positive-gain threshold policy.
- Version the elevation algorithm so catalog data can be regenerated when it
  changes.
- Label elevation as terrain-derived, not device/barometric elevation.

## 8. Automatic testing strategy

Testing is built into every phase. A feature is not complete when it merely works
manually; its domain behavior, important UI states, failure modes, and critical
browser workflow need an automated safety net.

### 8.1 Test layers

#### Domain and application unit tests

Run with Vitest and no React, DOM, network, IndexedDB, or MapLibre initialization.
Use constructor-injected fakes for ports. Cover:

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

- Mock Service Worker intercepts STAC, COG metadata, and provider HTTP requests at
  the network boundary. Include success, malformed JSON, invalid schema, timeout,
  cancellation, rate limit, CORS-like failure, and server-error fixtures.
- `fake-indexeddb` runs Dexie repository and migration tests in Node.
- File/DOM fixtures exercise GPX parsing, validation, sanitization, and writing.
- Catalog tooling runs against a small checked-in corpus containing valid,
  malformed, duplicate, reversed, multi-segment, missing-elevation, and privacy
  metadata examples.
- Golden catalog outputs are compared byte-for-byte where deterministic output is
  required.

#### React component tests

Use React Testing Library and `user-event`. Render components with fake application
services at the composition boundary. Test what a user sees and does:

- Loading, empty, ready, partial, disabled, and error states.
- Track filters and selection.
- Planner commands, validation, dialogs, and keyboard behavior.
- Developer-mode activation, recording, health results, and export confirmation.
- Accessible names, focus management, and important screen-reader announcements.

Do not assert private hook state, MUI implementation details, or large snapshots.

#### Map adapter tests

Most map behavior should target a small `MapPort`/facade interface and use a fake
in unit/component tests. Test the real MapLibre adapter in Chromium for:

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
- Add, move, reorder, and remove planning waypoints.
- Calculate metrics and interact with the elevation chart.
- Save, reload, export, and reimport a plan.
- Change Sentinel scenes without losing the plan.
- Toggle terrain without recreating application state.
- Recover from provider, storage, and map failures.
- Record/export diagnostics and prove secret/geometry redaction.

### 8.2 Accessibility and visual checks

- Run automated axe checks on the application shell and critical dialogs/workflows.
- Test keyboard-only use of global actions, drawers, tabs, lists, dialogs, and
  planner controls.
- Keep a small set of stable Playwright screenshots for the shell and important
  non-map states. Screenshot updates require deliberate review.
- Do not treat automated accessibility checks as complete accessibility proof;
  manually verify the critical keyboard flows before releases.

### 8.3 Coverage policy

Start with enforceable thresholds rather than an aspirational 100%:

- Global statements/lines/functions: 80%.
- Global branches: 75%.
- Domain and application statements/lines: 90%.
- Domain and application branches: 85%.

Generated code, static fixtures, type-only modules, and trivial composition files
may be excluded with documented configuration. Do not add meaningless tests or
ignore directives merely to satisfy a percentage. Risky calculations, migrations,
redaction, and parsers require direct behavioral tests regardless of coverage.

Thresholds can increase once a stable baseline exists; lowering them requires a
documented reason.

### 8.4 Fixtures and determinism

- Check in small synthetic fixtures with no real personal GPX data.
- Freeze clocks and ID generators through injected ports when output depends on
  time or randomness.
- Do not call public services from CI.
- Do not rely on test execution order.
- Restore fake timers, global objects, browser storage, and request handlers after
  each test.
- Use stable coordinates and tolerances for floating-point assertions.
- A flaky test is a defect. Fix or quarantine it with an issue and owner; do not
  normalize repeated blind reruns.

### 8.5 Continuous integration

GitHub Actions runs automatically on every pull request and push to the protected
default branch:

1. Check out the exact commit and install the supported Node LTS plus pnpm.
2. Run `pnpm install --frozen-lockfile`.
3. Run format, lint, and strict type checks.
4. Run unit/component/integration tests with coverage and enforce thresholds.
5. Run catalog tests against the synthetic fixture corpus.
6. Build production assets with the GitHub Pages base path.
7. Serve the built assets and run Playwright Chromium plus axe checks.
8. Upload test reports, coverage, Playwright traces, screenshots, and videos only
   on failure or according to a bounded retention policy.

Required checks block merging. Deployment runs only after the same commit passes
all required checks. A lightweight post-deployment smoke test verifies the Pages
URL, asset base path, build version, and bootstrap without querying external data
providers.

## 9. Delivery phases

### Phase 0: repository and quality scaffold

Deliver:

- React + TypeScript + Vite project.
- Material UI theme and map-workbench shell.
- Strict TypeScript, ESLint, Prettier, Vitest, Playwright, and CI.
- Mock Service Worker, fake IndexedDB, synthetic fixture foundations, coverage
  enforcement, and a GitHub Actions required-check workflow.
- GitHub Pages base-path configuration.
- Architecture folders and composition root.
- Structured logger, global error capture, React error boundary, build metadata,
  and the initial developer-mode drawer/URL activation path.
- Minimal bootstrap-failure report/export and diagnostics-bundle inspection CLI.

Acceptance:

- `pnpm check` and `pnpm build` pass from a clean checkout.
- Coverage thresholds are enforced and a Playwright Chromium smoke test runs
  against the production build without public network access.
- The empty shell deploys and reloads correctly under a GitHub Pages subpath.
- An intentional startup/component error appears in developer mode and a sanitized
  diagnostics file can be exported.
- `pnpm diagnostics:inspect -- <bundle.json>` validates that file and reports the
  intentional failure.

### Phase 1: map foundation

Deliver:

- MapLibre React viewport.
- OSM vector basemap/overlay with attribution.
- Camera persistence.
- 2D/3D terrain toggle.
- Layer loading and error feedback.
- Map/WebGL/source diagnostics and bounded event instrumentation.

Acceptance:

- Current Chrome can pan, zoom, rotate, pitch, and toggle terrain smoothly.
- Map lifecycle code is isolated from the rest of the UI.

### Phase 2: GPX catalog pipeline

Deliver:

- GPX audit/index CLI.
- Deterministic catalog and simplified preview output.
- Validation and duplicate report.
- Initial curated metadata schema.
- Catalog audit report accessible from developer mode.

Acceptance:

- All source tracks are accounted for as valid, rejected, or warned.
- The browser loads one index and does not fetch all original GPX files.

### Phase 3: track catalog UI

Deliver:

- Tracks drawer, filters, visible-map search, previews, selection, details, and
  original GPX download.
- Elevation summary/profile for selected tracks.

Acceptance:

- Filtering 1,200 entries feels immediate.
- Selecting a track loads only the data needed for that track.

### Phase 4: manual planner

Deliver:

- Add/move/remove/reorder waypoint interaction.
- Straight geodesic segments.
- Distance and elevation sampling.
- Elevation chart linked to the map.
- Local save/load and GPX export.

Acceptance:

- A plan survives a page reload.
- Exported GPX reimports without geometry loss.
- Calculation services have deterministic unit tests.

### Phase 5: Sentinel-2 imagery

Deliver:

- STAC search by viewport/date/cloud cover.
- Scene selector and true-color raster display.
- Imagery metadata and attribution.
- Cancellable loading and actionable errors.
- Sanitized request tracing, provider timing, and quota/rate-limit diagnostics.

Acceptance:

- A user can select a different acquisition without resetting the map or plan.
- Secrets are absent from source code and production assets.

### Phase 6: polish and release

Deliver:

- Keyboard accessibility and tooltips.
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
- A diagnostics bundle from each critical failure fixture contains enough evidence
  to distinguish configuration, provider, parsing, storage, map, and calculation
  failures without exposing private track data.

## 10. Estimated effort

For one developer using Codex assistance:

| Area | Expected effort |
| --- | ---: |
| Scaffold, architecture, and GUI shell | 3-5 days |
| Map, OSM layers, and terrain | 4-7 days |
| Catalog audit/index pipeline | 3-7 days, depending on source consistency |
| Catalog UI and elevation profile | 4-7 days |
| Manual planner and persistence | 4-7 days |
| Sentinel scene selection/rendering | 4-8 days |
| Testing, accessibility, performance, deployment | 5-10 days |

These ranges are planning estimates, not commitments. The first technical spike
should retire the largest uncertainties before detailed estimates are made.

## 11. Main risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Sentinel COG performance or CORS behavior | Prove one real scene in Phase 1/technical spike; retain a replaceable raster adapter. |
| Inconsistent elevation gain | Use one versioned DEM sampling/smoothing policy and regenerate the catalog. |
| MapLibre/React lifecycle complexity | Keep a dedicated map facade and integration tests; do not let native map objects leak into domain code. |
| GPX source quality and duplicates | Produce a non-destructive validation report before publishing or renaming files. |
| Excessive frontend state complexity | Separate remote, local UI, persisted, and domain state; do not add Redux/NgRx-style machinery without demonstrated need. |
| CSS/design time grows | Stay within Material UI and the shared theme; reject one-off custom widgets without a functional reason. |
| Static provider dependence | Put all endpoints behind configuration and ports; never hard-code provider behavior into use cases. |
| Problems cannot be reproduced remotely | Ship production developer mode, structured correlation IDs, health snapshots, and a one-file sanitized diagnostics export. |
| Diagnostic logs leak personal data or secrets | Allowlist exported fields, centrally redact, exclude geometry/payloads by default, cap retention, and test redaction with secret fixtures. |
| Frontend regressions are found only manually | Require layered automatic tests and protected CI checks; keep map/provider tests deterministic with local fixtures. |
| Browser tests become slow or flaky | Keep most rules below the browser layer, use Chromium only, intercept external requests, retain failure traces, and treat flakes as defects. |

## 12. Deferred ideas

- Rich 3D marker models and animation.
- Route comparison and overlap analysis.
- Photos and route notes.
- Offline regional packages.
- Accounts and shared links.
- Server-side Sentinel processing and additional band combinations.
- Automatic routing, only if it becomes a real user need.

Komoot, Wikiloc, and Strava are intentionally outside the current plan.
