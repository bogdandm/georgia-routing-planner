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
another agent's worktree. The maintainer commonly runs four to six agents in parallel;
separate worktrees keep independent workstreams isolated without fragmenting one
workstream across repeated review branches.

Each worktree must also use a distinct, explicit development-server port. Check that the
chosen port is free before starting Vite and pass both `--port <port>` and
`--strictPort`; do not rely on Vite's automatic port fallback.

The only exception is when the maintainer directly instructs that agent to use the main
repository checkout for the current task. Treat the main checkout as
maintainer-controlled in every other case: do not switch its branch, edit its files, or
run implementation commands there. The only repository-level Git operations allowed
against the main checkout when starting a workstream are read-only inspection, fetching
the intended base, and `git worktree list` or `git worktree add`. Run them with
`git -C <main-root>` so the target is explicit.

Before modifying files:

1. Run `git status --short --branch` and identify the current branch and existing user
   changes.
2. If the current branch is `main`, create or switch to a purpose-specific branch before
   the first write.
3. Use branch names such as `feature/<short-description>`, `fix/<short-description>`,
   `docs/<short-description>`, or `chore/<short-description>`.

### Creating a branch and worktree on Windows

First run `git worktree list` and inspect local branches. If the workstream, branch, or
worktree already exists, reuse it for continuation work. Do not create a second one.

For a genuinely new workstream, resolve the main checkout through Git's common directory
instead of assuming the current directory is the main checkout:

```powershell
$commonGitDir = (git rev-parse --path-format=absolute --git-common-dir).Trim()
$mainRoot = Split-Path $commonGitDir -Parent
$workstream = 'short-workstream-slug'
$branch = 'feature/short-workstream-slug'
$worktreePath = Join-Path $mainRoot ".codex-worktrees\$workstream"

if (Test-Path -LiteralPath $worktreePath) {
  throw "Worktree path already exists: $worktreePath"
}
git -C $mainRoot show-ref --verify --quiet "refs/heads/$branch"
if ($LASTEXITCODE -eq 0) {
  throw "Branch already exists: $branch"
}
git -C $mainRoot fetch origin main
git -C $mainRoot worktree add $worktreePath -b $branch origin/main
Set-Location $worktreePath
git status --short --branch
```

Choose the branch prefix that matches the work. Replace both placeholder values; do not
copy them literally. Before `worktree add`, confirm the path does not exist and the
branch name is unused. Do not nest a worktree under any linked worktree except the
repository's intentionally ignored main-checkout `.codex-worktrees/<workstream>`
directory, which is the standard location for durable local worktrees. Managed Codex
worktrees supplied by the host are also valid; do not relocate or recreate them.

Keep the local worktree directory slug at 20 characters or fewer. Windows package paths
can exceed filesystem cleanup limits even when Git accepts a longer worktree path.

The combined `worktree add -b` command creates the branch directly in its worktree
without switching `main`. After creation, every edit, install, test, commit, and server
command must use the new worktree as its working directory. Verify both
`git rev-parse --show-toplevel` and `git status --short --branch` before the first
write.

Do not automatically prune, remove, or repair other worktrees. Remove a worktree and its
branch only when it was created as a disposable validation fixture or the maintainer
explicitly requests removal. Resolve and verify the exact absolute target before
removing it.

### Node, pnpm, PATH, and dependencies

Each worktree has its own `node_modules`. Never copy, move, junction, or symlink
`node_modules` from the main checkout or another worktree, and never invoke a binary
from another worktree's `node_modules/.bin`. pnpm's content-addressed store already
shares package data safely.

Before running JavaScript tooling in a new worktree:

1. Read `.node-version`, `package.json#engines`, and `package.json#packageManager`.
2. Run `Get-Command node.exe`, `node.exe --version`, `Get-Command pnpm.cmd`, and
   `pnpm.cmd --version`.
3. Confirm Node satisfies the declared engine and pnpm matches the declared major and
   pinned package-manager version.
4. If the task needs dependencies, run `pnpm.cmd install --frozen-lockfile` from the
   worktree with network permission available from the start. Even with a frozen
   lockfile and warm pnpm store, missing package archives may require registry access.
   Documentation-only tasks do not need an install.
5. Prefer repository scripts through `pnpm.cmd <script>`. In managed Windows shells, do
   not use `pnpm exec`: duplicate PATH variables can prevent it from finding the current
   worktree's `.bin` directory. When no repository script exists, invoke the current
   worktree binary explicitly as `.\node_modules\.bin\<tool>.CMD <arguments>`.

On Windows, use `pnpm.cmd`, not the PowerShell `pnpm.ps1` shim; managed shells may block
the latter through execution policy. Do not change machine execution policy to make the
shim work. If `pnpm.cmd` is absent but `corepack.cmd` exists, use `corepack.cmd pnpm`
with the repository-pinned version. If no compatible Node or package manager is
available, report the exact command lookup and version results; do not download or
install a machine-wide runtime during an unrelated task.

If an install or executable lookup fails, verify the current directory and executable
source before changing files:

```powershell
git rev-parse --show-toplevel
Get-Command node.exe
Get-Command pnpm.cmd
pnpm.cmd config get store-dir
```

