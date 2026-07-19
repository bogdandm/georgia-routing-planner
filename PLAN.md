# Terrain Overlays Implementation Plan

## 1. Branch and approval boundary

- Active branch: `feature/terrain-overlays`.
- Branch base: `main` as checked out on 2026-07-19.
- Approval boundary: all implementation remains on this feature branch until the
  reviewed pull-request state is explicitly approved for integration into `main`.
- The unrelated `fix/client-side-cloud-highlighting` working tree was preserved in the
  named stash `user-wip-before-terrain-overlays` before this branch was created.

## 2. Required outcome

Add two independently controllable terrain overlays to the long-lived MapLibre map:

1. A hillshade/relief layer that is always available.
2. An elevation-isoline layer with configurable contour spacing.

Default contour spacing is 50 m for minor lines and 200 m for emphasized, labeled index
lines. Contours appear only at a zoom level where that density remains readable and
useful. Styling follows the supplied reference: low-contrast relief, fine subdued tan
minor contours, and stronger index contours that do not overpower satellite imagery or
OSM context.

The normal native layer order is:

```text
base map
-> relief shade
-> satellite imagery
-> elevation isolines
-> OSM data layers
```

A rendering setting can move relief shade above satellite imagery:

```text
base map
-> satellite imagery
-> relief shade
-> elevation isolines
-> OSM data layers
```

The setting changes order without remounting MapLibre, losing the selected satellite
scene, or altering the visibility of unrelated logical layers.

## 3. Architecture and decisions to validate

- Extend the existing typed map-layer controller and stable native ID registry; do not
  expose the MapLibre instance outside the map adapter.
- Use a replaceable elevation raster-dem provider with explicit attribution, CORS, and
  usage-policy documentation. Reuse the same DEM source for hillshade and client-side
  contour generation when MapLibre and the selected contour library support it.
- Generate contours in the browser from bounded terrain tiles; do not introduce a
  project backend or embed secrets in `VITE_*` configuration.
- Keep rendering preferences serializable and validated. Persist them through the
  existing map-layer preferences owner rather than adding a second authoritative store.
- Treat hillshade as an always-available map capability: it remains usable without a
  satellite scene and is restored after style or terrain lifecycle changes.
- Start contours at the first zoom where default 50 m lines are legible without visual
  clutter. The initial implementation target is zoom 11, subject to fixture tests and a
  current-Chrome visual check against the supplied reference.
- Apply contour-distance changes atomically and preserve the current map camera and all
  unrelated sources/layers.

## 4. Work packages and commit sequence

### T1. Provider contract and terrain source — Done

- Inspect the existing base-map, terrain, satellite, visibility, diagnostics, and
  preference flows.
- Add validated provider configuration for the elevation tiles required by both
  overlays, including safe public defaults or an explicit unavailable state.
- Add stable source/layer IDs and typed overlay preferences.
- Document endpoint policy, attribution, replacement, and failure behavior.
- Test configuration validation, ID ownership, and source creation.

Commit: `feat(map): define terrain overlay sources`

### T2. Relief shade and deterministic layer ordering — Done

- Render a low-contrast hillshade layer whenever the map style is ready.
- Insert it below satellite imagery by default.
- Add the rendering preference that moves hillshade above or below satellite imagery.
- Reconcile order after map style reloads, satellite apply/switch/remove operations, and
  terrain changes without duplicate sources, layers, or listeners.
- Add typed diagnostic events/snapshots for initialization, order changes, and bounded
  failures.
- Test both order variants, idempotency, restoration, missing-layer recovery, and
  satellite switching.

Commit: `feat(map): add configurable relief shading`

### T3. Elevation isolines and interval settings — Done

- Add client-side contour generation from the configured elevation tiles.
- Render minor and index lines above satellite imagery and below all OSM data layers.
- Use 50 m minor and 200 m index intervals by default; label index contours only.
- Add rendering controls for contour distance while retaining a clear 200 m major-line
  cadence. Validate bounds and reject combinations that cannot be represented safely.
- Start rendering at the selected minimum zoom and clean up generated resources
  deterministically.
- Test interval expressions/options, minimum zoom, layer placement, preference changes,
  cancellation/failure, and cleanup.

Commit: `feat(map): render configurable elevation isolines`

### T4. Settings, persistence, and accessibility — Done

- Add compact controls to the existing Settings > Rendering surface for contour distance
  and shade-over-satellite ordering.
- Clearly describe index versus minor contour behavior and the visual effect of the
  shade-order toggle.
- Persist validated preferences and repair unsupported stored values to defaults.
- Expose independent, durable Relief shading and Elevation isolines visibility controls
  in the Layers tab while keeping interval and ordering controls in Settings.
- Cover keyboard interaction, accessible names, help text, and live failure feedback.
- Test fresh defaults, round trips, migration/repair, component interaction, and map
  command synchronization.

Commit: `feat(settings): configure terrain overlays`

### T5. Documentation and workflow hardening — Done

- Update stable feature, structure, runtime-flow, provider, setup, and docs-index
  content wherever ownership or behavior changes.
- Add a controlled-browser workflow only if source/layer ordering across the real
  MapLibre lifecycle cannot be proven below the browser boundary.
- Perform a current stable Chrome visual check at representative Georgia mountain zooms
  with and without satellite imagery, comparing contrast and density to the supplied
  reference.
- Confirm attribution remains visible and public-network access is not required by
  automated tests.

Commit: `docs(map): describe terrain overlay behavior`

## 5. Verification

Run the smallest relevant checks after each work package, followed by the complete gate:

```text
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:integration
pnpm test:coverage
pnpm build
pnpm e2e                 # only when required by the final MapLibre lifecycle scope
rg -n -i '\b(phase|phases|stage|stages|roadmap)\b' README.md docs
git diff --check
```

## 6. Definition of done

- Relief shade is available independently of satellite imagery and defaults below it.
- The rendering toggle reliably moves shade above satellite imagery and survives
  refresh/style restoration.
- Default contours use 50 m minor and 200 m major intervals, with readable labels and a
  defensible minimum zoom.
- User-selected contour spacing is validated, persisted, and applied without map
  remounts or camera loss.
- Native order is base, shade/satellite according to preference, isolines, OSM data,
  then existing user-owned overlays where applicable.
- Provider failures leave the base map and all unrelated controls usable and produce
  privacy-safe diagnostics.
- Focused tests, relevant browser evidence, documentation checks, and the production
  build pass.
- Intended changes are committed in reviewable units, pushed, and available in a draft
  pull request targeting `main`.

## 7. Verification evidence

Verified on 2026-07-19:

- Formatting, lint, strict type checking, repository audit, documentation-boundary grep,
  and diff validation pass.
- 160 unit/component tests and 18 integration tests pass.
- Coverage passes with 88.5% statements, 79.08% branches, 90% functions, and 90.75%
  lines across 178 tests.
- The production build passes. The existing large-bundle advisory remains non-blocking.
- All 12 controlled Chromium workflows pass with two workers, including axe checks,
  terrain failure recovery, diagnostics export, Sentinel ordering, and durable relief /
  isoline visibility from Layers.
- A live current-Chrome check confirmed that both Layers controls update immediately and
  survive reload, provider attribution remains clickable on the map, the Layers sidebar
  contains no raw attribution markup, and rapid contour-producing zoom changes recover
  to Ready without detached-buffer errors.
- The supplied diagnostics bundle was traced to a cached contour `ArrayBuffer` being
  transferred more than once. The protocol adapter now clones each delivery while
  preserving the cache-owned buffer, with a regression test for repeated cache hits.
