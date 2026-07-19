# Georgia Routing Planner

[Open Georgia Routing Planner](https://bogdandm.github.io/georgia-routing-planner/)

Georgia Routing Planner is a local-first web application for exploring Georgia. The
complete system concept combines OpenStreetMap data, Sentinel-2 imagery, terrain relief
and contours, 3D terrain, a curated GPX track library, saved markers, layer controls,
and straight-line GPX creation.

The project name is provisional. In the MVP, "routing" means placing waypoints and
connecting them with straight segments. It does not mean automatic trail-following or
turn-by-turn routing.

## Current application

The application provides a compact map workspace with Tracks, Satellite, Markers, and
Layers sections; a validated OpenStreetMap vector basemap; resilient 2D/3D terrain; live
Sentinel-2 L2A search and georeferenced true-color scene rendering; logical map layer
visibility; configurable relief shading and elevation isolines; durable settled-camera
restoration; provider failure feedback; settings; and bounded map/WebGL diagnostics.
Unavailable feature actions are shown as disabled controls or explicit empty states
instead of synthetic data.

See [docs/README.md](./docs/README.md) for the permanent project handbook and
[AGENTS.md](./AGENTS.md) for required engineering conventions.

## Getting started

Prerequisites:

- Node.js `24.14.0` (the pinned Node 24 LTS version in `.node-version`).
- pnpm `11.9.0`.
- Current stable desktop Google Chrome for supported manual use.

One conventional setup is to install Node through a version manager, then install the
pinned package manager:

```shell
npm install --global pnpm@11.9.0
pnpm install --frozen-lockfile
pnpm dev
```

The local development URL printed by Vite serves the application from `/`. Development
uses the public provider defaults unless `VITE_MAP_PROVIDER_CONFIGURATION` supplies a
validated replacement. Unit, integration, and browser tests use controlled local
fixtures and never depend on a public provider.

Playwright uses its own pinned Chromium build. Install it before the first local browser
test:

```shell
pnpm exec playwright install chromium
pnpm e2e
```

## Developer commands

| Command                                     | Purpose                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`                                  | Start the Vite development server.                                       |
| `pnpm typecheck`                            | Check browser, tests, configuration, E2E, and Node tools with strict TS. |
| `pnpm lint`                                 | Run type-aware ESLint and architecture import rules.                     |
| `pnpm format`                               | Write Prettier formatting.                                               |
| `pnpm format:check`                         | Verify formatting without changing files.                                |
| `pnpm test:watch`                           | Run Vitest in watch mode.                                                |
| `pnpm test`                                 | Run unit and React component tests.                                      |
| `pnpm test:integration`                     | Run controlled HTTP/IndexedDB adapter tests.                             |
| `pnpm test:coverage`                        | Enforce the repository coverage thresholds.                              |
| `pnpm e2e`                                  | Build and test the Pages-like subpath in Chromium with axe.              |
| `pnpm diagnostics:inspect -- <bundle.json>` | Validate and summarize an exported diagnostics bundle.                   |
| `pnpm build`                                | Type-check and produce static assets in `dist/`.                         |
| `pnpm check`                                | Run all non-browser CI checks; CI invokes `pnpm e2e` separately.         |

`catalog:audit` and `catalog:build` currently return a clear, non-destructive
not-implemented error. They do not pretend that catalog processing exists.

## Application structure

The composition root in `src/bootstrap/createRuntimeServices.ts` is the only place that
constructs browser adapters and connects them to application-facing ports. Presentation
features receive the typed `RuntimeServices` bundle through a React context. Tests
replace that entire bundle at the provider boundary.

State ownership is deliberate:

| State or behavior                           | Owner                                             |
| ------------------------------------------- | ------------------------------------------------- |
| Component-local presentation state          | React `useState`/`useReducer`                     |
| Cross-feature transient shell state         | Zustand                                           |
| Durable camera and UI settings              | Dexie/IndexedDB                                   |
| Business rules and workflows                | Domain/application classes and injected ports     |
| MapLibre lifecycle and imperative map state | The map feature adapter, never a general UI store |

React components render states and translate user events into named operations. They do
not call `fetch`, Dexie, or domain calculations directly. Application/domain code is
protected from UI, storage, HTTP, and map imports by ESLint restrictions.

## Map providers and configuration

The replaceable map-provider defaults are:

- OpenFreeMap's OpenMapTiles-compatible TileJSON and glyph endpoints for the vector
  basemap. Its shared map palette uses a neutral-grey ground, green vegetation,
  pale-blue glaciers, orange roads and paths, blue contours, and red restricted-area
  perimeters; satellite mode retains those meanings with imagery-safe opacity and
  contrast.
- AWS Open Data Mapzen Terrain Tiles in Terrarium encoding for relief shading,
  client-generated contours, and optional 3D terrain. A bounded client-side filter
  repairs only configured invalid values and isolated extreme pixels before all three
  consumers see the tile.
- Earth Search v1 for anonymous Sentinel-2 L1C/L2A STAC metadata queries.

None of these defaults uses a credential. Provider evidence, licensing, attribution, and
replacement constraints are recorded in
[docs/map-providers.md](./docs/map-providers.md). The application includes a complete
validated override example in
[docs/map-provider-configuration.example.json](./docs/map-provider-configuration.example.json).
For example, PowerShell can load that file before starting Vite:

```powershell
$env:VITE_MAP_PROVIDER_CONFIGURATION = Get-Content -Raw docs/map-provider-configuration.example.json
pnpm dev
```

The value is public build-time JSON. It must not contain secrets, authorization headers,
private query tokens, or confidential account identifiers. HTTPS and relative
application paths are accepted. The Sentinel configuration keeps the L1C/L2A collection
IDs distinct and caps pagination. An invalid override fails closed before MapLibre
mounts and presents a safe configuration message without echoing the input or its URLs.

Provider attribution remains visible in MapLibre. The OpenFreeMap/OpenMapTiles/OSM
credits are shown in 2D; Mapzen/AWS terrain attribution is added whenever relief,
contours, or 3D terrain use the DEM source.

## Developer mode and diagnostics

Developer mode is disabled by default. Enable it in Settings or add `?developer=1` to
the application URL. The URL flag remains available when persisted settings are broken.

The developer drawer shows build information, recent bounded events, non-destructive
browser/WebGL/IndexedDB/storage health checks, and a dedicated Map view. The Map view
shows the exact current camera locally, ordered source/layer IDs, terrain state,
aggregated provider failures, WebGL capabilities, and developer-only MapLibre debug
flags. Provider reachability is checked only after the user explicitly requests it;
normal startup never waits for an optional provider probe.

“Download diagnostics” exports a schema-version 2 JSON file locally. Nothing is
uploaded. The export pipeline allowlists fields and removes tokens, headers, local
Windows paths, GPX filenames, route geometry, and exact coordinates. Exported camera
longitude/latitude are rounded to `0.1` degree; the exact persisted camera remains
local. The inspection CLI accepts current bundles and migrates supported schema-version
1 bundles before summarizing them.

Inspect a received bundle without evaluating its content:

```shell
pnpm diagnostics:inspect -- diagnostics-2026-07-18T10-00-00.000Z.json
```

Invalid JSON and unsupported schema versions return a non-zero exit code with an
actionable message.

## Manual map verification

After `pnpm dev`, use current stable desktop Chrome to:

1. Confirm the map reaches ready state and OpenFreeMap/OpenMapTiles/OSM attribution is
   visible and keyboard reachable.
2. Pan, zoom, rotate, and pitch, wait for movement to settle, reload, and confirm the
   camera restores.
3. Toggle 3D on and off, confirming the map is not replaced, the camera intent is
   preserved, and terrain attribution is visible while 3D is active.
4. Enable developer mode, inspect the Map tab, run the explicit provider checks, and
   validate an exported bundle with `pnpm diagnostics:inspect -- <bundle.json>`.
5. Use the failure fixtures in `pnpm e2e` to confirm vector, DEM, retry, offline, WebGL
   context, accessibility, and public-network isolation behavior.

Known operating limits:

- OpenFreeMap currently has no SLA and its inspected vector source stops at zoom 14.
- The AWS S3 terrain endpoint has no SLA; native DEM coverage stops at zoom 15 and
  higher map zooms overzoom that data.
- There is no silent provider failover, offline-region download, or tile pre-cache.
- The default TiTiler renderer is a public best-effort demo service with no SLA. Replace
  its validated template before sustained public traffic.
- A storage outage falls back to the Georgia overview after a bounded wait; the current
  camera may not persist until storage recovers.
- Sentinel imagery is one scene at a time; mosaics, cloud masking, false color, and
  offline imagery are unavailable.

## GitHub Pages base paths

Development uses `/`. CI and Playwright set `BASE_PATH=/georgia-routing-planner/` so
Vite emits repository-relative static asset URLs. On PowerShell, an equivalent manual
build is:

```powershell
$env:BASE_PATH='/georgia-routing-planner/'
pnpm build
```

The checks workflow runs the frozen install, non-browser checks, production build,
Chromium smoke flows, and axe checks. For a successful `main` run, it also uploads the
exact `dist` artifact built from that commit. The Pages workflow starts only from that
successful Checks run and deploys its immutable artifact, so it cannot publish a feature
branch or independently rebuild unverified source. No deployment is part of
feature-branch verification.

## Complete system concept

The reviewed system concept includes:

- Display Sentinel-2 imagery with selected OSM trails, roads, labels, boundaries, water,
  shelters, peaks, passes, and other hiking-relevant features above it.
- Switch between a normal 2D map and pitched 3D terrain without changing engines.
- Browse, search, filter, and display approximately 1,200 existing GPX tracks.
- Import an additional GPX file locally without uploading it.
- Use `Create GPX` in Tracks to add, move, and delete waypoints connected by straight
  segments.
- Calculate distance, elevation gain/loss, minimum/maximum elevation, and an interactive
  elevation profile.
- Save Create GPX drafts and preferences locally in IndexedDB.
- Export a Create GPX draft as a standards-compliant GPX file.
- Enable a production-safe developer mode and export a sanitized diagnostics bundle for
  remote troubleshooting.
- Run as a static application on GitHub Pages.
- Support current desktop Google Chrome. Safari and legacy browsers are not project
  targets.

## System boundaries

- Automatic routing along trails or roads.
- Accounts, cloud synchronization, or collaborative editing.
- Komoot, Wikiloc, or Strava integrations.
- An always-running application server.
- Offline map-region downloads.
- A separate Cesium viewer.
- Editing OpenStreetMap data.

## Stack

| Area                    | Choice                                                                       | Reason                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Language                | TypeScript, strict mode                                                      | Required; makes domain contracts and external data boundaries explicit.                       |
| UI                      | React                                                                        | Preferred frontend framework.                                                                 |
| Build                   | Vite                                                                         | Fast modern build, static output, and straightforward GitHub Pages deployment.                |
| GUI components          | Material UI and MUI Icons                                                    | Ready-to-use accessible application shell, drawers, controls, lists, dialogs, and theming.    |
| Elevation chart         | MUI X Charts                                                                 | Keeps charts visually consistent with the rest of the interface.                              |
| Map                     | MapLibre GL JS                                                               | OSM vectors, raster imagery, GeoJSON, terrain, globe/pitch support, and extensible 3D layers. |
| React map adapter       | `react-map-gl/maplibre`                                                      | Maintained typed React wrapper around MapLibre.                                               |
| Remote state            | TanStack Query                                                               | Request lifecycle, caching, cancellation, retry policy, and loading/error state.              |
| HTTP                    | `ky`                                                                         | Small Fetch-based client with timeouts, hooks, and consistent errors.                         |
| Runtime validation      | Zod                                                                          | Validates STAC responses, catalog files, saved data, and configuration at boundaries.         |
| Local UI state          | Zustand                                                                      | Small predictable store for transient selection and panel state.                              |
| Persistence             | Dexie                                                                        | Typed IndexedDB access with explicit schema migrations.                                       |
| Geospatial calculations | Turf modules                                                                 | Distance, bounding boxes, simplification, sampling, and GeoJSON utilities.                    |
| GPX parsing             | `@tmcw/togeojson` in the browser; a Node XML parser in catalog tooling       | Mature conversion at runtime and efficient deterministic build-time indexing.                 |
| Unit tests              | Vitest and React Testing Library                                             | Fast domain/application tests and focused component tests.                                    |
| HTTP/integration tests  | Mock Service Worker and `fake-indexeddb`                                     | Tests real adapters and failure handling without contacting public services.                  |
| Browser tests           | Playwright, Chromium project only                                            | Tests the supported browser and real map interactions.                                        |
| Accessibility tests     | Testing Library plus axe in Chromium                                         | Automatically catches common labeling, contrast, and keyboard problems.                       |
| Quality                 | ESLint, typescript-eslint, Prettier, strict `tsc --noEmit`                   | Consistent readable code and an enforced type boundary.                                       |
| Diagnostics             | Internal typed structured logger, error boundary, diagnostics store/exporter | Makes remote debugging possible without an application server or external telemetry.          |
| Package manager         | pnpm                                                                         | Fast, deterministic dependency management.                                                    |

Direct dependency versions are exact in `package.json`, and the full compatible graph is
frozen in `pnpm-lock.yaml`. pnpm permits only the reviewed `esbuild` lifecycle script
and explicitly denies MSW's optional script.

## GUI direction

The approved Penpot concepts are the visual and interaction source of truth. The durable
workspace contract is recorded in [Features and workspace UX](./docs/features.md); when
repository prose conflicts with the reviewed Penpot layout, update the prose rather than
reinterpreting the design.

The interface uses a desktop map-workbench layout:

- A compact left quick-access rail whose primary feature sections are `Tracks`,
  `Satellite`, `Markers`, and `Layers`; `Settings` and opt-in `Diagnostics` are global
  actions at the bottom of the rail.
- A contextual sidebar for the active feature, with an adjacent detail pane for selected
  tracks or imagery when the reviewed workflow needs one.
- Manual planning launched by `Create GPX` from Tracks. Planning is a workflow, not a
  top-level feature, tab, or rail section.
- The persistent map as the primary canvas, with place search and 2D/3D controls layered
  over it. The 2D/3D selector sits below the right-side navigation/compass controls.
- Elevation appears only in contextual track or Create GPX details when geometry exists;
  there is no empty global elevation panel.
- Contextual dialogs for metadata, destructive confirmation, and application settings.
- A developer drawer, hidden by default, for logs, map/source state, requests, storage
  health, feature flags, and performance information.
- Material UI theme tokens for color, spacing, typography, elevations, and component
  defaults.

The goal is a coherent tool, not a custom design system. Prefer Material UI composition
(`Stack`, `Box`, `Drawer`, `Tabs`, `List`, `FormControl`, and `Dialog`) over handcrafted
widgets. Custom CSS is reserved for the application shell, map container, and cases
Material UI cannot express cleanly.

## Architecture summary

Business rules must not live in React components or Zustand stores. The codebase follows
a lightweight clean architecture:

```text
React UI -> application use cases -> domain model
                  |
                  v
             port interfaces
                  |
                  v
       web/API/IndexedDB adapters
```

Domain and application code uses readable classes, immutable values, interfaces, and
constructor injection. React components remain small declarative adapters. Inheritance
is not a goal; composition is preferred.

## Automatic quality gates

Tests are part of normal feature development and are not postponed to final
stabilization. Every pull request and relevant branch push runs a GitHub Actions
pipeline that installs the frozen lockfile and executes:

1. Formatting, ESLint, and strict TypeScript checks.
2. Domain, application, infrastructure, and React component tests.
3. Controlled HTTP and IndexedDB infrastructure tests.
4. A production build using the GitHub Pages base path.
5. Playwright shell, diagnostics, and accessibility tests in Chromium against the built
   application.

External OSM, Sentinel, STAC, and elevation services are replaced with controlled
fixtures in CI. A provider outage must not make the project's test suite flaky. The
branch is considered releasable only when all required checks pass.

## GPX collection

The complete system concept gives tracks two independent sources. The approximately
1,200 maintainer-selected GPX files (under 15 MB total) form a read-only static catalog
served by the GitHub Pages deployment. Catalog tooling produces:

- Search/filter metadata.
- Bounds and map centers.
- Consistently calculated distance and elevation statistics.
- Simplified map-preview geometry.
- Duplicate and validation reports.
- Stable links to original GPX files that are loaded only when selected.

The browser must not fetch and parse all original files at startup.

Separately, a user may import GPX files into that browser. Retained imports, personal
folders, saved markers, and Create GPX drafts live only in IndexedDB and are never added
to GitHub or uploaded automatically. The UI combines curated and local tracks without
erasing their different ownership. See
[Data model and storage ownership](docs/data-model.md).

## Deployment model

The MVP produces static files and is deployed to GitHub Pages through GitHub Actions.
Map, elevation, OSM, and Sentinel-2 data remain external data sources. No credentials or
secrets may be included in the bundle.

Developer mode is part of the production application. It is activated explicitly from
settings or a documented URL flag and can export a sanitized JSON diagnostics bundle. No
logs or usage telemetry are sent anywhere automatically.

If a requirement introduces a confidential OAuth client, protected API key, shared
storage, or server-side processing, it must use a separate small backend/serverless
component rather than weakening the static application's security.