Delete and reinstall only the current worktree's ignored `node_modules` when evidence
shows it is incomplete or stale. Do not delete the shared pnpm store, another worktree's
dependencies, or the lockfile as a troubleshooting shortcut.

Rules:

- Never commit directly to `main`.
- When asked directly for code review, review code only. Do not run tests, E2E tests, or
  other pnpm automatic checks.
- Never merge, fast-forward, rebase, or cherry-pick work into `main` until the user
  explicitly approves the current feature-branch state for integration.
- Do not interpret silence, a request for more work, or approval of an individual design
  detail as approval to update `main`.
- After approval, merge only the reviewed and verified feature-branch state. If
  additional material changes are requested after approval, return to a feature branch
  and obtain approval again.
- An explicit request to remove, postpone, or take a feature out of scope authorizes
  staging and committing the corresponding tracked-file deletions on the feature branch.
- Do not create a new remote, change branch protection, publish, or deploy unless the
  user requests it.
- Do not force-push, rewrite shared history, or use destructive Git commands to remove
  user work.
- Use the installed GitHub CLI (`gh`) directly for GitHub repository and remote
  workflows, including pull requests. Verify `gh auth status` before contacting GitHub.
- In managed Codex runs, immediately rerun a sandboxed `gh` authentication or likely
  network failure with required elevated sandbox permission. Treat the elevated result
  as authoritative.
- Preserve unrelated modifications and untracked files. If they overlap the task,
  inspect and incorporate them rather than discarding them.

### Incremental commit cadence

Commit implementation incrementally. Group commits around independently reviewable
behavior or one focused structural change, with directly relevant tests and permanent
documentation. Keep intermediate states buildable and internally consistent.

Before a multi-step workstream begins, create or update branch-local `PLAN.md` with the
intended commit sequence. A single small atomic change does not require a plan.

For each planned commit:

1. Complete one independently reviewable behavior or focused structural change.
2. Run only the focused checks needed for that commit.
3. Review the staged diff and commit it before starting the next planned scope.

Do not split commits merely to mirror architectural layers, and do not spread one
coherent simplification across unnecessary commits. Do not wait for the final
verification round before committing completed, reviewable work. Treat approximately
1,000 changed handwritten lines in an uncommitted implementation diff as a checkpoint
warning; inspect whether a completed part can be committed without creating a broken or
misleading intermediate state.

### Complexity and code-growth budget

Optimize for simplicity, explicit control flow, strong typing, shallow dependency
graphs, discoverability, and low cognitive load. Prefer changing, reusing, simplifying,
or deleting existing code over adding a parallel implementation.

Before adding a production file, abstraction, service, hook, adapter, state owner, or
dependency:

1. Search for the existing owner of the responsibility.
2. Extend or simplify that owner when doing so preserves clarity.
3. Add an abstraction only when it solves a concrete present-day problem and materially
   improves the code.
4. Record the reason and immediate consumer in `PLAN.md` when a plan is required.

Do not add abstractions for consistency, architectural purity, design-pattern
conformity, possible future reuse, or possible future implementations. Shared code must
have a real shared responsibility or multiple real consumers. Avoid interfaces with one
implementation unless the boundary isolates meaningful external or imperative
complexity. Avoid modules that mostly forward arguments and return values unchanged. Do
not wrap an API unless the wrapper substantially simplifies it or isolates important
complexity.

File count, navigation cost, call depth, dependency count, state duplication, and the
number of concepts needed to understand a feature are forms of complexity. Line count is
a review signal, not a target. Do not reduce it through compressed control flow,
oversized modules, weakened types, removed behavioral coverage, or merged unrelated
responsibilities.

When behavior is replaced, remove the superseded implementation, obsolete compatibility
paths, unused exports, redundant tests, and stale documentation in the same workstream.
Do not keep old and new implementations together unless a concrete, documented runtime
migration requires both.

Every multi-step `PLAN.md` must identify:

- Existing code that will be reused.
- Code, files, dependencies, or paths that will be removed or replaced.
- Why each new production file, abstraction, state owner, or dependency is necessary.

Before final verification, review the complete diff and remove unnecessary files, dead
branches, wrappers, adapters, interfaces, fallbacks, defensive logic, duplicate helpers,
and temporary compatibility code. Collapse trivial single-consumer abstractions when
they provide no meaningful boundary, lifecycle, or test seam.

Use net production growth as a review trigger:

- More than 500 net new handwritten production lines requires a brief justification.
- More than 1,000 net new handwritten production lines requires explaining why more
  existing code could not be replaced or simplified.
- Three or more new production files requires listing the responsibility and immediate
  consumer of each file.

Keep production and test measurements separate. Exclude tests, fixtures, generated
files, documentation, scripts, tooling, lockfiles, and formatting-only changes from
production LOC.

### Implementation and refactoring rules

- A bug fix makes the smallest semantic change that fixes the demonstrated problem. It
  must not introduce a new architectural layer or unrelated refactoring.
- Refactoring must reduce complexity rather than redistribute it. Prefer deleting code
  over moving, renaming, wrapping, extracting, or splitting it.
- Renaming, relocation, extraction, file splitting, and replacing one abstraction with
  another are not simplification by themselves.
