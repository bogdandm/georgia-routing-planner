# Follow-up plan

## Existing ownership to reuse

- `MapWorkspace` and `MapLibreFacade` own shared-camera restoration and terrain
  transitions.
- `mapShareUrl` owns URL serialization and parsing.
- `ShareMapDialog` owns share choices; `MapLibreLayerController` owns the transient
  selected scene.

## Replacement and removal

- Replace the oscillating shared-3D startup ordering with one explicit transition
  sequence.
- Replace unconditional scene inclusion in dialog links with a user-controlled,
  default-on choice.
- Remove any temporary merge compatibility logic once the final flow is covered.

## Commit sequence

1. Complete the `origin/main` merge, preserve flat-restart and transient-scene behavior,
   and fix browser-fallback readiness with focused coverage.
2. Stabilize shared 3D startup state and add focused component/browser coverage.
3. Add the satellite inclusion checkbox and URL behavior with focused dialog/share tests
   and documentation.
4. Run final verification, simplify the combined diff, update PR #32, and remove this
   plan.

No new production file, dependency, abstraction, or state owner is expected.
