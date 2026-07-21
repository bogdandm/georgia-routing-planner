# Repository simplification pass 2

## Commit sequence

1. **Own bootstrap error capture at the bootstrap boundary**
   - Reuse `runApplicationBootstrap` as the existing owner of pre-React setup,
     failure fallback, and runtime disposal.
   - Remove the single-consumer `installGlobalErrorCapture.ts` forwarding module.
   - Preserve window error and unhandled-rejection capture, while ensuring a cleanup
     exception cannot skip runtime disposal or the independent bootstrap fallback.

2. **Colocate the orbit pivot with middle-mouse camera control**
   - Reuse `MiddleMouseCameraControl` as the lifecycle owner for its pivot marker.
   - Remove the single-consumer `MapLibreOrbitPivotIndicator.ts` module while retaining
     the existing structural test seam and deterministic marker cleanup.

## Complexity budget

- Production files removed or replaced: two.
- New production files, abstractions, state owners, and dependencies: none.
- Existing external boundaries retained: MapLibre facade/layer controller, worker RPC,
  provider gateways, persistence, diagnostics, and structural test ports.

## Verification

- Run the focused bootstrap and middle-mouse tests after their respective commits.
- After both commits stabilize, review the complete branch diff and run one final
  `format:check`, `typecheck`, `lint`, and `test:coverage` round.
- Playwright is not applicable because these changes preserve presentation behavior and
  do not alter a critical browser workflow or shared runtime input exercised by E2E.
