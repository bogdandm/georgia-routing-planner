# Local GPX tracks: import, rendering, and simple storage

## Outcome

Deliver the first useful local-tracks workflow without the curated catalog or personal
organization features:

- import one GPX file through a file picker or by dropping it anywhere over the
  application workspace;
- preview its geometry immediately as a bright-blue track and inspect parsed metadata;
- fit every newly imported or selected saved track into the visible map area;
- choose an editable name, optionally generate an English place-based alternative, and
  explicitly save the track to browser-local IndexedDB;
- reopen, rename, search, sort, and delete saved tracks from a simple Tracks list;
- control all imported-track visibility and opacity through one persistent Layers entry;
- warn before browser unload while an imported preview has not been saved or discarded.

The persistent map remains visible. Tracks owns the list and import workflow, while a
selected or newly imported track opens the adjacent details pane shown by the reviewed
Penpot interaction hierarchy. The Penpot colors and its catalog/folder/tag controls are
not implementation requirements for this workstream.

## Scope boundaries

### Included

- Browser-local GPX import, preview, explicit retention, rename, and deletion.
- One imported file at a time. A GPX may contain multiple tracks, track segments, or
  routes internally.
- Full-workspace drag target regardless of the active rail section or whether a sidebar
  or details pane is open.
- Simple local track list sorted by English-locale name, with case-insensitive
  search-as-you-type over the saved display name.
- Bright-blue rendering for the active imported preview and saved local tracks.
- One `Imported tracks` Layers checkbox and one global opacity slider. The values are
  shared by every local track and saved locally, never stored per track.
- A `New track` import/details state, editable name, optional generated English name,
  explicit Save and Discard actions, and browser-unload protection while unsaved.
- Track details, including saved date, recorded time when present, distance, integral
  elevation gain/loss, elevation range, point/segment counts, bounds, start/end,
  retained standard GPX metadata, validation warnings, and generated place fields.
- Reuse of the configured OpenStreetMap/Nominatim provider for optional English naming.
  The user accepts that the bounded representative coordinates used for naming are sent
  to that provider.

### Explicitly excluded

- The repository-backed curated/global track catalog and its build pipeline.
- Categories, folders, nesting, manual ordering, tags, filters, viewport search, or
  advanced sort modes.
- Batch import, directory import, archive import, cloud synchronization, accounts, or
  automatic upload.
- Per-track color, visibility, opacity, or arbitrary MapLibre layer ordering.
- Track editing, point editing, route repair, automatic routing, GPX export, or Create
  GPX behavior.
- Terrain resampling, an elevation chart, moving-time detection, pause detection, or
  speed analysis.
- Displaying arbitrary GPX extension XML. Unknown extensions remain untrusted input and
  are ignored unless a reviewed field is added deliberately.

## Confirmed product decisions

1. A local track is persisted only after an explicit Save action. Until then it remains
   an in-memory preview and triggers the native browser leave-site confirmation on
   reload, close, or external navigation. Switching rail sections does not discard it.
2. Saved tracks support basic catalog manipulation: reopen/select, rename, and delete.
   Delete requires confirmation and atomically removes both summary and content.
3. Naming may contact the configured OpenStreetMap geocoder. A provider failure never
   blocks preview or save.
4. An existing GPX name is never automatically replaced by a generated name. The
   naming area shows the editable saved-name field and, separately, the generated
   English candidate with an `Apply generated name` button.
5. Multiple tracks/segments/routes are handled best-effort. Rendering preserves
   discontinuities, metrics are aggregated without connecting gaps, and details show a
   compact warning when the rendered geometry has multiple independent segments.
6. Files with multiple independent segments use a single closest/relevant POI candidate
   instead of the `Middle: Start -> End` pattern.

## Evidence from the supplied GPX samples

The implementation and parser tests must include sanitized fixtures derived from the
two supplied files, not the personal originals themselves.

| Sample | Observed structure | Planning consequence |
| --- | --- | --- |
| `Mon 13 Jul 2026.gpx` | GPX 1.1 from OsmAnd; metadata and track name `Mon 13 Jul 2026`; one track segment with 786 elevation-bearing points; no point timestamps; one separate sparse two-point route | Preserve the date-like embedded name, report time as unavailable, prefer detailed track geometry, and do not append the route or double-count distance |
| `Планиника.gpx` | GPX 1.1 from OsmAnd; metadata name `Sun 10 May 2026`; UTF-8 track name `Планиника`; one track segment with 892 elevation-bearing points; no point timestamps; one separate sparse six-point route | Prefer the track-level UTF-8 name over metadata/filename, preserve Unicode, and do not append the sparse route |

