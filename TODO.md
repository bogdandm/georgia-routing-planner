# TODO list

## Satellite imagery

- Improve the browser-render fallback:
  - Evaluate a more reliable alternative imagery source.
  - Remove the fallback timeout.
  - Make fallback errors actionable.
  - Show render queue/progress.
  - Prevent fallback failures from blanking the map.
  - Unload the previous image immediately when changing scenes.
- Polish the acquisition calendar:
  - Prevent spinner-induced text shifts.
  - Allow month changes while results load.
  - Debounce metadata loading after a month change.
- Add saved-marker search once markers are available.

## Track catalog and GPX import

- Build the deterministic static GPX audit, index, previews, and duplicate report.
- Load the combined curated and browser-local track library.
- Add track search, visible-area filters, sorting, folders, tags, and compact metrics.
- Add track selection, map preview, details, elevation profile, and original download.
- Import GPX files with validation and preview before optional local retention.
- Include imported GPX track names in global search.

## Create GPX

- Add, move, remove, and reorder waypoints connected by straight geodesic segments.
- Edit waypoint names, notes, and display styles.
- Calculate distance and terrain-derived elevation metrics with a linked profile.
- Save and reopen drafts locally; export standards-compliant GPX files.

## Markers

- Create, edit, delete, search, sort, and group saved markers.
- Store marker icon, color, coordinates, elevation, and preferred map scale.
- Include marker names in global search.
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
