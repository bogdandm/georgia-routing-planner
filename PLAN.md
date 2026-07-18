# Sentinel-2 Imagery Implementation Plan

## 1. Purpose, status, and branch boundary

This is the active implementation plan for the Satellite imagery workspace described in
[`TOP_LVL_PLAN.md`](./TOP_LVL_PLAN.md) and the stable contracts in
[`docs/features.md`](./docs/features.md),
[`docs/runtime-flows.md`](./docs/runtime-flows.md), and
[`docs/map-providers.md`](./docs/map-providers.md). It replaces the completed map
foundation plan that previously occupied this file.

- Status: **planning; no Sentinel search or rendering behavior is implemented yet**.
- Active branch: `feature/sentinel-imagery-plan`, created from `main` on 2026-07-19.
- Approval boundary: all implementation remains on a feature branch and reaches `main`
  only after the reviewed branch state is explicitly approved.
- Current application boundary: the Satellite rail destination and live viewport-center
  selector exist, while date/product filters, search, results, scene metadata, and
  imagery rendering remain unavailable.

The implementation must be delivered as focused, independently testable commits. Each
behavior commit includes its tests and leaves the repository buildable. This plan stays
current as review resolves the open prototype questions and as feasibility work selects
the raster path.

### 1.1 Work-package status

Update this table in the same commit that materially changes a package's state. `Done`
means its acceptance evidence exists on the feature branch; it does not mean approval to
merge into `main`.

| Package | Outcome                                           | Status  |
| ------- | ------------------------------------------------- | ------- |
| S5.0    | Plan, branch, prototype ledger, governance        | Done    |
| S5.1    | Catalog and raster feasibility decision           | Pending |
| S5.2    | Models, viewport geometry, and use cases          | Pending |
| S5.3    | Validated STAC gateway and configuration          | Pending |
| S5.4    | Search sidebar and acquisition calendar           | Pending |
| S5.5    | MapLibre true-color imagery and footprint adapter | Pending |
| S5.6    | Results, metadata, and applied actions            | Pending |
| S5.7    | Diagnostics and failure evidence                  | Pending |
| S5.8    | E2E, accessibility, docs, and design sync         | Pending |

## 2. Design authority and synchronization