The sample originals stay outside the repository and must never be committed.

## User experience and interaction contract

### Import entry points and drag overlay

- Enable the Tracks rail destination and the existing Import GPX action. Keep Create
  GPX disabled and clearly out of scope.
- Register drag-enter/over/leave/drop handling once at the workspace shell boundary so
  every map, panel, dialog backdrop, and active rail section participates in the same
  drop target.
- While a file is dragged over the application, show one accessible overlay explaining
  that a GPX file can be dropped. Do not mount duplicate handlers in feature panels.
- Accept one regular file with a `.gpx` extension. Reject zero files, multiple files,
  directories, and non-GPX input with a concise recoverable message. File content still
  passes XML/GPX validation; extension and MIME type are not trusted validation.
- If another import begins while an unsaved preview exists, ask the user to keep the
  current preview or discard it before reading the replacement.

### New-track preview and naming

- Open the Tracks workspace and adjacent details pane as soon as import begins. The pane
  title is `New track`; parsing has explicit loading, success-with-warnings, and failure
  states.
- After parsing, fit the map to validated bounds once and render the preview. Use padding
  for the open sidebar/details surfaces so the complete track is visible in the
  unobscured map area. Subsequent user camera movement is respected.
- Prefill the editable name using the first non-empty value in this order:
  1. selected detailed track `<name>`;
  2. GPX metadata `<name>`;
  3. selected route `<name>` when the file has route geometry only;
  4. the Unicode filename stem;
  5. `New track`.
- Do not classify date-like, numeric, or generic source names as invalid. The app does
  not silently guess that the user's existing name is bad.
- Begin optional place-name generation after geometry is available. Show its loading or
  unavailable state separately from the editable primary name. Saving remains available
  while naming is pending or failed.
- Display a generated English candidate in a read-only secondary field. The user must
  press `Apply generated name` to copy it into the editable primary field; editing the
  primary field afterward remains possible.
- Trim the saved name, reject an empty result, and do not require uniqueness. Stable ID,
  not name, owns track identity.

### Saved track list and details

- Load only local track summaries for the list. Sort with a stable English-locale,
  case-insensitive name comparison and use stable ID as the final tie-break.
- Filter during typing against the display name without a submit button. An empty query
  restores the complete name-sorted list.
- Selecting a result renders it, opens its details, and fits its complete validated
  bounds into the unobscured map area. The list item shows name plus compact distance
  and recorded duration when available.
- Rename updates the stored summary immediately after validation. Delete uses a focused
  confirmation naming the track; after deletion, remove its map geometry and clear the
  selection if it was active.
- Details distinguish `Recorded time` from `Saved`. Missing timestamps render
  `Unavailable`, never `0:00` and never a value inferred from a date-like name.
- Show the multiple-segment warning only when normalized rendering has more than one
  independent LineString. Explain that lines are not joined and totals exclude gaps.

### Layers behavior

- Add one provider-neutral `Imported tracks` group or entry to Layers with:
  - a visibility checkbox affecting the preview and all saved local tracks;
  - one 0–100% opacity slider affecting every imported-track line together.
- Keep the bright-blue base color in the semantic map palette. Opacity multiplies that
  base paint value and does not change the stored geometry.
- Persist visibility and opacity in the existing map-layer preference record with a
  compatible default migration. New installs default to visible and 100% opacity.
- Track geometry stays in the existing typed track band: above OSM reference data and
  below planning waypoints/markers and interaction highlights.

## GPX parsing and normalized geometry

### Boundary and limits

- Parse GPX as untrusted XML in a cohesive GPX module shared by browser import and the
  future catalog tool. Use browser XML APIs only behind the parsing boundary; no React,
  Dexie, MapLibre, or provider calls belong in the parser.
- Reject DTD/entity input and apply explicit limits for bytes, XML depth, track/route
  count, segment count, point count, warning count, text length, and finite coordinate
  ranges. Abort parsing/import when the owning preview is discarded or replaced.
- Support GPX 1.0 and 1.1 namespace variants and preserve valid UTF-8 text. Ignore
  unknown elements and extensions after applying resource limits.
- Return stable parse failures and bounded warnings without raw XML, full file paths, or
  complete personal geometry in messages or diagnostics.

### Geometry precedence

Normalize the file into independent ordered segments with this precedence:

