# Local GPX track enhancements plan

## Outcome

Make retained local GPX tracks easier to find, prioritize, reopen, understand, and
compare while keeping the original imported file private and unchanged.

## Product rules

- All imported tracks, descriptions, favorites, derived elevation data, and last-opened
  state remain local to the browser.
- The original imported GPX file is preserved even when its displayed elevation or
  calculated statistics are changed.
- Calculated values identify whether they use GPX elevation or relief-map elevation.
- Missing or unusable elevation must degrade gracefully without blocking track access.
- Existing import, rename, delete, map display, and local-storage behavior remains
  available.

## Track search

### Global search

- Global search includes retained local tracks whose names match the submitted text.
- Matching is case-insensitive and ignores leading and trailing whitespace.
- Show no more than the two most recently added matching tracks.
- Track results are visually distinguishable from place results.
- Opening a track result selects the track, opens Tracks, and displays it on the map.
- When more matching tracks may exist, provide an action that opens Tracks with the same
  search text already applied.
- Local track results remain available without network access and are not hidden by a
  place-search failure.

### Tracks search

- Tracks search matches track names and description text.
- The transferred global-search text produces the same matching behavior in Tracks.
- Clearing the search restores the normally ordered list.

## Favorites and list order

- A saved track can be marked or unmarked as a favorite from its list entry and details.
- Favorites appear before non-favorites.
- Within each group, the most recently added track appears first.
- Favorite state survives page refreshes and browser restarts.
- Changing favorite state does not change the original import date.
- Search results retain favorite-first and newest-first ordering.

## Latest opened track

- The latest opened saved track is restored after a page refresh or browser restart.
- Restoration reopens its details and displays its geometry on the map.
- Restoration performs at most one automatic map fit and must not repeatedly move the
  map after the user starts interacting.
- Unsaved import previews are not restored.
- Deleting the latest opened track clears the remembered selection.
- A missing, unreadable, or invalid remembered track is forgotten without blocking
  startup or access to the remaining track list.

## Responsive Tracks layout

- On viewports 1920 CSS pixels wide or narrower, track details do not open in a second
  pane to the right of the track list.
- The Tracks workspace keeps its existing single-column width so more horizontal space
  remains available for the map.
- The GPX upload region remains visible at the top while either the list or track details
  are shown below it.
- Opening a saved track replaces the search, result count, and track list with that
  track's details in the same content area.
- The details view provides an obvious Back to tracks action that restores the previous
  list and search state.
- Closing the selected track has the same navigation result as returning to the list.
- Returning to the list preserves its search text, ordering, and scroll position.
- Importing a new GPX remains available while details are open and follows the existing
  confirmation rules when replacing unfinished work.
- On viewports wider than 1920 CSS pixels, the list and selected-track details may remain
  visible side by side.
- Resizing across the breakpoint keeps the selected track and current list state instead
  of closing or reopening content.

## Track description

- Every saved track has an optional plain-text description.
- The details view shows an explicit Edit action.
- Edit mode provides a multiline field with Apply edit and Cancel actions.
- Applying a valid edit persists the description across refreshes and browser restarts.
- A failed edit keeps the previous saved description and reports the failure without
  closing the track.
- Outside edit mode, web links beginning with `http://` or `https://` are clickable and
  open safely in a new browser tab.
- Surrounding text and line breaks remain readable.
- Pasted markup is displayed as text and is never interpreted as HTML.
- Descriptions are bounded to 10,000 characters.

## Elevation profile

- A saved track with usable elevation displays an elevation graph against distance.
- The graph clearly communicates elevation, ascent, descent, minimum, maximum, and the
  selected elevation source.
- Gradient changes are visible on the graph through consistent color bands.
- Gradient meaning remains available without relying on color alone.
- Pointing at or focusing a graph position identifies the corresponding distance,
  elevation, and gradient and highlights the related map position.
- Multi-segment tracks do not invent distance or elevation changes across segment gaps.
- Partial elevation coverage is disclosed; calculations must not silently treat missing
  elevation as zero.
- The graph remains usable for long tracks without changing the stored original
  geometry.

## Elevation filtering

- The elevation view provides a filter button that reveals a slider measured in metres.
- The default threshold is 3 metres.
- The threshold controls elevation-noise filtering: elevation changes smaller than the
  selected value do not independently count toward gradient, ascent, descent, high-point,
  or climb calculations.
- Filtering does not remove geographic track points or alter the original GPX file.
- Changing the threshold updates all affected elevation statistics and climb results
  together.
- The active threshold is visible whenever filtered results are presented.
- The selected threshold persists for that track.

## High-point detection

- High-point detection applies to point-to-point, loop, and multi-segment tracks when
  elevation coverage is sufficient.
- For a loop, the complete loop is evaluated and the repeated start/end location is not
  treated as two separate high-point candidates.
- A high point must be meaningfully prominent rather than merely the highest noisy
  sample.
- The detected high point is emphasized in the elevation graph and may be used by
  automatic naming.
