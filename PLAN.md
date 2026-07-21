# Repository simplification pass 3

## Commit sequence

1. **Narrow runtime and viewport contracts**
   - Reuse `createRuntimeServices`, `MapViewportSnapshotStore`, `MapFacade`, and the
     existing serializable viewport types.
   - Stop exposing the internal `ky` client through the React service context; it has no
     production consumer. Keep direct access only in the test composition helper.
   - Remove the unused `MapViewportProvider` interface/file and colocate its data types
     with the map types that consume them. Update stale structure documentation exposed
     by earlier refactors.
   - No new production file, abstraction, state owner, or dependency is required.
   - Verify with focused viewport, facade, bootstrap, and type/lint checks.

2. **Remove duplicate satellite request tracking**
   - Reuse the existing `request` AbortController ref as the synchronous in-flight guard
     for archive-month loading.
   - Remove the parallel `loadingMonthsRef` set and its duplicate mutation/cleanup paths
     while preserving React-owned loaded-month and display state.
   - No new production file, abstraction, state owner, or dependency is required.
   - Verify with the satellite shell component tests plus type/lint checks.

3. **Remove fake-only contour assertions**
   - Delete the test file that constructs only a fake `ContourTileGenerator` and asserts
     strings hard-coded by that fake. Production contour behavior remains covered by the
     controller/backend/style suites.
   - No production behavior or coverage boundary is replaced.
   - Verify with the focused map test suite and repository audit.

## Final verification

- Review the complete diff for dead exports, duplicate state, stale documentation, and
  incomplete async cleanup.
- Confirm no test files exist under `src/` and stable documentation has no delivery
  progress terminology.
- Run `pnpm.cmd check`, integration tests, and Chromium E2E on reserved port `5187`.
- Remove this plan, commit the cleanup, push the existing branch, update PR #39, and
  recheck GitHub mergeability without waiting for CI.
