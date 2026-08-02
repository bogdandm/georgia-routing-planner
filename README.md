_This project was built 100% with LLMs._

# Trail Planner

[Open Trail Planner](https://trail-planner.bogdandm.com/)

Trail Planner is a local-first web application for exploring hiking maps, inspecting
terrain and satellite imagery, and working with personal tracks.

![Track details with an elevation profile and grade-colored route](./docs/assets/track-details.png)

![Sentinel-2 satellite imagery over 3D terrain](./docs/assets/satellite-imagery.png)

## Features

- Explore a detailed hiking map in 2D or 3D with terrain, contours, and relief.
- Search for places or coordinates and inspect recent Sentinel-2 satellite imagery.
- Import GPX, FIT, and KML tracks directly in the browser.
- Review distance, duration, speed, ascent, descent, elevation profile, and route
  grades.
- Save, search, favorite, rename, reopen, delete, and download personal tracks.
- Choose which tracks, imagery, terrain, contours, and map details are visible.
- Optionally sign in and explicitly enable synchronization across devices.

## Tracks

Drop a GPX, FIT, or KML file into the Tracks workspace or choose it from disk. Trail
Planner validates the file, displays the route on the map, and opens a detailed preview
before anything is saved.

Saved tracks remain available after reopening the application. They can be searched,
favorited, renamed, deleted, or downloaded as GPX or KML. Independent track segments,
available elevation, and aligned timestamps are preserved during export.

When usable elevation is available, the track view adds:

- Distance, recorded duration, average speed, ascent, and descent.
- An interactive elevation profile linked to the highlighted map position.
- A climbs-and-descents breakdown.
- Grade colors along non-flat parts of the route.

## Maps and satellite imagery

The map combines hiking-focused OpenStreetMap data with relief, elevation contours, and
optional 3D terrain. Place and coordinate search moves directly to an area of interest,
while layer controls adjust map detail, terrain overlays, satellite imagery, and active
track visibility.

The Satellite workspace searches recent Sentinel-2 scenes around the selected point.
Results show acquisition time, cloud cover, and scene coverage before true-color imagery
is applied to the map. The selected imagery remains aligned with terrain in both 2D and
3D.

## Local-first data

Imported files are parsed in the browser, and their original bytes are discarded after
processing. Saved tracks and map preferences use browser storage and remain usable
without an account.

Cross-device synchronization is optional and disabled by default. It starts only after
the user signs in and explicitly enables **Sync across devices**. Local track operations
remain available when synchronization is disabled or temporarily unavailable. Trail
Planner does not upload diagnostics or usage telemetry automatically.

## Developer overview

Trail Planner is a static TypeScript application built with React, Vite, Material UI,
and MapLibre GL JS. IndexedDB stores local tracks and preferences. Public map, terrain,
geocoding, and satellite services provide geographic data; Supabase supports the
optional account and synchronization workflow.

The codebase separates the React presentation layer from application workflows, domain
calculations, and browser or network adapters. Runtime dependencies are assembled in one
composition root so tests can replace storage, HTTP, map, and clock boundaries without
changing feature components.

The production build is deployed to GitHub Pages. No always-running application server
is required for the map and local track workflows.

### Local development

Prerequisites:

- Node.js `24.14.0`.
- pnpm `11.9.0`.
- Current stable desktop Google Chrome.

Install dependencies and start the development server:

```shell
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite. The default map, terrain, geocoding, and satellite
providers do not require credentials.

### Project structure

| Path                  | Responsibility                                       |
| --------------------- | ---------------------------------------------------- |
| `src/presentation/`   | React workspace, feature panels, and map rendering.  |
| `src/application/`    | User workflows and external-service contracts.       |
| `src/domain/`         | Track parsing, calculations, and domain rules.       |
| `src/infrastructure/` | Browser storage, HTTP, workers, and provider access. |
| `src/bootstrap/`      | Runtime dependency composition.                      |

### Development commands

| Command                 | Purpose                                    |
| ----------------------- | ------------------------------------------ |
| `pnpm dev`              | Start the local development server.        |
| `pnpm format:check`     | Check formatting.                          |
| `pnpm typecheck`        | Run strict TypeScript checks.              |
| `pnpm lint`             | Run ESLint.                                |
| `pnpm test`             | Run unit and component tests.              |
| `pnpm test:integration` | Run adapter and persistence tests.         |
| `pnpm build`            | Create the production build.               |
| `pnpm check`            | Run the complete non-browser verification. |

The complete command list is maintained in [`package.json`](./package.json).

### Documentation

- [Project documentation index](./docs/README.md)
- [Architecture and project structure](./docs/project-structure.md)
- [Runtime flows](./docs/runtime-flows.md)
- [Map providers and attribution](./docs/map-providers.md)
