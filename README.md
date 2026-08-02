_This project was built 100% with LLMs._

# Trail Planner

[Open Trail Planner](https://trail-planner.bogdandm.com/)

Trail Planner is a local-first map workspace for hiking tracks, terrain, and satellite
imagery.

![Track details with an elevation profile and grade-colored route](./docs/assets/track-details.png)

![Sentinel-2 satellite imagery over 3D terrain](./docs/assets/satellite-imagery.png)

## Features

- Explore a detailed hiking map in 2D or 3D with terrain, contours, and relief.
- Search for places or coordinates and inspect recent Sentinel-2 satellite imagery.
- Import GPX, FIT, and KML tracks directly in the browser.
- Review distance, duration, speed, ascent, descent, elevation profile, and route
  grades.
- Save, search, favorite, rename, reopen, and download personal tracks as GPX or KML.
- Choose which tracks, imagery, terrain, contours, and map details are visible.
- Optionally sign in and explicitly enable synchronization across devices.

Imported files are processed locally. Personal tracks stay in the browser unless the
user explicitly enables synchronization.

## Run locally

```shell
pnpm install --frozen-lockfile
pnpm dev
```

Open the URL printed by Vite in current desktop Google Chrome.
