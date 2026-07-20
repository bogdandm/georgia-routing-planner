# Responsive Terrain Compute Pipeline

## Summary

Move DEM repair and contour generation off Chrome's UI thread using a reusable typed Web
Worker transport. Keep one dedicated terrain worker alongside MapLibre's worker,
prioritize terrain during camera movement, evaluate the existing repair algorithm with a
reproducible benchmark, retain only measured optimizations, and recover transparently
without requiring a page refresh.

Implementation stays in the isolated `.codex-worktrees/terrain-compute-worker` worktree
on `feature/terrain-compute-worker`. The branch remains subject to the normal approval
gate before integration into `main`.

## Implementation changes

### 0. Review the overall render pipeline

- Review the complete visible-tile path before implementing the worker change: provider
  request, shared caching, PNG decode, DEM filtering, PNG encode, contour generation,
  protocol delivery, MapLibre parsing, source/layer updates, and WebGL rendering. Ensure
  every stage has one clear owner and dependencies continue to point inward through
  narrow capability interfaces.
- Keep React declarative and the native MapLibre instance long-lived. Imperative map,
  protocol, source, layer, and worker operations stay behind typed adapters; React and
  Zustand receive only serializable snapshots and must not become owners of native
  objects, caches, or calculation rules.
- Verify that request cancellation, timeouts, retry responsibility, cache invalidation,
  filter revisions, buffer ownership, and error translation are each handled in one
  deliberate layer. Avoid duplicate fetch, decode, filter, contour, or retry work across
  the window, terrain worker, and MapLibre worker.
- Keep render updates surgical: preference and filter changes update only the affected
  tile templates, caches, sources, and layers. They must not recreate the map, reset the
  camera, rebuild unrelated layers, or publish high-frequency map events into React
  state.
- Review startup, worker recovery, inline fallback, map detach/reattach, protocol
  registration, abort handling, and final disposal as one lifecycle. Every listener,
  subscription, queued request, transferable buffer, worker, and third-party resource
  must have explicit ownership and cleanup.
- Preserve intentional loading, partial, failure, recovery, and compatibility states.
  Keep diagnostics bounded and privacy-safe, and refactor adjacent render code only when
  the review identifies a concrete ownership, correctness, lifecycle, or duplicated-work
  problem; do not turn this feature into a speculative renderer rewrite.

### 1. Shared terrain compute engine and filter optimization

- Extract a shared `TerrainComputeEngine` that owns filtered-tile fetching, bounded
  caches, PNG processing, contour generation, cancellation, and diagnostic reporting.
  Worker and inline execution must call this same engine; the fallback must not contain
  a second filter or contour implementation.
- Keep the configured provider timeout, MapLibre abort propagation, current processed
  PNG and decoded-context LRU bounds, and the single filtered source shared by relief,
  3D terrain, and contours.
- Add `tools/performance/benchmarkTerrariumFilter.ts`, a deterministic, non-CI timing
  harness that compares the current reference implementation with one candidate at a
  time. Use seeded 256 by 256 center tiles and complete 3 by 3 neighborhoods covering
  valid varied terrain, sparse spikes, many invalid pixels, the observed corrupt
  scanline, cross-tile edges, and a worst-case high-gradient surface. Warm both
  implementations, alternate their execution order, run at least 30 measured samples per
  scenario, and report median, p95, and tiles per second as machine-readable JSON plus a
  concise table. Record runtime version, CPU model, scenario seed, iteration count, and
  whether filtering ran in Node or Chrome; do not use noisy heap deltas as an acceptance
  metric.
- Freeze the current filter as a test/tool-only reference oracle before changing the
  production algorithm. The harness must compare repair counts and output RGBA bytes
  before timing each scenario, so an incorrect candidate cannot produce a misleading
  speedup.
- Profile the reference implementation in Chrome and the benchmark before selecting an
  optimization. Evaluate these candidates incrementally rather than landing them as one
  assumed improvement:
  - A padded typed-array elevation and validity matrix containing the center tile and
    its one-pixel neighbor halo, replacing repeated coordinate and tile lookups.
  - Reused fixed-size neighbor and deviation buffers, with a measured small-sample
    median implementation, replacing per-pixel arrays, `map`, `filter`, and general
    sorting allocations.
  - Reusing the first classification pass's neighbor median for rejected-pixel repair,
    instead of scanning the same neighborhood again.
  - Lazy output cloning when the first repair is made, returning the original decoded
    tile when no pixel changes.