- Refactoring should reduce production LOC, production file count, dependency count,
  call depth, state duplication, or the concepts required to understand the affected
  feature.
- Prefer negative production LOC for simplification work unless added code is necessary
  to preserve required behavior or clarity.
- Do not rewrite the application merely to conform to these instructions.
- Preserve valuable existing boundaries when removing them would make the code less
  clear or less safe.

### Feature finalization and pull request

A feature is not finished until final verification passes and its branch is available in
a GitHub pull request targeting `main`. By final verification, implementation should
already be distributed across its planned commits.

After final verification:

1. Commit only cleanup caused by final verification or documentation corrections.
2. Remove branch-local `PLAN.md`, if present, and commit its removal. It must not appear
   in the final pull-request state or on `main`.
3. Push the branch and open a ready-for-review pull request, or update the existing pull
   request for that branch.
4. Give the user the pull-request link and report the active branch, commits, checks
   run, checks skipped as not applicable, and whether the branch is awaiting approval.

This standing instruction authorizes feature-completion push and pull-request creation
without another prompt. Never create a duplicate pull request for the same branch.

### Pull request title and description

Pull-request titles must use `<type>(<scope>): <imperative summary>`. The type must be
one of `feat`, `fix`, `refactor`, `docs`, `test`, `perf`, `build`, `ci`, or `chore`.
Scope is mandatory, short, and lowercase kebab-case. The summary starts with an
imperative verb, names the concrete outcome, has no trailing period, and keeps the
complete title at 72 characters or fewer.

Every pull-request description must use these headings in order:

1. `## Outcome`
2. `## Changes`
3. `## Verification`
4. `## UI evidence`, only when presentation behavior changes
5. `## Risk and rollback`
6. `## Review guidance`

Description rules:

- Describe the final branch state, not chronology or planned work.
- Keep Outcome to one through three concrete bullets.
- Group Changes by behavior or responsibility and name removed or replaced code.
- Report handwritten production additions and deletions, test additions and deletions,
  production and test files added, removed, and moved, new runtime dependencies, every
  new abstraction with its concrete current justification, and significant abstractions
  removed.
- State whether the result could be smaller without losing required behavior or clarity.
- Use `Not applicable - no production code changed` for production LOC on documentation,
  test-only, or configuration-only work.
- Verification must be a table naming every required command and manual check. Results
  are `Passed`, `Failed`, `Not run`, or `Not applicable`, with concise evidence or a
  reason.
- UI evidence includes before/after screenshots or recordings, viewport details, and
  Penpot comparison notes.
- State a real risk and concrete rollback path.
- Tell reviewers where to start and what invariant or tradeoff deserves attention.
- Update the title and description whenever scope, evidence, risk, or reviewer focus
  materially changes.

## Documentation ownership: system description vs planning

Keep stable system documentation independent from work breakdown and delivery progress:

| Location          | Owns                                                                                                      | Must not contain                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `README.md`       | Stable project overview, current application capabilities, setup, commands, and complete concept summary  | Feature phases/stages, task IDs, estimates, branch/commit/PR status, merge status, or progress  |
| `docs/`           | Stable feature concepts, implemented behavior, unavailable capability labels, architecture, and operation | Feature phases/stages, task ordering, estimates, branch/commit/PR status, or delivery progress  |
| `TOP_LVL_PLAN.md` | TO-BE product roadmap, feature ordering, dependencies, broad acceptance, and high-level progress          | Detailed durable technical contracts that belong in `docs/`, code, or tests                     |
| `PLAN.md`         | Active implementation tasks, work splits, commit sequence, verification plan, and detailed progress       | The only explanation of a feature's meaning, runtime contract, ownership, or operating behavior |

Rules:

- `README.md` and `docs/` may describe unavailable features needed to explain the
  reviewed system concept, but must not say when, in which stage, or through which task
  or branch they will be implemented.
- Only `PLAN.md` and `TOP_LVL_PLAN.md` may contain roadmap sequencing, work-item
  breakdown, estimates, branch tracking, approval progress, or implementation history.
- Stable documentation must not depend on a planning section, task number, or
  implementation split to explain a lasting contract.
- Move durable facts discovered during implementation into `README.md`, `docs/`, code
  contracts, or tests in the same change.
- When reviewed Penpot UI/UX conflicts with repository prose, Penpot wins for layout,
  feature placement, and interaction hierarchy. Update stable feature documentation and
  relevant planning files.
- Before a documentation handoff, verify this command returns no matches:

  ```powershell
  rg -n -i '\b(phase|phases|stage|stages|roadmap)\b' README.md docs
  ```

  Also inspect `README.md` and `docs/` for estimates, task identifiers, branch names,
  commits, pull-request state, merge state, approval state, and other progress
  reporting.

## Maintainer context

The maintainer is a backend developer and technical lead. Optimize for explicit control
flow, discoverable structure, strong typing, shallow dependencies, and readable code. Do
not assume deep familiarity with modern frontend conventions; document non-obvious React
behavior and explain frontend-specific tradeoffs in pull requests and handoffs. Do not
introduce backend-style layering merely because it may look familiar.

