# TODO list

## Features

- General map
  - ~~Switch to 3D cause camera to be underground and then jump to random location. Move
    camera to required height before mode map mode switch~~

- Improve browser satellite render fallback
  - Try to find alternative/better datasource to avoid browser render
  - Remove timeout completly
  - Improve error message
  - Add progress/queue bar
  - Sometimes it makes whole map blank
  - Satelite image change should unload current image right away even after render swap

- URL sharing & state saving
  - ~~Disable persistent 3D mode~~
  - ~~Share only 2D as regular link~~
  - ~~For 3D mode share give another option in right click menu with camera position as
    url param~~
  - ~~Satellite iamge sharing shares wrong image~~
  - ~~Do not persist satellite in localstorage, only as url sharing param~~
  - ~~Shared satellite should open datallite pane with scene card right away~~

- GPX upload
  - Attach GPX track names to search

- Simple markers
  - Attach markers to search

- Calendar
  - Spinner causes text shift
  - Allow month switch during load
  - Add small pause after month switch before loading ssatellites meta data

## Other

- ~~Run full code review~~
- ~~Try to run agent to compact code and reduce slop~~

## Track catalog and GPX import

- Build the deterministic static GPX audit, index, previews, and duplicate report.
- Load the combined curated and browser-local track library.
- Add track search, visible-area filters, sorting, folders, tags, and compact metrics.
- Add track selection, map preview, details, elevation profile, and original download.
- Import GPX files with validation and preview before optional local retention.

## Create GPX

- Add, move, remove, and reorder waypoints connected by straight geodesic segments.
- Edit waypoint names, notes, and display styles.
- Calculate distance and terrain-derived elevation metrics with a linked profile.
- Save and reopen drafts locally; export standards-compliant GPX files.

## Markers

- Create, edit, delete, search, sort, and group saved markers.
- Store marker icon, color, coordinates, elevation, and preferred map scale.
- Use markers as Satellite targets or copy them into Create GPX.

## Layers

- Add reviewed drag-ordering controls without breaking typed layer bands or attribution.
- Defer custom layers and a generic layer editor until a dedicated design is approved.

## Quality and release

- Complete accessibility and keyboard-flow verification.
- Cover critical GPX, marker, imagery, persistence, and failure flows with automated tests.
- Profile Chrome performance and audit loading, empty, error, and offline states.
- Complete privacy, attribution, diagnostics-redaction, and GitHub Pages release checks.

## Deferred ideas

- Route comparison and overlap analysis.
- Photos and route notes.
- Offline regional packages.
- Accounts and shared links.
- Server-side Sentinel processing and additional band combinations.
- Automatic routing only if it becomes a demonstrated need.
