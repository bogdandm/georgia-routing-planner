# AGENTS.md

## Scope

These instructions apply to unit, component, and integration tests under `tests/`. The
root [`AGENTS.md`](../AGENTS.md) also applies. Browser workflows belong under `e2e/` and
follow [`../e2e/AGENTS.md`](../e2e/AGENTS.md).

## Testing principles

Automated tests are required by default for changed production behavior. Test through
the smallest meaningful public boundary. Prefer real plain functions and focused fakes
over preserving or creating production abstractions solely for testing.

Use focused unit, integration, and component coverage. Tests should communicate one
behavioral reason for failure and use descriptive behavior names. Coverage must not
preserve redundant production layers or encourage low-value tests.

Use the existing runtime-service test support when a component crosses that boundary; do
not add clocks, ID generators, repositories, gateways, ports, or other production
abstractions solely to make a test injectable. Deterministic control is the reason for a
test seam, not architectural symmetry.

## Test layout

- Keep all tests outside the production source tree. ESLint rejects tests under `src/`.
- Use the top-level `tests/` tree for unit, component, integration, fixtures, fakes,
  builders, helpers, and setup code.
- Preserve a recognizable mapping between production paths and corresponding test paths,
  without retaining obsolete architectural layer names.
- Use `*.test.ts` or `*.test.tsx` for the normal Vitest suite and
  `*.integration.test.ts` or `*.integration.test.tsx` for the integration suite.
- Shared setup belongs in `tests/setup/`; focused reusable support belongs in
  `tests/helpers/`. Prefer the existing `@test` alias over deep relative imports.
- Do not create a broad internal test framework merely to reduce repetition. Test
  helpers must improve clarity rather than hide behavior behind abstraction.
- Report test LOC and test-file changes separately from production measurements.

## Test tools and boundaries

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

## Verification cadence

Use focused development feedback and one appropriate final verification round. Do not
run the complete matrix after every edit, commit, review response, or follow-up.

During implementation:

1. Run the smallest relevant test name or file.
2. A complete Vitest unit suite is acceptable when it gives useful fast feedback, but do
   not repeat it when its inputs are unchanged.
3. Do not run coverage, `pnpm check`, or another broad aggregate merely to create an
   intermediate commit.
4. Record commands and outcomes concisely for the handoff.

Run one unit or component file with `pnpm test <test-file>`, for example
`pnpm test tests/presentation/shell/WorkspaceShell.test.tsx`. The `test` script already
expands to `vitest run`; never append `-- --run`, `--run`, or a standalone `--`. Those
forms can prevent Vitest from applying the file filter and accidentally run the complete
suite. Before waiting for completion, inspect pnpm's echoed command and require it to
have the form `vitest run "<test-file>"`. Stop the command if the file argument is
missing. Use `-t '<exact-test-name-or-pattern>'` after the file path when one named test
is the smallest relevant scope.

Run one integration file with `pnpm test:integration <integration-test-file>`. Keep
integration filenames aligned with the configured `*.integration.test.{ts,tsx}` pattern.

A successful check remains valid while its inputs and configuration are unchanged. A new
turn, commit, push, or existing CI result is not a reason to rerun it. After an edit,
rerun only invalidated checks.

When a test fails and code is changed to fix it, rerun only that failed test first. Do
not restart its complete unit or integration suite after every fix. Run a broader
required check at most once after the focused test passes and all fixes that could
invalidate the broader result are complete.

## Coverage and final Vitest run

The final Vitest verification is `pnpm test:coverage` once. Its configuration includes
the normal unit/component suite and the integration suite, so it replaces both
`pnpm test` and `pnpm test:integration` in final verification. Do not run those three
commands sequentially. Keep `pnpm test` and `pnpm test:integration` for focused
development feedback before the final round.

Preserve the configured thresholds:

- Global statements, lines, and functions: 80%.
- Global branches: 75%.
- `src/application/**/*.ts` statements and lines: 90%; branches: 85%.
- `src/domain/**/*.ts` statements and lines: 90%; branches: 85%.

Do not weaken thresholds, add meaningless assertions, or add coverage ignores merely to
make a check pass. Exclusions belong in centralized configuration and require a concrete
reason.

## Shared-workstation timing

The maintainer commonly runs four to six agents on a shared medium-spec workstation.
Treat CPU, memory, disk, and browser contention as normal local conditions rather than
assuming CI-like timing.

Use a single 30-second per-test ceiling for local coverage work; the previous ten-second
ceiling is too aggressive under expected parallel-agent load. If one coverage test
exceeds the ceiling, rerun only that test once with the same ceiling. Do not rerun the
aggregate or increase the ceiling in steps. A timing-only failure in unrelated work is
not permission to edit committed timeout configuration.

## Command-wrapper timing

Command-wrapper limits control how long the agent waits for a process; they are not test
or assertion timeouts. Choose a realistic wrapper limit before launch:

| Local command scope                          | Wrapper limit |
| -------------------------------------------- | ------------- |
| Focused unit, component, or integration test | 5 minutes     |
| Full Vitest, coverage, or integration suite  | 15 minutes    |

These limits do not authorize broader test scope. A command returning no incremental
output is not evidence of a hang because some runners buffer output. If the shell tool
yields while the process is alive, keep waiting for that process and do not launch a
duplicate.

If a wrapper expires without a runner-reported test or assertion timeout, inspect the
existing process or terminal first. Continue waiting when it is still active. Never
restart the same command through a sequence of larger wrapper limits. If the process was
terminated by the wrapper, restart it at most once using the established limit and
record that the first result was an orchestration timeout, not a test failure.

The complete non-coverage suite can make the `WorkspaceShell` interactions
`navigates the contextual feature panels without covering the map` or
`collapses from the GR logo and restores from the remaining logo` exceed the five-second
default when many JSDOM workers contend on the shared workstation. If either exact test
passes under a focused run, validate the complete non-coverage suite once with:

```bash
pnpm test --maxWorkers=4
```

Keep the five-second per-test ceiling; do not add sleeps, remove assertions, or rerun
the same unconstrained suite.

## Definition of done for tests

- New or changed production behavior has focused coverage at the smallest meaningful
  boundary.
- Fixtures are synthetic and checked in; no private track or provider data is copied
  into tests.
- Failed focused tests are rerun before any invalidated broader check.
- `pnpm test:coverage` is run once in the final executable-code verification round,
  unless an already-run aggregate contains the same check.
- Commands and results are reported without duplicating successful runs.
