# Phase 1 Plan: Map Foundation

## 1. Purpose and relationship to the roadmap

This is the detailed implementation plan for Phase 1 of
[TOP_LVL_PLAN.md](./TOP_LVL_PLAN.md). It replaces the Phase 0 network-free smoke canvas
with the first production map foundation: a MapLibre viewport backed by validated,
replaceable OSM and terrain configuration, durable camera state, a resilient 2D/3D
terrain control, and privacy-safe map diagnostics.

Phase 1 establishes the map as a stable platform for catalog previews, manual planning,
and Sentinel-2 imagery. It does not implement those later product features.

## 2. Phase status and Git boundary

- Status: **planned; implementation has not started**.
- Phase 0 is merged into `main` at the start of this plan.
- Planning branch: `docs/phase-1-map-foundation-plan`.
- Implementation must occur on a feature branch, normally `feature/map-foundation`.
- `main` must remain unchanged until the user explicitly approves a verified
  feature-branch state.
- No remote push, pull request, deployment, or branch-protection change is included
  unless separately requested.

Phase 1 must be delivered as a sequence of small, reviewable commits. It must not be
collapsed into one phase-sized implementation commit. Every implementation commit must
include its relevant tests and leave the repository in a buildable, testable state.

## 3. Required outcome

At completion, the application must:

- Contain no tracked dependency directories, generated build/test output, local logs,
  diagnostics exports, secrets, editor state, or temporary files, with a repeatable
  repository audit included in normal checks.
- Use unambiguous top-level source names: `bootstrap` for runtime construction,
  `presentation` for React/UI code, and `application` only for use cases and ports.
- Render one long-lived MapLibre map centered on Georgia with an OSM-derived vector
  basemap and hiking-relevant overlay layers.
- Keep required OSM, vector-provider, and terrain attribution visible.
- Load all provider endpoints and provider-specific source-layer mappings through a
  validated, replaceable configuration boundary.
- Restore the last valid camera after reload and fall back safely when persisted data is
  absent or corrupt.
- Pan, zoom, rotate, and pitch smoothly in current stable desktop Chrome.
- Switch between a flat 2D presentation and 3D terrain without recreating the map,
  replacing its style, or losing the current center, zoom, and bearing.
- Keep a usable 2D map when terrain is unavailable and give the user actionable,
  accessible failure feedback.
- Isolate MapLibre's native object, events, sources, layers, and cleanup inside the map
  feature adapter/facade.
- Record bounded lifecycle, source, style, terrain, camera-summary, and WebGL evidence
  without logging high-frequency events or sensitive URL data.
- Expose a sanitized map snapshot and map/WebGL health information in developer mode and
  diagnostics exports.
- Pass deterministic automatic tests without contacting a public tile, terrain, or
  imagery provider.

## 4. Fixed decisions

The following decisions come from the top-level plan and Phase 0 architecture:

- Continue using MapLibre GL JS through `react-map-gl/maplibre`; do not add a second map
  engine or React map wrapper.
- Keep React components functional and declarative. MapLibre imperative behavior belongs
  in a typed map adapter/facade.
- Use one map instance for the lifetime of the workspace. Tab, drawer, diagnostics, and
  terrain-state changes must not remount it.
- Use a MapLibre-compatible vector source for OSM data. Do not make the production
  basemap depend on the public `tile.openstreetmap.org` raster service.
- Build a restrained hiking-focused style with centrally defined source and layer IDs.
  Satellite imagery added later must be able to sit below hiking vectors and labels.
- Use a `raster-dem` source compatible with MapLibre terrain. Provider encoding, tile
  size, zoom limits, URLs, and attribution are configuration, not feature constants.
- Keep the MVP static and anonymous. Public `VITE_*` values cannot contain secrets.
- Persist durable camera state through the existing Dexie settings repository. Do not
  mirror the authoritative camera continuously into Zustand.
- Use the existing typed logger, diagnostics service, health checks, and composition
  root rather than creating map-specific global services with overlapping ownership.
- Keep CI deterministic with checked-in synthetic fixtures and Playwright request
  interception. Public-provider availability is never a required test dependency.
- Add no runtime dependency unless the implementation demonstrates a concrete gap in
  MapLibre, React, Zod, Dexie, MUI, and the browser APIs already installed.