## Documentation and code comments

Permanent project documentation lives under `docs/` and is indexed by `docs/README.md`.
Keep that index accurate, use repository-relative links, and avoid duplicating
authoritative explanations.

Update documentation in the same change as the behavior it describes:

| Change                                                                                     | Required permanent documentation                                      |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Production organization, dependency direction, composition, or non-obvious state owner     | `docs/project-structure.md`                                           |
| User-visible feature, limitation, error behavior, privacy behavior, or capability boundary | `docs/features.md`                                                    |
| Startup, async sequence, lifecycle, cleanup, persistence, or cross-module interaction      | `docs/runtime-flows.md`                                               |
| Map endpoint, source schema, provider policy, attribution, CORS evidence, or replacement   | `docs/map-providers.md` and the configuration example when applicable |
| Setup, stable command, supported environment, or operator workflow                         | `README.md`                                                           |
| Documentation file added, renamed, or removed                                              | `docs/README.md`                                                      |

Keep documentation compact and focused on contracts, ownership, invariants, rationale,
failure behavior, and connections. Use TSDoc/JSDoc or inline comments when lifecycle,
cleanup, privacy, units, ownership, ordering, compatibility, security, or performance
constraints are not obvious from code. Do not restate declarations. Remove stale
comments with the behavior they describe.

## Product constraints

Future work must preserve these core requirements unless the maintainer approves a
change:

- TypeScript and React functional components.
- Current stable desktop Google Chrome.
- Static GitHub Pages delivery; Safari, legacy browsers, SSR, and SEO are not required.
- No automatic routing, accounts, cloud sync, or OAuth integrations in the MVP.
- User-created waypoints connected by straight geodesic segments.
- User-imported data stays local unless an explicit new requirement says otherwise.
- Privacy-safe, explicitly activated developer functionality where currently
  implemented; no automatic diagnostic or telemetry upload.

Existing diagnostics and developer-support behavior may be simplified only in a focused
future refactor that preserves reviewed user-facing requirements, privacy, and useful
support capability. Do not expand it by default in unrelated features.

## Technology policy

Core technologies to preserve:

- React functional components, strict TypeScript, and Vite.
- Material UI, MUI Icons, and MUI X Charts for the existing UI system.
- MapLibre GL JS through `react-map-gl/maplibre`.
- pnpm with a committed lockfile.
- Vitest, React Testing Library, Playwright Chromium, and axe for proportionate
  verification.

Currently installed tools may continue where they fit an actual responsibility:

- TanStack Query for appropriate remote or static query state.
- `ky` for HTTP transport.
- Zod for genuinely untrusted external boundaries.
- Zustand for suitable cross-feature transient state.
- Dexie for IndexedDB persistence.
- Focused Turf packages for geospatial calculations.
- Mock Service Worker, `fake-indexeddb`, and `@testing-library/user-event` for suitable
  tests.
- ESLint, typescript-eslint, and Prettier.
- The existing structured diagnostics and support tooling.

A feature does not need to use every installed state, transport, persistence,
validation, diagnostics, or testing library. Existing architectural and diagnostics
systems are not mandatory for every feature and may be simplified by a later focused
refactor. Do not add another component library, CSS framework, global state framework,
HTTP client, map engine, or utility grab-bag without documenting the concrete gap.

## Dependency policy

- Pin reproducible versions through `pnpm-lock.yaml`.
- Prefer current stable, maintained packages with TypeScript types.
- Avoid release candidates, nightlies, deprecated packages, and unnecessary utilities.
- Inspect licenses before addition and explain every new runtime dependency.
- Prefer browser APIs when their ergonomics and failure handling are adequate.
- Audit and check bundle impact for significant additions.

## Architecture and production organization

Architecture serves concrete current requirements. Organize production code primarily
around features and meaningful subsystems, and keep closely related code together. A
feature should normally be understandable without tracing a long chain of layers,
forwarding abstractions, or dependency-registration entries.

Prefer cohesive modules and plain functions. Use classes only when lifecycle, identity,
encapsulated mutable state, or management of a complex imperative API clearly justifies
them. Do not require domain, application, ports, and infrastructure layers, named
use-case classes, constructor injection, repositories, gateways, adapters, services,
facades, factories, managers, controllers, providers, interfaces, or dependency
injection by default.

Do not split cohesive logic merely to maintain formal layer boundaries or
one-export-per-file conventions. Production structure must reflect actual ownership, not
a predefined directory diagram. Do not create directories for features or subsystems
that do not exist. A small number of genuinely shared runtime subsystems is appropriate
when their responsibility is real and their consumers are known.

Preserve deliberate isolation around genuinely complex imperative systems and
external-data boundaries, including MapLibre integration and untrusted imported or
remote data. Do not generalize those exceptions into a repository-wide architecture.
Avoid circular dependencies and barrel exports that hide ownership, dependency
direction, or cycles.

## React and TypeScript

- Keep JSX declarative and components small enough to remain feature-focused.
- Keep business rules in cohesive feature code; do not default them to classes or a
  separate application layer.
- Isolate complex imperative MapLibre lifecycle and event handling behind the smallest
  useful boundary.