- Benchmark after each candidate. Keep a candidate only when it remains byte-identical,
  improves the combined scenario median by at least 25%, and makes no individual
  scenario's p95 more than 10% slower. If the combined candidates do not meet that gate,
  retain the readable reference algorithm and deliver the worker isolation without a
  speculative matrix rewrite. Treat a 50% reduction from the observed baseline as a
  stretch result, not an assumption.
- Keep `maplibre-contour` pinned at its current version and instantiate its
  `LocalDemManager` inside the shared engine so filtered DEM blobs, parsed elevation
  data, and generated contours continue to use bounded shared caches.

Planned commit: `perf(elevation): benchmark and optimize shared terrain compute`

### 2. Typed worker transport, recovery, and inline compatibility

- Add a dependency-free reusable worker RPC transport with request identifiers, typed
  discriminated messages, transferable results, abort forwarding, structured errors,
  status events, and deterministic shutdown.
- Create the terrain worker with Vite's module-worker form:
  `new Worker(new URL(..., import.meta.url), { type: 'module' })`, so its asset path
  remains correct under the GitHub Pages base path.
- Run DEM decoding, filtering, PNG encoding, parsed DEM work, and contour generation in
  one dedicated terrain worker. MapLibre retains its own default worker, limiting the
  application to one additional CPU worker rather than an adaptive pool that could
  increase contention.
- Use this request protocol:
  - `initialize`: validated terrain configuration, timeout, cache bounds, and current
    filter revision.
  - `dem` and `contour`: request ID, revision, tile coordinates, contour options when
    applicable, and priority.
  - `cancel`: request ID for work no longer needed by MapLibre.
  - `set-filter`: enabled state plus monotonically increasing revision.
  - `dispose`: cancel work, clear queues and caches, and close the worker.
  - `result`, `failure`, `status`, and `diagnostic`: correlated responses that never
    expose coordinates or provider URLs to exported diagnostics.
- Treat HTTP, timeout, decoding, and calculation errors as ordinary request failures.
  They must not restart the worker or prevent later MapLibre requests from succeeding.
- Treat worker `error`, `messageerror`, or channel loss as transport failures:
  - Start one fresh worker.
  - Replay the latest validated configuration and filter revision.
  - Retry each still-current, non-aborted request once.
  - Reject work from an obsolete filter revision as cancellation rather than allowing
    stale tiles to reach MapLibre.
- If the fresh worker cannot initialize or crashes again, switch permanently for that
  page session to an inline backend that invokes the same `TerrainComputeEngine`.
  Preserve terrain features, emit a warning that movement can be slower, and try the
  worker again on the next page session.
- Dispose the worker, requests, listeners, and registered protocols through the runtime
  service lifecycle. Worker shutdown must not depend on garbage collection or page
  refresh.

Planned commit: `feat(map): move terrain compute off the UI thread`

### 3. Interaction-aware scheduling

- Extend the map boundary so `movestart` marks terrain computation interactive and
  `moveend` returns it to settled mode. Detach must always clear the interactive state.
- Continue DEM and 3D surface requests at high priority while the camera moves.
- Hold newly requested contour jobs at low priority until movement settles. Do not
  explicitly hide existing contour tiles; allow MapLibre to retain or discard them
  normally.
- Remove aborted queued contours immediately, keep the queue bounded, and flush only
  current requests after `moveend`. A running synchronous contour calculation does not
  need unsafe preemption, but no new contour calculation may start while movement is
  active.
- Preserve current source-revision updates, camera state, layer visibility, and filter
  preference persistence. Changing the filter still reloads relief, 3D terrain, and
  contours atomically without remounting the map.

Planned commit: `perf(map): prioritize terrain while moving`

## Interfaces and observable state

- Introduce a capability-oriented `TerrainComputeBackend` with operations to fetch a DEM
  tile, generate a contour tile, update the filter revision, update interaction
  priority, and dispose resources.
- Keep the generic RPC transport in infrastructure/runtime code and the terrain engine
  in elevation infrastructure. Do not introduce a broad service locator or put worker
  objects in Zustand, TanStack Query, or domain/application layers.
- Extend the contour adapter with `setInteractionActive`, execution-status subscription,
  and `dispose` operations.
- Define `TerrainComputeStatus` as `worker`, `restarting`, or `inline`. Publish only the
  serializable status through the existing terrain-overlay presentation state. Do not
  persist it.
- Display inline compatibility as a non-blocking warning in the terrain settings. A
  successful worker restart should return to normal without showing an error.
- Preserve the existing `map.dem.tiles-processed` and `map.contours.tiles-generated`
  aggregates while adding allowlisted execution mode, queue duration, compute duration,
  pending count, restart, and fallback evidence. Diagnostics must continue to exclude
  tile coordinates, URLs, pixels, raw geometry, and arbitrary thrown objects.

## Testing and acceptance

