# Sentinel Imagery Application and Layer Controls Plan

## 1. Purpose and branch boundary

This plan contains the remaining work required to turn the implemented Sentinel-2
discovery browser into map imagery that can be applied, hidden, switched, and diagnosed.
It also introduces the first real Layers workspace at the same time so imagery is not
wired through a Satellite-only visibility mechanism.

- Status: **working UI and full check gate verified; draft PR update in progress**.
- Active branch: `feature/sentinel-map-layers`.
- Branch base: the current `feature/sentinel-imagery-plan` state at commit `3d2b4d2`.
- Approval boundary: all work remains on this feature branch until the combined imagery
  and Layers experience is reviewed and explicitly approved.
- Existing unrelated working-tree changes carried onto the branch are not part of this
  plan commit and must be preserved.

The completed catalog search, acquisition calendar, cloud filtering, grouped results,
URL tab restoration, and live query timeline are baseline capabilities. This plan does
not rebuild them.

## 2. Required outcome

At completion, a desktop Chrome user can:

1. Select a Sentinel-2 L2A card and see that scene on the existing MapLibre map.
2. Click a calendar acquisition day and apply the best-viewport-coverage scene from that
   day without reopening a results pane that the user closed.
3. Switch scenes without briefly removing a previously usable image when the replacement
   fails.
4. Open `#layers` and control the visibility of real logical map layers through a simple
   checkbox list.
5. Hide and restore the applied satellite image from Layers without losing its selected
   scene or search results.
6. See the scene footprint, fit the map to it, and retain the applied image while moving
   among workspace tabs or changing terrain mode.
7. Understand preview/render failures from the persistent Sentinel timeline and an
   exported privacy-safe diagnostics bundle.
8. Refresh without losing logical layer visibility, the applied Sentinel scene, or the
   collapsed-navigation preference.
9. See one lightweight operational line below map search for pending or failed work.

## 3. Fixed UX decisions

### 3.1 Satellite selection and application

- A whole scene-card click is the apply action; there is no separate Apply button.
- A calendar-day click chooses the scene with the highest submitted-viewport coverage.
  Acquisition-time order breaks equal-coverage ties.
- Calendar application updates selection and applied state but never changes whether the
  adjacent images pane is open.
- Selection, applying, applied, hidden, switching, and failed states are visually
  distinct. The UI never reports an image as applied before MapLibre confirms readiness.
- Failed replacement leaves the previously applied image visible and offers retry.
- Only one Sentinel scene is active. Mosaic composition is not part of this work.

### 3.2 Initial Layers workspace

The first Layers UI is deliberately small: a vertical list of logical layer names with
checkboxes and no drag handles, menus, opacity sliders, or decorative cards.

Initial logical layers:

| Layer             | Default behavior                                     | Checkbox effect                                             |
| ----------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| Satellite imagery | Available after a scene is applied; visible on apply | Hides/restores the raster while retaining the applied scene |
| Scene footprint   | Visible with an applied scene                        | Hides/restores the footprint outline                        |
| Hiking paths      | Visible                                              | Toggles the hiking path and steps style layers              |
| Roads             | Visible                                              | Toggles road fills/casings and road labels                  |
| Places and POIs   | Visible                                              | Toggles place, peak, water, and hiking POI symbols/labels   |

The base land and water surface remains visible and is not exposed as a removable layer.
The Satellite imagery and Scene footprint checkboxes are disabled with concise secondary
text until a scene has been applied. Controls affect the long-lived native map
immediately and never remount it.

Visibility and the last successful applied scene are durable local preferences. Opacity
control and user-defined ordering remain separate enhancements.

## 4. Rendering checkpoints

### 4.1 Early UI/interaction checkpoint: preview overlay

Deliver a fast reviewable map application before the production renderer is complete:

```text
selected L2A scene
-> validated thumbnail HTTPS URL
-> scene-footprint bounding rectangle
-> MapLibre image source
-> raster layer at the reserved satellite insertion point
```

This overlay is explicitly `preview` quality. The JPEG thumbnail is stretched to a
rectangle and is not a geometrically correct Sentinel raster. The UI and diagnostics
must label the state as preview imagery; it must not be documented as accurate imagery.
It is sufficient to review card/calendar application, visibility checkboxes, layer
order, scene switching, footprint display, fit behavior, loading, and failure recovery.