The canonical layout and interaction prototype is
[prototype 2](https://design.penpot.app/#/workspace?team-id=e53c2c6b-a0fc-80ee-8008-585e71ddb1af&project-id=e53c2c6b-a0fc-80ee-8008-586356e1ef5a&file-id=dd49d952-2105-80b2-8008-587f93c8a333&page-id=dd49d952-2105-80b2-8008-587f93c8a334).
The reviewed “Redesign B — Satellite imagery discovery workspace (1920×1080)” frame is
the current Satellite reference.

Use this authority order:

1. Penpot owns layout, feature placement, control grouping, visual hierarchy, and
   interaction intent.
2. Stable repository documentation owns behavior, architecture, data, privacy, provider,
   attribution, and failure contracts.
3. This plan owns delivery order, progress, verification, and unresolved implementation
   decisions.

Synchronization rules for this workstream:

- Every accepted review change to the implemented Satellite UI must be applied to the
  corresponding Penpot surface and recorded in this plan.
- Every accepted Penpot change must update the in-scope implementation and the relevant
  permanent documentation in the same workstream.
- Inspect the current Penpot hierarchy before each design edit and preserve reviewer
  changes. Apply one requested review change per Penpot operation.
- Do not replace unimplemented prototype features with the application's temporary
  disabled controls, empty states, placeholders, or reduced behavior.
- Do not treat illustrative scene IDs, dates, coordinates, counts, or percentages as
  production constants.

### 2.1 Prototype-to-delivery ledger

| Prototype surface          | Reviewed contract                                                                    | Current application                                       | Planned work                                                      | State                                                     |
| -------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| Satellite rail destination | Opens contextual Satellite tools without remounting the map                          | Implemented                                               | Regression coverage in S5.8                                       | Existing                                                  |
| Search-area selector       | Compact `Viewport                                                                    | <latitude, longitude>` selector; Marker is a later source | Viewport center implemented; Marker disabled                      | Actual viewport bounds in S5.2; preserve Marker for later | Partial |
| Date calendar              | Range selection plus acquisition/cloud hints below available days                    | Placeholder card only                                     | Availability query and accessible calendar in S5.4                | Planned                                                   |
| Sentinel options           | Exclusive L1C/L2A choice and cloud threshold                                         | Disabled controls                                         | Typed criteria and active controls in S5.4                        | Planned                                                   |
| Other imagery              | Visible boundary that no other source is available in this prototype                 | Not represented exactly                                   | Honest unavailable row in S5.4; no invented provider              | Planned                                                   |
| Search summary/action      | Concise criteria summary and `Search Images` action                                  | Disabled action                                           | Submitted criteria, loading, cancellation, and validation in S5.4 | Planned                                                   |
| Adjacent results pane      | Overlay/adjacent pane titled for the search point, with scene and acquisition counts | Unavailable                                               | Shell-owned pane in S5.6                                          | Planned                                                   |
| Date-grouped scene cards   | Platform, product level, cloud, coverage, warning, thumbnail, expand action          | Unavailable                                               | Result grouping and cards in S5.6                                 | Planned                                                   |
| Expanded scene metadata    | Acquisition time, tile, orbit, product, edge distance, attribution                   | Unavailable                                               | Validated metadata details in S5.6                                | Planned                                                   |
| Applied scene actions      | Applied status, fit footprint, and hide imagery                                      | Unavailable                                               | Map adapter and commands in S5.5/S5.6                             | Planned                                                   |
| Persistent map composition | True-color scene beneath hiking references, with footprint and other state preserved | Reserved satellite layer band only                        | Rendering and layer-order work in S5.5                            | Planned                                                   |

## 3. Required user outcome

At completion, a desktop Chrome user can:

1. Open Satellite without recreating the persistent MapLibre map.
2. Search the actual current viewport for Sentinel-2 L1C or L2A scenes using a bounded
   inclusive date range and cloud-cover threshold.
3. See acquisition availability in the calendar and compare returned scenes grouped by
   UTC acquisition date.
4. Understand each scene's platform, processing level, scene cloud cover, submitted
   viewport coverage, and any search-point-to-scene-edge warning.
5. Expand one scene to inspect its acquisition, tile, orbit, product identity,
   attribution, and coverage evidence.
6. Apply one concrete true-color scene, see its footprint, fit the map to that
   footprint, switch scenes, and hide the imagery without losing search results.
7. Change 2D/3D terrain or move among workspace destinations without resetting the
   applied scene or unrelated workspace state.
8. Recover from no results, cancellation, malformed provider data, offline/network
   failure, rate limiting, COG/tile decode failure, and WebGL/source failure through
   intentional accessible states.
9. Export diagnostics that distinguish catalog, validation, render, and provider
   failures without exporting exact search geometry, asset URLs, request bodies, or
   other sensitive data.

## 4. Fixed product and UX decisions

- Satellite remains one of the four primary rail destinations; it is not a dialog or a
  separate page.
- The map is long-lived. Opening/closing the results pane, applying imagery, and
  changing filters must not remount it.
- `Viewport` is the first implemented search source. It uses the submitted visible map
  bounds, while the selector displays the settled viewport center as latitude then
  longitude.
- `Marker` remains visible but unavailable until saved-marker behavior exists. This work
  does not invent a marker repository or synthetic marker choices.
- Search supports Sentinel-2 L1C and L2A as separate exclusive choices. Do not silently
  substitute one collection for the other.
- The cloud threshold filters scene-level STAC cloud metadata. The UI must not imply
  that this is a cloud calculation limited to the viewport.
- Date range endpoints are inclusive and interpreted as UTC calendar dates.
- Results are concrete scenes, not hidden mosaics. Selecting another scene replaces the
  applied raster explicitly.
- Partial coverage remains visible: uncovered basemap stays present, the footprint can
  be inspected, and the coverage percentage and edge warning remain explicit.
- True-color imagery sits below OSM hiking references, labels, catalog/Create GPX
  geometry, markers, and interaction highlights.
- Applying imagery does not change the current camera automatically. `Fit footprint` is
  the explicit camera command.
- `Hide imagery` stops raster display without deleting results or the selected scene's
  metadata. Final footprint visibility semantics await the review question in
  section 14.
- Closing the results pane does not silently remove an applied scene.
- `Other imagery` remains an honest unavailable boundary. Do not add a fake provider or
  generic source picker.
- Detailed Layers UI is not invented without a reviewed Layers prototype. This work
  exposes typed imagery visibility/opacity capabilities so a later reviewed Layers
  surface can use them.

## 5. Scope boundaries

### 5.1 Included

- Anonymous, configuration-driven STAC search for the reviewed Sentinel collections.
- Actual viewport-bounds capture and bounded search geometry.
- Date availability, range selection, product-level selection, cloud threshold, search,
  result grouping, selection, metadata, and attribution.
- One replaceable true-color rendering adapter chosen by the feasibility gate.
- Scene footprint, coverage, edge distance, fit, hide, and applied-state handling.
- TanStack Query lifecycle, AbortSignal propagation, typed errors, diagnostics, tests,
  stable documentation, and Penpot synchronization.

### 5.2 Excluded

- Automatic scene mosaics or cloud-free composites.
- Band math, false-color products, NDVI, change detection, download/export, or image
  editing.
- Saved-marker search until the Markers capability exists.
- Other satellite providers, local imagery import, generic WMS/XYZ forms, or arbitrary
  Layers controls.
- Offline imagery packages, service-worker prefetching, or durable COG/tile caching.
- Accounts, provider credentials, a proxy, server-side reprojection, or a new backend.
- Mobile-specific layout, Safari support, and globe-specific imagery behavior.
- Changing unrelated future Penpot surfaces to resemble the incomplete application.

## 6. Architecture and ownership

### 6.1 Target dependency flow

```text
Satellite React workspace
        |
        v
application use cases -----------------------> application ports
        |                                           ^
        v                                           |
serializable criteria/results        Earth Search STAC gateway
                                                    |
                                                    v
                                           configured ky client

Satellite React commands -> narrow imagery-map capability -> MapLibre adapter
                                                        |
                                                        v
                                      raster source/layer + footprint source/layer
```

The catalog path follows normal clean-architecture dependency injection. The imperative
MapLibre path remains a presentation adapter because it controls a UI rendering engine.
React receives only serializable scene/render snapshots and narrow commands; neither
application use cases nor Zustand receive the native map.

### 6.2 Proposed contracts

Names may be refined during implementation, but responsibilities remain separate:

- `SatelliteSearchCriteria`: search area, inclusive UTC date range, product level, and
  cloud threshold.
- `SatelliteSearchArea`: discriminated union beginning with a viewport bounds snapshot;
  later Marker support can add another variant without changing the gateway.
- `SatelliteScene`: stable item ID, platform, level, acquisition time, footprint, cloud
  cover, tile/orbit/product metadata, validated render asset reference, and attribution
  label.
- `SatelliteAcquisitionGroup`: UTC date with one or more concrete scenes and derived
  availability summary.
- `SatelliteSceneCoverage`: submitted-area coverage percentage, center/interest-point
  relation, and optional edge warning.
- `LoadSatelliteAvailability`: returns date summaries for the visible calendar month.
- `SearchSatelliteScenes`: validates limits, invokes the gateway,
  deduplicates/paginates, calculates derived display data, and returns date-grouped
  scenes.
- `SatelliteCatalogGateway`: small cancellable STAC search capability.
- `SatelliteImageryMap`: narrow presentation capability for apply, hide, fit footprint,
  subscribe, and get a serializable render snapshot.
- `MapLibreSatelliteImageryAdapter`: owns protocol registration, raster/footprint
  sources and layers, scene switching, cancellation, cleanup, and render diagnostics.

Do not introduce a broad satellite service, map manager, generic command bus, or native
MapLibre getter.

### 6.3 State ownership

| State                                                                 | Owner                                     | Persistence          |
| --------------------------------------------------------------------- | ----------------------------------------- | -------------------- |
| Draft date range, calendar month, product level, cloud threshold      | Satellite React feature                   | Session only         |
| Last submitted criteria                                               | Satellite React feature / query key       | Session only         |
| Availability and search request lifecycle/results                     | TanStack Query                            | In-memory cache only |
| Expanded/selected result and pane visibility                          | Satellite React feature                   | Session only         |
| Applied scene ID, render state, raster visibility, footprint snapshot | Imagery-map adapter, exposed serializably | Session only         |
| Native raster/GeoJSON sources, layers, protocols, listeners           | MapLibre imagery adapter                  | Never                |
| Settled camera and existing terrain state                             | Existing map owner/repository             | Existing policy      |
| Provider/catalog configuration                                        | Validated runtime configuration           | Build/runtime asset  |

No raw STAC response, COG bytes, native map instance, class instance, or full geometry
is stored in Zustand, TanStack Query persistence, or Dexie.

### 6.4 Target repository shape

Create files only when they contain real behavior. Expected ownership is:

```text
src/
  domain/satellite/
    SatelliteScene.ts
    satelliteCoverage.ts
  application/satellite/
    LoadSatelliteAvailability.ts
    SearchSatelliteScenes.ts
  application/ports/
    SatelliteCatalogGateway.ts
  infrastructure/stac/
    EarthSearchSatelliteCatalogGateway.ts
    earthSearchSchemas.ts
  presentation/satellite-browser/
    SatelliteWorkspace.tsx
    SatelliteSearchForm.tsx
    SatelliteCalendar.tsx
    SatelliteResultsPane.tsx
    SatelliteSceneCard.tsx
    SatelliteSceneDetails.tsx
  presentation/map/
    SatelliteImageryMap.ts
    MapLibreSatelliteImageryAdapter.ts
test/fixtures/satellite/
  availability-response.json
  search-response.json
  malformed-response.json
  raster/...
e2e/
  satellite-imagery.spec.ts
```

Exact file splitting should follow one primary export per file and avoid barrel files.

## 7. Provider and rendering decision gate

The catalog path and raster path are separate replaceable decisions. The catalog may be
usable even when a candidate raster adapter fails, but the user-visible feature is not
complete until both reviewed L1C and L2A flows have an honest rendering outcome.

### 7.1 Catalog candidate

Earth Search v1 is the initial candidate because it offers a public STAC search API and
the repository already recorded successful anonymous access to a Sentinel true-color
COG. It is best-effort and has no SLA. Before product code depends on it, S5.1 must
revalidate:

- Current collection IDs and the L1C/L2A asset sets.
- POST search support for bbox/intersects, inclusive datetime, cloud filtering,
  deterministic sorting, fields, pagination links, and cancellation.
- Browser CORS from local development and the GitHub Pages origin.
- STAC conformance, response media type, rate/quota behavior, timeout behavior, and
  attribution/licensing.
- The exact metadata fields and fallbacks used for platform, tile, orbit, product,
  processing level, footprint, and true-color asset selection.
- HTTPS-only asset references and any requester-pays/authentication flags.

All endpoints and collection mappings are validated configuration. The static client
must not contain credentials or fall back silently to a different provider.

### 7.2 Raster decision

The existing provider spike proves range access, not renderability. The official
MapLibre COG example uses `@geomatico/maplibre-cog-protocol`, but that adapter documents
that its input must already be EPSG:3857 and it does not reproject. Sentinel scene
assets commonly use UTM grids, so package adoption is not assumed.

S5.1 must compare at least these paths against one representative Georgia L1C scene and
one L2A scene:

1. A browser-side COG/JP2 windowing, reprojection, and tile adapter with work isolated
   from the UI thread.
2. An anonymous standards-compatible raster tile service only if its policy, CORS,
   attribution, longevity, request limits, and static-client security are acceptable.
3. A deliberately reduced reviewed product scope only if neither path can meet the fixed
   constraints; no silent L1C/L2A substitution or blurry preview stretching.

The gate records:

- Projection, format, bands, overviews, block size, compression, no-data/alpha behavior,
  and browser decoder support for each product level.
- Requests, transferred bytes, time to first visible pixels, interaction responsiveness,
  memory behavior, cancellation latency, cache bounds, and cleanup after scene switch.
- Chrome/WebGL behavior in 2D and terrain mode, source/layer ordering, CORS/range
  behavior, and failure categories.
- Candidate dependency versions, licenses, transitive size, maintenance activity, worker
  requirements, CSP/base-path behavior, and production bundle impact.
- A provider/adapter replacement boundary that leaves search and scene-selection use
  cases unchanged.

The chosen path and rejected alternatives become durable evidence in
`docs/map-providers.md` before later work packages add product behavior. If no
acceptable path exists, stop after the gate and request a product or deployment decision
rather than weakening privacy/static-hosting constraints.

## 8. Search and derived-data contracts

### 8.1 Viewport snapshot

- Extend the serializable map capability with settled WGS84 viewport bounds plus center.
- Capture the submitted bounds when the user searches; later panning does not mutate an
  in-flight request or relabel existing results.
- Reject non-finite, inverted, world-spanning, or unsupported antimeridian bounds with a
  typed user-facing error.
- Do not add exact bounds to default diagnostics exports.

### 8.2 Availability and search

- Availability covers the displayed calendar month for the current product level and
  cloud threshold. It returns per-date scene count and a reviewed cloud summary.
- The explicit search uses the selected inclusive range and the same product/cloud
  criteria.
- Limit the supported date span and result count based on S5.1 provider measurements;
  show an actionable refinement message rather than truncating silently.
- Follow provider pagination through validated HTTPS links only, cap pages/results, and
  deduplicate by collection plus stable item ID.
- TanStack Query owns retry. The `ky` adapter does not add a second automatic retry
  layer.
- Abort superseded requests and classify user cancellation separately from failure.

### 8.3 Coverage and edge evidence

- `viewport coverage` is the geodesic intersection area of the submitted viewport
  polygon and the validated scene footprint divided by submitted viewport area.
- Clamp only final display rounding; reject invalid geometries instead of manufacturing
  a percentage.
- The search interest point is the submitted viewport center. The edge distance is the
  shortest geodesic distance from that point to the scene boundary.
- Show an edge warning when the interest point is outside the scene or inside but within
  a reviewed distance threshold. Keep the wording distinct for those cases.
- Use focused Turf packages only if they materially simplify robust intersection/area/
  distance calculations. Record license and bundle impact before adding them.

### 8.4 Mapping and validation

- Validate the feature collection, every item, geometry, dates, collection, product
  level, cloud value, asset media type/roles, asset URL, and pagination link with Zod.
- Map external data into readonly internal types before domain/application logic uses
  it.
- Decide whether one malformed item makes the response partial or failed. The preferred
  policy is to omit invalid items, report a bounded validation summary, and fail only
  when no trustworthy result can be produced or the response envelope is invalid.
- Preserve acquisition timestamps internally in UTC; group/display by UTC date.
- Do not expose raw response bodies or provider error objects to React or diagnostics.

## 9. End-to-end Sentinel query chain and payloads

This section fixes the intended top-level data flow and the external/internal payload
boundaries. The coordinates, dates, item IDs, counts, and asset URLs are illustrative
examples taken from a live Earth Search query on 2026-07-19 against July 2025 data. They
are not application constants.

### 9.1 Capture the submitted viewport

When the user presses **Search Images**, the map capability reads the settled center and
visible bounds from MapLibre and returns a serializable snapshot:

```json
{
  "center": {
    "latitude": 42.6584,
    "longitude": 44.6439
  },
  "bbox": [44.55, 42.6, 44.75, 42.72]
}
```

The bounding-box order is the STAC/GeoJSON order `[west, south, east, north]`. The
search captures this snapshot once; later panning does not mutate an in-flight query or
existing results.

### 9.2 Build the typed search criteria

The React form maps the viewport snapshot and filters into an application DTO:

```json
{
  "area": {
    "type": "viewport",
    "bbox": [44.55, 42.6, 44.75, 42.72]
  },
  "startDate": "2025-07-02",
  "endDate": "2025-07-17",
  "productLevel": "L2A",
  "maxCloudCover": 25
}
```

The product choice maps to one and only one STAC collection:

```text
L1C -> sentinel-2-l1c
L2A -> sentinel-2-l2a
```

Earth Search currently exposes both collections from its
[STAC root](https://earth-search.aws.element84.com/v1/), with separate
[L1C](https://earth-search.aws.element84.com/v1/collections/sentinel-2-l1c) and
[L2A](https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a) collection
contracts.

### 9.3 Create TanStack Query keys

The availability query covers the displayed calendar month:

```json
[
  "satellite",
  "availability",
  "earth-search",
  "L2A",
  "2025-07",
  25,
  [44.55, 42.6, 44.75, 42.72]
]
```

The submitted scene query includes the complete immutable criteria:

```json
[
  "satellite",
  "scenes",
  "earth-search",
  "L2A",
  "2025-07-02",
  "2025-07-17",
  25,
  [44.55, 42.6, 44.75, 42.72]
]
```

Exact coordinates may exist in the in-memory key, but must not appear in default
diagnostics exports. TanStack Query owns in-memory caching, stale-result protection,
cancellation, and the single retry policy.

### 9.4 Execute the availability query

The query chain is:

```text
TanStack Query
-> LoadSatelliteAvailability
-> SatelliteCatalogGateway
-> EarthSearchSatelliteCatalogGateway
-> configured ky client
-> POST https://earth-search.aws.element84.com/v1/search
```

Example request for the visible month:

```json
{
  "collections": ["sentinel-2-l2a"],
  "bbox": [44.55, 42.6, 44.75, 42.72],
  "datetime": "2025-07-01T00:00:00Z/2025-07-31T23:59:59Z",
  "query": {
    "eo:cloud_cover": {
      "lte": 25
    }
  },
  "sortby": [
    {
      "field": "properties.datetime",
      "direction": "desc"
    }
  ],
  "fields": {
    "include": [
      "id",
      "collection",
      "properties.datetime",
      "properties.platform",
      "properties.eo:cloud_cover"
    ]
  },
  "limit": 100
}
```

The gateway validates the response, groups items by UTC acquisition date, and produces
the calendar annotations:

```json
{
  "month": "2025-07",
  "dates": [
    {
      "date": "2025-07-17",
      "sceneCount": 2,
      "cloudSummaryPercent": 4
    }
  ]
}
```

The meaning of `cloudSummaryPercent` remains governed by the prototype review question
in section 14; the current recommendation is the lowest scene-level cloud value on that
date.

### 9.5 Execute the submitted scene search

The application chain is:

```text
TanStack Query
-> SearchSatelliteScenes
-> SatelliteCatalogGateway
-> EarthSearchSatelliteCatalogGateway
-> configured ky client
-> POST https://earth-search.aws.element84.com/v1/search
```

Example request:

```json
{
  "collections": ["sentinel-2-l2a"],
  "bbox": [44.55, 42.6, 44.75, 42.72],
  "datetime": "2025-07-02T00:00:00Z/2025-07-17T23:59:59Z",
  "query": {
    "eo:cloud_cover": {
      "lte": 25
    }
  },
  "sortby": [
    {
      "field": "properties.datetime",
      "direction": "desc"
    }
  ],
  "fields": {
    "include": [
      "id",
      "collection",
      "bbox",
      "geometry",
      "properties.datetime",
      "properties.platform",
      "properties.eo:cloud_cover",
      "properties.proj:epsg",
      "properties.grid:code",
      "properties.s2:tile_id",
      "properties.s2:product_type",
      "properties.s2:product_uri",
      "assets.visual",
      "assets.thumbnail",
      "links"
    ]
  },
  "limit": 100
}
```

Earth Search advertises STAC 1.0 Item Search, query, fields, and sorting conformance
from the linked STAC root. The client still validates actual response behavior and does
not infer support only from conformance declarations.

### 9.6 Receive a STAC FeatureCollection

The response content type is GeoJSON/STAC JSON. A trimmed L2A response is:

```json
{
  "type": "FeatureCollection",
  "stac_version": "1.0.0",
  "context": {
    "limit": 100,
    "matched": 10,
    "returned": 10
  },
  "features": [
    {
      "type": "Feature",
      "id": "S2A_38TMN_20250731_0_L2A",
      "collection": "sentinel-2-l2a",
      "bbox": [44.000177, 42.359721, 45.120421, 43.352783],
      "geometry": {
        "type": "Polygon",
        "coordinates": ["validated scene footprint coordinates"]
      },
      "properties": {
        "datetime": "2025-07-31T07:58:21.070000Z",
        "platform": "sentinel-2a",
        "eo:cloud_cover": 2.628153,
        "proj:epsg": 32638,
        "grid:code": "MGRS-38TMN",
        "s2:tile_id": "S2A_OPER_MSI_L2A_TL_2APS_20250731T110117_A052785_T38TMN_N05.11",
        "s2:product_type": "S2MSI2A",
        "s2:product_uri": "S2A_MSIL2A_20250731T075021_N0511_R135_T38TMN_20250731T110117.SAFE"
      },
      "assets": {
        "visual": {
          "href": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/38/T/MN/2025/7/S2A_38TMN_20250731_0_L2A/TCI.tif",
          "type": "image/tiff; application=geotiff; profile=cloud-optimized",
          "roles": ["visual"],
          "gsd": 10,
          "proj:shape": [10980, 10980]
        },
        "thumbnail": {
          "href": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/38/T/MN/2025/7/S2A_38TMN_20250731_0_L2A/preview.jpg",
          "type": "image/jpeg",
          "roles": ["thumbnail"]
        }
      }
    }
  ],
  "links": [
    {
      "rel": "next",
      "method": "POST",
      "href": "https://earth-search.aws.element84.com/v1/search",
      "body": {
        "next": "provider pagination token"
      }
    }
  ]
}
```

The full provider response contains more fields and assets. Zod schemas accept only the
required allowlisted structure and ignore unrelated extensions after validating the
envelope.

### 9.7 Follow bounded pagination

When a validated response contains a `links` entry with `rel: "next"`, the gateway:

1. Verifies HTTPS, the configured Earth Search origin, POST method, and response type.
2. Replays the validated provider-supplied body, including its opaque `next` token.
3. Appends valid items, deduplicated by collection plus item ID.
4. Stops at the configured page/result cap or when no next link exists.

An observed next-page body has this shape:

```json
{
  "datetime": "2025-07-01T00:00:00Z/2025-07-31T23:59:59Z",
  "query": {
    "eo:cloud_cover": {
      "lte": 25
    }
  },
  "sortby": [
    {
      "field": "properties.datetime",
      "direction": "desc"
    }
  ],
  "collections": ["sentinel-2-l2a"],
  "bbox": [44.55, 42.6, 44.75, 42.72],
  "limit": 100,
  "next": "2025-07-29T07:58:25.174000Z"
}
```

Do not concatenate or execute arbitrary pagination URLs and do not truncate silently.

### 9.8 Validate and map the external JSON

The boundary is:

```text
unknown JSON
-> Zod STAC envelope/item/geometry/asset schemas
-> validated external items
-> readonly SatelliteScene[]
```

A mapped internal L2A scene is:

```json
{
  "sceneId": "S2A_38TMN_20250731_0_L2A",
  "level": "L2A",
  "platform": "Sentinel-2A",
  "acquiredAt": "2025-07-31T07:58:21.070Z",
  "cloudCoverPercent": 2.628153,
  "tileCode": "38TMN",
  "orbit": "R135",
  "productType": "S2MSI2A",
  "productId": "S2A_MSIL2A_20250731T075021_N0511_R135_T38TMN_20250731T110117.SAFE",
  "projectionEpsg": 32638,
  "footprint": {
    "type": "Polygon",
    "coordinates": ["validated scene footprint coordinates"]
  },
  "visualAsset": {
    "format": "cog",
    "url": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/38/T/MN/2025/7/S2A_38TMN_20250731_0_L2A/TCI.tif",
    "mediaType": "image/tiff; application=geotiff; profile=cloud-optimized"
  },
  "thumbnailUrl": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/38/T/MN/2025/7/S2A_38TMN_20250731_0_L2A/preview.jpg"
}
```

`tileCode` comes from a validated MGRS grid code. The observed item has no dedicated
relative-orbit property, so `orbit` may be extracted only from a strictly validated
Sentinel product URI; otherwise it remains `null`. Missing metadata is never invented.

### 9.9 Calculate coverage, edge evidence, and acquisition groups

For each validated scene:

```text
viewport coverage percent =
geodesic area(intersection(submitted viewport polygon, scene footprint))
/ geodesic area(submitted viewport polygon)
* 100
```

The edge calculation is:

```text
submitted viewport center
-> shortest geodesic distance to the scene polygon boundary
-> inside/outside/near-edge classification
-> distance and warning DTO
```

Focused Turf modules may provide intersection, area, and point-to-boundary distance
after the S5.1 dependency/bundle review.

The final result is grouped and sorted by UTC acquisition date:

```json
{
  "sceneCount": 8,
  "acquisitionDayCount": 4,
  "groups": [
    {
      "date": "2025-07-17",
      "scenes": [
        {
          "sceneId": "S2A_38TMN_20250717_0_L2A",
          "cloudCoverPercent": 4,
          "viewportCoveragePercent": 92,
          "edgeDistanceKm": 14.6
        }
      ]
    }
  ]
}
```

Counts are derived from validated data, not copied from prototype sample labels.

### 9.10 Present results and select a scene

The presentation chain is:

```text
SatelliteSearchResult
-> SatelliteResultsPane
-> UTC date groups
-> SatelliteSceneCard
-> selected SatelliteSceneDetails
```

The card may request `assets.thumbnail.href` as a lightweight JPEG preview when the
asset exists. A thumbnail is never stretched over the map as the production raster.

Selecting a scene does not immediately move the camera. It sends the mapped scene to the
narrow imagery-map capability:

```text
user selects/applies scene
-> SatelliteImageryMap.apply(scene, AbortSignal)
-> MapLibreSatelliteImageryAdapter
-> validated visual asset
```

### 9.11 L2A raster request and MapLibre chain

The observed L2A visual asset is:

```json
{
  "url": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/38/T/MN/2025/7/S2A_38TMN_20250731_0_L2A/TCI.tif",
  "format": "COG",
  "mediaType": "image/tiff; application=geotiff; profile=cloud-optimized",
  "projection": "EPSG:32638",
  "resolutionMeters": 10,
  "shape": [10980, 10980]
}
```

The required rendering chain is:

```text
MapLibre requests Web Mercator tile z/x/y
-> raster adapter converts tile bounds to the scene projection
-> HTTP Range requests read only required COG headers/blocks/overviews
-> provider returns 206 Partial Content
-> worker decodes the requested RGB window
-> adapter reprojects/resamples EPSG:32638 pixels to EPSG:3857
-> adapter returns one 256x256 RGBA/PNG tile
-> MapLibre raster source renders the tile
```

Representative range request:

```http
GET /sentinel-s2-l2a-cogs/.../TCI.tif HTTP/1.1
Host: sentinel-cogs.s3.us-west-2.amazonaws.com
Range: bytes=0-16383
```

Representative response:

```http
HTTP/1.1 206 Partial Content
Content-Type: image/tiff
Content-Range: bytes 0-16383/<asset-size>
Content-Length: 16384
```

MapLibre's
[official COG example](https://maplibre.org/maplibre-gl-js/docs/examples/add-a-cog-raster-source/)
shows the custom-protocol shape:

```ts
maplibregl.addProtocol('cog', cogProtocol);

map.addSource('sentinel-imagery', {
  type: 'raster',
  url: 'cog://<validated-visual-asset-url>',
  tileSize: 256,
});

map.addLayer(
  {
    id: 'sentinel-imagery',
    type: 'raster',
    source: 'sentinel-imagery',
  },
  firstOsmReferenceLayerId,
);
```

This code is the desired MapLibre boundary, not a selected dependency. The example
adapter documents that its inputs must already use EPSG:3857 and that it does not
reproject. The observed Georgia scene uses EPSG:32638, so S5.1 must prove or choose the
reprojection-capable implementation before S5.5 adopts a production adapter.

### 9.12 L1C raster branch

The same live area/month query returned L1C metadata, but the visual asset differs:

```json
{
  "sceneId": "S2A_38TMN_20250731_0_L1C",
  "collection": "sentinel-2-l1c",
  "productType": "S2MSI1C",
  "projectionEpsg": 32638,
  "visualAsset": {
    "href": "s3://sentinel-s2-l1c/tiles/38/T/MN/2025/7/31/0/TCI.jp2",
    "type": "image/jp2",
    "roles": ["visual"],
    "shape": [10980, 10980]
  },
  "thumbnail": null
}
```

The browser cannot fetch the `s3://` URL through normal HTTP and does not provide a
MapLibre-ready JPEG 2000 tile decoder. Therefore:

```text
L1C STAC search/metadata
-> works through the same JSON query chain

L1C map rendering
-> requires an approved HTTPS asset/tile service
   or a browser JP2 + reprojection adapter
-> remains an S5.1 feasibility decision
```

Do not silently render the related L2A scene when the user selected L1C, and do not
present metadata-only L1C results as successfully applicable imagery.

### 9.13 Add the footprint and applied-state snapshot

The validated STAC geometry becomes a GeoJSON source:

```json
{
  "type": "Feature",
  "properties": {
    "sceneId": "S2A_38TMN_20250731_0_L2A"
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": ["validated scene footprint coordinates"]
  }
}
```

The map adapter owns:

```text
satellite raster source/layer
satellite footprint GeoJSON source/layers
applied scene ID
raster loading/ready/failed/hidden state
attribution
cleanup and cancellation
```

`Fit footprint` derives bounds from the validated geometry and calls the typed
map-camera capability. `Hide imagery` changes raster visibility according to the
reviewed footprint semantics without deleting search results.

### 9.14 Cancellation and typed failure chain

Cancellation travels through every boundary:

```text
TanStack Query AbortSignal
-> LoadSatelliteAvailability/SearchSatelliteScenes
-> SatelliteCatalogGateway
-> ky/fetch
-> pagination
-> raster protocol/worker/range requests
```

Stale operation IDs prevent cancelled or superseded responses from replacing current
state. Failures map into explicit categories:

```json
{
  "kind": "rate-limit | timeout | offline | http | schema | pagination | unsupported-asset | decode | reprojection | map-source | cancelled",
  "retryable": true,
  "message": "Safe actionable user-facing message"
}
```

Raw response bodies, headers, URLs with arbitrary queries, asset URLs, geometries, and
provider error objects never reach React or default diagnostics.

### 9.15 Complete query chain

```text
MapLibre settled viewport snapshot
-> typed search criteria
-> TanStack Query key and AbortSignal
-> availability/search application use case
-> SatelliteCatalogGateway
-> POST Earth Search /v1/search
-> STAC FeatureCollection JSON
-> bounded pagination
-> Zod envelope/item/geometry/asset validation
-> readonly SatelliteScene[]
-> coverage, edge distance, UTC grouping, and counts
-> Satellite results UI
-> selected visual asset
-> raster adapter
-> COG/JP2 range or approved tile requests
-> decode and reprojection
-> MapLibre raster layer plus GeoJSON footprint
```

## 10. Step-by-step work packages

### S5.0 Establish the reviewed plan and design governance

Scope:

- Create the feature branch from `main`.
- Replace the completed historical `PLAN.md` with this active plan.
- Save the canonical Penpot URL and synchronization rules in `AGENTS.md`.
- Inspect the live Satellite prototype and record the UI ledger and discrepancies.

Verification:

- `git diff --check`
- `pnpm format:check`
- Manual review that the prototype link opens the intended file/page and no Penpot
  content was overwritten.

Commit: `docs: plan Sentinel imagery implementation`

### S5.1 Choose and document the catalog/rendering path

Scope:

- Revalidate Earth Search collections, search behavior, CORS, attribution, and sample
  Georgia metadata.
- Exercise representative L1C and L2A assets in current Chrome.
- Prototype candidate raster paths behind a throwaway narrow adapter, not product UI.
- Measure render/cancellation/memory/bundle characteristics and inspect dependency
  licenses.
- Select or reject the product path and update `docs/map-providers.md` plus any approved
  configuration example.

Acceptance:

- One documented, replaceable, anonymous static-client path can render the required
  product levels, or the work stops with precise evidence and a product decision
  request.
- No provider key, backend, hosted telemetry, or unbounded whole-scene download is
  added.
- The spike is not left wired into production UI.

Commit: `docs(satellite): choose catalog and raster path`

### S5.2 Add satellite models, viewport search geometry, and use cases

Scope:

- Add readonly search, scene, acquisition, coverage, and result types.
- Add the `SatelliteCatalogGateway` port and cancellable availability/search use cases.
- Extend the map snapshot/capability with validated settled viewport bounds.
- Implement date validation, grouping, stable ordering, deduplication, coverage, and
  edge calculations.
- Define typed application errors for invalid criteria, result limit, geometry, and
  provider capability failures.

Tests in the same commit:

- Inclusive UTC ranges, invalid/reversed/oversized ranges, L1C/L2A separation.
- Deterministic acquisition grouping and stable scene order.
- Full, partial, zero, invalid, and boundary-touching coverage.
- Point inside/outside/near-edge distance semantics.
- Viewport bounds capture, antimeridian rejection/handling, and no exact geometry in
  diagnostics.

Commit: `feat(satellite): model viewport scene search`

### S5.3 Implement the validated STAC gateway and configuration

Scope:

- Add validated satellite provider configuration without exposing secrets.
- Implement the Earth Search adapter using the configured central `ky` policy and Zod
  schemas.
- Support availability and explicit scene search, bounded pagination, deterministic
  sorting, partial-item validation policy, and AbortSignal.
- Map HTTP/timeout/offline/rate-limit/schema/cancellation errors into typed outcomes.
- Construct the gateway and use cases in `createRuntimeServices` with explicit types.
- Add bounded feature diagnostics and safe provider health evidence.

Tests in the same commit:

- MSW success for L1C and L2A, empty results, multiple pages, and field fallbacks.
- Malformed envelope/item/geometry/date/cloud/assets/pagination URL.
- Cancellation, timeout, offline, 4xx, 429, 5xx, and partial validation.
- Configuration validation, HTTPS/origin safety, and fake token/query/body redaction.
- Fixture bytes are synthetic/minimal and no public provider is contacted.

Commit: `feat(satellite): add Earth Search gateway`

### S5.4 Build the prototype-aligned search sidebar and calendar

Scope:

- Extract Satellite UI from the generic `WorkspaceSidebar` into feature-focused
  components while preserving the shell and live map.
- Implement the compact viewport selector, inclusive range calendar, month navigation,
  availability annotations, L1C/L2A toggle, cloud threshold, other-imagery boundary,
  criteria summary, and Search Images action.
- Keep Marker visible and disabled with an honest explanation.
- Choose the calendar implementation through an explicit dependency/accessibility/bundle
  review. Prefer the existing MUI family; do not hand-roll inaccessible date semantics.
- Add loading, unavailable, empty, stale, validation-error, and retry states without
  clearing the last successful results unnecessarily.

Tests in the same commit:

- Keyboard range selection, month navigation, focus, labels, and live status updates.
- Availability loading/empty/error/partial states and reviewed per-day cloud summary.
- Product/cloud changes update availability and query keys without duplicate retry.
- Search captures current viewport once, disables invalid/repeated submission, and
  aborts superseded work.
- Marker and Other imagery remain unavailable without fake data.

Commit: `feat(satellite): build imagery search controls`

### S5.5 Integrate true-color imagery and footprint with MapLibre

Scope:

- Implement the chosen raster adapter behind `SatelliteImageryMap`.
- Register protocol/worker resources once, with deterministic cancellation and cleanup.
- Add stable satellite raster and footprint source/layer IDs at the reserved layer band.
- Apply one concrete scene, switch atomically, expose render loading/ready/failed/hidden
  snapshots, fit footprint, and hide/show raster.
- Preserve the applied scene across 2D/3D transitions and unrelated sidebar changes.
- Retain OSM attribution and add Sentinel/Copernicus/provider attribution while imagery
  is applied.
- Aggregate tile/decode/source errors and keep a usable base map on failure.

Tests in the same commit:

- Fake facade/adapter unit tests for add order, no duplicate sources/listeners, atomic
  replacement, cancellation, cleanup, and idempotent hide/show.
- Style/layer-order tests prove imagery is below hiking references and user geometry.
- Terrain transition, fit bounds, style/context recovery, and failed scene replacement.
- Local raster/COG fixture in Chromium; no public imagery request in required tests.

Commit: `feat(map): render selected Sentinel imagery`

### S5.6 Add results, metadata, selection, and applied actions

Scope:

- Add the adjacent shell-owned results pane from the Penpot layout without covering or
  remounting the map.
- Derive the pane title from the submitted center and compute scene/acquisition counts
  from returned data.
- Render month/date grouping, compact scene cards, thumbnails/footprint diagrams,
  coverage, edge warnings, expansion, and one expanded metadata card.
- Wire apply, applied, fit footprint, hide imagery, scene switch, pane close, and retry
  states to the narrow map capability.
- Keep selected/applied distinctions explicit and never imply a mosaic.

Tests in the same commit:

- Correct grouping/counts for zero, one, and multiple scenes/dates/months.
- Expansion and selection preserve list state; applied status follows the map snapshot.
- Metadata fallbacks never invent tile/orbit/product values.
- Apply loading/failure/retry, switch failure preserving the prior scene, fit, hide, and
  close-pane behavior.
- Pane focus order, accessible names, warnings, status announcements, and desktop
  overflow/scroll behavior.

Commit: `feat(satellite): add scene results and metadata`

### S5.7 Complete diagnostics, failure behavior, and developer evidence

Scope:

- Add stable events for availability, search, validation, apply, render, switch, hide,
  cancel, and failure outcomes with operation IDs and monotonic durations.
- Add a sanitized satellite snapshot to developer mode/support bundles when it
  materially improves diagnosis; version schemas and CLI compatibility if the bundle
  changes.
- Add a non-destructive provider/catalog/render health check only if it can run without
  delaying normal startup or downloading large data.
- Bound repeated tile/decode errors and include remediation hints for offline, rate
  limit, unsupported asset, decode, and WebGL/source failures.

Safe fields may include provider ID/origin, product level, date-span length, threshold,
result/invalid-item/page counts, public scene ID or hashed stable ID, render state,
duration, request count, and transferred-byte buckets. Never export exact bounds/center,
footprint geometry, asset/tile URLs, arbitrary query strings, request/response bodies,
headers, tokens, cookies, raw errors, or unbounded tile coordinates.

Tests in the same commit:

- Fake coordinates, filenames, tokens, query strings, headers, and asset URLs are absent
  from logs, snapshots, bundles, and CLI output.
- Repeated failures aggregate within caps and logging failure cannot break
  search/render.
- Bundle version compatibility and actionable unsupported-version messages.

Commit: `feat(diagnostics): capture satellite imagery evidence`

### S5.8 Harden end-to-end behavior, accessibility, documentation, and design sync

Scope:

- Add deterministic Chromium workflows against controlled STAC and raster fixtures.
- Cover GitHub Pages base path, search, grouping, apply, switch, hide, fit, terrain
  preservation, cancellation, malformed data, provider failure, and diagnostics export.
- Run axe on the search sidebar and results/details pane; complete a manual
  current-Chrome keyboard/visual pass.
- Update `docs/features.md`, `docs/runtime-flows.md`, `docs/project-structure.md`,
  `docs/map-providers.md`, provider configuration example, `README.md`, and
  `docs/README.md` only where their durable contracts changed.
- Apply accepted UI review changes to Penpot one operation at a time. Preserve unrelated
  future prototype features and update this plan's ledger/status.

Acceptance:

- Required browser tests reject every unexpected public request.
- The map does not remount and active imagery survives terrain/rail changes.
- Loading, empty, partial, error, applied, and hidden states match the reviewed
  prototype and are keyboard accessible.
- Stable docs contain no phase/stage/roadmap or delivery-progress leakage.

Commit: `test(satellite): harden imagery workflows` followed by
`docs: document Sentinel imagery operation` when the scopes are independently
reviewable.

## 11. Automatic test and acceptance matrix

| Boundary            | Required evidence                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Domain/application  | Criteria validation, UTC grouping, stable order, dedupe, bounds, coverage, edge distance, caps, cancellation                             |
| STAC infrastructure | Zod mapping, collections, fields, pagination, CORS/config assumptions, timeout/offline/429/5xx/malformed/partial errors via MSW          |
| Raster adapter      | Representative format/projection, layer order, atomic switch, cancellation, cache/resource bounds, cleanup, terrain and context recovery |
| React search        | All calendar/form states, keyboard range selection, availability, query keys, search submission, retry, Marker/Other boundaries          |
| React results       | Counts/grouping, expansion, metadata, apply/applied/failed/hidden, fit, pane close, responsive desktop overflow                          |
| Diagnostics         | Operation correlation, bounded fields, schema compatibility, secret/location/URL/body redaction                                          |
| Chromium            | Search → compare → apply → switch → terrain → hide, controlled failures, base path, no unexpected network, axe                           |
| Penpot              | Accepted review changes mirrored without replacing unimplemented future features                                                         |

Required browser fixtures must be synthetic or redistribution-safe. No test copies a
personal track or requires Earth Search/AWS availability.

## 12. Performance, privacy, and reliability limits

- The feasibility gate sets explicit search-result, pagination, date-span, worker,
  memory, request, transferred-byte, time-to-first-pixel, and cancellation budgets
  before the raster dependency is accepted.
- Keep COG/raster decoding off the UI thread when the chosen approach performs
  meaningful CPU work. Cap workers instead of defaulting to all logical processors.
- Do not download an entire full-resolution Sentinel scene merely to show the current
  viewport.
- Cancel obsolete availability/search/render work and ignore stale completion by
  operation ID.
- Keep the last successfully applied scene visible until its replacement is ready; if
  replacement fails, report failure and retain the prior usable scene.
- Bound in-memory tile/metadata caches and release scene-specific resources on switch,
  hide teardown, or map destruction according to the reviewed behavior.
- Do not persist search history, results, image bytes, exact bounds, or applied-scene
  geometry in IndexedDB for this workstream.
- Never send search coordinates anywhere except the explicitly configured catalog/raster
  providers required by the user command. Document that network boundary in the UI and
  stable privacy behavior.
- Provider/search/render failure must never remove the OSM map, terrain control, or
  existing local workspace state.

## 13. Quality gates and definition of done

Run narrow tests with every work package. Before feature handoff, run:

```text
pnpm repo:audit
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:coverage
pnpm build
pnpm e2e
pnpm check
```

Also verify:

1. The selected catalog and render path has current provider/CORS/license/attribution
   and replacement evidence in stable documentation.
2. L1C and L2A behavior matches the reviewed scope; neither is silently substituted.
3. Search and rendering are cancellable, bounded, typed, and diagnosable.
4. One explicit scene renders below OSM references with correct footprint, partial
   coverage, metadata, and attribution.
5. Switching/terrain/navigation does not recreate the map or lose unrelated state.
6. No secret, exact default-export location, asset URL, raw geometry, response body,
   personal data, generated artifact, or unexpected public-network test is included.
7. Automatic coverage remains above repository thresholds without meaningless assertions
   or ignores.
8. Production build works under the GitHub Pages base path and bundle impact is
   measured.
9. Current Chrome passes the reviewed visual and keyboard flows; axe passes critical
   Satellite states.
10. This plan, permanent docs, tests, code, and Penpot reflect the same accepted design.
11. The intended commits are pushed to a feature branch and available in a draft pull
    request targeting `main` before the feature is presented as finished.

## 14. Prototype review questions and discrepancy log

These are design/data-contract questions, not permission to reinterpret the prototype.
Recommended defaults let implementation planning continue, but the accepted answers must
be reflected in Penpot and this plan before the affected UI is implemented.

| Question                           | Current prototype observation                                                                   | Recommended contract                                                                                  | Review state    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------- |
| Inclusive range/result consistency | The range label and selected cells end on 17 July 2026, while the first result is dated 18 July | Search results must stay within the inclusive submitted range; change sample result or selected range | Awaiting review |
| Acquisition count consistency      | Header says `4 acquisition days`, while six visible acquisition dates span July and June        | Derive count from distinct UTC dates in all returned scenes and keep sample content consistent        | Awaiting review |
| Calendar cloud annotation          | A single cloud percentage appears below a date even though that date may have several scenes    | Show the lowest scene cloud percentage for that date and use it only as an availability hint          | Awaiting review |
| Hide imagery versus footprint      | The expanded card has `Hide imagery` but no separate footprint visibility action                | Hide the raster, retain selection/metadata and footprint so coverage stays inspectable                | Awaiting review |

If review changes any recommended contract, update the relevant fixed decision, tests,
Penpot sample state, and work package before implementation.
