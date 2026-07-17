# Phase 0 Plan: Basic Project Infrastructure

## 1. Purpose and relationship to the roadmap

This is the detailed implementation plan for Phase 0 of
[TOP_LVL_PLAN.md](./TOP_LVL_PLAN.md). It converts the architectural decisions into
a working, tested React repository that later map, catalog, planning, elevation,
and Sentinel features can extend safely.

This phase establishes infrastructure and one thin vertical smoke path. It does
not implement the product features from later phases.

## 2. Phase status and Git boundary

- Status: **planned; not implemented**.
- Planning branch: `feature/basic-project-infrastructure-plan`.
- Implementation must occur on a feature branch, normally
  `feature/basic-project-infrastructure`.
- `main` must remain unchanged until the user explicitly approves a verified
  feature-branch state.
- No remote, push, pull request, deployment, or branch-protection change is part
  of this phase unless separately requested.

If implementation starts from this planning branch, either continue on it with a
clearly documented commit history or create the dedicated implementation branch
before changing application files. Do not switch to `main` to begin work.

## 3. Required outcome

At completion, a clean checkout can install one frozen dependency graph and run a
documented command set that:

- Starts a React + TypeScript development server.
- Renders a Material UI map-workbench shell in current Chrome.
- Mounts a minimal network-free MapLibre canvas to prove WebGL integration.
- Constructs application services through an explicit composition root.
- Provides typed configuration, HTTP, query, local-state, persistence, and
  diagnostics foundations.
- Captures startup and React failures and exports a sanitized diagnostics bundle.
- Runs automatic unit, component, infrastructure, accessibility, and Chromium
  smoke tests.
- Builds static GitHub Pages-compatible assets.
- Runs the same required checks automatically in GitHub Actions.

## 4. Fixed decisions

These decisions are already approved by the top-level plan and should not be
reopened during Phase 0 without a concrete blocker:

- React functional components with strict TypeScript.
- Vite static build; no SSR framework.
- Material UI, MUI Icons, and MUI X Charts for the GUI system.
- MapLibre GL JS through `react-map-gl/maplibre`.
- Clean architecture with class-based domain/application services and explicit
  constructor injection.
- TanStack Query for remote/static query state.
- `ky` for HTTP transport and Zod for runtime validation.
- Zustand for transient cross-feature UI state only.
- Dexie for durable IndexedDB data.
- Vitest, React Testing Library, Mock Service Worker, `fake-indexeddb`, Playwright
  Chromium, and axe-based accessibility checks.
- pnpm with a committed lockfile.
- Current stable desktop Chrome as the supported runtime.
- Production-safe developer mode with no automatic telemetry upload.

Versions must be current stable and mutually compatible at implementation time,
then pinned by `pnpm-lock.yaml`. Do not use `latest` ranges, prereleases, or
unreviewed upgrade automation during the initial scaffold.

## 5. Phase non-goals

- Real OSM tiles or a hiking overlay style.
- Sentinel/STAC search or imagery.
- Production elevation sampling.
- GPX catalog ingestion or the 1,200-track dataset.
- GPX import/export behavior beyond optional placeholder interfaces.
- Manual waypoint planning.
- Automatic routing.
- Accounts, synchronization, backend services, OAuth, or telemetry SaaS.
- Mobile/Safari support.
- Final branding, custom design system, or complex animations.
- Deploying an unapproved branch to the public GitHub Pages site.

## 6. Target repository structure

Create files only when they contain real configuration, code, tests, or
documentation. Do not add empty directories merely to match this diagram.

```text
georgia-routing-planner/
  .github/
    workflows/
      checks.yml
      pages.yml                 # deploys only approved main
  e2e/
    app-shell.spec.ts
    diagnostics.spec.ts
  public/
    fixtures/
      map-style.json            # local network-free test style if useful
  src/
    app/
      bootstrap/
        createApplicationServices.ts
        ApplicationServicesContext.tsx
        buildInfo.ts
      theme/
        createAppTheme.ts
      App.tsx
      AppErrorBoundary.tsx
    application/
      ports/
        DiagnosticLogger.ts
        IdGenerator.ts
        Clock.ts
    diagnostics/
      logging/
      redaction/
      snapshots/
      export/
    infrastructure/
      http/
        createHttpClient.ts
      persistence/
        AppDatabase.ts
      runtime/
        BrowserClock.ts
        CryptoIdGenerator.ts
    features/
      app-shell/
      map/
      developer-tools/
    shared/
      errors/
      types/
      ui/
    main.tsx
    vite-env.d.ts
  test/
    fixtures/
    setup/
      vitest.setup.ts
      mswServer.ts
  tools/
    diagnostics/
      inspectDiagnostics.ts
  .editorconfig
  .gitattributes
  .gitignore
  eslint.config.js
  index.html
  package.json
  playwright.config.ts
  pnpm-lock.yaml
  prettier.config.js
  tsconfig.json
  tsconfig.app.json
  tsconfig.node.json
  vite.config.ts
  vitest.config.ts
  README.md
  TOP_LVL_PLAN.md
  PLAN.md
  AGENTS.md
```