- Reserve `application` for the clean-architecture application layer. Remove the vague
  `src/app` name by moving composition to `src/bootstrap` and React/UI code to
  `src/presentation` before adding Phase 1 map files.
- Keep generated dependencies and local outputs out of Git. The lockfile, source
  fixtures, and intentional configuration examples remain tracked; installed packages,
  build output, reports, caches, logs, secrets, and personal exports do not.

## 5. Provider feasibility and configuration gate

Provider selection is a required Phase 1 gate because anonymous static clients cannot
protect credentials and provider policies, CORS behavior, schemas, and availability can
change.

Before making a provider the production default, record an evidence-based decision in
`docs/map-providers.md` covering:

1. Anonymous browser use from the GitHub Pages origin and local development origin.
2. No secret, confidential token, or referrer-only credential embedded in the bundle.
3. Published usage policy, attribution text/link, license obligations, and reasonable
   MVP traffic limits.
4. HTTPS and CORS behavior for vector metadata/tiles, glyphs, sprites, and DEM tiles.
5. Vector source-layer names required for paths, roads, water, land cover, boundaries,
   settlements, peaks, passes, and hiking-relevant points of interest.
6. DEM encoding (`mapbox` or `terrarium`), tile size, useful zoom range, no-data
   behavior, and attribution.
7. Current Chrome behavior for style load, pitch, terrain, and recoverable tile errors.
8. A replacement/fallback path that requires configuration and style-mapping changes,
   not changes to React feature workflows.

The production application must fail configuration validation with an actionable
bootstrap/map message rather than silently contacting an unintended endpoint. If no
acceptable anonymous vector or terrain provider exists, stop at this gate and report the
constraint; do not work around it by publishing a private key.

The top-level risk register also calls for a small Sentinel COG feasibility spike in
Phase 1. Time-box a non-product investigation of one public true-color COG in current
Chrome and record CORS, range-request, render-time, and replacement-adapter findings in
the same provider document. Do not add STAC search, scene selection, or a production
satellite UI in this phase.

## 6. Phase non-goals

- Sentinel/STAC search, date/cloud filters, or a user-visible satellite layer.
- GPX parsing, catalog generation, track previews, track selection, or downloads.
- Manual waypoints, route segments, route editing, or elevation calculation.
- Offline regional map packages, service-worker tile caching, or prefetching.
- Geocoding, directions, automatic routing, or turn-by-turn navigation.
- Multiple base-style themes or a general-purpose layer editor.
- 3D buildings, custom terrain meshes, globe projection, or rich animations.
- Mobile layout or Safari-specific behavior.
- Exact camera coordinates in default exported diagnostics.
- Automatic failover between public providers. A clear degraded state is preferable to
  hidden source switching with different data/licensing semantics.
- Backend, proxy, OAuth, telemetry upload, or secret management.

## 7. Ownership and architecture

### 7.1 Source terminology

The current names `src/app` and `src/application` represent different architectural
concepts, but the distinction is too subtle. Phase 1 uses these explicit terms:

- `src/bootstrap`: the composition root, runtime-service construction, providers, build
  metadata, startup error capture, and the browser entry wiring.
- `src/presentation`: React components, the workspace shell, theme, feature UI, UI
  stores, and MapLibre presentation adapters.
- `src/application`: framework-independent use cases and capability ports. It must not
  contain React, MUI, MapLibre, Dexie, or browser API code.
- `src/infrastructure`: implementations of application ports using browser storage,
  HTTP, files, or other external mechanisms.

As part of the rename, replace the overly broad `ApplicationServices` composition bundle
names with `RuntimeServices` (or an equally explicit approved name), including the
factory, context, provider, and hook. Rename `App`/`AppErrorBoundary` to workspace-
shell names. Update import aliases, architecture lint rules, tests, and documentation in
the same behavior-preserving commit.

### 7.2 State ownership