- Do not store mutable class instances in Zustand or TanStack Query caches.
- Do not use React class components or UI inheritance hierarchies.
- Keep strictness flags enabled, including `strict`, `noUncheckedIndexedAccess`, and
  `exactOptionalPropertyTypes`.
- Do not use `any`. Use `unknown` at untrusted boundaries and narrow it.
- Use readonly data where mutation is not intentional and discriminated unions for
  useful finite states.
- Name ambiguous primitives, especially GeoJSON `[longitude, latitude]` coordinates.
- Prefer exhaustive handling, type-only imports, and consistent descriptive file names.

## Control flow, external data, and errors

- Prefer `async`/`await` and explicit control flow over nested callback workflows.
- Pass `AbortSignal` through operations where cancellation is materially required.
- Keep retry ownership in one place and avoid duplicate automatic retries.
- Clean up map listeners, object URLs, workers, and subscriptions deterministically.
- Validate genuinely untrusted external data at the boundary where it enters trusted
  code. Do not repeat validation, mapping, normalization, result wrapping, or error
  conversion when it adds no meaningful behavior.
- Handle demonstrated and realistic failure modes. Do not add speculative fallbacks,
  compatibility paths, recovery frameworks, or distinct typed error layers when the UI
  treats the failures identically.
- Render intentional loading, empty, partial, and error states where the interaction
  needs them.
- Set explicit HTTP timeouts where appropriate, treat failures differently only when
  callers can act differently, and keep public endpoint configuration replaceable.
- Do not put secrets in Vite environment variables; `VITE_*` values are public.
- Respect OSM, imagery, STAC, and elevation-provider attribution and usage rules.

## State ownership and persistence

Choose the smallest state or persistence mechanism appropriate to the current
responsibility. Keep ownership local and obvious:

- Use component state or reducers for local visual and interaction state.
- Use TanStack Query when its remote/static query lifecycle provides concrete value.
- Use Zustand only for genuinely cross-feature transient state.
- Use URL state for intentionally shareable camera or filter state.
- Use browser storage or Dexie directly through cohesive feature code; do not require a
  repository object solely to access persistence.

Do not duplicate authoritative state across React, Zustand, TanStack Query, Dexie, or
the URL. Document a non-obvious owner. Business rules may be plain functions or cohesive
modules and do not belong in domain/application classes by default.

## Proportional diagnostics and privacy

Diagnostics, logging, health checks, redaction, support exports, schema versioning,
correlation IDs, and troubleshooting tools must be proportional to current product and
support needs. Do not require every feature or ordinary operation to participate in a
repository-wide diagnostics framework or emit start, completion, failure, cancellation,
correlation, and duration events.

Do not require support-bundle compatibility, diagnostics schema migrations, a
diagnostics CLI, a health-check framework, or bootstrap-level export recovery unless it
remains an explicit current product requirement for the changed scope. User-visible
error states do not require a parallel exported diagnostic representation. Focused
development diagnostics may use `console` directly when centralized structured logging
provides no concrete benefit; remove temporary noisy logging before handoff.

Preserve these privacy boundaries:

- Never log or export secrets, authorization headers, tokens, cookies, private user
  data, raw imported content, arbitrary query strings, local paths, or complete
  environment objects.
- Do not export raw GPX, full geometry, timestamps, descriptions, or filenames by
  default. Geometry export requires explicit user opt-in.
- Keep retained diagnostic data bounded when retention exists.
- Never upload diagnostics or telemetry automatically.
- Logging and diagnostics must not make the primary operation fail.

When changing currently implemented diagnostic export, redaction, or telemetry
boundaries, add focused tests proving private data is excluded.

## GUI and CSS

Material UI is the default for application chrome and controls.

- Use the shared theme for palette, typography, spacing, shape, breakpoints, and
  component defaults.
- Prefer MUI layout primitives and components over handwritten widgets.
- Use `sx` for small one-off details and CSS modules for map sizing or complex layout.
- Do not add Tailwind, Bootstrap, another design system, or another CSS-in-JS library.
- Maintain visible focus, keyboard access, labels, tooltips, contrast, and minimum hit
  areas.
- Keep the MVP theme deliberate and small.

## Map rules

Use [`docs/assets/map-style-reference.png`](docs/assets/map-style-reference.png) as the
standing visual reference. Keep roads, paths, and labels subdued over satellite imagery;
render user GPX/routes in legible medium blue with restrained light casing.

- Isolate MapLibre's complex imperative lifecycle and events within the map feature.
- Keep layer and source IDs centralized and typed.
- Use GeoJSON layers for many tracks and DOM/MUI markers only for a small number of
  interactive waypoints.
- Throttle high-frequency events before updating React or URL state.
- Do not recreate the map because unrelated panel state changed.
- Keep OSM attribution visible.
- Test required layer ordering and do not leak the native map object to unrelated code.

## GPX and catalog rules

- Never alter the original GPX collection in place during auditing or indexing.
- Generate published copies and metadata into a separate output directory.
- Validate coordinate ranges, segment sizes, XML structure, and resource limits.
- Keep catalog output deterministic and load full-resolution GPX only on demand.
- Version schemas or calculation policies when compatibility is a current requirement.
- Record rejected or suspicious tracks in a machine-readable validation report.
- Preserve attribution and provenance. Remove private metadata only under an explicit
  documented publishing policy.

