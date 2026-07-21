# Map restart and sharing work plan

## Existing owners to reuse

- `MapCameraRepository`, `DexieMapCameraRepository`, `SettledCameraPersistence`, and
  `MapWorkspace` remain responsible for durable camera restoration.
- `mapShareUrl`, `ShareMapDialog`, and the `MapWorkspace` context menu remain
  responsible for share contracts and explicit share actions.
- `MapLibreLayerController`, `mapLayerStore`, and `SatelliteBrowser` remain responsible
  for transient satellite selection, rendering, and the selected-scene card.

## Replaced or removed behavior

- Remove durable terrain mode/orientation restoration so every ordinary restart is 2D.
- Remove `appliedScene` from IndexedDB map-layer preferences and delete its restore
  path.
- Replace share URL v1 emission with an explicit 2D/3D contract while retaining safe v1
  parsing compatibility.
- Replace applied-scene sharing with selected-scene sharing, including while raster
  rendering is pending.
- Replace map-readiness-gated shared-scene UI restoration with immediate Satellite
  section/card selection; rendering may follow when the map is ready.

## Commit sequence

1. Persist only the 2D camera and non-scene layer preferences, with migration/repair
   coverage and updated persistence documentation.
2. Add distinct 2D and 3D share URL behavior and update the dialog/context-menu UI with
   focused URL and component tests.
3. Make satellite selection transient and authoritative for sharing, restore shared
   scene UI immediately, and cover the pending-render race plus pane/card behavior.
4. Add or adjust focused Chromium workflows for restart and shared satellite behavior,
   complete the simplification pass, run final verification, and remove this plan.

## New production abstractions

No new production files, dependencies, services, or state owners are planned. Existing
ports, stores, controller APIs, and components will be simplified or extended in place.