The preview implementation must remain behind the same narrow imagery-map capability as
the final renderer so it can be deleted without rewriting Satellite or Layers UI state.

### 4.2 Production checkpoint: georeferenced L2A reflectance bands

Replace the preview adapter with a bounded, correctly georeferenced renderer for the
validated `assets.red`, `assets.green`, and `assets.blue` COGs:

```text
SatelliteVisualAsset(kind = sentinel-rgb-cogs)
-> bounded range/tile requests
-> decode and CRS-aware placement
-> MapLibre raster source/layer
-> ready snapshot
```

The implementation must select and document one static-client-compatible path. Candidate
paths may include a focused client COG adapter or a replaceable anonymous tiling
service. The gate rejects any solution requiring a browser secret, unbounded whole-scene
download, or a project backend. L1C JP2 rendering remains excluded from the MVP.

## 5. Architecture and state ownership

Dependency direction remains:

```text
SatelliteBrowser / LayersPanel
        -> application commands
        -> SatelliteImageryMap and MapLayerVisibility ports
        -> MapLibre adapter owned by the map feature
```

Required contracts:

- `SatelliteImageryMap` accepts a validated serializable scene snapshot and an
  `AbortSignal`; it exposes apply, switch, fit-footprint, visibility, and cleanup
  capabilities without exposing the native MapLibre object.
- `MapLayerVisibility` accepts logical layer IDs rather than raw arbitrary MapLibre IDs.
  One logical layer may control several stable native style layers.
- `AppliedSatelliteImagerySnapshot` is a discriminated union for `empty`, `loading`,
  `preview`, `ready`, `hidden`, and `failed` states. It records only safe serializable
  identifiers and status evidence.
- Dexie owns durable visibility and applied-scene preferences. A small Zustand store
  projects their live serializable UI state; neither stores a MapLibre instance, adapter
  class, worker, image bytes, or request object.
- The MapLibre adapter owns sources, layers, native listeners, cancellation, and
  cleanup.
- Satellite search results remain owned by the Satellite browser. Applying maps one
  selected result into the narrow serializable command input.

Stable native IDs must cover the preview/production raster and footprint source/layers.
Layer order is invariant:

```text
base land
-> Sentinel raster
-> water/roads/hiking references
-> Sentinel footprint
-> labels/POIs
-> user tracks, markers, and planning geometry
```

Durable ownership and runtime behavior discovered while implementing this plan must be
recorded in `docs/project-structure.md`, `docs/runtime-flows.md`, and `docs/features.md`
in the same behavior commit.

## 6. Work packages and commit sequence

### I1. Establish logical layer controls — Done

Scope:

- Define typed logical layer IDs and their allowlisted native layer groups.
- Extend the map capability with idempotent visibility commands and a serializable
  visibility snapshot.
- Replace the current Layers empty state with the checkbox list in section 3.2.
- Keep unavailable Satellite controls disabled until an applied snapshot exists.
- Ensure `#layers` restoration displays the same state without remounting MapLibre.

Tests:

- Every logical layer maps only to its intended stable MapLibre IDs.
- Toggling a checkbox calls one named command and updates checked state after success.
- Repeated toggles are idempotent; missing style layers produce a safe typed failure.
- Satellite controls enable after apply and retain their checks across rail changes.
- Keyboard labels, focus order, disabled explanations, and live error status are
  covered.

Commit: `feat(layers): add logical map visibility controls`

### I2. Add the preview imagery and footprint adapter — Superseded

The production tile adapter proved reviewable immediately, so no stretched preview path
was shipped. The same card/calendar, footprint, fit, visibility, switching, and failure
interactions use correctly georeferenced tiles.

Scope:

- Add stable Sentinel preview and footprint source/layer IDs at the reserved layer band.
- Validate the thumbnail URL and derive a bounded rectangle from the validated
  footprint.
- Apply, replace, hide/show, fit, and remove the preview through `SatelliteImageryMap`.
- Render the real polygon/multipolygon outline separately from the rectangular image.
- Preserve the old image until a replacement source has loaded successfully.
- Aggregate source/image failures and always keep the base map usable.