Exact file grouping may change if the implementation reveals a clearer boundary,
but the dependency direction from AGENTS.md must remain intact.

## 7. Work packages

### P0.1 Repository hygiene and runtime declaration

Create:

- `.gitignore` for Node, Vite, Playwright, coverage, local environment files,
  generated catalog/diagnostic artifacts, and IDE noise.
- `.gitattributes` that normalizes text files to LF while allowing Windows scripts
  to opt into CRLF if any are later required.
- `.editorconfig` for UTF-8, final newlines, spaces, and consistent indentation.
- A Node version declaration using one conventional file supported by local/CI
  tooling, pinned to the selected active LTS line.
- `package.json` with `private: true`, ESM mode, package-manager declaration,
  engine constraint, repository scripts, and no publish intent.

Verification:

- Git sees no dependency cache, build output, test artifact, or local secret.
- Node and pnpm version errors are understandable.
- Line endings remain stable on Windows and CI.

### P0.2 Scaffold React, TypeScript, and Vite without overwriting documents

Add the minimum Vite React files manually or scaffold into a temporary directory
and apply the result selectively. Never run a generator that overwrites README,
plans, AGENTS.md, Git history, or unrelated files.

Configure:

- React Fast Refresh using the standard supported Vite React plugin.
- Static asset base derived safely for local development and GitHub Pages.
- Build-time constants for app version, commit hash, build timestamp, and build
  mode. Missing Git metadata must degrade safely in local archives/builds.
- Source aliases only where they improve imports without hiding layer boundaries.
- Production sourcemap policy: generate private CI/debug artifacts if useful, but
  do not expose sources unintentionally on a public deployment.

Verification:

- `pnpm dev` renders the application.
- A production build loads correctly from `/` and a simulated repository subpath.
- Direct reload does not request assets from the domain root accidentally.

### P0.3 Configure strict TypeScript

Use project references or separated app/Node configurations where necessary.
Enable at minimum:

- `strict`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noImplicitOverride`
- `noFallthroughCasesInSwitch`
- `noImplicitReturns`
- `noUnusedLocals`
- `noUnusedParameters`, with a documented convention for intentional omissions
- modern DOM and ECMAScript libraries compatible with current Chrome

Keep Node-only tools out of the browser compilation graph. Keep test globals
explicit rather than leaking them into production types.

Verification:

- `pnpm typecheck` checks application, tests, configuration, and tools as intended.
- A deliberate `any`, unchecked index access, and invalid optional assignment each
  fail in a temporary verification or dedicated configuration test.

### P0.4 Configure formatting and linting

Add flat ESLint configuration with TypeScript and React rules. Include:

- React Hooks correctness.
- No floating promises.
- Safe async/promise use.
- No explicit `any`.
- Import/type-import consistency.
- Unused code checks compatible with the TypeScript compiler.
- Focused architectural import restrictions so `domain` cannot import UI,
  infrastructure, storage, or map packages.

Use Prettier for formatting and ESLint for code quality; do not make them fight
over formatting rules.

Verification:

- `pnpm lint` and `pnpm format:check` run without modifying files.
- `pnpm format` is the explicit write command.
- Architectural dependency violations fail lint or a small boundary test.

### P0.5 Install the minimum foundation dependencies

Initial runtime dependencies:

- `react`, `react-dom`
- `@mui/material`, `@mui/icons-material`, Emotion dependencies
- `@mui/x-charts`
- `maplibre-gl`, `react-map-gl`
- `@tanstack/react-query`
- `ky`, `zod`, `zustand`, `dexie`

Initial development dependencies:

- TypeScript and React types
- Vite and its supported React plugin
- ESLint/type-aware React/TypeScript plugins
- Prettier
- Vitest, V8 coverage, jsdom
- React Testing Library, jest-dom, and user-event
- Mock Service Worker and `fake-indexeddb`
- Playwright test and axe Playwright integration

Turf and GPX/XML packages may be deferred until the first phase that uses them;
do not install unused production packages merely because they appear in the
top-level stack.

Verification:

- The frozen lockfile reproduces installation.
- `pnpm audit` findings are reviewed rather than hidden.
- The production bundle contains only imports actually used by the shell.

### P0.6 Establish the composition root and architecture boundary

Implement a small explicit composition root that constructs:

- Build/runtime configuration.
- `DiagnosticLogger` and sinks.
- `Clock` and `IdGenerator` adapters.
- One `ky` HTTP client factory without a real provider dependency.
- TanStack `QueryClient` with deliberate retry/staleness defaults.
- Dexie `AppDatabase` with an initial versioned schema.
- Any small application services required by the shell.

Expose dependencies through a typed `ApplicationServicesContext`. Fail fast with
a useful typed error if a feature uses services outside the provider.

Do not add a dependency-injection framework, service locator, `Utils` class, or a
single giant `AppService`.

Verification:

- Unit tests construct use cases/services with fakes and no React.
- A component test replaces the whole service bundle at the provider boundary.
- Domain/application modules do not import React or browser adapters.

### P0.7 Build the Material UI application shell

Create a desktop-first shell containing:

- Top `AppBar` with project name and disabled/placeholder global actions.
- Left drawer with `Tracks`, `Plan`, and `Satellite` tabs and intentional empty
  states.
- Main map area.
- Collapsible bottom elevation placeholder.
- Settings entry.
- Hidden developer drawer activated through settings and a documented URL flag.

Define one MUI theme with:

- Palette, typography, spacing, shape, elevation, and component defaults.
- System or bundled-font strategy with no dependency on Google Fonts.
- Visible keyboard focus and adequate contrast.
- A restrained earth/satellite color direction without custom branding work.

Use MUI layout primitives first. Limit CSS modules to the viewport shell and map
sizing. Do not introduce Tailwind or another component/design library.

Verification:

- Shell fits the supported Chrome viewport without accidental page scrolling.
- Drawer, tabs, developer-mode activation, and elevation collapse work by mouse
  and keyboard.
- Component/axe tests find no known serious accessibility violations.

### P0.8 Add a network-free MapLibre smoke canvas

Render MapLibre through `react-map-gl/maplibre` using an inline or local empty
style with a background layer only. It must make no public tile request.

Isolate the map behind the first small facade/adapter and capture:

- Load/ready/error lifecycle.
- WebGL availability and context loss where supported.
- Camera snapshot for diagnostics.
- Clean unmount/listener removal.

This smoke canvas proves dependency compatibility and lifecycle handling. Real
OSM sources, terrain, styles, and map interactions belong to Phase 1.

Verification:

- The canvas renders in current Chrome and the Playwright environment.
- A forced map/WebGL failure produces a stable UI error and diagnostic event.
- Component tests can replace the map with a fake instead of requiring WebGL.

### P0.9 Establish persistence and state ownership

Create:

- An initial Dexie database class with explicit version 1 schema for settings and
  bounded diagnostics only, unless a simpler schema is justified.
- A tiny Zustand store for UI state such as active tab and drawer state.
- QueryClient configuration for remote state, even though no production remote
  query is made yet.

Keep one authoritative owner per state value. Do not store domain class instances
or MapLibre objects in Zustand, TanStack Query, or Dexie.

Verification:

- Dexie repository/migration tests run with `fake-indexeddb`.
- UI preferences survive a reload where specified.
- Invalid persisted settings are validated, repaired/reset safely, and logged.

### P0.10 Implement the diagnostics foundation

Implement the minimum useful production diagnostics slice from the top-level plan:

- Typed structured event schema and stable event names.
- Bounded in-memory ring buffer.
- Console sink active only through the logging abstraction.
- Central allowlist redaction.
- Startup milestones and build/runtime snapshot.
- Global `error` and `unhandledrejection` capture.
- React error boundary.
- Bootstrap fallback that works if React cannot mount.
- Developer drawer overview/log/health skeleton.
- JSON diagnostics export with reproduction notes.
- URL activation that still works when normal persisted settings are broken.

Add non-destructive Phase 0 health checks for:

- JavaScript/browser capability.
- WebGL/MapLibre initialization.
- IndexedDB read/write and storage estimate.
- Build/configuration consistency.

Remote provider, catalog, elevation, and terrain health checks are added in their
own phases.

Verification:

- Fake secrets, headers, coordinates, filenames, and GPX-like metadata are removed
  from exported bundles.
- A thrown component error and unhandled rejection appear in the bundle.
- Ring-buffer and persisted diagnostic limits are tested.
- Logging failure cannot crash the primary application.

### P0.11 Implement the diagnostics inspection CLI

Create a Node-only CLI that:

- Accepts one diagnostics JSON path.
- Parses it as untrusted data with a versioned Zod schema.
- Never evaluates or dynamically imports bundle content.
- Prints build/browser summary, fatal/recent errors, failed health checks, slow
  operations, map state, storage state, and likely next investigation areas.
- Omits fields classified as sensitive.
- Returns a non-zero exit code for invalid/unsupported input with an actionable
  message.

Verification:

- Golden valid, redacted, malformed, and unsupported-version fixtures.
- `pnpm diagnostics:inspect -- <fixture>` produces deterministic output.
- A bundle exported by the browser can be consumed by the CLI in an end-to-end
  test.

### P0.12 Configure automatic tests

Configure Vitest projects or clear test groups for:

- Pure unit tests in a Node environment.
- React component tests in jsdom.
- Infrastructure tests with Mock Service Worker and `fake-indexeddb`.

Configure Playwright Chromium against the production Vite build. Initial required
browser flows:

- Open at a GitHub Pages-like subpath and reload directly.
- Render shell and network-free map canvas.
- Change tabs and collapse/expand panels.
- Activate developer mode by settings and URL.
- Trigger a controlled component failure and export diagnostics.
- Run axe checks on shell, settings, and developer drawer.

Enforce the coverage thresholds from TOP_LVL_PLAN.md. Keep synthetic fixtures free
of real personal tracks and external-network dependencies.

Verification:

- `pnpm test`, `pnpm test:integration`, `pnpm test:coverage`, and `pnpm e2e` pass.
- Tests fail if external network access is attempted unexpectedly.
- Playwright retains trace/screenshot/video artifacts on failure only.

### P0.13 Define stable package commands

Implement the command interface required by AGENTS.md:

```text
pnpm dev
pnpm typecheck
pnpm lint
pnpm format
pnpm format:check
pnpm test:watch
pnpm test
pnpm test:integration
pnpm test:coverage
pnpm e2e
pnpm diagnostics:inspect -- <bundle.json>
pnpm build
pnpm check
```

Catalog commands may initially return a clear not-yet-implemented message or be
added in Phase 2; do not create misleading scripts that appear to audit real data.

`pnpm check` must be non-destructive and suitable for CI. Document whether it
includes Playwright or whether CI calls `pnpm e2e` separately after `pnpm build`.

### P0.14 Add GitHub Actions checks and guarded Pages workflow

`checks.yml` runs on pull requests and relevant branch pushes:

1. Checkout.
2. Install the pinned Node LTS and pnpm.
3. `pnpm install --frozen-lockfile`.
4. Format, lint, and type checks.
5. Unit/component/infrastructure tests with enforced coverage.
6. Production build using a Pages-like base path.
7. Install/use pinned Playwright Chromium and run browser/axe tests.
8. Upload bounded failure artifacts.

Use dependency caching supplied by the pnpm/Node actions without caching
`node_modules` as an opaque mutable artifact.

`pages.yml` must:

- Be incapable of deploying feature branches to the production Pages environment.
- Build/deploy only an approved `main` commit, or be manually disabled until the
  repository remote and approval workflow exist.
- Re-run or depend on required checks for the exact commit.
- Upload only the static `dist` output.
- Run a post-deployment bootstrap smoke check when a real Pages URL is configured.

No actual deployment is authorized during Phase 0 planning or implementation
unless the user separately requests it.

### P0.15 Documentation and backend-developer handoff

Update README with:

- Prerequisites and exact setup commands.
- How React components, hooks, use cases, services, Query, Zustand, and Dexie divide
  responsibilities.
- How to run each test layer.
- How to activate developer mode and inspect a bundle.
- How GitHub Pages base paths work.
- The current feature branch and approval status only when appropriate; avoid
  stale permanent branch text in product documentation.

Add a short architecture decision record only for a decision that is not already
captured clearly in README, TOP_LVL_PLAN, PLAN, or AGENTS.

## 8. Expected dependency boundaries

The following imports are allowed:

```text
features/presentation -> application ports/use cases, shared UI, map adapter API
application           -> domain, application ports
domain                -> domain only
infrastructure        -> domain/application ports plus external libraries
bootstrap             -> every layer solely to construct the application
diagnostics           -> its contracts and safe browser/runtime adapters
tools                  -> Node-only schemas/utilities, never imported by browser
```

Disallowed examples:

- Domain importing React, MUI, Dexie, `ky`, Zustand, TanStack Query, or MapLibre.
- JSX directly calling `fetch`/`ky` or Dexie.
- Zustand actions implementing distance/elevation/catalog business rules.
- Infrastructure importing feature components.
- Browser code importing Node-only tools.
- Arbitrary global singletons imported from everywhere.

## 9. Test and acceptance matrix

| Capability | Unit/component evidence | Browser/CI evidence |
| --- | --- | --- |
| Strict configuration | Configuration/type fixtures fail correctly | CI typecheck required |
| Architecture boundary | ESLint or boundary test | CI lint required |
| Application shell | RTL behavior and axe tests | Chromium shell/reload flow |
| Local map smoke | Fake facade component states | Real network-free MapLibre canvas |
| Composition root | Fakes replace ports cleanly | App boots from production bundle |
| Dexie | `fake-indexeddb` schema/migration tests | Settings survive reload |
| HTTP foundation | MSW success/error/cancel tests | No unexpected external requests |
| Diagnostics | schema, redaction, bounds, error tests | Record/export controlled failure |
| Diagnostics CLI | valid/invalid/golden CLI tests | Browser bundle accepted by CLI |
| GitHub Pages path | Vite config tests where useful | Build served and reloaded under subpath |
| Accessibility | RTL/axe targeted checks | Playwright axe plus keyboard smoke |

## 10. Coverage and quality gates

Required before Phase 0 can be presented for approval:

- Global statements/lines/functions at least 80%.
- Global branches at least 75%.
- Domain/application statements/lines at least 90%.
- Domain/application branches at least 85%.
- Zero TypeScript errors.
- Zero ESLint errors.
- Formatting check passes.
- Unit, component, infrastructure, and Playwright suites pass.
- Production build passes from a clean frozen-lockfile install.
- No required test contacts a public map/data provider.
- Dependency audit has no ignored unexplained critical finding.
- Diagnostics redaction fixtures prove secrets and personal geometry are absent.

If a check is temporarily blocked by an external tool defect, document the exact
failure, evidence, containment, and follow-up. Do not silently remove the gate.

## 11. Planned commit sequence

Commits remain on the implementation feature branch. A reasonable sequence is:

1. `chore: scaffold React TypeScript toolchain`
2. `chore: configure lint formatting and test foundations`
3. `feat: add application shell and composition root`
4. `feat: add network-free MapLibre smoke canvas`
5. `feat: add local persistence and state foundations`
6. `feat: add structured diagnostics and bootstrap fallback`
7. `test: add browser accessibility and diagnostics coverage`
8. `ci: add required checks and guarded Pages workflow`
9. `docs: document infrastructure and development workflow`

Combine or split commits when it improves reviewability. Do not commit broken
intermediate states merely to match this list. Every commit intended for review
should compile or clearly state why it is an intentionally preparatory commit.

## 12. Approval checklist

Before asking for approval to integrate into `main`, report:

- Active feature branch and commit list.
- Files and architecture introduced.
- Dependency summary and audit result.
- Exact commands run and their results.
- Coverage summary.
- Playwright/axe result and any retained artifact.
- Production bundle size summary.
- Diagnostics export/inspection demonstration.
- Known limitations, deferred work, and any deviation from this plan.
- Confirmation that no public deployment, secret, or personal GPX data was added.

Remain on the feature branch after presenting the result. Update `main` only after
the user explicitly approves integration.

## 13. Definition of Phase 0 done

Phase 0 is done only when:

1. The repository is reproducible from a clean checkout with the frozen lockfile.
2. The documented command interface exists and required checks pass.
3. The Material UI workbench shell and local MapLibre smoke canvas run in current
   Chrome.
4. Clean architecture boundaries and constructor-based service composition are
   demonstrated by real code and tests.
5. Persistence, HTTP, remote-query, and transient-state foundations exist without
   absorbing business logic.
6. Developer mode captures startup/component failures and exports a correctly
   redacted bundle readable by the CLI.
7. GitHub Actions defines protected automatic checks and the Pages workflow cannot
   publish a feature branch.
8. Documentation is sufficient for a backend developer to run, test, navigate,
   and diagnose the frontend.
9. The verified state is committed on a feature branch and presented for user
   approval.
10. No commit or merge has been made to `main` without that approval.