1. If any valid `<trkseg>` contains at least two valid `<trkpt>` values, render all such
   track segments and do not append `<rte>` geometry. This prevents OsmAnd's sparse
   companion route from duplicating an already detailed track.
2. Otherwise, render each `<rte>` containing at least two valid `<rtept>` values as an
   independent segment.
3. Top-level waypoints are metadata only and never connected into a track.
4. A file with no renderable segment fails preview with a clear unsupported/empty GPX
   error.

Invalid points can be skipped only when the remaining segment is still renderable and a
warning identifies the bounded segment/point location. Never draw a line between two
independent segments, tracks, or routes.

### Standard metadata retained

Store a bounded, explicit metadata projection rather than an arbitrary XML mirror:

- GPX version and creator;
- metadata name, description, time, keywords, author name, copyright label/year, and
  validated HTTP(S) links when present;
- selected track or route names, descriptions, comments, source, type, and number;
- source filename, point count, independent segment count, and validation warnings;
- first and last recorded timestamps and elapsed duration when timestamp ordering is
  valid.

Do not retain arbitrary extension payloads as metadata. The original GPX blob is kept
only after Save so later export or reprocessing can preserve information outside the
current projection.

## One-time derived values

Compute all summary metrics once during import, before save, and persist them with
explicit calculation-policy versions. Opening, searching, sorting, rendering, or
changing opacity must not recalculate them.

### Coordinates and bounds

- `startCoordinate`: first valid point of the first rendered segment.
- `endCoordinate`: last valid point of the last rendered segment.
- `bounds`: antimeridian-aware bounds over every rendered point.
- `center`: derived from the bounds for display/future indexing; it is not substituted
  for the start or end.
- Preserve start, end, and bounds in the lightweight summary for future spatial search.

### Distance

- Sum geodesic distance between consecutive points inside each independent segment.
- Never add distance across a segment boundary.
- Store metres plus `distanceAlgorithmVersion`; UI conversion and rounding are
  presentation only.

### Recorded time

- Use the earliest first-point and latest last-point timestamps only when valid parsed
  timestamps establish non-negative ordering across the rendered content.
- Store recorded start, recorded end, and elapsed seconds. Do not calculate moving time
  in this feature.
- When timestamps are partial, contradictory, or absent, keep recorded duration absent
  and add a bounded warning when the input was inconsistent.

### Elevation

- Use valid elevations embedded in the rendered GPX points; do not contact the terrain
  provider during import.
- For every consecutive pair with two valid elevations inside one segment, add a
  positive delta to ascent or the absolute negative delta to descent. Never use only
  `last - first`, bridge missing-elevation points, or cross a segment boundary.
- Store ascent, descent, minimum, and maximum metres only when supported by the available
  samples, together with `elevationSource: "gpx"` and
  `elevationAlgorithmVersion`.
- Keep the calculation as a small versioned pure function with focused fixtures. Any
  later smoothing/noise policy requires a version bump and explicit migration or
  reprocessing decision; it is not silently introduced here.

## English POI naming

### Provider reuse

- Extend the existing place-search owner and configured Nominatim adapter with a bounded
  reverse/nearby-name operation; do not introduce a second HTTP client, geocoder, retry
  loop, or generic location service.
- Send `Accept-Language: en`, use the existing application-wide pacing, timeout,
  cancellation, validation, caching, and safe error translation, and make at most three
  sequential provider requests for one import.
- Treat settlement, named natural/hiking features, and administrative places as useful
  naming candidates. Store provider-independent candidate fields rather than raw
  Nominatim responses.

### Representative points and generated text

- For one continuous non-loop segment, query:
  - `startPoi` at the first coordinate;
  - `middlePoi` at the coordinate nearest 50% of cumulative segment distance;
  - `endPoi` at the last coordinate.
- Define a loop through a versioned pure policy: start-to-end distance is at most the
  greater of 100 metres or 1% of total distance. A loop uses the most relevant single
  candidate rather than pretending it has different endpoints.
- For multiple independent segments, choose up to three representative points spread
  over rendered cumulative distance, retain the best result as `fallbackPoi`, and
  generate one place name. Do not imply continuity with an arrow-form name.
- For a non-loop with three useful distinct English labels, generate
  `Middle: Start -> End`. Collapse repeated labels and degrade to the best available
  meaningful combination; if the result would be empty or misleading, expose no
  generated candidate.