## Testing

Automated tests are required by default for changed production behavior. Test through
the smallest meaningful public boundary. Prefer real plain functions and focused fakes
over preserving or creating production abstractions solely for testing.

Use focused unit, integration, and component coverage plus a small number of high-value
Chromium workflows. Coverage must not preserve redundant production layers or encourage
low-value tests. Tests should communicate one behavioral reason for failure and use
descriptive behavior names.

Do not require tests to inject clocks, ID generators, repositories, gateways, ports, or
other abstractions unless deterministic control is necessary. Do not require component
tests to mock application ports at a composition boundary.

### Test layout

- Keep all tests outside the production source tree.
- Use the existing top-level `test/` tree for unit, component, integration, fixtures,
  fakes, builders, helpers, and setup code.
- Preserve a recognizable mapping between production paths and corresponding test paths,
  without retaining obsolete architectural layer names.
- Keep browser workflows under `e2e/`.
- Production directories contain only runtime code and runtime assets.
- Do not create a broad internal test framework merely to reduce repetition.
- Test helpers must improve clarity rather than hide behavior behind abstraction.
- Report test LOC and test-file changes separately from production measurements.

### Verification cadence

Use focused development feedback and one appropriate final verification round. Do not
run the complete matrix after every edit, commit, review response, or follow-up.

During implementation:

1. Run the smallest relevant test name, file, or affected package.
2. Use focused Playwright scenarios only when browser behavior cannot be represented
   faithfully below E2E.
3. A complete Vitest unit suite is acceptable when it gives useful fast feedback, but do
   not repeat it when its inputs are unchanged.
4. Do not run coverage, complete Playwright, `pnpm check`, or another broad aggregate
   merely to create an intermediate commit.
5. Record commands and outcomes concisely for the handoff.

A successful check remains valid while its inputs and configuration are unchanged. A new
turn, commit, push, or existing CI result is not a reason to rerun it. After an edit,
rerun only invalidated checks.

When a test fails and code is changed to fix it, rerun only that failed test first. Do
not restart its complete unit, integration, or E2E suite after every fix. Run a broader
required check at most once after the focused test passes and all fixes that could
invalidate the broader result are complete.

### Documentation-only verification

When only Markdown or other non-executable documentation changes, do not run TypeScript,
ESLint, tests, coverage, Playwright, or builds. Run only the changed-document formatter,
documentation-boundary checks required here, and `git diff --check`.

Documentation-only pull requests must keep required CI conclusive while skipping
Playwright installation and execution. Classification must inspect the complete diff; do
not use top-level path filters that leave a required check pending.

### Test tools and boundaries

- Use React Testing Library queries by role, accessible name, and visible text.
- Use `user-event` for realistic interaction. Avoid MUI class, hook-internal, and large
  snapshot assertions.
- Use Mock Service Worker when HTTP-boundary control is useful and reset handlers after
  each test.
- Use `fake-indexeddb` for browser persistence behavior that needs IndexedDB control.
- Use checked-in synthetic GPX/STAC/catalog fixtures; never copy private tracks into
  tests.
- Cover realistic success and failure behavior appropriate to the changed scope.
- Use a small map fake for unit/component behavior and real MapLibre in Chromium only
  for behavior requiring WebGL or browser integration.
- Never use live third-party tiles or public data services for required CI checks.

### Managed Windows coverage timing

The maintainer commonly runs four to six agents on a medium-spec Windows workstation.
Treat CPU, memory, disk, and browser contention as normal local conditions rather than
assuming CI-like timing.

The final Vitest verification is `pnpm test:coverage` once. Its configuration includes
the normal unit/component suite and the integration suite, so it replaces both
`pnpm test` and `pnpm test:integration` in final verification. Do not run those three
commands sequentially. Keep `pnpm test` and `pnpm test:integration` for focused
development feedback before the final round.

Use a single 30-second per-test ceiling for local managed-Windows coverage work; the
previous ten-second ceiling is too aggressive under expected parallel-agent load. If one
coverage test exceeds the ceiling, rerun only that test once with the same ceiling. Do
not rerun the aggregate or increase the ceiling in steps. A timing-only failure in
unrelated work is not permission to edit committed timeout configuration.

### Command-wrapper timing

Command-wrapper limits control how long the agent waits for a process; they are not test
or assertion timeouts. Choose a realistic wrapper limit before launch:

| Local command scope                          | Wrapper limit |
| -------------------------------------------- | ------------- |
| Focused unit, component, or integration test | 5 minutes     |
| Full Vitest, coverage, integration, or build | 15 minutes    |
| Focused Playwright subset                    | 10 minutes    |
| Justified complete Playwright suite          | 30 minutes    |

These limits do not authorize broader test scope. A command returning no incremental
output is not evidence of a hang because some runners buffer output. If the shell tool
yields while the process is alive, keep polling or waiting for that process and provide
concise progress updates; do not launch a duplicate.

