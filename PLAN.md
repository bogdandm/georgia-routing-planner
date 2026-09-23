# CI test split

## Scope

- Correct PR #159 diagnostics source expectations independently.
- Split `WorkspaceShell` tests into shardable files with a shared test-only harness.
- Replace the flaky Mosaic scenario with three focused state-transition tests.
- Split CI verification jobs while preserving aggregate `verify` and merged coverage
  enforcement.

## Commit sequence

1. `test(shell): split WorkspaceShell coverage suite`
2. `ci(tests): split verification into bounded test jobs`

## Verification

- Compare the Vitest contract list before and after the test split.
- Run focused Mosaic and each split WorkspaceShell file.
- Run all coverage shards, merge reports, and prove the threshold environment gate.
- Check Playwright shard discovery without launching browsers.
- Run formatting, typecheck, lint, and repository audit.
