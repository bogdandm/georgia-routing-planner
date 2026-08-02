# AGENTS.md

## Scope

These instructions apply to Supabase Edge Function and Postgres tests under
`supabase/tests/`. The root [`AGENTS.md`](../../AGENTS.md) and production Supabase
[`AGENTS.md`](../AGENTS.md) also apply. Production functions, migrations, and
configuration must remain outside this directory.

## Test placement and boundaries

- Keep all Supabase-specific tests under `supabase/tests/`; do not colocate `*.test.ts`
  with deployable Edge Function source or put test-only SQL in `migrations/`.
- Mirror the production responsibility: Edge Function tests belong under
  `tests/functions/<function-name>/`; Postgres and pgTAP tests belong under
  `tests/database/`.
- Deno tests may fake HTTP, Storage, and RPC boundaries, but they must exercise the real
  Edge Function control flow through imports from `supabase/functions/`.
- Database behavior—RLS, grants, stored-function state transitions, accounting, and
  deterministic races—must be tested against local Postgres, not simulated by a fake RPC
  test.
- Use synthetic UUIDs, metadata, and payloads. Never use a maintainer account, private
  track, publishable key, service-role key, database password, PAT, refresh token, or
  other live credential.
- Test observable security and lifecycle contracts rather than migration source text or
  implementation details. Every regression test must fail for a plausible authorization,
  accounting, revision, cleanup, or concurrency bug.

## Edge Function tests

Use the pinned `supabase/functions/deno.json` and `deno.lock`. Do not add Node-only test
APIs, unpinned imports, network access, filesystem-wide permissions, sleeps, or timing-
based race assertions. Model concurrent behavior with deterministic deferred operations
or explicit call ordering.

Use the repository scripts from the current worktree:

- `pnpm supabase:functions:check` checks production entry points and their Deno tests;
- `pnpm supabase:functions:test` runs isolated Edge Function tests with `--no-prompt`.

When an Edge Function RPC contract changes, also run the focused database test covering
that contract once the local database harness exists. Do not run unrelated browser,
Vitest, or Playwright suites for a Supabase-only change.

## Postgres tests

Start each SQL test in a transaction and roll it back. Reset role and JWT claims between
actors, use schema-qualified names, and avoid order dependence. Cover both allowed and
denied operations for `anon`, `authenticated`, and `service_role` only where that role
has an explicit contract.

Use deterministic interleavings for reservation, finalization, release, expiry,
deletion, and purge races; never rely on wall-clock sleeps. Verify both the returned
outcome and unchanged rows/counters after rejection. A migration change requires a clean
bootstrap from an empty local database plus focused regression coverage for every
changed RLS, privilege, concurrency, quota, or lifecycle invariant.

Run local Supabase/Postgres commands only when the changed scope and repository scripts
require them. Always stop a locally started stack during cleanup, including on failure.
Never connect these tests to the live project unless the maintainer explicitly requests
the dedicated live-test workflow.