If a wrapper expires without a runner-reported test or assertion timeout, inspect the
existing process or terminal first. Continue waiting when it is still active. Never
restart the same command through a sequence of larger wrapper limits. If the process was
terminated by the wrapper, restart it at most once using the established limit from the
table and record that the first result was an orchestration timeout, not a test failure.

### Managed Chromium timing

Run at most one local Chromium worker per agent whenever other agent workstreams may be
active. Do not increase browser workers to shorten wall-clock time. Two local workers
are allowed only when the maintainer confirms the workstation is not shared with other
active test runs.

Preserve these Chromium limits under normal parallel-agent load:

| Context | Workers | Per-test ceiling | Assertion ceiling | Retries |
| ------- | ------- | ---------------- | ----------------- | ------- |
| Local   | 1       | 120 seconds      | 20 seconds        | None    |
| CI      | 1       | 120 seconds      | 20 seconds        | None    |

Preserve focused existing exceptions in `e2e/map-foundation.spec.ts`, terrain workflows,
and `e2e/satellite-imagery.spec.ts`. Do not replace observable synchronization with
sleeps, retries, or broad timeout increases.

An actual test timeout is not an instruction to ratchet limits upward. First determine
whether the expected observable state occurred and rerun only the failed test once under
the established local worker and timeout settings. During unrelated work, report a
repeatable timeout without changing timeout configuration. During an explicitly scoped
timeout fix, use measured runtime under expected workstation contention to choose one
documented ceiling, change it once, and validate only the affected test. Do not try a
series of guessed values.

### End-to-end and accessibility

Use Playwright Chromium for critical workflows and materially changed high-risk browser
boundaries. Minor fixes covered below E2E do not require a local E2E run or new
scenario. Use controlled fixtures and wait for observable application states. Retain
useful failure artifacts; do not solve flakes with arbitrary sleeps or unconditional
retries.

Before running the complete local E2E suite, record concrete evidence that the branch
changes behavior or shared runtime inputs exercised across that suite. Name the changed
behavior or input and the E2E specs that exercise it. If the diff does not justify every
spec, do not run the complete suite: run only the smallest relevant spec, project,
scenario, or grep-selected subset. If no E2E scenario exercises the changed behavior,
skip local E2E rather than using an unrelated workflow as evidence. CI may still run its
required complete suite independently.

Invoke a focused subset as
`pnpm.cmd e2e <spec-path> --grep '<exact-test-name-or-pattern>'`. The repository wrapper
forwards arguments to Playwright. Omit `--grep` when the complete named spec is the
smallest justified boundary; do not insert a standalone `--`.

If an E2E test fails, diagnose and fix it, then rerun only that test. Do not restart the
complete E2E suite after each failure. A complete suite may run once later only when it
was already justified by the branch-wide evidence and the fixes invalidate that broader
result.

This also applies when CI reports one failing E2E test while the other tests pass. After
the focused fix, run only the failed test locally; changing that spec or its exercised
code does not by itself justify rerunning the complete suite. Treat the other passing CI
results as valid unless the fix changes a shared runtime input that those specific tests
exercise.

Run axe for the application shell and critical workflows. Test keyboard focus, dialog
and drawer behavior, labels, and live status where relevant. Automated accessibility
checks supplement a brief manual keyboard pass for changed presentation behavior.

### Coverage

Keep reasonable global CI minimums:

- Statements, lines, and functions: 80%.
- Branches: 75%.

Do not impose directory- or architecture-specific thresholds. Exclude generated code,
static fixtures, type-only files, and trivial composition through centralized,
documented configuration. Never add meaningless assertions or coverage ignores merely to
meet a threshold.

### CI policy

GitHub Actions runs on every pull request and protected-branch push. Required checks
include frozen-lockfile installation, formatting, linting, type checking, suitable tests
with coverage, catalog fixture checks, production build, and Chromium/axe checks against
the built application. Documentation-only diffs report an explicit successful E2E skip.
Required checks block merging.

## Commands

Maintain the existing package scripts as the stable developer interface. Use only the
commands relevant to the changed scope and do not require a feature to exercise every
installed tool:

- `pnpm dev`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm test:watch`
- `pnpm test` for normal focused development feedback
- `pnpm test:integration` for focused integration development feedback
- `pnpm test:coverage` as the single final Vitest run covering both suites
- `pnpm e2e`
- `pnpm catalog:audit`
- `pnpm catalog:build`
- `pnpm diagnostics:inspect -- <bundle.json>` when current support-bundle work requires
  it
- `pnpm build`
- `pnpm check`

## Local servers and ports

Every worktree owns one explicit development-server port for its lifetime. Continuation
work reuses that port. Choose from `4173-4199` unless the task requires another range.
Do not assume Vite's default is available.

Coordinate parallel agents through ignored reservations under the main checkout at
`.codex-worktrees/.ports/<port>/owner.txt`. Resolve the main checkout through
`--git-common-dir`, not through the current worktree path. Before reserving a port:

1. Check existing reservations and reuse the current worktree's reservation.
2. Check listeners with `netstat -ano | Select-String -Pattern ':<port>\s'`.
3. Choose a port with neither a reservation nor a listener.
4. Create the port-number directory with
   `New-Item -ItemType Directory -ErrorAction Stop`. Directory creation is the atomic
   reservation; if it already exists, choose another port.
5. Write the current worktree's absolute path to `owner.txt`.

A new reservation can be created with:

```powershell
$port = 4173
$commonGitDir = (git rev-parse --path-format=absolute --git-common-dir).Trim()
$mainRoot = Split-Path $commonGitDir -Parent
$worktreeRoot = (git rev-parse --show-toplevel).Trim()
$reservationsRoot = Join-Path $mainRoot '.codex-worktrees\.ports'
$reservation = Join-Path $reservationsRoot $port