| State or behavior                                           | Owner                                  | Persistence         |
| ----------------------------------------------------------- | -------------------------------------- | ------------------- |
| Native `Map`/`MapRef`, listeners, sources, layers, controls | Map adapter/facade                     | Never               |
| Loading, ready, degraded, fatal presentation state          | Map feature component                  | No                  |
| Current high-frequency camera during gestures               | MapLibre                               | No                  |
| Last settled, validated camera                              | Map camera repository via Dexie        | Yes                 |
| 2D/3D control and pending/error state                       | Map feature component/controller       | No in Phase 1       |
| Last useful map diagnostics snapshot                        | Map diagnostics snapshot store/service | In memory only      |
| Settings/dialog/drawer state                                | Existing Zustand UI store              | No                  |
| Provider configuration                                      | Validated application configuration    | Build/runtime asset |

Do not put a native map object, class instance, mutable source, or per-frame camera
value in Zustand, TanStack Query, Dexie, or the runtime-services context.

### 7.3 Map boundary

The presentation feature may expose small typed capabilities such as:

```ts
interface MapFacade {
  getCamera(): MapCamera;
  getDiagnosticsSnapshot(): MapDiagnosticsSnapshot;
  setTerrainMode(mode: TerrainMode): Promise<TerrainTransitionResult>;
  setDebugOptions(options: MapDebugOptions): void;
}
```

The exact API may change during implementation, but it must remain capability-oriented.
It must not expose `Map`, `MapRef`, arbitrary `getMap()`, or generic command strings.
React receives serializable snapshots and typed outcomes. Event handlers translate
MapLibre events at this boundary and remove every listener on teardown.

### 7.4 Provider configuration boundary

Define and validate a readonly configuration model before constructing a style. It must
represent at least:

- Vector metadata/tile endpoint information.
- Provider-specific source-layer mappings.
- Glyph and sprite endpoints when the chosen style requires them.
- Vector and OSM attribution.
- Terrain metadata/tile endpoint, encoding, tile size, zoom limits, and attribution.
- Conservative request timeout/error-display policy where applicable.

Use Zod at the external boundary and map parsed data into an internal readonly type.
Configuration errors are typed and safe to show. Never log full tile templates, query
strings, tokens, headers, or raw configuration objects.

### 7.5 Stable source and layer contract

Centralize stable application IDs instead of scattering string literals. The initial
order from bottom to top is:

1. Background/land cover.
2. A reserved future satellite insertion point.
3. Water and terrain shading, if used.
4. Administrative boundaries.
5. Roads.
6. Hiking paths/tracks/steps.
7. Hiking points such as shelters, peaks, and passes.
8. Place and feature labels.
9. Reserved future catalog tracks, plans, and waypoints above the basemap.

Layer definitions must be deterministic and testable without constructing a WebGL
context. Provider source-layer names are mapped once in the style factory.

## 8. Target repository shape

Create files only when they contain real behavior, configuration, tests, or fixtures.
Names may be refined, but ownership should remain recognizable:

```text
georgia-routing-planner/
  docs/
    map-providers.md
  e2e/
    map-foundation.spec.ts
  src/
    bootstrap/
      createRuntimeServices.ts
      RuntimeServicesContext.ts
      RuntimeServicesProvider.tsx
      useRuntimeServices.ts
      configuration/
        MapProviderConfiguration.ts
    presentation/
      shell/
        WorkspaceShell.tsx
        WorkspaceErrorBoundary.tsx
      theme/
        createAppTheme.ts
      developer-tools/
        DeveloperDrawer.tsx
      map/
        MapWorkspace.tsx
        MapFacade.ts
        MapLibreFacade.ts
        MapStatusOverlay.tsx
        TerrainModeControl.tsx
        mapIds.ts
        mapStyleFactory.ts
        mapTypes.ts
    application/
      ports/
        MapCameraRepository.ts
    diagnostics/
      export/
        diagnosticBundleSchema.ts
      snapshots/
        MapDiagnosticsSnapshotStore.ts
        HealthCheckService.ts
    infrastructure/
      persistence/
        AppDatabase.ts
        DexieMapCameraRepository.ts
  test/
    fixtures/
      map/
        provider-configuration.json
        style-metadata.json
        vector-tile.pbf
        terrain-dem.png
  tools/
    repository/
      auditRepository.ts
```

The fixture names are illustrative. Keep fixture data synthetic, minimal, licensed for
repository use, and free of personal GPX or real user-location data.

## 9. User-visible behavior

### 9.1 Startup and map loading

Use an explicit state model rather than one boolean:

