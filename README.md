# Georgia Routing Planner

Georgia Routing Planner is a planned local-first web application for exploring Georgia
with OpenStreetMap data, Sentinel-2 imagery, 3D terrain, a curated GPX track library,
and simple manual route planning.

The project name is provisional. In the MVP, "routing" means placing waypoints and
connecting them with straight segments. It does not mean automatic trail-following or
turn-by-turn routing.

## Status

Phase 0 infrastructure is implemented and verified on a feature branch and is awaiting
maintainer approval. The current vertical smoke path provides a strict React/TypeScript
application, a Material UI workbench shell, a network-free MapLibre canvas, local
settings persistence, typed service composition, diagnostics export, and automatic
tests. Product features remain assigned to later roadmap phases.

See [TOP_LVL_PLAN.md](./TOP_LVL_PLAN.md) for the product roadmap, [PLAN.md](./PLAN.md)
for the detailed plan for the active implementation phase, and [AGENTS.md](./AGENTS.md)
for the required engineering conventions.

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

The local development URL printed by Vite serves the application from `/`. No public map
or data provider is contacted by the Phase 0 canvas.

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
| `pnpm test:coverage`                        | Enforce the Phase 0 coverage thresholds.                                 |
| `pnpm e2e`                                  | Build and test the Pages-like subpath in Chromium with axe.              |
| `pnpm diagnostics:inspect -- <bundle.json>` | Validate and summarize an exported diagnostics bundle.                   |
| `pnpm build`                                | Type-check and produce static assets in `dist/`.                         |
| `pnpm check`                                | Run all non-browser CI checks; CI invokes `pnpm e2e` separately.         |

`catalog:audit` and `catalog:build` intentionally return a clear, non-destructive Phase
2 placeholder error. They do not pretend that catalog processing exists yet.

## Phase 0 application structure

The composition root in `src/app/bootstrap/createApplicationServices.ts` is the only
place that constructs browser adapters and connects them to application-facing ports.
Features receive the typed `ApplicationServices` bundle through a React context. Tests
replace that entire bundle at the provider boundary.

State ownership is deliberate:

| State or behavior                           | Owner                                             |
| ------------------------------------------- | ------------------------------------------------- |
| Component-local presentation state          | React `useState`/`useReducer`                     |
| Cross-feature transient shell state         | Zustand                                           |
| Durable settings and future local records   | Dexie/IndexedDB                                   |
| Future remote/static request state          | TanStack Query                                    |
| Business rules and workflows                | Domain/application classes and injected ports     |
| MapLibre lifecycle and imperative map state | The map feature adapter, never a general UI store |

React components render states and translate user events into named operations. They do
not call `fetch`, Dexie, or future domain calculations directly. Application/domain code
is protected from UI, storage, HTTP, and map imports by ESLint restrictions.

## Developer mode and diagnostics

Developer mode is disabled by default. Enable it in Settings or add `?developer=1` to
the application URL. The URL flag remains available when persisted settings are broken.

The developer drawer shows build information, recent bounded events, and non-destructive
browser/WebGL/IndexedDB/storage health checks. “Download diagnostics” exports a
versioned JSON file locally. Nothing is uploaded. The export pipeline allowlists fields
and removes tokens, headers, local Windows paths, GPX filenames, and coordinate pairs.

Inspect a received bundle without evaluating its content:

```shell
pnpm diagnostics:inspect -- diagnostics-2026-07-18T10-00-00.000Z.json
```

Invalid JSON and unsupported schema versions return a non-zero exit code with an
actionable message.

## GitHub Pages base paths

Development uses `/`. CI and Playwright set `BASE_PATH=/georgia-routing-planner/` so
Vite emits repository-relative static asset URLs. On PowerShell, an equivalent manual
build is:

```powershell
$env:BASE_PATH='/georgia-routing-planner/'
pnpm build
```

The Pages workflow is guarded to `refs/heads/main`; it cannot deploy a feature branch.
The checks workflow runs the frozen install, non-browser checks, production build,
Chromium smoke flows, and axe checks. No deployment is part of feature-branch
verification.

## MVP goals

- Display Sentinel-2 imagery with selected OSM trails, roads, labels, boundaries, water,
  shelters, peaks, passes, and other hiking-relevant features above it.
- Switch between a normal 2D map and pitched 3D terrain without changing engines.
- Browse, search, filter, and display approximately 1,200 existing GPX tracks.
- Import an additional GPX file locally without uploading it.
- Create a plan by adding, moving, and deleting waypoints connected by straight
  segments.
- Calculate distance, elevation gain/loss, minimum/maximum elevation, and an interactive
  elevation profile.
- Save plans and preferences locally in IndexedDB.
- Export a plan as a standards-compliant GPX file.
- Enable a production-safe developer mode and export a sanitized diagnostics bundle for
  remote troubleshooting.
- Run as a static application on GitHub Pages.
- Support current desktop Google Chrome. Safari and legacy browsers are not project
  targets.

## Explicit MVP non-goals

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

The interface will use a desktop map-workbench layout:

- A compact top application bar for project name, base-layer choice, 2D/3D toggle,
  import, export, and settings.
- A persistent left Material UI drawer with `Tracks`, `Plan`, and `Satellite` tabs.
- The map as the primary canvas.
- A collapsible elevation panel across the bottom.
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

Business rules must not live in React components or Zustand stores. The planned codebase
follows a lightweight clean architecture:

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

Tests are part of normal feature development, not a final stabilization phase. Every
pull request and relevant branch push runs a GitHub Actions pipeline that installs the
frozen lockfile and executes:

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

The approximately 1,200 GPX files (under 15 MB total) will be processed during the
build. A catalog tool will generate:

- Search/filter metadata.
- Bounds and map centers.
- Consistently calculated distance and elevation statistics.
- Simplified map-preview geometry.
- Duplicate and validation reports.
- Stable links to original GPX files that are loaded only when selected.

The browser must not fetch and parse all original files at startup.

## Deployment model

The MVP produces static files and is deployed to GitHub Pages through GitHub Actions.
Map, elevation, OSM, and Sentinel-2 data remain external data sources. No credentials or
secrets may be included in the bundle.

Developer mode is part of the production application. It is activated explicitly from
settings or a documented URL flag and can export a sanitized JSON diagnostics bundle. No
logs or usage telemetry are sent anywhere automatically.

If a future feature requires a confidential OAuth client, protected API key, shared
storage, or server-side processing, it must be introduced as a separate small
backend/serverless component rather than weakening the static application's security.