New-Item -ItemType Directory -Force -Path $reservationsRoot | Out-Null
if (netstat -ano | Select-String -Pattern ":$port\s") {
  throw "Port $port already has a listener"
}
New-Item -ItemType Directory -Path $reservation -ErrorAction Stop | Out-Null
Set-Content -LiteralPath (Join-Path $reservation 'owner.txt') -Value $worktreeRoot
```

Start Vite with `pnpm.cmd dev --port <port> --strictPort`. Do not insert a standalone
`--`: pnpm passes it to Vite as a positional argument and Vite may ignore the options
that follow. Set `E2E_PORT` to the same reserved port for Playwright. Never rely on
automatic port fallback, terminate an unknown listener, or reuse another worktree's
reservation. If strict startup reports a race, release only the reservation owned by the
current worktree, reserve another free port, and retry once.

Stop the worktree's server before releasing its reservation. Remove a reservation only
after reading `owner.txt`, resolving both paths, and confirming it belongs to the
current worktree. A reservation whose worktree is still listed by `git worktree list` is
not stale merely because it has no current listener.

## Environment troubleshooting and self-repair

Agent workflow instructions must improve when a reproducible repository-specific
environment problem is discovered. Do not leave the next agent to rediscover a known
PATH, worktree, dependency, port, shell, browser, or command-wrapper failure.

When the documented primary path fails:

1. Reproduce it with the smallest safe command and capture the exact symptom.
2. Determine whether the cause belongs to the repository/worktree, the managed shell, or
   the host machine. Do not hide a machine problem with a source-code change.
3. Apply the smallest safe fix to the current worktree or invocation.
4. Verify the fix from the affected worktree; use a disposable worktree when the problem
   concerns worktree creation or first-time setup.
5. Correct the root instruction in the existing relevant section of `AGENTS.md` so its
   primary command path works without encountering the same failure. Delete the broken
   command and superseded alternatives in the same edit.
6. Update `README.md` instead when the solution is a stable developer setup or operator
   workflow, and update the appropriate `docs/` file when it changes a lasting runtime
   or architecture contract.

Do not append a known-problems list, incident diary, fallback ladder, or collection of
commands to try. Those make every agent replay failures before finding the working path.
The authoritative section must contain one tested primary sequence and only unavoidable
decision branches. Do not include dates, task IDs, branch names, transient logs,
personal paths, secrets, or machine-only workarounds that other agents cannot use.

## Final verification and definition of done

Run one final verification round after implementation and expected quick follow-up
changes are complete.

1. Review the complete branch diff. Confirm behavior, tests, and permanent documentation
   agree; remove unnecessary files, branches, wrappers, adapters, interfaces, fallbacks,
   and defensive logic.
2. For documentation-only changes, run only the changed-document formatter, required
   documentation-boundary checks, and `git diff --check`.
3. For executable code, run `pnpm format:check`, `pnpm typecheck`, and `pnpm lint` once.
4. Run `pnpm test:coverage` once as the final Vitest verification. It includes normal
   and integration tests; do not also run `pnpm test` or `pnpm test:integration` in the
   final round.
5. Run catalog, diagnostics, or build commands only when scope requires them. If an
   aggregate includes a narrower required check, run only the aggregate.
6. Run Playwright only for a new or materially changed critical workflow or high-risk
   browser boundary. Map each changed behavior to the specs that exercise it and run the
   smallest relevant subset.
7. Run the complete local Playwright suite only when recorded evidence shows the diff
   affects behavior or shared runtime inputs exercised by every spec. When that evidence
   exists and CI-shaped local evidence is required, run it once on Windows PowerShell:

   ```powershell
   $env:CI='1'; pnpm e2e; Remove-Item Env:CI
   ```

8. If a test fails and is fixed, rerun only that test first. Do not restart a complete
   suite after each fix, including when the failure came from CI and the fix changes an
   E2E spec.
9. Visually verify changed loading, empty, error, partial, focus, and responsive states
   in current Chrome when presentation behavior changes.
10. Verify diagnostics or redaction only when the change affects those responsibilities.
11. Confirm no secret, private GPX metadata, generated debug file, or unrelated artifact
    is included.
12. Confirm non-obvious exported contracts and invariants have accurate compact
    comments.
13. Report handwritten production LOC added/removed; test LOC added/removed; production
    and test files added/removed/moved; runtime dependencies; new abstractions and their
    current justification; significant abstractions removed; and whether the result
    could be smaller without losing behavior or clarity.

Do not duplicate successful checks. If files change after the final round, rerun only
invalidated checks. Do not mark work complete while a required check fails; report an
external or pre-existing failure precisely and preserve unrelated user changes.
