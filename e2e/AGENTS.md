# AGENTS.md

## Scope

These instructions apply to Playwright Chromium and accessibility workflows under
`e2e/`. The root [`AGENTS.md`](../AGENTS.md) also applies. Unit, component, and
integration tests belong under `tests/` and follow
[`../tests/AGENTS.md`](../tests/AGENTS.md).

## Default execution model

Local E2E is opt-in: do not launch Playwright, Chromium, axe, or `pnpm e2e` without an
explicit request; otherwise report `Not applicable - not requested`. The runner owns
build, bounded preview on `4173`, readiness, and cleanup. Use `E2E_PORT` only when the
maintainer supplies it.

## Browser-testing policy

- Do not browse manually, capture screenshots repeatedly, inspect by trial and error, or
  open a browser merely to confirm that the page loads.
- Treat maintainer-supplied visual evidence as primary and prefer component coverage.
- Add or change E2E only when explicitly requested.

## End-to-end and accessibility

After a request, run its stated scope; when unspecified, run the smallest relevant
subset. Run the complete suite only when explicitly requested. If no scenario covers the
request, report that instead of running unrelated E2E. Use controlled fixtures,
observable waits, and useful failure artifacts; never add sleeps or unconditional
retries.

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
