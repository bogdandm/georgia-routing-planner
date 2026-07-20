# Map Discovery and Sharing Implementation Plan

## 1. Branch and approval boundary

- Active branch: `feature/map-discovery-sharing`.
- Branch base: finalized `feature/camera-interactions`, followed by the latest
  `origin/main` merge on 2026-07-20.
- Approval boundary: all implementation remains on this feature branch until the draft
  pull request is reviewed and explicitly approved for integration into `main`.

## 2. Required outcome

Complete the desktop map-discovery bundle without replacing MapLibre's native camera
semantics:

1. Add native device-location navigation without writing device coordinates to the URL.
2. Add submit-driven place search through a replaceable, policy-compliant Nominatim
   gateway plus direct coordinate entry.
3. Add explicit versioned share links containing center, zoom, and an optional applied
   Sentinel scene. Normal camera movement must not mutate the browser URL.
4. Add a Share action immediately below Layers in the workspace rail.
5. Add a map context menu for copying coordinates, sharing the clicked point, and using
   that point as the satellite-search anchor.
6. Restore accessible click inspection with formatted coordinates, terrain elevation,
   and deterministic nearby OSM POI selection.

The isolated terrain diorama and vertical POI leader labels remain out of scope.

## 3. Architecture and durable decisions

- Keep camera commands, rendered-vector queries, and native click/context events behind
  the typed `MapFacade`; React consumes only serializable commands and inspection state.
- Keep device geolocation in MapLibre's native `GeolocateControl`. Camera persistence
  remains the only automatic persistence path; share parameters are created only by an
  explicit Share or point-menu action.
- Use a versioned query contract with bounded numeric parsing and stable defaults.
  Unknown versions or malformed values fall back to the existing local camera.
- Submit text search only. The public Nominatim service forbids client-side autocomplete
  and caps application traffic at one request per second. Keep the endpoint replaceable,
  cache identical query-and-area requests, validate JSON with Zod, and show OSM
  attribution. Accumulate unique results while doubling the viewport-bounded search to a
  500 km radius even after nearer matches are found.
- A direct coordinate submission never contacts Nominatim. Accept clearly labelled
  `lat, lon` and `lon, lat` forms; reject pairs where both orders are plausible unless
  the user supplies a `lat`/`lon` label.
- Nearby POI inspection uses the existing validated OpenMapTiles source layers and a 100
  m geodesic radius. Sort first by exact distance and then by stable feature identity.
- Reuse MapLibre terrain elevation when available and the configured raster DEM as the
  flat-map fallback. A map click closes an onscreen popup; the following click opens the
  next inspection. An offscreen popup is replaced immediately. Abort older samples when
  the popup closes.
- Diagnostics record bounded outcomes, durations, counts, and coarse status only. They
  never include exact coordinates, search text, shared URLs, or arbitrary POI metadata.

## 4. Work packages and commit sequence

### T1. Versioned navigation and explicit sharing

- Add the versioned URL codec and initial-camera override.
- Add serializable map navigation commands and native geolocation control.
- Add Share below Layers, copy-link dialog, satellite scene encoding/restoration, and
  transient copy confirmations.
- Add the accessible map context menu and satellite anchor handoff.
- Cover parsing defaults, privacy boundaries, keyboard interaction, and copy failures.

Commit: `feat(map): add explicit location sharing`

### T2. Policy-compliant place search

- Add the place-search gateway, use case, Nominatim adapter, schema validation, caching,
  request pacing, cancellation, and safe diagnostics.
- Replace the disabled search placeholder with submit-driven place/coordinate search.
- Add loading, empty, invalid, provider-error, and result-selection behavior.
- Stream deduplicated inner-to-outer matches into the result list while wider searches
  remain in progress, preventing nearby same-name features from hiding settlements.
- Normalize provider categories and prioritize settlements, administrative place
  boundaries, mountains, and water; keep streets and other POIs behind an explicit
  secondary-results action.
- Document provider policy, attribution, privacy, and replacement configuration.

Commit: `feat(map): add place and coordinate search`

### T3. Accessible point inspection

- Restore the typed MapLibre inspection adapter and serializable state.
- Reuse the configured DEM and vector source layers for elevation and nearby POIs.
- Add deterministic 100 m selection, cancellation/race handling, error states, and
  privacy-safe diagnostics.
- Cover popup accessibility, DEM decoding, POI selection, and the click-to-close gate.

Commit: `feat(map): restore accessible point inspection`

### T4. Documentation and browser verification

- Update `README.md`, stable feature/structure/runtime/provider documentation, and the
  docs index only when ownership changes require it.
- Verify native camera behavior remains intact and visually check search, geolocation,
  sharing, context actions, copy feedback, and point-inspection states in current
  Chrome.
- Run the complete proportionate verification gate and capture any documented managed
  Windows coverage fallback.

Commit: `docs(map): describe discovery and sharing`

## 5. Verification

```text
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:integration
pnpm test:coverage
pnpm build
pnpm e2e
rg -n -i '\b(phase|phases|stage|stages|roadmap)\b' README.md docs
git diff --check
```

## 6. Definition of done

- Device location is opt-in, remains local, and does not appear in the URL unless the
  user explicitly creates a share link.
- Share links restore center and zoom, tolerate missing/older parameters, and restore a
  valid optional Sentinel scene without accepting arbitrary provider URLs.
- Place search respects Nominatim policy, direct coordinates remain local, and every
  loading/empty/error state is intentional and accessible.
- Map context actions use the exact clicked point without logging it.
- Point inspection resolves elevation and the deterministic nearest POI within 100 m.
  Clicking while it is open closes it without inspecting that click; stale asynchronous
  results can never reopen a closed inspection.
- Camera persistence and finalized native camera interactions remain passing.
- Intended commits are pushed and available in a draft pull request targeting `main`.