Tests:

- Correct source type, coordinate order, layer insertion points, and footprint GeoJSON.
- No duplicate sources, layers, listeners, or stale callbacks after repeated
  application.
- Cancellation and failed replacement preserve the prior scene.
- Hide/show does not re-download or discard the applied scene.
- Fit handles polygon and multipolygon bounds without changing pitch or bearing.
- Cleanup removes owned resources only.

Commit: `feat(map): preview selected Sentinel imagery`

### I3. Wire cards, calendar, and Layers to applied state — Done

Scope:

- Make card clicks apply the selected scene and expand its card.
- Make calendar clicks apply the best-coverage scene, scroll when the results pane is
  open, and leave pane visibility unchanged when it is closed.
- Display applying, preview-applied, hidden, switching, and failed states.
- Add compact fit-footprint and hide/restore actions only to the expanded applied card.
- Keep Layers checkboxes and Satellite actions synchronized through one authoritative
  snapshot.
- Show validated acquisition, tile, orbit, product, edge-distance, and attribution
  details without inventing missing values.

Tests:

- Card and calendar commands choose the correct scene and share the same apply path.
- A calendar click never reopens a closed results pane.
- Selected versus applied cards remain distinguishable during switching/failure.
- Layers visibility changes update Satellite state and the inverse path also works.
- Tab changes and terrain transitions preserve applied and visibility state.

Commit: `feat(satellite): apply scenes through shared layer state`

### I4. Select and implement the production L2A renderer — Done

Scope:

- Measure the focused COG candidates in current Chrome using representative Georgia
  scenes and bounded network requests.
- Record CORS, range behavior, projection support, cancellation, memory, attribution,
  dependency license, and bundle impact.
- Choose the production path or stop with concrete evidence and a product decision.
- Implement the selected adapter behind `SatelliteImageryMap` and remove the stretched
  preview raster path from production behavior.
- Retain the preview adapter only as a controlled test fixture if it remains useful.

Tests:

- Controlled local COG/tile fixture proves georeferenced placement and layer order.
- Required tests make no public provider requests.
- Decode, range, timeout, cancellation, malformed asset, projection, source, and WebGL
  failures return typed outcomes and preserve the base map.
- Scene switching is atomic and terrain/style restoration recreates owned resources
  once.

Commit: `feat(map): render georeferenced Sentinel L2A imagery`

### I5. Complete diagnostics and support-bundle evidence — Done

Scope:

- Correlate card/calendar command, asset selection, request/decode, map apply,
  visibility, switch, fit, and failure steps with the existing Sentinel operation ID.
- Keep the live timeline accurate for preview and production renderers.
- Add a bounded applied-imagery snapshot to exported diagnostics only where it
  materially improves support evidence.
- Add remediation hints for offline, unsupported asset, range/decode, projection, and
  MapLibre source failures.

Tests:

- Exact coordinates, footprints, asset URLs, request bodies, headers, tokens, and raw
  errors are absent from logs, snapshots, exported bundles, and CLI output.
- Durations are monotonic and repeated source/tile failures are aggregated within caps.
- Diagnostics failure cannot break imagery or layer visibility commands.

Commit: `feat(diagnostics): trace Sentinel rendering and layers`

### I6. Harden the complete browser workflow and documentation — Done

Scope:

- Add deterministic Chromium flows for apply, calendar apply, switch, hide/restore from
  Layers, fit, terrain preservation, failure recovery, and diagnostics export.
- Run axe on Satellite results/details and the Layers checkbox list.
- Complete a manual current-Chrome keyboard and visual review at supported desktop
  sizes.
- Update stable feature, architecture, runtime, provider, and operating documentation.
- Remove obsolete delivery details from this plan and mark work-package outcomes.

