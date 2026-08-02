# Trail Planner

[Open Trail Planner](https://trail-planner.bogdandm.com/)

Trail Planner is a local-first web application for planning hiking trips by exploring
maps, inspecting terrain and satellite imagery, and working with personal tracks.
Automatic routing along trails or roads is not currently available.

_This project was built 100% with LLMs._

![Track details with an elevation profile and grade-colored route](./docs/assets/3.png)

![Sentinel-2 satellite imagery over 3D terrain](./docs/assets/2.png)

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
favorited, renamed, deleted, or downloaded as GPX or KML.

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

Imported tracks, saved tracks, and map preferences use browser storage and remain
available without an account.

Cross-device synchronization is optional and disabled by default. It starts only after
the user signs in and explicitly enables **Sync across devices**. Local track operations
remain available when synchronization is disabled or temporarily unavailable. Trail
Planner does not upload diagnostics or usage telemetry automatically.

## Limitations

- No automatic routing along trails or roads.
- No offline map-region downloads.
- Map, terrain, geocoding, and imagery features depend on public providers.
- Current desktop Google Chrome is the primary supported browser.

## Developer overview

Trail Planner is a static TypeScript application built with React, Vite, Material UI,
and MapLibre GL JS. IndexedDB stores local tracks and preferences, while Supabase
supports optional accounts and synchronization. The production build is deployed to
GitHub Pages, and the core map and local track workflows do not require an
always-running application server.

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

Account and synchronization features require:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Without these variables, account and synchronization features remain unavailable while
local track functionality continues to work.

### Development commands

| Command                 | Purpose                                    |
| ----------------------- | ------------------------------------------ |
| `pnpm dev`              | Start the local development server.        |
| `pnpm test`             | Run unit and component tests.              |
| `pnpm test:integration` | Run adapter and persistence tests.         |
| `pnpm e2e`              | Run browser and accessibility checks.      |
| `pnpm build`            | Create the production build.               |
| `pnpm check`            | Run the complete non-browser verification. |

The complete command list is maintained in [`package.json`](./package.json).

### Documentation

- [Project documentation index](./docs/README.md)
- [Features and workspace UX](./docs/features.md)
- [UI design guidelines](./docs/ui-design.md)
- [Architecture and project structure](./docs/project-structure.md)
- [Map providers and attribution](./docs/map-providers.md)
- [Agent workflow and engineering conventions](./AGENTS.md)
