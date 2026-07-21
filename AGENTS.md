# AGENTS.md

## Scope

These instructions apply to the entire Georgia Routing Planner repository.

## Canonical UI prototype

The canonical Penpot workspace is
[Georgia Routing Planner prototype](https://design.penpot.app/#/workspace?team-id=e53c2c6b-a0fc-80ee-8008-585e71ddb1af&project-id=e53c2c6b-a0fc-80ee-8008-586356e1ef5a&file-id=dd49d952-2105-80b2-8008-587f93c8a333&page-id=dd49d952-2105-80b2-8008-587f93c8a334).
Use it as the standing visual and interaction reference without asking the maintainer to
provide the link again.

## Git workflow and approval gate

`main` is the protected approval branch. All implementation, documentation,
configuration, data, test, and maintenance changes must be made on a feature branch.

## Parallel-agent worktrees

Every agent starting a new workstream must create and use a fresh, dedicated Git
worktree and purpose-specific branch. Follow-up prompts, review rounds, CI fixes, and
other continuation work for that workstream must reuse its existing branch and worktree.
Do not create another branch or worktree for continuation work unless the maintainer
directly instructs you to do so. When the maintainer names an existing branch or
worktree, keep all requested work there. Never reuse the main repository checkout or
another agent's worktree. The maintainer may run up to four agents in parallel; separate
worktrees keep independent workstreams isolated without fragmenting one workstream
across repeated review branches.

Each worktree must also use a distinct, explicit development-server port. Check that the
chosen port is free before starting Vite and pass both `--port <port>` and
`--strictPort`; do not rely on Vite's automatic port fallback, because browser review
could otherwise open a different worktree's server.

The only exception is when the maintainer directly instructs that agent to use the main
repository checkout for the current task. Treat the main checkout as
maintainer-controlled in every other case: do not switch its branch, edit its files, or
run Git operations there.

Before modifying files:

1. Run `git status --short --branch` and identify the current branch and existing user
   changes.
2. If the current branch is `main`, create or switch to a purpose-specific branch before
   the first write.
3. Use branch names such as `feature/<short-description>`, `fix/<short-description>`,
   `docs/<short-description>`, or `chore/<short-description>`.

Rules:

- Never commit directly to `main`.
- When asked for code review directly by user - do not run tests, e2e tests or other
  pnpm commands to run automatic checks. Your job is to review code only.
- Never merge, fast-forward, rebase, or cherry-pick work into `main` until the user
  explicitly approves the current feature-branch state for integration.
- Do not interpret silence, a request for more work, or approval of an individual design
  detail as approval to update `main`.
- After approval, merge only the reviewed and verified feature-branch state. If
  additional material changes are requested after approval, return to a feature branch
  and obtain approval again.
- An explicit request to remove, postpone, or take a feature out of scope authorizes
  staging and committing the corresponding tracked-file deletions on the feature branch.
  Do not ask for separate confirmation merely because Git represents removal by staging
  the deleted paths.
- Do not create a new remote, change branch protection, publish/deploy, or perform other
  external actions unless the user requests them.
- Do not force-push or rewrite shared history. Never use destructive Git commands to
  remove user work.
- The GitHub CLI (`gh`) is installed and available for this project. Use it directly for
  GitHub repository and remote workflows, including creating pull requests; do not try a
  GitHub connector first or report a connector-to-CLI fallback. Verify `gh auth status`
  before an operation that contacts GitHub.
- In managed Codex runs, a sandboxed `gh auth status` or other `gh` command may falsely
  report that the token is invalid because the sandbox cannot access the host keyring or
  network. When a sandboxed `gh` command reports an authentication or likely
  sandbox-related failure, immediately rerun the same command with
  `sandbox_permissions: "require_escalated"` before concluding that authentication is
  invalid, asking the maintainer to log in, or blocking publication. Treat the elevated
  result as authoritative; never report an invalid token based only on a sandboxed
  result.
- Preserve unrelated modifications and untracked files. If they overlap the task,
  inspect and incorporate them rather than discarding them.

### Incremental commit cadence

Implementation must be committed incrementally. Do not accumulate an entire workstream
into one final commit.

Before a multi-step workstream begins, create or update the branch-local `PLAN.md` with
the intended commit sequence. A multi-step workstream includes work that spans multiple
layers, independently useful behaviors, migrations, or infrastructure concerns. A single
small atomic change does not require a plan.

For each planned commit:

1. Complete one independently reviewable behavior, layer, migration, or infrastructure
   concern together with its directly relevant tests and permanent documentation.
2. Run only the focused checks needed for that commit.
3. Review the staged diff and commit it before starting the next planned scope.

Do not wait for the final verification round before creating intermediate commits.
Focused checks are sufficient for intermediate commits; broad checks belong to the final
verification round.

A commit should normally contain one of:

- One domain or application capability with its tests.
- One infrastructure adapter or persistence change with its tests.
- One presentation behavior with its component tests.
- One end-to-end workflow addition or modification.
- One focused configuration, build, or documentation change.

Do not combine domain, infrastructure, presentation, end-to-end, and unrelated
documentation changes merely because they belong to the same feature. Split them at
stable dependency boundaries while keeping each commit buildable and internally
consistent. Use clear imperative or Conventional Commit-style messages.

Treat approximately 1,000 changed handwritten lines in an uncommitted implementation
diff as a checkpoint warning, not a target or absolute limit. Before adding more,
inspect whether completed work can be committed independently. Generated files,
lockfiles, snapshots, fixtures, and mechanical formatting are excluded from this
heuristic but should still be isolated when practical. Explain in the pull request when
a large atomic commit genuinely cannot be divided without leaving broken or misleading
intermediate states.

### Feature finalization and pull request

A feature is not handed off as finished until final verification passes and its branch
is available in a GitHub pull request targeting `main`. By the start of final
verification, implementation should already be distributed across its planned commits.
Do not squash the workstream into one final commit.

After final verification:

1. Commit only cleanup caused by final verification or documentation corrections.
2. Remove branch-local `PLAN.md` if it exists and commit its removal. `PLAN.md` must
   never appear in the final pull-request state or on `main`.
3. Push the feature branch and open a ready-for-review pull request, or update the
   existing pull request for that branch.
4. Give the user the pull-request link and report the active branch, commits, checks
   run, checks skipped as not applicable, and whether the branch is awaiting approval.

This standing instruction authorizes the feature-completion push and pull-request
creation without a separate prompt. If a pull request already exists for the branch,
update it instead of creating a duplicate.

## Documentation ownership: system description vs planning

Keep stable system documentation independent from work breakdown and delivery progress:

| Location          | Owns                                                                                                      | Must not contain                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `README.md`       | Stable project overview, current application capabilities, setup, commands, and complete concept summary  | Feature phases/stages, task IDs, estimates, branch/commit/PR status, merge status, or progress  |
| `docs/`           | Stable feature concepts, implemented behavior, unavailable capability labels, architecture, and operation | Feature phases/stages, task ordering, estimates, branch/commit/PR status, or delivery progress  |
| `TOP_LVL_PLAN.md` | TO-BE product roadmap, feature ordering, dependencies, broad acceptance, and high-level progress          | Detailed durable technical contracts that belong in `docs/`, code, or tests                     |
| `PLAN.md`         | Active implementation tasks, work splits, commit sequence, verification plan, and detailed progress       | The only explanation of a feature's meaning, runtime contract, ownership, or operating behavior |

Rules:

- `README.md` and `docs/` may describe features that are not implemented when needed to
  explain the complete reviewed system concept. Label current availability clearly, but
  never say when, in which phase/stage, or through which task/branch the feature will be
  implemented.
- Only `PLAN.md` and `TOP_LVL_PLAN.md` may contain phases, stages, roadmap sequencing,
  work-item breakdown, delivery estimates, branch tracking, approval progress, or
  implementation-status history.
- Planning files may link to stable documentation. Stable documentation must not depend
  on a planning section, phase name, task number, or implementation split to explain a
  feature or system contract.
- Durable facts discovered during implementation must move into `README.md`, `docs/`,
  code contracts, or tests in the same change. Planning files may retain task outcomes,
  but must not remain the sole record of lasting behavior or architecture.
- When reviewed Penpot UI/UX conflicts with repository prose, Penpot wins for layout,
  feature placement, and interaction hierarchy. Update stable feature documentation and
  the relevant planning files; do not reinterpret the design to preserve stale prose.
- Before a documentation handoff, verify that this command returns no matches:

  ```powershell
  rg -n -i '\b(phase|phases|stage|stages|roadmap)\b' README.md docs
  ```

  Also inspect `README.md` and `docs/` for estimates, task identifiers, branch names,
  commit hashes, pull-request state, merge state, approval state, and other progress
  reporting. Current capability statements such as “not currently available” are
  allowed; delivery timing is not.

## Maintainer context

The maintainer is a backend developer and technical lead. Optimize the codebase for
explicit control flow, discoverable architecture, strong types, and readable
object-oriented domain/application code. Do not assume deep familiarity with modern
frontend conventions; document non-obvious React behavior and explain frontend-specific
tradeoffs in pull requests and handoffs.

## Documentation and code comments

Permanent project documentation lives under `docs/` and is indexed by `docs/README.md`.
Keep that index accurate and use repository-relative links. Do not duplicate large
sections across files; link to the authoritative explanation.

Update documentation in the same change as the behavior it describes:

| Change                                                                                     | Required permanent documentation                                      |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Directory, layer, dependency direction, composition, or state owner                        | `docs/project-structure.md`                                           |
| User-visible feature, limitation, error behavior, privacy behavior, or capability boundary | `docs/features.md`                                                    |
| Startup, async sequence, lifecycle, cleanup, persistence, or cross-module interaction      | `docs/runtime-flows.md`                                               |
| Map endpoint, source schema, provider policy, attribution, CORS evidence, or replacement   | `docs/map-providers.md` and the configuration example when applicable |
| Setup, stable command, supported environment, or operator workflow                         | `README.md`                                                           |
| Documentation file added, renamed, or removed                                              | `docs/README.md`                                                      |

Rules:

- A feature is incomplete when its permanent documentation describes old ownership,
  behavior, failure handling, or limits.
- Planning files may link to permanent documentation, but permanent documentation must
  not depend on a planning file for context.
- Keep documentation compact: describe contracts, ownership, invariants, rationale,
  failure behavior, and connections. Do not narrate obvious code or add filler.
- Include small diagrams or tables only when they clarify relationships or sequences
  better than concise prose. Update them when the represented flow changes.
- Tests are executable behavioral evidence, not a replacement for an architecture or
  operating explanation.

Use TSDoc/JSDoc comments on exported contracts and important implementation classes when
their lifecycle, invariants, failure semantics, privacy boundary, units, or ownership
are not obvious from the signature. Use inline comments for non-obvious ordering,
cleanup, compatibility, security, performance, or workaround reasons.

Do not comment every declaration or restate a line in English. Comments must explain why
a constraint exists or what callers may rely on. Remove or update comments in the same
commit as the behavior they describe; a stale comment is a defect. Avoid TODO comments
without an issue or concrete completion condition.

## Product constraints

- TypeScript is mandatory.
- React is the UI framework.
- Support current stable desktop Google Chrome.
- Safari, legacy browsers, SSR, and SEO are not requirements.
- The MVP is a static GitHub Pages application.
- The MVP has no automatic routing, accounts, cloud sync, or OAuth integrations.
- Planning uses user-created waypoints connected by straight geodesic segments.
- User-imported data remains local unless a new requirement explicitly says otherwise.
- Production builds must include an explicitly activated, privacy-safe developer mode
  and diagnostics export. Do not rely on the user opening Chrome DevTools.

## Required stack

Use the following unless an approved architecture decision records a change:

- React with functional components.
- Strict TypeScript.
- Vite.
- Material UI, MUI Icons, and MUI X Charts.
- MapLibre GL JS through `react-map-gl/maplibre`.
- TanStack Query for remote/static query state.
- `ky` for HTTP transport.
- Zod at external-data boundaries.
- Zustand for transient UI/session state only.
- Dexie for IndexedDB persistence.
- Focused Turf packages for geospatial calculations; avoid importing the entire Turf
  bundle when a small module is sufficient.
- Vitest and React Testing Library.
- Mock Service Worker, `fake-indexeddb`, and `@testing-library/user-event` for
  controlled integration and interaction tests.
- Playwright configured for Chromium only.
- Axe integration for automated accessibility checks in Chromium.
- ESLint, typescript-eslint, and Prettier.
- pnpm and a committed lockfile.
- An internal typed structured diagnostics API with bounded sinks and centralized
  redaction. Do not add a hosted telemetry product for the MVP.

Do not add another component library, CSS framework, global state framework, HTTP
client, map engine, or utility grab-bag without documenting the concrete gap in the
existing stack.

## Dependency policy

- Pin reproducible versions through `pnpm-lock.yaml`.
- Prefer current stable, actively maintained packages with TypeScript types.
- Avoid release candidates, nightly builds, and deprecated packages in production
  dependencies.
- Inspect package licenses before addition.
- Explain why every new runtime dependency is needed.
- Prefer browser/platform APIs when their ergonomics and error handling are already
  adequate.
- Run an audit and check bundle impact for significant additions.

## Architecture

Use a lightweight clean architecture with inward dependencies:

```text
presentation -> application -> domain
                     |
                   ports
                     ^
                     |
              infrastructure
```

### Domain

Contains business concepts, invariants, value objects, and pure domain services. It must
not import React, MUI, MapLibre, Zustand, TanStack Query, Dexie, browser storage, HTTP
libraries, or generated API clients.

Use classes where identity, invariants, or behavior justify them. Use readonly
interfaces/types for DTO-shaped data. Prefer composition over inheritance.

### Application

Contains named use-case classes and orchestration. Examples:

- `AddWaypointToPlan`
- `CalculatePlanMetrics`
- `ImportGpxTrack`
- `SearchTrackCatalog`

Use cases depend on port interfaces and receive dependencies through constructors. They
return explicit result values or throw typed application errors at well-defined
boundaries. Do not return React-specific state.

### Ports

Define small capability-oriented interfaces such as:

- `ElevationProvider`
- `SatelliteCatalogGateway`
- `TrackCatalogRepository`
- `RoutePlanRepository`
- `Clock`
- `IdGenerator`

Do not create broad `ApiService`, `Utils`, `Manager`, or `Helper` interfaces.

### Infrastructure

Implements ports using HTTP, STAC, terrain data, GPX/XML, Dexie, browser files, and
static catalog assets. Validate external input before mapping it to domain or
application types.

### Presentation

Contains React components, hooks, MUI composition, map adapters, and view models. It may
call application use cases but must not implement domain rules.

## Expected source structure

Keep feature ownership visible while preserving layer boundaries:

```text
src/
  bootstrap/            # composition root, runtime services, and providers
  domain/
    planning/
    tracks/
    elevation/
    satellite/
    shared/
  application/
    planning/
    tracks/
    satellite/
    ports/
  infrastructure/
    http/
    stac/
    elevation/
    gpx/
    persistence/
    catalog/
  diagnostics/
    logging/
    instrumentation/
    snapshots/
    export/
    redaction/
  presentation/
    shell/
    theme/              # MUI theme and design tokens
    routing/            # client-side page routing, if introduced
    map/
    planner/            # Tracks-owned Create GPX workflow; never top-level navigation
    markers/
    layers/
    track-catalog/
    satellite-browser/
    elevation-profile/
  shared/
    ui/
    errors/
    types/
tools/
  catalog/              # Node-only GPX audit/index pipeline
  diagnostics/          # support-bundle validation and summary CLI
test/
  fixtures/             # synthetic GPX, STAC, terrain, catalog, and error inputs
e2e/
```

Avoid barrel files that obscure dependency direction or create circular imports.

## OOP and React rules

React's supported composition model is functional components, so do not use React class
components merely to appear object-oriented. Apply OOP where it adds clarity:

- Domain entities and value objects.
- Use-case classes.
- Repository and gateway implementations.
- Map and browser integration facades.
- Explicit dependency construction.

Keep JSX declarative. A component should primarily map a view model to UI and translate
events into named commands.

- Keep components small and feature-focused.
- Extract business workflows into use cases, not giant custom hooks.
- Extract imperative MapLibre operations into a typed map facade/adapter.
- Do not store class instances in Zustand or TanStack Query caches. Store serializable
  snapshots/DTOs and map them deliberately.
- Do not use inheritance hierarchies for UI components.
- Avoid generic base services and service locators.

## TypeScript style

- Enable all practical strictness flags, including `strict`, `noUncheckedIndexedAccess`,
  and `exactOptionalPropertyTypes`.
- Do not use `any`. Use `unknown` at untrusted boundaries and narrow it.
- Use Zod schemas for JSON, persisted records, configuration, and other external data.
- Use readonly properties and arrays unless mutation is intentional.
- Prefer discriminated unions for finite states and result variants.
- Use domain-specific value types instead of passing ambiguous primitive tuples. GeoJSON
  remains `[longitude, latitude]`; name types so coordinate order is obvious.
- Use exhaustive `switch` handling with a `never` assertion.
- Use type-only imports where applicable.
- One primary exported class/component per file. Small tightly related types may share
  that file.
- Name files after their primary export. React component files use PascalCase; other
  modules use the repository's chosen consistent convention.

## Control-flow and async rules

- Prefer `async`/`await` over `.then()` chains.
- Never nest multi-step callbacks.
- JSX event handlers should be named functions or one-line commands, not embedded
  workflows.
- Pass `AbortSignal` through cancellable application and infrastructure calls.
- Keep retry responsibility in one layer. TanStack Query normally owns it; avoid
  duplicate automatic retries in `ky`.
- Convert third-party errors into typed infrastructure/application errors before they
  reach components.
- Always render intentional loading, empty, partial, and error states.
- Clean up map listeners, object URLs, workers, and subscriptions deterministically.

## Diagnostics and developer mode

Treat observability as part of every feature. A feature that can fail due to data,
browser state, map state, storage, or a remote provider is incomplete until its failure
can be understood from an exported diagnostics bundle.

### Logging API

- Use the injected typed `DiagnosticLogger`; do not call `console.log`, `console.debug`,
  or `console.error` directly outside the logger's console sink and the earliest
  bootstrap fallback.
- Use stable dotted event names such as `catalog.load.started`,
  `elevation.sample.completed`, or `map.source.failed`.
- Log structured allowlisted fields, not interpolated object dumps.
- Include operation/correlation IDs across UI command, use case, repository, HTTP, and
  result events.
- Log start/end/failure/cancel for important operations and include monotonic duration.
- Normalize unknown thrown values before logging.
- Do not log inside tight point, tile, render, or animation loops. Aggregate counts,
  timings, and representative errors.
- Logging must never make the primary operation fail.

### Required capture

- React error boundary and global error/unhandled rejection.
- Application/bootstrap/build/config version.
- Use-case timings and outcomes.
- Sanitized HTTP lifecycle through central `ky` hooks.
- TanStack Query failures and cancellation at the query boundary.
- MapLibre error, WebGL context, style/source/terrain state, and throttled lifecycle
  summaries.
- GPX/catalog validation summaries and calculation algorithm versions.
- Dexie migrations, schema version, table counts, and storage estimate.
- Performance milestones and slow-operation warnings.

### Redaction and privacy

- Redaction is allowlist-based. Adding a new diagnostic field requires deciding whether
  it is safe to export.
- Never export authorization headers, tokens, cookies, secrets, raw request or response
  bodies, arbitrary query strings, local paths, or complete environment objects.
- Do not export raw GPX, full geometry, timestamps, descriptions, or filenames by
  default. Use stable catalog IDs and numeric summaries.
- Geometry inclusion must be a separate explicit user opt-in in the export UI.
- Keep buffers size- and time-bounded. Provide a clear action.
- No diagnostic network upload or third-party telemetry in the MVP.
- Add automated tests containing fake tokens, coordinates, filenames, and personal
  metadata to prove the exporter removes them.

### Support bundle compatibility

- Version the diagnostics manifest and every evolving event/snapshot schema.
- Keep the exporter deterministic where practical.
- Include app version, source commit, build time, provider configuration summary,
  browser capabilities, and reproduction notes.
- Older bundles should fail parsing with a clear compatibility message, not an untyped
  exception.
- Prefer a readable JSON bundle until size or attachments justify ZIP.
- Maintain a Node CLI that accepts a bundle path, validates it without evaluating
  content, and prints a concise troubleshooting summary safe for logs and issue
  comments.
- The production bootstrap fallback must capture/export startup failures even if React
  or the normal developer drawer cannot mount.

### Health checks

Developer mode must expose non-destructive self-tests for browser/WebGL support, catalog
consistency, IndexedDB read/write and quota, terrain/elevation sampling, and configured
remote-provider reachability. Each check returns a typed status, duration, evidence
summary, and remediation hint. Do not make normal application startup wait for optional
remote health checks.

## State ownership

Use the smallest state mechanism that fits:

- Component-local visual state: React `useState`/`useReducer`.
- Remote or static fetched data: TanStack Query.
- Cross-feature transient UI state: Zustand.
- Durable browser data: Dexie repositories.
- Business rules and transitions: domain/application classes.
- Shareable map camera/filter state: URL parameters when useful.

Do not duplicate the same authoritative state across React, Zustand, TanStack Query, and
Dexie. Document the owner when it is not obvious.

## HTTP and external data

- Create one configured `ky` client per external origin/policy where necessary.
- Set explicit timeouts and identify requests where provider policy requires it.
- Do not put secrets in Vite environment variables: `VITE_*` values are public.
- Validate successful responses with Zod.
- Treat non-2xx responses, invalid bodies, timeouts, cancellation, and quota/rate errors
  separately when the UI can act differently.
- Respect OSM, imagery, STAC, and elevation-provider attribution and usage rules.
- Keep endpoints and source configuration replaceable.

## GUI and CSS

Material UI is the default answer for application chrome and controls.

- Use the shared theme for palette, typography, spacing, shape, breakpoints, and
  component defaults.
- Prefer MUI layout primitives and components over handwritten HTML/CSS widgets.
- Use `sx` for small one-off layout details.
- Use CSS modules for map sizing, complex shell layout, and styles that are clearer as
  CSS. Do not create a large global stylesheet.
- Do not add Tailwind, Bootstrap, another design system, or a CSS-in-JS library
  alongside MUI's configured styling engine.
- Do not copy large component implementations from examples when composition of existing
  MUI components works.
- Maintain visible focus, keyboard access, labels, tooltips, contrast, and minimum hit
  areas.
- Do not spend time on a custom brand system during the MVP. A small deliberate theme is
  sufficient.

## Map rules

Use [`docs/assets/map-style-reference.png`](docs/assets/map-style-reference.png) as the
standing visual reference for map overlays on satellite imagery. Keep roads, paths, and
labels subdued and semi-transparent so they do not obscure terrain; user GPX/routes use
a clearly legible medium blue with a restrained light casing. Avoid bright white road
networks, brown hiking routes, and saturated overlays that dominate the imagery.

- Isolate MapLibre's imperative object and events in the map feature/adapter.
- Keep layer IDs and source IDs centralized and typed.
- Use GeoJSON source/layer rendering for many tracks; do not create thousands of DOM
  markers.
- Use DOM/MUI markers only for a small number of interactive planning waypoints.
- Throttle/debounce high-frequency map events before updating React or URL state.
- Never recreate the map because an unrelated panel state changed.
- Keep OSM attribution visible.
- Test layer ordering: satellite raster below hiking vectors, labels, user tracks, and
  waypoints.
- Expose safe developer-mode snapshots and supported MapLibre debug flags without
  leaking the native map object into unrelated features.

## GPX and catalog rules

- Never alter the original GPX collection in place during auditing/indexing.
- Generate published copies and metadata into a separate output directory.
- Validate coordinate ranges, segment sizes, XML structure, and resource limits.
- Make catalog output deterministic and stable.
- Load original full-resolution GPX only on demand.
- Version the catalog schema and elevation calculation policy.
- Record every rejected or suspicious track in a machine-readable validation report.
- Preserve required attribution/provenance and remove private metadata only under an
  explicit documented publishing policy.

## Testing

Automated tests are required by default. Add or update tests in the same change as
production behavior. Do not postpone the entire test suite to a subsequent change and do
not rely on manual browser verification as the only evidence.

### Verification cadence

Verification has two phases: focused development feedback and one final verification
round. Do not run the complete verification matrix after every edit, commit, review
response, or follow-up prompt.

During implementation:

1. Run the smallest relevant test target: a test name, test file, or affected package
   when possible.
2. Use focused unit, component, or integration tests for ordinary changes. Use focused
   Playwright scenarios only when browser behavior cannot be represented faithfully
   below the end-to-end boundary.
3. Do not run coverage, the complete Vitest suite, the complete Playwright suite,
   `pnpm check`, or other broad verification merely to create an intermediate commit.
4. Keep a concise record of commands run and their outcomes for the final handoff. Do
   not paste complete successful logs when the command, result, and duration are enough.

A successful check remains valid while neither its relevant inputs nor its configuration
have changed. Do not rerun a successful command merely because a new agent turn or
review round started, an intermediate commit was created, the branch is about to be
pushed, or the same commit was already verified locally or by CI. After a follow-up
edit, rerun only the checks invalidated by that edit. Documentation-only changes do not
invalidate code, build, coverage, or end-to-end results.

### Documentation-only verification

When a change modifies only Markdown or other non-executable documentation, do not run
TypeScript checking, ESLint, unit/component/integration tests, coverage, Playwright, or
production builds. Verify only the changed documentation with its formatter, the
documentation-boundary checks required by this file, and `git diff --check`. If the
change also modifies executable code, configuration, schemas, or test fixtures, use the
normal verification rules for those files.

### Managed Windows coverage timing

Parallel V8 coverage can make `WorkspaceShell` interaction tests exceed Vitest's
five-second default on managed Windows. The coverage configuration therefore owns a
ten-second per-test ceiling. When coverage is required during final verification, run
the canonical command once:

```powershell
pnpm test:coverage
```

Do not first run coverage with a five-second ceiling or repeat it merely to apply the
known limit. If a test still exceeds ten seconds, investigate it as a new failure; do
not add sleeps, remove assertions, or silently increase the ceiling.

### Managed Chromium timing

Software-rendered Chromium is resource-constrained when MapLibre, terrain decoding,
IndexedDB persistence, and diagnostics export overlap. Preserve these configured limits:

| Context | Workers | Per-test ceiling | Assertion ceiling | Retries |
| ------- | ------- | ---------------- | ----------------- | ------- |
| Local   | 2       | 90 seconds       | 10 seconds        | None    |
| CI      | 1       | 120 seconds      | 20 seconds        | None    |

Keep the following focused exceptions and synchronization rules:

- `e2e/map-foundation.spec.ts` owns a 60-second ceiling for the real-MapLibre camera
  workflow. Send keyboard shortcuts through the canvas locator and allow ten seconds for
  the settled camera to reach IndexedDB.
- Terrain tests must wait for persisted `terrain` state before dependent camera input.
  Treat `aria-pressed` as including the intermediate `enabling` state. After restoring
  terrain, wait for the selected 3D control to become enabled. Preserve the 20-second
  readiness assertion, 45-second workflow ceiling, and focused 10-second camera
  persistence assertion.
- `e2e/satellite-imagery.spec.ts` owns a focused two-minute ceiling.

Do not replace these limits with sleeps, retries, or broader timeout increases. When a
new environment-specific timeout passes under a focused bounded run, record the exact
test, cause, and validated command or local ceiling in this file during the same change.

Use this test distribution:

- Many fast domain/application unit tests.
- Focused infrastructure integration tests at external boundaries.
- Focused React behavior tests for component states and user interaction.
- A small, high-value Chromium end-to-end suite for critical workflows.

Tests should follow Arrange/Act/Assert or Given/When/Then clearly. One test should
communicate one behavioral reason for failure. Use descriptive behavior names.

Co-locate unit and component tests with their source as `*.test.ts` or `*.test.tsx`.
Keep shared synthetic fixtures under `test/fixtures` and browser workflows under `e2e`.
Test code follows the same readability and type-safety rules as production code.

### Unit tests

Prioritize tests for:

- Distance and coordinate calculations.
- Waypoint editing invariants.
- Elevation resampling, smoothing, ascent, and descent.
- GPX parse/write round trips.
- Catalog filtering and deterministic generation.
- Zod boundary validation and error mapping.
- Dexie schema migrations.

Domain/application tests should not mount React or initialize MapLibre.

Use explicit fakes/builders rather than broad mocking frameworks where practical. Inject
`Clock`, `IdGenerator`, repositories, gateways, and elevation providers so tests control
time, IDs, failures, and results deterministically.

### Infrastructure tests

- Use Mock Service Worker at the HTTP boundary. Reset handlers after every test.
- Use `fake-indexeddb` for Dexie repository and migration tests.
- Use checked-in synthetic GPX/STAC/catalog fixtures; never copy private production
  tracks into the test corpus.
- Cover success, cancellation, timeout, malformed data, schema mismatch, quota,
  rate-limit, storage-full, and migration-failure paths where applicable.
- Test deterministic catalog output byte-for-byte for the small fixture corpus.

### Component tests

Test behavior rather than implementation details. Query by role, accessible name, and
visible text. Mock application ports at the composition boundary rather than mocking
internal functions.

Use `user-event` for realistic input. Avoid assertions against MUI-generated class
names, hook internals, or large JSX snapshots. Test loading, empty, ready, partial,
disabled, and error states deliberately.

### End-to-end tests

Use Playwright's Chromium project only for critical workflows. Minor fixes and isolated
features covered by focused unit, component, or infrastructure tests do not require a
local E2E run or a new E2E scenario. Add or run Playwright when the change creates or
materially alters a major workflow such as:

- Application opens on GitHub Pages-style base path.
- Track search and selection.
- Add/move/delete waypoints through Create GPX in Tracks.
- Save/reload/export a Create GPX draft.
- Select imagery and recover from a failed request.
- Toggle terrain without losing an active Create GPX draft.
- Activate developer mode through the URL, record a failure, export diagnostics, and
  verify secret/geometry redaction.

Network-dependent tests should use recorded fixtures or controlled test adapters; CI
must not depend on public map/data service availability.

Use Playwright traces, screenshots, console output, network logs, and videos as failure
artifacts. Do not solve flakes by adding arbitrary sleeps or unconditional retries. Wait
for observable application states.

### Map testing

- Unit/component tests depend on a small fake map facade, not a real WebGL context.
- Real MapLibre source/layer order, camera, terrain, style reload, interaction, WebGL
  failure, and diagnostics are tested in Chromium.
- Never use live third-party tiles for required CI checks.
- Mask the canvas or serve fixed local tiles for visual regression tests.

### Accessibility tests

- Run axe checks for the application shell and critical workflows.
- Test keyboard focus order, drawer/dialog focus trapping, labels, and live status
  announcements.
- Automated checks supplement rather than replace a brief manual keyboard pass before
  release.

### Coverage

Enforce these initial minimums in CI:

- Global statements, lines, and functions: 80%.
- Global branches: 75%.
- Domain/application statements and lines: 90%.
- Domain/application branches: 85%.

Exclude only generated code, static fixtures, type-only files, and trivial composition
modules through centralized documented configuration. Never add meaningless assertions
or coverage-ignore comments merely to meet a threshold.

### CI policy

GitHub Actions runs on every pull request and protected-branch push. Required checks
include frozen-lockfile installation, formatting, linting, type checking,
unit/component/integration tests with coverage, catalog fixture tests, production build,
and Playwright Chromium/axe tests against the built application.

Required checks block merging. Deployment uses the exact already-tested commit and is
followed by a small Pages smoke test. CI uploads bounded failure artifacts so a
developer can diagnose browser failures without rerunning them locally.

## Commands

After scaffolding, maintain these package scripts as the stable developer interface:

```text
pnpm dev            # local Vite server
pnpm typecheck      # strict TypeScript checks
pnpm lint           # ESLint
pnpm format:check   # Prettier verification
pnpm test:watch     # fast Vitest feedback during development
pnpm test           # Vitest unit/component tests
pnpm test:integration # adapter, IndexedDB, HTTP, and fixture integration tests
pnpm test:coverage  # coverage report
pnpm e2e            # Playwright Chromium tests
pnpm catalog:audit  # non-destructive GPX validation/index report
pnpm catalog:build  # generate published catalog assets
pnpm diagnostics:inspect -- <bundle.json> # validate and summarize support bundle
pnpm build          # typecheck plus production Vite build
pnpm check          # all non-destructive CI checks
```

If a command is not yet implemented, add it with the relevant implementation rather than
documenting a different ad-hoc command.

## Local servers and ports

Before starting any local development, preview, test, or helper server, check that its
intended TCP port has no listener. Never attempt to start a server on an unchecked or
occupied port. If the port is occupied, do not terminate or replace the existing
process; select an available port and pass it explicitly, unless the task requires the
original port, in which case report the conflict before proceeding.

## Final verification and definition of done

Run one final verification round after implementation and expected quick follow-up
changes are complete. By this point, implementation should already be committed in the
incremental sequence defined by `PLAN.md` when a plan was required.

1. Review the complete branch diff and confirm tests and permanent documentation match
   the changed behavior.
2. For documentation-only changes, run only the changed-document formatter, the
   documentation-boundary checks required by this file, and `git diff --check`.
3. For executable code, run `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, and
   `pnpm test` once.
4. Run `pnpm test:integration`, catalog commands, diagnostics commands, coverage, or
   `pnpm build` only when the changed scope requires them. Dependency, configuration,
   map, worker, build, or deployment changes require `pnpm build`. When a required
   aggregate command includes a narrower required command, run only the aggregate
   command: for example, `pnpm test:coverage` replaces `pnpm test`, and a `pnpm build`
   script that includes type checking replaces a separate `pnpm typecheck`. Do not run
   both solely to produce duplicate evidence.
5. Run Playwright only when the change creates or materially alters a major workflow or
   high-risk browser boundary listed in the end-to-end policy. Focused scenarios are
   sufficient unless the next step specifically requires the CI-shaped suite.
6. For MapLibre, terrain, persistence, diagnostics, or satellite end-to-end changes, run
   the CI-shaped Playwright suite once on Windows PowerShell:

   ```powershell
   $env:CI='1'; pnpm e2e; Remove-Item Env:CI
   ```

   Do not also run the complete local Playwright suite unless diagnosing a failure.

7. Verify changed loading, empty, error, and partial states visually in current Chrome
   when presentation behavior changed.
8. Verify changed failure paths emit useful bounded diagnostic events without secret or
   personal payloads.
9. Confirm no secret, personal GPX metadata, generated debug file, or unrelated
   workspace artifact is included.
10. Confirm exported contracts and non-obvious invariants have accurate, compact code
    comments and no comment contradicts current behavior.

If files change after the final round, rerun only invalidated checks. Repeat the
complete round only when subsequent changes are broad enough to invalidate it. Removing
`PLAN.md`, correcting documentation, or changing pull-request prose does not invalidate
successful code or end-to-end checks.

Do not mark work complete when a required check fails. Report an external or
pre-existing failure precisely without repeatedly rerunning an unchanged failing
command, and keep unrelated user changes intact.