```text
configuration -> style loading -> ready
       |               |           |
       v               v           v
     fatal           fatal      degraded
```

- `fatal` means there is no usable map, for example invalid provider configuration,
  WebGL initialization failure, or an unrecoverable style error. Show an accessible map
  error panel with remediation and diagnostics guidance.
- `degraded` means the base map remains usable but one source or terrain is unavailable.
  Keep interaction enabled, show bounded feedback, and provide retry when retry is safe.
- Do not cover the map permanently for an isolated tile failure.
- Loading feedback must have an accessible status name and disappear when the map is
  usable.

### 9.2 Camera persistence

Persist a versioned `MapCamera` containing longitude, latitude, zoom, bearing, and
pitch. Validate finite numbers and clamp values to supported ranges before use.

- Load the persisted camera before the production map is mounted so the user does not
  see a default-to-restored jump.
- Use the documented Georgia-wide camera when no valid record exists.
- Persist on settled camera events, not every animation frame or pointer movement.
- Debounce/coalesce writes and flush the last settled value on safe teardown when
  practical.
- A corrupt camera record repairs only that record, logs one bounded warning, and falls
  back to the Georgia default without breaking other settings.
- A persistence failure leaves the current session usable and produces non-blocking
  feedback/diagnostics; it must not make map movement fail.

### 9.3 2D/3D terrain

Place an accessible `2D / 3D` MUI control over or immediately beside the map. The native
map remains the same instance in both modes.

- 2D removes MapLibre terrain and returns pitch to zero while preserving center, zoom,
  and bearing.
- 3D ensures the configured DEM source is ready, enables terrain with a documented
  exaggeration, and restores the last useful nonzero pitch or a conservative default.
- Disable repeated transitions while a terrain transition is pending.
- If DEM metadata or tiles fail, return to a usable 2D state and show an actionable
  error. The user can retry explicitly.
- Switching modes must not reload the base style or duplicate sources/listeners.
- Terrain attribution remains visible whenever its data is requested or displayed.

### 9.4 Map controls and attribution

- Enable expected desktop pan, wheel/double-click zoom, rotate, and pitch interactions.
- Provide MapLibre navigation/compass controls with accessible surrounding labels where
  native accessibility is insufficient.
- Keep attribution visible and keyboard reachable; do not set
  `attributionControl={false}` in the production map.
- Preserve visible focus and ensure MUI overlays do not block normal map gestures.
- Do not introduce custom zoom buttons when MapLibre's supported control is adequate.

## 10. Work packages

### P1.1 Audit repository hygiene and ignored artifacts

This is the first implementation task and first Phase 1 commit. Start with a read-only
inventory using `git ls-files`, `git status --short --ignored`, `git check-ignore`, and
a filesystem review before changing ignore rules or removing anything from the index.

The planning-branch baseline already confirms that `node_modules/`, `dist/`,
`coverage/`, `playwright-report/`, `test-results/`, and `debug.log` are ignored and not
tracked. They remain visible in a normal file explorer because `.gitignore` affects Git,
not the local filesystem. Re-run the audit from the implementation branch and cover at
least:

- Installed packages and local package stores, including `node_modules/` and a
  repository-local `.pnpm-store/`.
- Vite/TypeScript/ESLint/tool caches and build output.
- Coverage, Playwright blob/HTML reports, screenshots, videos, traces, and test results.
- Logs, PID files, crash dumps, temporary/editor backup files, and OS metadata.
- `.env` variants and credentials, while retaining intentional `.env.example` files.
- Exported diagnostics, catalog build/audit output, and other user-local data.
- IDE state, except explicitly shared minimal recommendations such as
  `.vscode/extensions.json`.

Do not ignore source-like directories or broad file extensions merely to make the audit
pass. `pnpm-lock.yaml`, checked-in synthetic test fixtures, source maps intentionally
used as fixtures, and reviewed configuration examples are repository inputs and remain
tracked.

Add a dependency-free `pnpm repo:audit` command that fails when `git ls-files` contains
a forbidden artifact/secret path. Put the path-classification rules in a small testable
module, cover allowed exceptions, and run the command from `pnpm check` and CI. If an
artifact is already tracked, remove it from the Git index without deleting the user's
local copy unless deletion is separately requested. Report every such path explicitly.