### Automated tests

- Compare the optimized filter byte-for-byte and count-for-count against a test-only
  reference implementation over seeded synthetic grids, missing neighbor tiles, coherent
  ridges, positive and negative spikes, sentinels, the observed corrupt scanline, and
  valid unchanged terrain.
- Test the benchmark harness's deterministic scenario generation, correctness-first
  comparison, warmup exclusion, alternating execution order, percentile calculation, and
  JSON schema without asserting wall-clock thresholds in CI.
- Test engine caching, overlapping neighborhood coalescing, filter-revision
  invalidation, request cancellation, timeouts, network recovery, contour buffer
  ownership, and deterministic disposal.
- Test worker RPC correlation, transferable results, aborted requests, initialization
  failure, crash recovery, state replay, one retry, rejection of stale results, and
  terminal inline fallback using injected fake worker endpoints.
- Test that DEM requests proceed while movement is active, contours remain queued,
  canceled contours disappear, the queue remains bounded, and remaining contours resume
  on `moveend`.
- Add focused React coverage for the inline compatibility warning and its removal after
  normal worker recovery.
- Extend Chromium coverage to prove that the production worker bundle loads with the
  configured base path and that filtered relief, 3D terrain, contours, camera input,
  reload persistence, and teardown remain functional.

### Performance acceptance

- In healthy operation, Chrome Performance recordings must show DEM repair and contour
  calculation on the terrain worker rather than the window thread.
- Camera pan, zoom, pitch, and orbit input must remain responsive while filtered terrain
  reloads and while contour work is pending.
- Capture the benchmark before the first production optimization and after every
  candidate using the same machine, runtime, seed, scenarios, warmup, and iteration
  count. Record the command and before/after summary in this plan's verification
  evidence and in the pull request; generated benchmark JSON remains an untracked local
  artifact.
- Apply the 25% combined-median improvement and maximum 10% per-scenario p95 regression
  gate defined above. The approximately 91 ms single-scenario planning measurement is
  context only; the new multi-scenario reference run becomes the authoritative baseline.
- Repeat the winning candidate once in current stable Chrome inside the actual terrain
  worker. Node results select the algorithm, while the Chrome run confirms that browser
  typed-array, image, and worker behavior does not reverse the result.
- Worker transport or recovery must never require F5. A failed tile request must not
  poison subsequent requests, and failed worker recovery must leave the same features
  available through the inline engine.

### Verification commands

Run focused tests with each implementation commit, followed by:

```powershell
pnpm repo:audit
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:coverage
pnpm build
pnpm exec tsx tools/performance/benchmarkTerrariumFilter.ts --iterations 30 --json
$env:CI='1'; pnpm e2e; Remove-Item Env:CI
rg -n -i '\b(phase|phases|stage|stages|roadmap)\b' README.md docs
git diff --check
```

The coverage configuration already owns the managed-Windows ten-second per-test ceiling.
Run canonical coverage once; investigate any remaining timeout as a new failure rather
than rerunning with another ceiling or adding sleeps.

## Permanent documentation

- Update `docs/project-structure.md` with worker, engine, transport, state ownership,
  and lifecycle boundaries.
- Update `docs/runtime-flows.md` with request scheduling, cancellation, revision replay,
  worker restart, inline fallback, and teardown.
- Update `docs/map-providers.md` with optimized filtering, shared worker-side caches,
  and failure behavior.
- Update `docs/features.md` with the compatibility warning and the guarantee that the
  basemap remains usable during terrain failures.
- Update `README.md` with the stable terrain-filter benchmark command, its
  non-CI/non-regression-test purpose, and how to compare runs on the same environment.
- Keep stable documentation free of work-item sequencing, branch state, estimates, or
  approval progress; those details remain in this file.

## Assumptions and definition of done

- Supported stable desktop Chrome provides module workers, `OffscreenCanvas`, and
  `createImageBitmap`.
- No backend service, WASM toolchain, new runtime dependency, or generic shared worker
  pool is introduced. Future GPX or elevation workloads may reuse the typed RPC
  transport with their own capability-specific workers.
- Inline fallback deliberately favors feature availability over responsiveness only
  after worker recovery fails.
- Filtered DEM bytes and contour geometry remain behaviorally compatible with the
  current implementation for the same configuration and inputs.
- Terrain filter optimization is conditional on the benchmark gate. Worker isolation,
  cancellation, recovery, and scheduling remain required even if no candidate is kept.
- The work is complete only when relevant checks and performance evidence pass, the
  intended commits are pushed, and a draft pull request targeting `main` is available
  for review. The feature branch remains awaiting approval until the maintainer
  explicitly authorizes integration.