- If elevation coverage or prominence is insufficient, the application uses its
  established naming fallback and does not present an uncertain high point as fact.

## Relief-map elevation recalculation

- A user can explicitly request elevation recalculation from the configured relief map.
- Recalculation shows progress and can be cancelled.
- It never uploads the track or sends the original GPX file to another service.
- A successful recalculation updates the displayed profile, statistics, high point, and
  climbs together.
- Relief-map results remain distinguishable from elevations recorded in the GPX file.
- The user can return to the original GPX elevation when usable GPX elevation exists.
- Provider gaps and partial failures are reported clearly and do not replace a previously
  usable profile with an unusable result.
- Recalculated results survive page refreshes and browser restarts.

## Gradients and climbs

- The elevation graph identifies sustained climbs and the changing gradient within them.
- Each climb reports its start and end along the track, distance, elevation gain,
  average gradient, and difficulty category.
- Climb difficulty follows Garmin's published cycling concept based on climb length and
  average grade, including the published category thresholds and recognizable category
  colors.
- Climb details are available from both the graph and a readable summary.
- Loop tracks can contain climbs and use the same detection rules as non-loop tracks.
- Segment gaps, missing elevation, and filtered noise do not create artificial climbs.
- The behavior follows Garmin's publicly documented inputs and categories; undocumented
  proprietary detection behavior is not claimed as an exact reproduction.

## Automatic-name evaluation

- Use the local GPX collection at
  `C:\Users\bogdan-dm\Downloads\nakarte_tracks_17.06.2026_17.42` as a private evaluation
  corpus.
- Do not copy the collection into the repository or include its raw contents in logs,
  commits, screenshots, or reports.
- Evaluate names in batches and report the generated name, selected anchors, high-point
  decision, loop/multi-segment decision, place candidates, fallback reason, and failure.
- Support a maintainer-provided expected name or assessment for individual tracks.
- Summarize exact matches, acceptable suggestions, incorrect suggestions, unresolved
  names, and processing failures.
- Cover loops, point-to-point tracks, multiple segments, missing or partial elevation,
  duplicate endpoints, multiple comparable summits, and sparse or noisy recordings.
- Promote only explicitly selected, sanitized examples into permanent test fixtures.

## Failure and privacy behavior

- Search, description editing, favorites, restoration, elevation calculation, and
  autonaming report failures without making unrelated track actions unavailable.
- Cancelling or failing a derived calculation retains the last usable saved result.
- No automatic geocoding, elevation lookup, or corpus processing starts merely because
  the browser opens.
- User-entered descriptions and full track geometry are not written to diagnostics.

## Delivery sequence

1. `feat(tracks): add metadata and persistent track state`
   - Add descriptions, favorites, favorite-first ordering, latest-opened restoration,
     and the responsive list/details layout.
2. `feat(search): include local tracks in global search`
   - Add the two newest matching results and transfer the query into Tracks.
3. `feat(elevation): add filtered track elevation profiles`
   - Add the graph, 3-metre default filter, gradients, statistics, high points, and loop
     handling.
4. `feat(elevation): recalculate profiles from relief data`
   - Add explicit recalculation, progress, cancellation, provenance, persistence, and
     restoration of original GPX elevation.
5. `feat(tracks): identify and present categorized climbs`
   - Add sustained-climb detection and Garmin-documented difficulty presentation.
6. `test(tracks): evaluate automatic naming against local corpus`
   - Add the private batch evaluation workflow and selected sanitized regression cases.
7. Final verification and documentation
   - Verify the complete behavior, update stable feature and runtime documentation,
     remove this planning file, and prepare the reviewed branch for integration.

## Reuse and complexity constraints

- Extend the existing Tracks workspace, local-track persistence, search, elevation
  provider, map interaction, and chart system.
- Replace the current alphabetical-only list ordering with favorite-first,
  newest-first ordering.
- Replace raw adjacent-point elevation totals with the single selected filtered-profile
  policy wherever the new elevation view is used.
- Do not add another state framework, chart library, map engine, persistence system, or
  network service.
- New production concepts are limited to the derived elevation profile and climb result
  because the graph, recalculation, filtering, and climb details require durable,
  consistently interpreted results.

## Acceptance

- A user can favorite, describe, find, open, refresh, and return to a retained track
  without losing those choices.
- At 1920 CSS pixels and below, opening details replaces the list beneath the persistent
  upload region and returning restores the prior list state.
- Above 1920 CSS pixels, the wider side-by-side presentation remains available.
- Global search shows at most two newest matching tracks and can continue the same search
  in Tracks.
- Description links are clickable only outside edit mode and pasted HTML is inert.
- Loop tracks receive the same high-point and climb analysis as other tracks.
- The default 3-metre elevation filter changes calculations without changing geometry.
- GPX and relief-map profiles remain distinguishable and reversible.
- Elevation graphs, gradients, high points, and climbs remain consistent with the active
  source and filter.
- The private GPX corpus can improve automatic naming without entering repository
  history or diagnostics.