Tests and checks:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:coverage`
- `pnpm build`
- `pnpm e2e`
- `rg -n -i '\b(phase|phases|stage|stages|roadmap)\b' README.md docs`
- `git diff --check`

Commit: `test(satellite): harden imagery layer workflows`, with documentation committed
separately when it is independently reviewable.

### I7. Persist state and float the complete navigation — Done

Scope:

- Persist logical layer visibility, the last successfully applied scene, and navigation
  collapse state in validated Dexie records.
- Keep the map fixed to the full viewport while rail, sidebar, and results float above
  it as one continuous surface.
- Collapse with a short transition into the fixed clickable GR mark without moving or
  resizing that anchor.
- Add the shared one-line operational status below map search.
- Replace clipped TCI rendering with full-range raw RGB reflectance-band composition.

Tests cover storage repair and round trips, restored scene application, fixed map
dimensions, navigation reload persistence, raw-band renderer requests, and status/error
states.

### I8. Persistent renderer tuning and workspace polish — In progress

Scope:

- Keep imagery stretch controls in Settings, persist their values, allow saturation up
  to five times normal, and reapply the active scene atomically.
- Keep Settings visually and interactively non-modal so the map remains available while
  tuning.
- Present Settings as three compact tabs: General, Rendering, and Storage. Report
  available origin-storage categories, quota, and optional JavaScript heap metrics in
  megabytes, while stating the browser-managed tile-cache limitation.
- Make safe raster-renderer failures selectable from the shared status line and classify
  common rejection, throttling, availability, and timeout cases.
- Remove the duplicate recoverable map banner and give non-ready status a translucent
  map-readable surface.
- Preserve readiness subscribers across Strict Mode ref cleanup so Satellite cannot be
  left with a detached map controller until refresh.
- Finish GR-only collapse geometry, close animation, pane rounding, and consistent map
  control spacing.

Tests cover tuning bounds and persistence, renderer URL substitution, safe error
classification and disclosure, the non-dimming Settings surface, and both GR collapse
directions.

## 7. Review checkpoints

### Checkpoint A: Layers interaction

- `#layers` shows only the five real logical controls.
- Basemap is never accidentally hidden.
- Checkboxes update the existing map immediately and survive rail changes.

### Checkpoint B: Fast preview application

- Card and calendar selection visibly apply the preview image.
- The footprint shows the real scene boundary, making preview distortion obvious.
- Closing the results pane remains respected.
- Layers can hide and restore both raster and footprint independently.

### Checkpoint C: Production raster

- The same UI renders correctly georeferenced L2A imagery.
- Layer order, terrain changes, failure recovery, diagnostics, and attribution are ready
  for approval.

## 8. Exclusions

- Sentinel-2 L1C JP2 rendering.
- Mosaics or multiple simultaneously active scenes.
- Cloud masking, band math, false-color composites, or image processing controls.
- Layer drag ordering, opacity sliders, or custom layers.
- Accounts, server-side proxying, secret provider keys, or hosted telemetry.
- Applying imagery from an unloaded calendar date without first retrieving its scene
  metadata.

## 9. Definition of done

This work is complete only when:

- Correctly georeferenced L2A imagery—not the stretched preview—can be applied and
  switched through card and calendar actions.
- Layers checkboxes control every listed logical layer through typed shared state.
- Pane closure, search results, terrain, tab, and map lifecycle invariants hold.
- Loading, empty, hidden, applied, switching, and failure states are intentional and
  keyboard accessible.
- Render and visibility failures are diagnosable without leaking geometry or asset URLs.
- Relevant unit, integration, component, Chromium, axe, build, and documentation checks
  pass.
- The branch is committed, pushed, and available in a draft pull request targeting
  `main` for explicit UI/UX approval.

Verification evidence on 2026-07-19:

- Strict type checking, formatting, lint, repository audit, unit/component tests,
  integration tests, production build, and controlled Chromium/axe tests pass.
- Coverage passes with 147 tests, 89.48% statements, 78.99% branches, 92.56% functions,
  and 91.85% lines.
- The built-app Chromium suite passes all 11 workflows, including raw RGB Sentinel
  application and reload restoration, fixed map bounds, navigation collapse persistence,
  terrain, diagnostics, axe, and public-network isolation.
- A live current-Chrome smoke applied `S2A_38TMN_20260702_0_L2A` through Earth Search
  and TiTiler's STAC RGB renderer, showed the lightweight pending status, and completed
  with the floating three-pane navigation and full-screen map intact.