- Relevance and deterministic tie-breaking belong in a pure selection function covered
  by tests. Prefer a named specific hiking/natural feature or settlement over a broad
  administrative label, then provider distance, then stable English lexical order.

Persist `startPoi`, `middlePoi`, `endPoi`, and `fallbackPoi` as separate optional summary
fields. Each stored candidate contains the English display label, category/kind,
matched coordinate, distance when the provider supplies it, and lookup timestamp. Also
persist the generated candidate text even when the user keeps the original name so
details can explain or reapply the result without another network request.

## Persistence model and ownership

### Existing code to reuse and extend

- `AppDatabase` remains the only Dexie database and migration owner.
- The current runtime composition and `RuntimeServicesProvider` construct and expose the
  parser/import repository/geocoder dependencies once.
- `WorkspaceShell`, `WorkspaceSidebar`, and the existing adjacent-pane layout own the
  drag target, Tracks list, and details placement respectively.
- `MapLibreFacade`, `MapLibreLayerController`, stable map IDs, map-layer store, and the
  semantic palette own source/layer lifecycle, ordering, selection, and paint updates.
- The existing place-search gateway, Nominatim adapter, configured HTTP client, clock,
  ID generator, diagnostic logger, and map-layer preferences are extended at their
  current ownership boundaries.
- Existing Turf packages may be used only where they already provide the exact
  geospatial primitive needed. Prefer a small pure haversine/cumulative-distance
  function over adding a utility package.

### New records

Advance the existing Dexie schema with two coordinated tables:

- `localTracks`: lightweight validated summaries indexed by stable ID, normalized name,
  and saved date; includes metrics and their versions, geometry facts, standard metadata,
  warnings, generated name, and separate POI fields.
- `localTrackContents`: same stable track ID as primary key; contains the original GPX
  Blob and normalized MultiLineString/segment geometry used for rendering.

Save summary and content in one Dexie transaction. Rename changes only the validated
summary. Delete removes both records in one transaction. A content row without a
summary is never listable, and repository reads treat a missing content row as a bounded
storage-integrity error rather than crashing the workspace.

Do not add folder, placement, category, tag, or catalog tables in this schema version.
Do not store MapLibre objects, React state, request state, or mutable class instances in
Dexie or Zustand.

### New production code justification

Keep new production files to the smallest cohesive set; final names may follow existing
repository conventions:

| Responsibility | Why a new owner is necessary | Immediate consumers |
| --- | --- | --- |
| GPX parser and normalized GPX types | Untrusted XML parsing, limits, metadata projection, and geometry precedence are a real external-data boundary shared with the later static catalog tool | Import workflow and parser tests |
| Pure track metric/name policies | Versioned distance, elevation, loop, representative-point, and generated-name behavior must be independent of React, MapLibre, and Dexie | Import workflow and unit tests |
| Local track repository contract/implementation | Atomic summary/content persistence and schema-integrity handling are durable storage behavior, not component state | Tracks workflow and database tests |
| Tracks feature UI/state | Import preview lifecycle, list query, selection, naming, leave guard, and details form one feature-owned workflow | Workspace sidebar/details composition |

Before implementation, verify whether these responsibilities can be kept in existing
files or combined without creating oversized modules. Do not add forwarding services,
one-method adapters, repository factories, a second global store, or a general-purpose
catalog abstraction for future curated tracks.

### Replaced or removed paths

- Replace the disabled Tracks placeholder, disabled search, disabled Import action, and
  disabled Tracks rail behavior with the local-only workflow.
- Remove any placeholder folder/filter/sort controls that would misleadingly imply those
  excluded features are available; do not leave parallel old and new Tracks UIs.
- Extend the existing layer preference shape and controller instead of adding a second
  track-specific preference store or MapLibre manager.
- Update stable documentation that currently says GPX import, track details, and
  interactive imported-track layers are unavailable.

No new runtime dependency is expected. If implementation evidence demonstrates one is
necessary, record the exact gap, license, bundle impact, and rejected browser/existing
package alternatives before adding it.

## Failure, cancellation, and privacy behavior

- Parsing/validation failures keep the existing application and saved list usable and
  never create IndexedDB rows.
- A naming timeout, rate limit, invalid response, or offline state is a non-blocking
  secondary warning. The primary name remains editable and Save remains available.
- Discard/replacement/unmount aborts pending naming and ignores late results through a
  preview-operation identity check.
- Save quota/transaction failure leaves the preview unsaved and protected by the leave
  guard. It does not report success or partially list the track.