### P1.2 Clarify bootstrap, presentation, and application names

Perform one behavior-preserving source move before new map work:

- Move `src/app/bootstrap` to `src/bootstrap`.
- Move the React shell/error boundary, theme, global presentation styles, and existing
  `src/features` code under explicit `src/presentation` subdirectories.
- Keep `src/application` for framework-independent ports and future use cases.
- Rename `ApplicationServices` symbols to `RuntimeServices`, and rename the generic
  `App`/`AppErrorBoundary` components to `WorkspaceShell`/`WorkspaceErrorBoundary`.
- Update imports, aliases, ESLint architecture boundaries, tests, README, `AGENTS.md`,
  and diagrams so no current instruction recreates `src/app`.

Do not mix map behavior into this commit. All existing unit, integration, accessibility,
diagnostics, and Chromium shell tests must pass after the moves, proving the change is
terminology and ownership only.

### P1.3 Retire the smoke-component boundary

Replace `MapSmokeCanvas` with a production-named `MapWorkspace` while initially keeping
the network-free Phase 0 style. Introduce the smallest typed facade/controller boundary
needed for lifecycle, camera, terrain, and diagnostic snapshots.

Deliverables:

- A single map instance with explicit mount/load/idle/error/unmount handling.
- Listener registration and deterministic cleanup owned by the adapter.
- A fake facade/controller for component tests.
- Existing shell, diagnostics, accessibility, and no-network tests remain green.

### P1.4 Validate provider feasibility

Complete the vector, DEM, and time-boxed Sentinel COG checks described in Section 5.
Document exact evidence dates because provider behavior is time-sensitive. Record the
chosen default and a rejected alternative where useful.

This package changes no product scope. It prevents the implementation from baking in an
unusable provider or a credential that cannot be kept secret.

### P1.5 Add validated map provider configuration

Add a Zod boundary and internal readonly configuration. Construct it in the composition
root or a dedicated configuration factory, then inject only the parsed form.

Test:

- Valid production-shaped and local-fixture configurations.
- Missing endpoints and source-layer mappings.
- Unsupported DEM encodings and invalid zoom/tile-size values.
- Relative GitHub Pages base-path handling where local assets are used.
- Error messages and diagnostics contain no query secrets or full provider payload.

### P1.6 Build the OSM hiking style

Implement a pure style factory using stable source/layer IDs and the parsed provider
mapping. Use restrained theme-compatible colors and retain room for future imagery,
tracks, plans, and waypoints.

Cover land/background, water, boundaries, roads, hiking paths, useful hiking POIs, and
labels only where supported by the selected source. Unsupported optional source layers
must be documented; do not invent data that the provider does not expose.

Test the produced style shape, source mapping, layer order, visibility defaults,
attribution, and absence of secrets. Keep production provider I/O outside unit tests.

### P1.7 Persist and restore the camera

Add a small `MapCameraRepository` port and a Dexie-backed adapter using the existing
settings table unless an index/schema change genuinely requires a database migration. Do
not increment the Dexie schema version merely for a new key in an existing key-value
table.

Load the camera before map mount, persist settled moves, repair corrupt records, and
cover read/write failures. Add fake-indexeddb tests, component behavior tests, and a
Chromium reload flow.

### P1.8 Implement terrain mode

Add the DEM source and 2D/3D control without replacing the base style or map instance.
Model transition states explicitly: `flat`, `enabling`, `terrain`, `disabling`, and
`failed` (or an equivalent discriminated union).

Test successful toggles, repeated clicks, unavailable DEM, source error, retry, camera
preservation, source/listener deduplication, and teardown during a pending transition.

### P1.9 Add loading and recoverable error feedback

Translate MapLibre errors into typed, user-actionable categories. Distinguish WebGL,
style/configuration, base-vector, glyph/sprite, and DEM failures as far as the available
event evidence permits.

- Fatal failures replace the unusable canvas with remediation.
- Source/terrain failures use a non-blocking alert/snackbar and keep a usable map.
- Repeated equivalent tile failures are aggregated instead of producing alert storms.
- Retry actions are explicit and must not create duplicate map instances or listeners.
- Offline state is described accurately; do not promise offline map availability.

### P1.10 Extend map and WebGL diagnostics

Capture stable, bounded events for:

