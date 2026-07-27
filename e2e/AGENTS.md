# AGENTS.md

## Scope

These instructions apply to Playwright Chromium and accessibility workflows under
`e2e/`. The root [`AGENTS.md`](../AGENTS.md) also applies. Unit, component, and
integration tests belong under `tests/` and follow
[`../tests/AGENTS.md`](../tests/AGENTS.md).

## Default execution model

Do not launch Playwright, Chromium, axe, or any local E2E command unless the maintainer
explicitly requests E2E work. Do not infer authorization from UI changes, browser risk,
test coverage gaps, final verification, or the fact that CI runs E2E. When no explicit
request exists, report local E2E as `Not applicable - not requested`.

Do not start Vite's live development server or a long-running preview server for E2E
work. Use `pnpm e2e`; the repository runner builds the application, starts a bounded
loopback Vite preview with `--strictPort`, waits for readiness, runs Playwright, and
stops the preview in `finally`.

The runner supplies the GitHub Pages base path and uses `E2E_PORT` only as a per-command
override; otherwise it defaults to `4173`. Do not probe for or select another port
automatically. The maintainer may supply `E2E_PORT` when an override is wanted. The
runner owns the preview lifecycle; do not keep it alive after the run or terminate an
unknown listener.

## Browser-testing policy

- Agents must not browse the application manually, repeatedly capture screenshots,
  inspect pages through trial and error, or use a live server as a substitute for
  understanding the code and writing tests.
- For visual feedback, prefer screenshots, recordings, and concrete observations
  supplied by the maintainer, plus deterministic Playwright evidence from the built app.
- When the maintainer supplies screenshots, treat them as the primary evidence for the
  reported visual issue. Update focused component coverage where practical; add or
  change E2E coverage only when the maintainer explicitly requests it.
- Prefer deterministic component tests and bounded Playwright scenarios over open-ended
  manual interaction.
- Do not run a browser merely to confirm that the page opens when existing build,
  component, or E2E coverage already proves the changed behavior.

## End-to-end and accessibility

After an explicit E2E request, use Playwright Chromium with controlled fixtures and wait
for observable application states. Retain useful failure artifacts; do not solve flakes
with arbitrary sleeps or unconditional retries.

Run the complete local E2E suite only when the maintainer explicitly requests the
complete suite. For any narrower or unspecified E2E request, run the smallest relevant
spec, project, scenario, or grep-selected subset. If no E2E scenario exercises the
requested behavior, report that limitation instead of running an unrelated workflow. CI
may still run its required complete suite independently.

Invoke a focused subset as `pnpm e2e <spec-path> --grep '<exact-test-name-or-pattern>'`.
The repository wrapper forwards arguments to Playwright. Omit `--grep` when the complete
named spec is the smallest justified boundary; do not insert a standalone `--`.

If an E2E test fails, diagnose and fix it, then rerun only that test. Do not restart the
complete E2E suite after each failure. Run the complete suite later only if the
maintainer explicitly requests it.

This also applies when CI reports one failing E2E test while the other tests pass. After
the focused fix, run only the failed test locally; changing that spec or its exercised
code does not by itself justify rerunning the complete suite. Treat the other passing CI
results as valid unless the fix changes a shared runtime input that those specific tests
exercise.

Run axe for the application shell and critical workflows. Test keyboard focus, dialog
and drawer behavior, labels, and live status where relevant. Encode keyboard and
accessibility behavior in Playwright where practical. Perform a manual keyboard pass
only when the maintainer explicitly requests live review.

## Managed Chromium timing

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

## Command-wrapper timing

| Local command scope                          | Wrapper limit |
| -------------------------------------------- | ------------- |
| Focused Playwright subset                    | 10 minutes    |
| Explicitly requested complete Playwright run | 30 minutes    |

Wrapper limits control how long the agent waits for the process; they are not Playwright
or assertion timeouts. Buffered output is not evidence of a hang. If the process is
still active, keep waiting and do not launch a duplicate. If the wrapper terminated the
process, restart it at most once with the established limit and record the first result
as an orchestration timeout.

## Final E2E verification

When the maintainer explicitly requests the complete suite or CI-shaped local E2E
evidence, run it once in WSL:

```bash
CI=1 pnpm e2e
```

Retain traces, screenshots, videos, and reports produced for failures. Do not add
sleeps, unconditional retries, broad timeout increases, or live third-party dependencies
to make a scenario pass. Report the exact focused or complete command and result in the
handoff.