- A MapLibre source/layer failure does not delete imported data. Details remain usable
  and expose a recoverable rendering warning.
- Diagnostics may record file size, parser version, counts, bounded warning codes,
  calculation versions, durations, and outcomes. They must not record filenames,
  names, coordinates, bounds, raw GPX, POI labels, or geometry.
- The UI states that saved tracks remain in this browser. Coordinate disclosure for the
  explicitly requested naming action is limited to at most three representative points.

## Implementation and commit sequence

Each commit must be independently reviewable, keep the application buildable, include
its focused tests, and update durable documentation alongside the behavior it adds.

### Commit 1: Parse GPX and calculate versioned summaries

- Add the bounded GPX parsing boundary, normalized independent-segment model, metadata
  projection, geometry precedence, and stable failures/warnings.
- Add pure distance, bounds/start/end, recorded-duration, integral elevation, loop,
  representative-point, and generated-name policies.
- Add compact synthetic fixtures plus sanitized structures derived from both supplied
  OsmAnd samples, including detailed-track-plus-sparse-route precedence and Unicode.
- Document durable model contracts in `docs/data-model.md`.

Focused checks: parser/metric unit tests, typecheck, lint for touched files, and fixture
privacy review.

### Commit 2: Persist and manipulate local tracks

- Extend `AppDatabase` with versioned `localTracks` and `localTrackContents` tables and a
  focused repository contract.
- Implement atomic save, summary listing, content loading, rename, and delete.
- Validate every record read from IndexedDB and cover migrations, transactions,
  Unicode, duplicates names, and missing/corrupt counterpart rows with
  `fake-indexeddb` integration tests.
- Update storage ownership and lifecycle documentation in `docs/data-model.md`,
  `docs/project-structure.md`, and `docs/runtime-flows.md`.

Focused checks: persistence integration tests, typecheck, and lint for touched files.

### Commit 3: Import, name, list, and guard the unsaved preview

- Replace the disabled Tracks placeholder with local summaries, name search-as-you-type,
  stable name sorting, selection, adjacent details, rename, and confirmed deletion.
- Add the file picker and shell-level full-workspace drag overlay with replacement
  confirmation and one-file validation.
- Implement the `New track` preview lifecycle, explicit Save/Discard, editable primary
  name, secondary generated-name field/button, and native `beforeunload` guard.
- Extend the existing Nominatim owner for at-most-three cancellable English reverse
  lookups and store separate POI fields plus the generated candidate.
- Update `docs/features.md`, `docs/runtime-flows.md`, and `docs/map-providers.md` with the
  user-visible, async, privacy, provider-policy, and failure contracts.

Focused checks: use-case/geocoder tests, React Testing Library interaction tests,
accessibility assertions, typecheck, and lint for touched files.

### Commit 4: Render tracks and add global Layers controls

- Extend the existing map controller/facade with one local-track GeoJSON source and
  stable bright-blue line layers in the reserved track band.
- Render independent segments without gap lines, support selection/preview updates, fit
  the complete track after import or saved-track selection with panel-aware padding, and
  clean up sources/listeners deterministically.
- Add persistent imported-track visibility and one global opacity slider to Layers with
  compatible map-preference migration.
- Update map structure, runtime flow, visual palette, and feature documentation.

Focused checks: controller/style/store unit tests, Layers UI tests, typecheck, lint, and
targeted browser checks for line rendering, ordering, opacity, and preservation across
rail changes.

### Commit 5: Final integration evidence and cleanup

- Exercise the complete import/save/reopen/search/rename/delete flow with representative
  GPX fixtures, including multiple segments, no timestamps, Unicode, naming failure,
  IndexedDB reload, and unsaved unload confirmation.
- Add proportionate Playwright coverage for full-screen drop, adjacent details, map
  rendering, and Layers control behavior; run axe on the new Tracks/details surfaces.
- Update `README.md` setup/capability text only if stable user/operator guidance changes,
  and keep `docs/README.md` accurate.
- Review the complete diff and remove placeholder controls, duplicate types/helpers,
  unused compatibility code, unnecessary production files, and speculative fallbacks.
- Record UI evidence at the repository's supported desktop Chrome viewport and compare
  layout/hierarchy with Penpot while using the repository's current semantic colors.

Focused checks: focused unit/integration/UI checks first, then the repository's complete
required verification suite once.

## Acceptance criteria

