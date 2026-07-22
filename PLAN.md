# Local GPX follow-up plan

## Existing code to reuse

- Keep `TracksWorkspaceProvider` as the single owner of import, preview, persistence,
  naming, and active-track state.
- Keep the existing `LocalTrackSummary.sourceFilename` IndexedDB contract; expose and
  verify it rather than adding a duplicate persisted field or database migration.
- Keep `findDominantSummit` as the representative-point policy and adjust its bounded
  selection rule using the supplied Shkedi-Likheti track.
- Keep `GpxValidationWarning` as the parser's structured warning source and render its
  existing message and point/segment context in the details pane.

## Replaced or removed code

- Remove the header `TrackImportAction` and disabled `Create GPX` action.
- Remove whole-workspace drag state, drag handlers, and `TrackDropOverlay` from
  `WorkspaceShell`.
- Replace those entry points with one contained import/drop zone inside the Tracks tab.
- Restore the workspace tab order from `origin/main`: Satellite, Layers, Markers,
  Tracks, with Tracks enabled in the existing final slot.

## Complexity constraints

- Add no production files, runtime dependencies, state owners, or generic abstractions.
- Keep drag/drop event handling local to the import zone.
- Prefer explicit warning rendering and existing typed values over new adapters.

## Commit sequence

1. `feat(tracks): refine local import workspace`
   - Restore main's tab order, remove Create GPX and the separate import action, add a
     contained drag/drop zone with its own browse button, pin the compact local-storage
     notice to the panel bottom, right-align Discard/Save, show the stored source
     filename, and render technical validation-warning details.
   - Update focused component and browser coverage for the revised interaction.
2. `fix(tracks): use the highest interior naming point`
   - Reproduce the supplied Shkedi-Likheti elevation profile, adjust summit selection so
     Kelida Pass's highest interior point is used, and retain conservative fallbacks when
     elevation coverage or interior geometry is insufficient.
3. Final verification and cleanup
   - Merge the latest `origin/main`, resolve only invalidated UI tests, run focused and
     repository-required checks, remove this `PLAN.md`, push, and refresh the existing
     ready pull request.
