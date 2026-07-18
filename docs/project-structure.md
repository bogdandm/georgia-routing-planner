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
  UI --> UseCases["application use cases"]
  UseCases --> Domain["domain values and calculations"]
  UseCases --> Ports["application ports"]
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
Any domain layer added to the repository must remain independent of all browser
frameworks.

## Repository layout

```text
src/
  main.tsx                 browser entry and provider nesting
  bootstrap/               one-time dependency construction and React service context
  domain/satellite/        framework-free Sentinel values and geometry calculations
  application/satellite/   cancellable Sentinel search and availability orchestration
  application/ports/       framework-free catalog, viewport, diagnostics, and storage ports
  infrastructure/          HTTP, STAC, IndexedDB, clock, and ID implementations
  diagnostics/             bounded logging, redaction, health, snapshots, and export
  presentation/
    shell/                 feature rail, contextual sidebars, settings, and shell state
    map/                   map UI, pure style, facade, terrain, and camera coordination
    developer-tools/       local support and diagnostic UI
    theme/                 shared color tokens and Material UI theme
    styles/                application-level CSS
e2e/                       built-app Chromium workflows and provider fixtures
test/                      shared fixtures, fakes, setup, and repository-policy tests
tools/                     Node-only audit, diagnostics, and E2E runners
docs/                      maintainer-facing system documentation
```

The satellite domain contains readonly criteria, scene, coverage, and grouped-result
values plus deterministic Turf-backed coverage/edge calculations. The satellite
application layer validates submitted UTC criteria, enforces result bounds and product
separation, deduplicates scenes, and publishes correlated diagnostics through ports. It
does not import React, MapLibre, `ky`, or STAC JSON.

`infrastructure/stac/` owns the configured Earth Search adapter and Zod schemas. It
builds allowlisted STAC requests, validates all returned items before mapping them,
follows only same-origin POST pagination tokens within the configured cap, and converts
transport/schema failures to safe catalog errors. The composition root exposes the
adapter through `SatelliteCatalogGateway`; React never receives its `ky` client.

## Composition root

[`createRuntimeServices.ts`](../src/bootstrap/createRuntimeServices.ts) is the only
place that constructs runtime adapters. It creates the clock, ID generator, bounded
logger, Dexie database, camera repository, validated provider configuration, map
snapshot store, Sentinel query timeline store, HTTP client, health/diagnostics services,
and TanStack Query client.

[`main.tsx`](../src/main.tsx) installs global failure capture and nests providers in
this order: runtime services, TanStack Query, MUI theme, error boundary, workspace
shell. Tests replace the whole `RuntimeServices` object at the context boundary.

## State ownership

| State                                                     | Owner                               | Reason                                             |
| --------------------------------------------------------- | ----------------------------------- | -------------------------------------------------- |
| Dialogs, active rail section, developer flags             | Zustand `uiStore`                   | Cross-component, transient, serializable UI state  |
| Component transitions and messages                        | React component state               | Local rendering concern                            |
| Native map, listeners, camera snapshot, terrain operation | `MapLibreFacade`                    | Imperative MapLibre lifecycle stays isolated       |
| Settled camera                                            | Dexie through `MapCameraRepository` | Durable local state                                |
| Map diagnostic snapshot                                   | `MapDiagnosticsSnapshotStore`       | Serializable view shared by UI, health, and export |
| Current/last Sentinel step status and duration            | `SentinelQueryDiagnosticsStore`     | Memory-only live developer timeline                |
| Submitted Sentinel criteria and derived grouped results   | Application DTOs / TanStack Query   | Disposable, not persisted                          |

Do not mirror authoritative map or durable data into Zustand. React consumes the map's
serializable snapshot through `useSyncExternalStore`; unrelated UI state must not cause
the native map instance to be recreated.

`WorkspaceShell` only composes the persistent regions. `WorkspaceRail` owns the Tracks,
Satellite, Markers, and Layers destinations plus global Diagnostics and Settings
actions. `WorkspaceSidebar` owns each section's implemented, disabled, or empty
presentation. Create GPX is currently a disabled Tracks action and is never a rail
section. Shared palette values live in `appColors.ts` so the MUI theme and pure MapLibre
style use the same visual vocabulary without introducing a second styling system.

## Map boundary

[`MapWorkspace.tsx`](../src/presentation/map/MapWorkspace.tsx) translates React state
and user commands. [`MapLibreFacade.ts`](../src/presentation/map/MapLibreFacade.ts) owns
the native object, event listeners, terrain source, error aggregation, WebGL state, and
cleanup. [`mapStyleFactory.ts`](../src/presentation/map/mapStyleFactory.ts) is pure and
uses stable IDs from `mapIds.ts`. Any added feature layer must extend that typed
ordering instead of scattering MapLibre identifiers through presentation components.

The same facade implements the narrow `MapViewportProvider` capability. It returns a
copy of current WGS84 bounds and center or `null` before a native map exists. Sentinel
validation rejects non-finite, inverted, antimeridian-crossing, or center-mismatched
snapshots; exact bounds never enter the default diagnostics bundle.