1. Dropping one valid GPX anywhere over the application opens `New track`, renders a
   bright-blue preview, and fits its complete bounds into the unobscured map area with
   sidebar/details padding regardless of the previously open rail section. Selecting a
   saved track performs the same fit.
2. The two supplied OsmAnd structures parse without double-counting their sparse route;
   the Cyrillic track name survives unchanged and neither file invents recorded time.
3. Track geometry with multiple independent segments renders without connecting gaps,
   aggregates metrics across segments, and shows the details warning.
4. Distance and elevation gain/loss are computed only during import, use consecutive
   within-segment pairs, carry algorithm versions, and load unchanged after reload.
5. Start, end, antimeridian-aware bounds, separate generated POI fields, generated-name
   candidate, and selected standard GPX metadata are persisted in the local summary.
6. An embedded track/metadata/route name or filename remains the default editable name.
   Generated English text appears separately and changes the primary field only after
   `Apply generated name`.
7. A non-loop single segment can generate `Middle: Start -> End` from three useful
   candidates; loops and multi-segment geometry use one best-place fallback. Missing or
   failed POI lookup never blocks Save.
8. Save creates summary and content atomically. Saved tracks survive reload and can be
   selected, renamed, searched during typing, sorted by name, and deleted with
   confirmation.
9. Leaving/reloading/closing the page while a valid preview is unsaved invokes the
   browser's native confirmation. Saving or explicitly discarding removes the guard.
10. Layers exposes one Imported tracks visibility value and one global opacity value;
    both affect preview and saved tracks, persist across reload, and never create
    per-track settings.
11. Invalid, oversized, empty, multi-file, or unsupported input produces bounded helpful
    feedback, writes no track rows, and leaves existing tracks/map features usable.
12. No raw GPX, filename, track name, coordinate, bounds, geometry, or generated POI text
    appears in diagnostics.

## Verification matrix

| Area | Required evidence |
| --- | --- |
| Parser boundary | GPX 1.0/1.1 namespaces, Unicode, detailed-track precedence over sparse route, route-only fallback, multiple tracks/segments, invalid coordinates, entity/size/count limits, cancellation, and bounded warnings |
| Metrics | Multi-segment geodesic sum without gaps, integral ascent/descent, missing elevation, min/max, timestamp absence/inconsistency, antimeridian bounds, loop threshold, and algorithm versions |
| Naming | Source-name priority, no automatic overwrite, non-loop three-place format, duplicate/degraded results, loop fallback, multi-segment fallback, English request, three-request cap, pacing, abort, offline/rate-limit behavior, and saved separate POI fields |
| Persistence | New-schema upgrade, atomic save/delete, reload, rename, duplicate names, Unicode, corrupted summary/content handling, quota/transaction failure, and no partial rows |
| UI | Whole-workspace drag overlay, one-file rejection, replacement confirmation, preview state, Save/Discard, search during typing, name-only stable sort, rename/delete, details fields/warnings, and accessible keyboard/focus behavior |
| Map/Layers | Bright-blue independent lines, stable layer band, panel-aware full-track fitting after import and saved selection, preview/saved updates, cleanup, global visibility/opacity, persistence, and coexistence with OSM/Sentinel/terrain |
| Leave guard | Active only for a non-retained preview and cleared after successful Save or explicit Discard |
| Privacy/diagnostics | No personal GPX fields in logs; only bounded counts, codes, versions, durations, and outcomes |
| Final checks | Repository format check, lint, typecheck, unit/integration tests, production build, targeted Playwright Chromium flow, axe scan, and documentation forbidden-roadmap-term check for `README.md`/`docs/` |

## Final review gates

- Measure handwritten production and test additions/deletions separately and report new,
  removed, and moved files in the pull request.
- If production growth exceeds 500 net lines, justify it against replaced placeholders
  and unavoidable parser/storage/map responsibilities. If it exceeds 1,000, stop and
  identify which existing code or planned behavior can be simplified before review.
- For three or more new production files, list each responsibility and immediate
  consumer in the pull request and collapse trivial single-consumer forwarding modules.
- Confirm the result could not be smaller without losing the untrusted GPX boundary,
  one-time metric guarantees, atomic storage, or the user-visible workflow.
- Verify `rg -n -i '\b(phase|phases|stage|stages|roadmap)\b' README.md docs` returns no
  matches and inspect stable documentation for task/branch/PR progress language.
- Remove this branch-local `PLAN.md` only after every planned implementation commit and
  final verification are complete; it must not enter the implementation pull request's
  final state.
