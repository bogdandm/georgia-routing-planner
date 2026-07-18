# Project structure

## System shape

The application is a static React client. GitHub Pages serves the build; the browser
talks directly to public map providers and stores durable local state in IndexedDB.
There is no application server, account, secret-bearing frontend configuration, or
automatic telemetry upload.

```mermaid
flowchart LR
  Browser["Chrome"] --> Main["main.tsx"]
  Main --> Bootstrap["bootstrap composition root"]
  Bootstrap --> UI["presentation"]
  UI --> Ports["application ports"]
  Infra["infrastructure adapters"] --> Ports
  UI --> MapLibre["MapLibre facade"]
  Infra --> IndexedDB["IndexedDB / Dexie"]
  MapLibre --> Providers["Vector and terrain providers"]
  UI --> Diagnostics["diagnostics"]
  Infra --> Diagnostics
  MapLibre --> Diagnostics
```

Dependencies point toward contracts: presentation and infrastructure may depend on
application ports; application code must not depend on React, MapLibre, Dexie, or MUI.
The future domain layer will remain independent of all browser frameworks.

## Repository layout

```text
src/
  main.tsx                 browser entry and provider nesting
  bootstrap/               one-time dependency construction and React service context
  application/ports/       framework-free capability contracts and shared values
  infrastructure/          HTTP, IndexedDB, clock, and ID implementations
  diagnostics/             bounded logging, redaction, health, snapshots, and export
  presentation/
    shell/                 desktop workbench and settings
    map/                   map UI, pure style, facade, terrain, and camera coordination
    developer-tools/       local support and diagnostic UI
    theme/                 Material UI theme
    styles/                application-level CSS
e2e/                       built-app Chromium workflows and provider fixtures
test/                      shared fixtures, fakes, setup, and repository-policy tests
tools/                     Node-only audit, diagnostics, and E2E runners
docs/                      maintainer-facing system documentation
```

`domain/` and most application use-case folders are intentionally absent until later
product phases add tracks, planning, elevation, and imagery behavior.

## Composition root

[`createRuntimeServices.ts`](../src/bootstrap/createRuntimeServices.ts) is the only
place that constructs runtime adapters. It creates the clock, ID generator, bounded
logger, Dexie database, camera repository, validated provider configuration, map
snapshot store, HTTP client, health/diagnostics services, and TanStack Query client.

[`main.tsx`](../src/main.tsx) installs global failure capture and nests providers in
this order: runtime services, TanStack Query, MUI theme, error boundary, workspace
shell. Tests replace the whole `RuntimeServices` object at the context boundary.

## State ownership

| State                                                     | Owner                               | Reason                                             |
| --------------------------------------------------------- | ----------------------------------- | -------------------------------------------------- |
| Dialogs, selected workspace tab, developer flags          | Zustand `uiStore`                   | Cross-component, transient, serializable UI state  |
| Component transitions and messages                        | React component state               | Local rendering concern                            |
| Native map, listeners, camera snapshot, terrain operation | `MapLibreFacade`                    | Imperative MapLibre lifecycle stays isolated       |
| Settled camera                                            | Dexie through `MapCameraRepository` | Durable local state                                |
| Map diagnostic snapshot                                   | `MapDiagnosticsSnapshotStore`       | Serializable view shared by UI, health, and export |
| Future remote/static data                                 | TanStack Query                      | Request and cache lifecycle                        |
| Future business invariants                                | Domain/application classes          | Framework-independent behavior                     |

Do not mirror authoritative map or durable data into Zustand. React consumes the map's
serializable snapshot through `useSyncExternalStore`; unrelated UI state must not cause
the native map instance to be recreated.

## Map boundary

[`MapWorkspace.tsx`](../src/presentation/map/MapWorkspace.tsx) translates React state
and user commands. [`MapLibreFacade.ts`](../src/presentation/map/MapLibreFacade.ts) owns
the native object, event listeners, terrain source, error aggregation, WebGL state, and
cleanup. [`mapStyleFactory.ts`](../src/presentation/map/mapStyleFactory.ts) is pure and
uses stable IDs from `mapIds.ts` so future imagery, tracks, plans, and waypoints can be
inserted without accidental layer reordering.
