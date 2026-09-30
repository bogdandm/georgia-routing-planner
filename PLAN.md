# Render cascade performance plan

Branch-local plan; delete before the pull request.

## Approved scope (one commit per item)

1. P0-1 Mosaic `styledata` loop: order mosaic layers only when entries change; guard
   `moveLayer` with `map.getLayersOrder()`.
2. P0-2a Viewport publishing: publish the viewport snapshot only on load/settle with
   value equality; keep `lastIdleAt` out of the React-observed facade snapshot.
3. P0-2b React Compiler in the existing Babel step.
4. P0-2c Track/marker sort: depend on the map center only for distance-based sorts;
   precompute track distances.
5. P0-3 Elevation-chart hover: skip unchanged trace points, no layer-order checks on
   trace data updates, memoized profile sampling and chart props.
6. P1-4 Terrain queue: `LayersPanel` selects fields with `useShallow` and ignores the
   queue; queue-state store writes are trailing-throttled (~250 ms) without affecting
   terrain delivery.
7. P1-5 Satellite mosaic context: refs for movement/terrain state inside `showMosaic`;
   `satelliteMode` in its own context.
8. P1-7 `styledata` cascade: per-source dirty tracking for `setData`, `getLayersOrder()`
   instead of `getStyle()`, `terrainOverlays` store write only on change, slider
   persistence on commit, batched marker icon images.
9. P2 Markers map-layer effect depends on a derived boolean, not `activeTab`.
10. P2 Hidden `CompactTrackSummary` mounts only while its disclosure is open.
11. P2 Saved-track rename does not recompute the elevation profile.
12. P2 Weather bounds documentation matches the `dataloading` implementation.

Out of scope (maintainer decision): middle-button pan coalescing, route preview source,
tile-error throttling, style layer changes, DEM pipeline, COG rasterizer, map options,
bundle splitting (separate later workstream), shader compile.

## Verification

- Focused Vitest per changed area; final `pnpm format:check`, `pnpm typecheck`,
  `pnpm lint`, `pnpm test:coverage`, `pnpm build`.
- A/B browser profile (origin/main build vs branch build, same harness, real GPU): idle,
  left drag, drag with active track, chart hover, section switch, layer toggle, mosaic
  idle/drag, and time-to-idle after drag for terrain delivery.
