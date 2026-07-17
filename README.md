# Georgia Routing Planner

Georgia Routing Planner is a planned local-first web application for exploring
Georgia with OpenStreetMap data, Sentinel-2 imagery, 3D terrain, a curated GPX
track library, and simple manual route planning.

The project name is provisional. In the MVP, "routing" means placing waypoints
and connecting them with straight segments. It does not mean automatic
trail-following or turn-by-turn routing.

## Status

Architecture and product planning. The application has not been scaffolded yet.

See [TOP_LVL_PLAN.md](./TOP_LVL_PLAN.md) for the product roadmap,
[PLAN.md](./PLAN.md) for the detailed plan for the active implementation phase,
and [AGENTS.md](./AGENTS.md) for the required engineering conventions.

## MVP goals

- Display Sentinel-2 imagery with selected OSM trails, roads, labels, boundaries,
  water, shelters, peaks, passes, and other hiking-relevant features above it.
- Switch between a normal 2D map and pitched 3D terrain without changing engines.
- Browse, search, filter, and display approximately 1,200 existing GPX tracks.
- Import an additional GPX file locally without uploading it.
- Create a plan by adding, moving, and deleting waypoints connected by straight
  segments.
- Calculate distance, elevation gain/loss, minimum/maximum elevation, and an
  interactive elevation profile.
- Save plans and preferences locally in IndexedDB.
- Export a plan as a standards-compliant GPX file.
- Enable a production-safe developer mode and export a sanitized diagnostics
  bundle for remote troubleshooting.
- Run as a static application on GitHub Pages.
- Support current desktop Google Chrome. Safari and legacy browsers are not
  project targets.

## Explicit MVP non-goals

- Automatic routing along trails or roads.
- Accounts, cloud synchronization, or collaborative editing.
- Komoot, Wikiloc, or Strava integrations.
- An always-running application server.
- Offline map-region downloads.
- A separate Cesium viewer.
- Editing OpenStreetMap data.

## Planned stack

| Area | Choice | Reason |
| --- | --- | --- |
| Language | TypeScript, strict mode | Required; makes domain contracts and external data boundaries explicit. |
| UI | React | Preferred frontend framework. |
| Build | Vite | Fast modern build, static output, and straightforward GitHub Pages deployment. |
| GUI components | Material UI and MUI Icons | Ready-to-use accessible application shell, drawers, controls, lists, dialogs, and theming. |
| Elevation chart | MUI X Charts | Keeps charts visually consistent with the rest of the interface. |
| Map | MapLibre GL JS | OSM vectors, raster imagery, GeoJSON, terrain, globe/pitch support, and extensible 3D layers. |
| React map adapter | `react-map-gl/maplibre` | Maintained typed React wrapper around MapLibre. |
| Remote state | TanStack Query | Request lifecycle, caching, cancellation, retry policy, and loading/error state. |
| HTTP | `ky` | Small Fetch-based client with timeouts, hooks, and consistent errors. |
| Runtime validation | Zod | Validates STAC responses, catalog files, saved data, and configuration at boundaries. |
| Local UI state | Zustand | Small predictable store for transient selection and panel state. |
| Persistence | Dexie | Typed IndexedDB access with explicit schema migrations. |
| Geospatial calculations | Turf modules | Distance, bounding boxes, simplification, sampling, and GeoJSON utilities. |
| GPX parsing | `@tmcw/togeojson` in the browser; a Node XML parser in catalog tooling | Mature conversion at runtime and efficient deterministic build-time indexing. |
| Unit tests | Vitest and React Testing Library | Fast domain/application tests and focused component tests. |
| HTTP/integration tests | Mock Service Worker and `fake-indexeddb` | Tests real adapters and failure handling without contacting public services. |
| Browser tests | Playwright, Chromium project only | Tests the supported browser and real map interactions. |
| Accessibility tests | Testing Library plus axe in Chromium | Automatically catches common labeling, contrast, and keyboard problems. |
| Quality | ESLint, typescript-eslint, Prettier, strict `tsc --noEmit` | Consistent readable code and an enforced type boundary. |
| Diagnostics | Internal typed structured logger, error boundary, diagnostics store/exporter | Makes remote debugging possible without an application server or external telemetry. |
| Package manager | pnpm | Fast, deterministic dependency management. |

Dependency versions will be pinned by the lockfile when the application is
scaffolded. The project should use mutually compatible current stable releases,
not unbounded `latest` ranges.

## GUI direction

The interface will use a desktop map-workbench layout:

- A compact top application bar for project name, base-layer choice, 2D/3D
  toggle, import, export, and settings.
- A persistent left Material UI drawer with `Tracks`, `Plan`, and `Satellite`
  tabs.
- The map as the primary canvas.
- A collapsible elevation panel across the bottom.
- Contextual dialogs for metadata, destructive confirmation, and application
  settings.
- A developer drawer, hidden by default, for logs, map/source state, requests,
  storage health, feature flags, and performance information.
- Material UI theme tokens for color, spacing, typography, elevations, and
  component defaults.

The goal is a coherent tool, not a custom design system. Prefer Material UI
composition (`Stack`, `Box`, `Drawer`, `Tabs`, `List`, `FormControl`, and
`Dialog`) over handcrafted widgets. Custom CSS is reserved for the application
shell, map container, and cases Material UI cannot express cleanly.

## Architecture summary

Business rules must not live in React components or Zustand stores. The planned
codebase follows a lightweight clean architecture:

```text
React UI -> application use cases -> domain model
                  |
                  v
             port interfaces
                  |
                  v
       web/API/IndexedDB adapters
```

Domain and application code uses readable classes, immutable values, interfaces,
and constructor injection. React components remain small declarative adapters.
Inheritance is not a goal; composition is preferred.

## Automatic quality gates

Tests are part of normal feature development, not a final stabilization phase.
Every pull request and protected-branch push will run a GitHub Actions pipeline
that installs the frozen lockfile and executes:

1. Formatting, ESLint, and strict TypeScript checks.
2. Domain, application, infrastructure, and React component tests.
3. Catalog-tool fixture and deterministic-output tests.
4. A production build using the GitHub Pages base path.
5. Playwright end-to-end and accessibility tests in Chromium against the built
   application.

External OSM, Sentinel, STAC, and elevation services are replaced with controlled
fixtures in CI. A provider outage must not make the project's test suite flaky.
The branch is considered releasable only when all required checks pass.

## GPX collection

The approximately 1,200 GPX files (under 15 MB total) will be processed during
the build. A catalog tool will generate:

- Search/filter metadata.
- Bounds and map centers.
- Consistently calculated distance and elevation statistics.
- Simplified map-preview geometry.
- Duplicate and validation reports.
- Stable links to original GPX files that are loaded only when selected.

The browser must not fetch and parse all original files at startup.

## Deployment model

The MVP produces static files and is deployed to GitHub Pages through GitHub
Actions. Map, elevation, OSM, and Sentinel-2 data remain external data sources.
No credentials or secrets may be included in the bundle.

Developer mode is part of the production application. It is activated explicitly
from settings or a documented URL flag and can export a sanitized JSON diagnostics
bundle. No logs or usage telemetry are sent anywhere automatically.

If a future feature requires a confidential OAuth client, protected API key,
shared storage, or server-side processing, it must be introduced as a separate
small backend/serverless component rather than weakening the static application's
security.
