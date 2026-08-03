# Plan

## Scope

Prevent the automatically restored latest local track from replacing the restored map camera. Explicit imports, saved-track opens, and elevation recalculation retain their existing fit behavior.

## Steps

1. Mark the one latest-track restoration in `TracksWorkspaceProvider` with a private ref and suppress only its map-fit request.
2. Clear the marker before each explicit active-track transition.
3. Add a shell-level regression test using `FakeMapFacade` and persisted local-track/camera data.
4. Run focused and final executable checks, review the branch diff, then obtain the required read-only review.

## Verification

- Focused `WorkspaceShell` regression test.
- Formatting, type checking, linting, and coverage.
