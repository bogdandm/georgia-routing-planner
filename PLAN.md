# Repository Simplification Plan

## Baseline and boundaries

- Branch: `refactor/repo-simplify`.
- Worktree: `.codex-worktrees/repo-simplify`.
- Baseline: 122 handwritten production files and 19,306 lines under `src/`; 70
  unit/integration/E2E files and 11,738 lines under `tests/` and `e2e/`.
- The requested test relocation is already present on `origin/main`: no test or spec
  files are tracked under `src/`, unit/integration tests mirror production paths under
  `tests/`, and browser workflows remain under `e2e/`. Do not create a no-op structural
  commit.
- Baseline `pnpm.cmd check` passes the repository audit, formatting, lint, 335 covered
  tests, typecheck, and production build.
- Preserve user data by retaining the IndexedDB database name, schema version, setting
  keys, camera record versions, layer-preference repair behavior, and local-only privacy
  boundaries.

## Existing code to reuse

- Keep `AppDatabase` as the single durable-state owner and reuse its existing settings
  table and validation boundary.
- Keep the MapLibre facade/controller implementation as the imperative native-map owner;
  simplify only forwarding contracts and adjacent coordination.
- Keep the worker RPC, terrain compute, COG rasterization, and Zod parsing boundaries
  because they isolate cancellation, transferables, native resources, and untrusted
  provider/storage data.
- Keep the bounded logger, redaction schema, diagnostic export, and health checks
  because they provide current local support behavior and privacy enforcement.
- Reuse existing focused tests as behavioral contracts, changing tests only when
  imports, ownership, or an evidenced defect changes.

## Removed or replaced code

- Replace TanStack Query's single place-search consumer with direct component-owned
  cancellable request state, then remove its provider, query client wiring, runtime
  dependency, and test wrappers.
- Fold `DexieMapCameraRepository` into `AppDatabase`, which already owns the settings
  table, storage validation, and logger. Keep the small structural camera persistence
  contract only where it remains a useful test seam.
- Collapse the three-file React runtime-services context/provider/hook into one module.
- Replace trivial clock and ID implementation classes/files with typed runtime values at
  the composition root while retaining injectable structural types for deterministic
  tests.
- Inline or colocate single-consumer map capability and diagnostic batching wrappers
  when they do not protect native lifecycle or an external boundary.
- Consolidate duplicated Sentinel search/availability orchestration where common control
  flow and error conversion can be shared without weakening domain or provider
  boundaries.
- Remove unused exports, obsolete test/config references, and runtime dependencies with
  no remaining consumer, including `@mui/x-charts`.

## New production files and abstractions

- None planned. Any newly discovered need must be recorded here with its immediate
  consumer and why extending existing ownership would be less clear.

## Commit sequence

### 1. `refactor(search): own place requests in the component`

- Replace the one-consumer TanStack Query path with an abortable React request whose
  cleanup prevents stale progress/results from updating the UI.
- Remove the query client from bootstrap, tests, and dependencies.
- Preserve explicit-submit behavior, progressive results, cancellation, error states,
  and provider pacing/cache ownership.
- Focused verification: Map search component tests, bootstrap tests, typecheck, lint.

### 2. `refactor(runtime): collapse composition forwarding layers`

- Merge runtime services context/provider/hook into one discoverable module.
- Fold camera persistence into `AppDatabase` without changing durable keys or schemas.
- Replace trivial browser clock and ID classes with structural values at the composition
  root and remove their production files.
- Simplify service construction and update affected tests/documentation.
- Focused verification: bootstrap, persistence, camera persistence, diagnostics, and
  application orchestration tests; typecheck and lint.

### 3. `refactor(map): remove thin map coordination wrappers`

- Remove single-consumer capability interface files and colocate the necessary
  structural contracts with their consumers.
- Collapse the generic diagnostic batch window into the two concrete terrain diagnostic
  aggregators, sharing only direct code when it still reduces total concepts.
- Remove redundant snapshots, transformations, exports, and subscriptions discovered in
  the complete map flow while retaining deterministic listener/worker/native cleanup.
- Focused verification: map, terrain, layers, and developer diagnostics tests; typecheck
  and lint.

### 4. `refactor(satellite): remove unused availability orchestration`

- Remove the availability use case that bootstrap constructs but no production consumer
  reads; the calendar already loads its month ranges through the main satellite search.
- Remove its unused domain result types, runtime wiring, isolated tests, and stale
  documentation rather than consolidating unreachable behavior.
- Review Satellite browser state for mirrored or repeatedly derived values; remove only
  state whose owner and behavior are unambiguous.
- Isolate any correctness fix in focused tests and document why prior behavior violated
  an established invariant.
- Focused verification: satellite domain/application/STAC/browser tests, typecheck,
  lint.

### 5. `refactor(repo): remove obsolete code and dependencies`

- Perform the repository-wide dead-code, import/export, dependency, async cleanup, and
  production-test-location pass.
- Update stable documentation to the final ownership and runtime flows; keep planning
  language out of `README.md` and `docs/`.
- Measure production/test LOC and file/dependency changes, run the final verification,
  then remove `PLAN.md` before the final commit.
- Final verification: `pnpm.cmd check`, `pnpm.cmd test:integration`, `pnpm.cmd e2e`,
  documentation vocabulary scan, `git diff --check`, and confirmation that `src/`
  contains no tests.

## Retained abstraction criteria

- MapLibre facade/controller: isolates the mutable native map, event listeners, terrain,
  rendering transitions, and cleanup from React.
- Worker RPC and compute/raster worker boundaries: isolate transferables, cancellation,
  queueing, failure, and deterministic termination.
- Provider gateways plus Zod schemas: isolate wire formats, allowlisting, pagination,
  and untrusted JSON.
- Dexie database: owns IndexedDB schema and durable local data validation.
- Diagnostics logger/redaction/export and health checks: retain the implemented,
  privacy-safe support capability.
- Small structural dependency types (clock, ID, camera persistence, diagnostics): retain
  only when multiple consumers or deterministic tests use the seam without extra runtime
  forwarding.

## Final review questions

- Is production LOC negative and are fewer production files/concepts required to trace
  each changed behavior?
- Did each removed layer shorten a real dependency path rather than rename it?
- Are existing user records read and written compatibly?
- Can stale asynchronous work update state or survive disposal anywhere changed?
- Are all retained abstractions tied to a concrete current lifecycle, boundary, or test
  seam?