- Map mount, load, first idle, style ready, and unmount.
- WebGL capability plus context lost and restored.
- Terrain enable/disable/failure and duration.
- Aggregated source/tile errors by safe category and source ID.
- Settled camera changes at a throttled summary rate.
- Current ordered source/layer IDs, terrain state, style identity, last idle time, and
  safe WebGL renderer/capability information.

Do not log continuous render/move events, full URLs, query strings, tile coordinates,
raw error objects, or exact persisted records.

Extend the versioned diagnostics bundle deliberately. If the schema changes from Phase 0
version 1, introduce version 2 and a tested v1-to-current compatibility migration in
`diagnostics:inspect`; do not mutate the meaning of version 1 in place.

The local developer UI may display the exact current camera for immediate inspection,
but default exported diagnostics must round longitude/latitude to a documented coarse
precision or omit them. Full route/track geometry remains excluded.

### P1.11 Add developer map inspection and health

Add a `Map` view to the developer drawer, or an equivalently clear map section, showing
serializable snapshots rather than the native map object. Include:

- Camera, style, ordered sources/layers, terrain mode, and last idle state.
- Recent aggregated source failures.
- WebGL version/capability/context state.
- Supported MapLibre debug flags such as tile boundaries or collision boxes, available
  only while developer mode is active and reset safely.

Extend health checks with a non-destructive map readiness check and a terrain/provider
reachability check that runs only on explicit user request. Normal application startup
must not wait for optional provider health checks.

### P1.12 Harden deterministic browser coverage and documentation

Create synthetic vector and DEM fixtures sufficient to run the production style and
terrain paths in real Chromium. Intercept every configured provider request and fail the
test on unexpected public network access.

Update README status, map configuration instructions, attribution/licensing notes,
manual verification steps, known provider limitations, and diagnostics behavior. Keep
the top-level roadmap unchanged unless implementation discovers a material product or
phase-boundary change.

## 11. Automatic test and acceptance matrix

| Concern             | Unit/component/integration evidence                    | Chromium evidence                               |
| ------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| Repository hygiene  | Artifact classifier and allowed-exception tests        | `pnpm repo:audit` sees no tracked output        |
| Source terminology  | Architecture lint/import and existing behavior tests   | Renamed workspace shell behaves unchanged       |
| Facade boundary     | Fake facade drives loading/ready/error and cleanup     | Native map initializes once                     |
| Provider config     | Zod valid/invalid/secret fixtures                      | Local deterministic config loads                |
| OSM style           | Pure style/source/layer-order assertions               | Synthetic vector feature renders                |
| Attribution         | Style/config attribution assertions                    | Visible and keyboard-reachable attribution      |
| Camera              | Validation, clamping, debounce, repository failures    | Pan/zoom/rotate/pitch then reload restores      |
| Terrain             | Transition reducer/controller and failure tests        | 2D/3D toggles with local DEM                    |
| Camera preservation | Controller snapshots before/after                      | Center/zoom/bearing preserved across toggle     |
| Failure feedback    | Fatal/degraded/retry component states                  | Intercepted vector/DEM/WebGL failures recover   |
| Diagnostics         | Event bounds, aggregation, redaction, schema migration | Developer map view and exported bundle          |
| Lifecycle cleanup   | Listener/source deduplication tests                    | Remount/retry does not duplicate map or events  |
| Accessibility       | RTL roles, names, status, focus, axe                   | Keyboard control and serious/critical axe pass  |
| Network isolation   | Fixture adapters reject unexpected calls               | No unhandled public request in required E2E     |
| Pages base path     | Configuration/base URL unit tests                      | Production bundle runs under repository subpath |

Required browser scenarios:

1. Open the built application under `/georgia-routing-planner/` with local fixtures and
   reach a ready map.
2. Pan, zoom, rotate, and pitch; reload and verify the last settled camera.
3. Toggle 3D on and off; verify the same map instance and preserved center/zoom/bearing.
4. Fail the DEM request; verify the base map remains usable, a concise error appears,
   and retry can enable terrain after the fixture recovers.
5. Fail required style/vector metadata; verify a fatal or degraded state appropriate to
   the failure and useful diagnostics.
6. Trigger WebGL context loss/restoration in a controlled way where Chromium supports
   it; verify UI and bounded events.
7. Enable developer mode, inspect map state, export diagnostics, and validate it with
   `pnpm diagnostics:inspect`.
8. Assert no unexpected public network request and no serious/critical axe violation in
   the Phase 1 controls and failure states.

## 12. Performance, privacy, and reliability limits

- Record a first-load and first-idle duration in diagnostics, but do not set a brittle
  CI millisecond threshold on shared runners.
- Camera persistence and diagnostic snapshot updates must occur on settled/throttled
  events, never per animation frame.
- Aggregate identical source errors over a bounded time window and retain only capped
  counts plus representative safe categories.
- Keep the existing logger ring-buffer cap. Any increase requires measured evidence and
  an explicit memory bound.
- Never export full tile URLs, query strings, access tokens, authorization headers,
  sprite/glyph payloads, tile coordinates, or raw MapLibre error objects.
- Export only stable source/layer IDs and provider origins or approved labels.
- Treat camera longitude/latitude as potentially personal. Default bundle precision must
  be coarse and covered by redaction tests.
- Revoke listeners, subscriptions, timers, and pending persistence work on teardown.
- Pass `AbortSignal` through explicit provider probes. MapLibre-owned internal tile
  cancellation remains within the adapter and is not reimplemented.

## 13. Quality gates

Every implementation commit runs the narrow tests for its behavior. Before presenting
Phase 1 for approval, run:

```text
pnpm repo:audit
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:coverage
pnpm build
pnpm e2e
pnpm check
```

The final state must also satisfy:

- `pnpm repo:audit` reports no tracked dependency, generated, secret, local-only, or
  temporary artifact and is part of `pnpm check`/CI.
- No ambiguous `src/app` directory or `ApplicationServices` composition-bundle name
  remains; architecture lint rules enforce the documented source boundaries.
- Existing global and domain/application coverage thresholds remain enforced.
- No required test contacts a public vector, terrain, OSM, or imagery endpoint.
- Current stable desktop Chrome passes the real-provider manual smoke check documented
  with the provider decision date.
- Required attribution is visible in both 2D and 3D.
- Bundle inspection accepts both a new Phase 1 bundle and the checked-in Phase 0 v1
  fixture when a schema migration was introduced.
- Production build works under the GitHub Pages base path.
- No secret, personal GPX data, exact default-export camera, or unbounded map event data
  appears in logs, fixtures, build output, or diagnostics.

## 14. Planned commit sequence

Implementation occurs on `feature/map-foundation`. The sequence below is intentionally
smaller than the phase. Each commit includes the listed tests and must pass at least
`pnpm typecheck`, `pnpm lint`, and the relevant Vitest suite before the next commit.

| Commit                                                      | Scope                                                                                                                          | Commit-level verification                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `chore: audit repository hygiene and ignored artifacts`     | Complete the tracked/ignored inventory, tighten `.gitignore`, add `repo:audit`, its classifier tests, and CI/check integration | Audit tests, `pnpm repo:audit`, existing checks           |
| `refactor: clarify source architecture names`               | Move to `bootstrap`/`presentation`, retain `application` for use cases/ports, and rename runtime/shell symbols                 | Architecture lint, typecheck, all existing tests and E2E  |
| `refactor(map): isolate the MapLibre lifecycle`             | Rename the smoke surface, introduce the typed facade boundary, lifecycle cleanup, and fake while retaining the local style     | Existing shell/E2E plus facade/component tests            |
| `docs: record Phase 1 provider feasibility`                 | Select vector/DEM defaults and record policy/CORS/schema evidence plus the bounded Sentinel COG spike                          | Formatting/link review; no production provider calls      |
| `feat(config): validate map provider configuration`         | Add Zod configuration, safe errors, composition, and fixture config                                                            | Config unit tests, secret-redaction tests, build          |
| `feat(map): render the OSM hiking basemap`                  | Add pure style factory, stable IDs/layer order, attribution, and loading states                                                | Style tests, component tests, local-vector Chromium smoke |
| `feat(map): persist settled camera state`                   | Add camera value/schema, repository port/adapter, restore/debounce/repair behavior                                             | Unit, fake-indexeddb, component, reload E2E               |
| `feat(map): add resilient 2D and 3D terrain modes`          | Add DEM source, MUI toggle, transitions, fallback, retry, and camera preservation                                              | Transition/component tests and local-DEM E2E              |
| `feat(map): add recoverable provider failure feedback`      | Add typed fatal/degraded states, aggregation, retry, and accessible alerts                                                     | Component tests and intercepted-failure E2E               |
| `feat(diagnostics): capture bounded map and WebGL evidence` | Add aggregation, snapshot state, health hooks, bundle schema/version migration, and redaction                                  | Diagnostics/schema/CLI compatibility/integration tests    |
| `feat(developer-tools): expose map diagnostics`             | Add developer map view, safe debug flags, health states, accessible feedback                                                   | RTL/axe and developer-mode E2E                            |
| `test(map): harden MapLibre provider failure workflows`     | Add remaining real-map context-loss, network-isolation, and lifecycle regression cases                                         | Full `pnpm e2e` and coverage gates                        |
| `docs: document Phase 1 map operation`                      | Record configuration, attribution, manual checks, README status, and plan outcome                                              | Formatting/link review and full `pnpm check`              |

Small adjustments to this sequence are allowed when a reviewable dependency boundary
requires them, but the following rules are not optional:

- Do not squash all Phase 1 work into one mega-commit.
- Do not create artificially tiny commits that leave dead code, unused configuration,
  disabled tests, or a broken build.
- Keep tests with the production behavior they verify; do not defer most tests to the
  final hardening commit.
- The hardening commit covers cross-cutting browser cases, not missing unit tests from
  earlier behavior.
- Documentation-only feasibility evidence may stand alone, but code commits remain
  independently executable and reviewable.

## 15. Approval checklist

Before asking to integrate Phase 1 into `main`, report:

- Active branch and the ordered commit list.
- Repository audit result, `.gitignore` changes, any paths removed from the index, and
  confirmation that local user files were not deleted.
- Final `bootstrap`/`presentation`/`application` ownership and the old-to-new path and
  symbol mapping.
- Chosen vector/terrain providers, evidence date, attribution/license requirements, and
  known limits.
- Sentinel COG spike conclusion and what remains deferred to the imagery phase.
- Map boundary, state ownership, provider configuration, and persistence changes.
- Exact commands run with results and coverage summary.
- Real local-fixture Chromium flows and real-provider manual smoke result.
- Diagnostics schema/version and compatibility result.
- Loading/error/accessibility behavior demonstrated.
- Production bundle impact and any new dependency with rationale.
- Known limitations, deviations from this plan, and deferred work.
- Confirmation that no public deployment, provider secret, personal GPX data, or
  unexpected public-network test dependency was added.

Remain on the feature branch after the handoff. Merge to `main` only after explicit user
approval.

## 16. Definition of Phase 1 done

Phase 1 is complete only when:

1. A repeatable repository audit proves dependencies, build/test output, caches, logs,
   secrets, exports, and temporary artifacts are ignored and not tracked.
2. `src/app` and the generic application-service composition names are gone;
   `bootstrap`, `presentation`, `application`, and `infrastructure` have distinct,
   enforced responsibilities.
3. A validated, replaceable provider configuration renders the OSM hiking map with
   correct attribution.
4. The map supports smooth desktop pan, zoom, rotate, and pitch in current Chrome.
5. The last valid settled camera restores after reload and corrupt persistence degrades
   safely.
6. 2D/3D terrain toggles on the same map instance, preserves camera intent, and falls
   back to a usable 2D map on DEM failure.
7. MapLibre lifecycle and native objects remain isolated behind a typed feature boundary
   with deterministic cleanup.
8. Loading, fatal, degraded, retry, offline, and WebGL-loss states are accessible and
   covered automatically.
9. Map/source/terrain/WebGL instrumentation is useful, bounded, sanitized, and visible
   in developer mode and the exported diagnostics bundle.
10. Diagnostics inspection remains compatible with supported Phase 0 bundles.
11. Required tests run with local vector/DEM fixtures and no public-provider dependency;
    a separately documented real-provider smoke check passes.
12. The provider and Sentinel COG feasibility decisions, configuration, attribution, and
    operating limits are documented for the maintainer.
13. The verified implementation exists as multiple focused, testable commits on the
    feature branch and is presented for approval without changing `main`.
