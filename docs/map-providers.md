# Map provider decision

## Decision record

- Evidence date: **2026-07-18**.
- Scope: anonymous static browser client hosted on GitHub Pages and local development
  origins.
- Decision: use the OpenFreeMap public OpenMapTiles vector source and the AWS Open Data
  Mapzen Terrain Tiles bucket as replaceable defaults.
- Credentials: neither default requires an API key, cookie, account, signed request, or
  referrer-restricted secret. No provider credential is included in the bundle.

Provider behavior and policy are time-sensitive. Recheck this record before a public
traffic increase or whenever the defaults change.

## Vector basemap: OpenFreeMap

The production default is the TileJSON endpoint `https://tiles.openfreemap.org/planet`.
The official [quick-start guide](https://openfreemap.org/quick_start/) documents
MapLibre use through the public instance, and the
[provider page](https://openfreemap.org/) states that the instance needs no registration
or API key and currently imposes no map-view/request limit. It does not offer an SLA.

The inspected live TileJSON advertised zooms 0 through 14 and a versioned HTTPS PBF
template. The provider's Liberty style identified these optional support endpoints:

- Glyphs: `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`.
- Sprite metadata/image base: `https://tiles.openfreemap.org/sprites/ofm_f384/ofm`.

The application uses glyphs for labels but intentionally avoids provider sprite
coupling. Hiking points are rendered with simple circles and text. The source is the
unmodified [OpenMapTiles schema](https://openmaptiles.org/schema/), which gives this
configuration mapping:

| Application concept | Source layer          | Relevant fields/values                                                       |
| ------------------- | --------------------- | ---------------------------------------------------------------------------- |
| Land cover          | `landcover`           | `class` (`wood`, `grass`, `farmland`, `wetland`, `ice`, etc.) and `subclass` |
| Human land use      | `landuse`             | `class` (`military`, residential, and other uses)                            |
| Protected land      | `park`                | `class`, names                                                               |
| Water               | `water`, `waterway`   | geometry and `class`                                                         |
| Boundaries          | `boundary`            | `admin_level`, `disputed`, `maritime`                                        |
| Roads and paths     | `transportation`      | `class`, `subclass`, `brunnel`                                               |
| Road/path labels    | `transportation_name` | names, `class`, `subclass`                                                   |
| Peaks and passes    | `mountain_peak`       | `class` (`peak`, `saddle`, etc.), names, `ele`                               |
| Hiking POIs         | `poi`                 | `class`, `subclass`, names, `rank`                                           |
| Settlements         | `place`               | `class`, names, `rank`, `capital`                                            |
| Water labels        | `water_name`          | names and geometry-specific fields                                           |

The transportation schema explicitly includes `path`, `track`, `footway`, `steps`,
`bridleway`, and `cycleway` classifications. OpenMapTiles does not expose hiking route
relations as a dedicated source layer in this default schema, so the current style shows
physical ways rather than claiming to show official marked routes.

English-first labels use `name:en`, then the provider-generated `name:latin` field for
transliteration, and finally legacy English/native fallbacks. Land-cover `ice` supplies
the available glacier geometry. Land-use `military` supplies restricted-area geometry,
but the schema has no dependable general access/ownership field; private-property and
other closure coverage is therefore unavailable rather than inferred from unrelated
land-use classes.

The Layers panel represents this source under its provider heading. One **Natural
features** checkbox owns the polygon layers for vegetation (`landcover` excluding ice),
glaciers (`landcover` ice), and water bodies (`water`). Waterway lines and water labels
remain visible as navigation context. The remaining source controls cover Restricted
areas (`landuse` military), Hiking paths, Roads, and Places and POIs. New source-layer
families must be added to the corresponding Layers control in the same change as their
style.

Waterways and water bodies share one blue. The `waterway` layer is ordered below the
`water` fill so lake and reservoir polygons mask overlapping river centerlines.

### Attribution and licensing

Attribution remains visible in MapLibre's attribution control:

> OpenFreeMap · © OpenMapTiles · Data from OpenStreetMap

Each name links to the provider/license page supplied by the TileJSON. OpenFreeMap's
[attribution section](https://openfreemap.org/#attribution) requires OpenMapTiles and
OpenStreetMap credit; OpenFreeMap credit itself is encouraged. The OpenMapTiles schema
is CC-BY and its implementation is BSD-licensed. OSM data remains subject to ODbL and
the OSM attribution guidance.

### Browser evidence and replacement

A page served from `http://127.0.0.1:4174` fetched the cross-origin TileJSON
successfully with status 200 (`application/json`, 19,254 bytes, 368 ms in the observed
run). The provider's own MapLibre example loaded its style, tiles, glyphs, and
attribution over HTTPS. This confirms browser CORS for the tested local origin; GitHub
Pages uses the same anonymous CORS request model.

The base source, support endpoints, layer mapping, and attribution are parsed
configuration. Replacing OpenFreeMap therefore requires a compatible TileJSON/schema
configuration and style-mapping review, not changes to React workflows.

## Place search: public Nominatim

The replaceable default place-search endpoint is the public OpenStreetMap Nominatim
Search API. Search is submit-only because the public usage policy forbids client-side
autocomplete. Each request supplies a bounded `viewbox`; the application begins with the
visible viewport and doubles the bounded area until it reaches a 500 km radius from the
original viewport center. Matches from narrower areas remain first while wider responses
append new displayed name-and-category combinations. This collapses one named street
split across several OSM ways without suppressing same-name features whose full location
labels differ, and avoids allowing a nearby road or business name to hide a more distant
settlement. Provider categories are normalized into settlements, administrative areas,
mountains, water, and other results. Settlement classification uses explicit OSM place
types rather than the whole `place` category, keeping squares and similar objects out of
the default list. The first four categories are visible by default; streets, businesses,
and other POIs require the explicit secondary-results action.

JSONv2 `category` and `type` are the result object's open-ended primary OSM tag, not a
stable Nominatim enum. The adapter therefore allowlists reviewed tags: cities, towns,
villages, hamlets, and isolated dwellings; administrative boundaries; peaks, ranges,
ridges, saddles, volcanoes, and mountain passes; and named rivers, streams, canals,
waterfalls, springs, bays, straits, and water bodies. Every other tag is
deterministically classified as `other`. Requests select the `address`, `natural`, and
`manmade` provider layers so POI and railway matches cannot consume the bounded result
quota. Raw tag values are retained at the port boundary while presentation converts them
to readable labels.

The adapter enforces a minimum one-second interval between network requests, caches
query-and-viewbox responses for five minutes, limits each provider response to the
configured maximum, validates JSON with Zod, and exposes typed timeout, rate-limit,
invalid-response, provider, and network failures. Queries and result metadata are not
written to diagnostics. UI attribution links to the OpenStreetMap copyright page.

## Terrain: AWS Open Data Mapzen Terrain Tiles

The terrain default is
`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` with:

- Encoding: `terrarium`.
- Tile size: 256 pixels.
- Zoom range: 0 through 15; higher map zooms overzoom the last DEM level.
- HTTPS and anonymous access.
- Exaggeration: 1.15, deliberately conservative for route-planning context.
- Relief: low-contrast hillshade from the same source in both flat and 3D modes.
- Contours: browser-generated vector tiles from zoom 11 through 15, with a 32-tile
  least-recently-used DEM cache.
- Preprocessing: a shared filtered-Terrarium protocol repairs only rejected pixels
  before the PNG reaches relief, 3D terrain, or contour generation.

The [AWS Open Data entry](https://registry.opendata.aws/terrain-tiles/) describes global
bare-earth elevation and anonymous bucket access. The upstream
[service documentation](https://github.com/tilezen/joerd/blob/master/docs/use-service.md)
documents the Terrarium endpoint, 256-pixel size, and zoom limit.

A browser-origin single-range request to a Georgia-covering PNG returned status 206 and
exactly 1,024 requested bytes in 538 ms. This verifies HTTPS, CORS, and byte-range
behavior for the observed endpoint.

### Conservative Terrarium repair

The configured tile at `15/20448/12164`, covering the reported map point, contained no
transparent pixels and no RGB `0/0/0` Terrarium sentinel. Its decoded range was −710.68
m to 1,191.20 m. Exactly 256 pixels were below zero: the complete local row 5. The
eastern neighbor repeated the same one-row pattern (−701.53 m minimum), while the
western, northern, and southern neighbors remained within 830.05 m to 1,278.50 m. The
bad scanline crosses one shared tile border and begins at another; it is not a coastline
transition or an artifact introduced by contour rendering.

The filter uses a one-pixel halo decoded from all eight neighboring tiles. It rejects
transparent pixels, configured sentinel elevations, values outside the configured
physical range, and isolated local extremes. The local test requires at least five
neighbors close to their median, median absolute deviation no greater than 80 m, a
neighbors close to their median, median absolute deviation no greater than 80 m, no more
than one neighbor supporting the extreme center value, and a center residual of at least
500 m upward or 300 m downward. The asymmetric limit reflects confirmed provider
corruption while keeping upward peak detection more conservative. This preserves
coherent ridges and cliffs, including narrow features with two supporting pixels.
Rejected pixels are replaced with the median of valid immediate neighbors; accepted
pixels are never resampled, blurred, or re-encoded. The production filter reuses fixed
eight-value neighbor/deviation buffers, reuses the classification median for repair, and
clones output bytes only at the first changed pixel. A deterministic reference oracle
verifies identical repair counts and RGBA bytes across the benchmark scenarios. A tile
with no repairs returns the original PNG bytes.

The default physical range is −500 m through 9,000 m and the explicit sentinel list is
`[-32768]`. These bounds cover global terrestrial elevations conservatively while
rejecting the observed inland −700 m scanline. Applying the policy repairs all 256 bad
pixels and changes the center tile range to 969.49–1,191.20 m. Thresholds and the
48-entry processed-PNG and decoded-context LRU bounds are validated provider
configuration, not rendering constants. Requests use the provider timeout and MapLibre
abort signal. Diagnostics export only duration and aggregate no-data, sentinel,
impossible-value, spike, repaired, and unrepaired counts; tile URLs, indices,
coordinates, and pixels are excluded. Overlapping neighborhoods coalesce in-flight
source fetch and decode work, and diagnostics are emitted in fixed-size aggregate
batches instead of one event per rendered tile. Mixed results retain the batch's most
severe status without creating a new event for every cancellation transition.

At Lisi Lake, tiles `15/20455/12195` and `15/20456/12195` contain 63 compact downward
spikes against a 626–635 m local surface. Their residuals range from −315.19 m to
−1,826.25 m, with source minima of −683.80 m and −1,197.81 m. The repeated pixel-offset
pattern crosses the shared tile boundary while surrounding tiles remain plausible. A 300
m downward threshold rejects all 63; 400 m leaves five and 500 m leaves eighteen.

Settings > Rendering exposes `Repair invalid DEM elevation pixels`, enabled by default
and persisted locally. Disabling it bypasses decoding and repair and returns the
original center PNG. Both modes retain one shared protocol for relief, 3D terrain, and
contours; changing the preference invalidates their mode-dependent caches and reloads
all three consumers together so they cannot disagree.

### Attribution, limits, and failure policy

The source attribution is shown whenever the DEM source is configured or terrain is
requested:

> Terrain data: Mapzen/AWS Open Data — includes Copernicus, USGS, NOAA, and regional
> providers

It links to the upstream
[full attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md),
which is authoritative and includes region-specific credits. For Georgia, the global and
European inputs make Copernicus/European Union and USGS/NOAA provenance especially
relevant.

The S3 endpoint has no CDN or SLA; upstream documentation says it is optimized for EC2
networking. This is acceptable for interactive relief, contours, and explicitly enabled
3D, but it is the main production risk. A missing/no-data tile or network failure may
omit an overlay or return 3D to flat mode, but it never blocks the vector basemap. There
is no silent terrain provider failover because a replacement could have different
licensing and elevation semantics.

### Client-side contour generation

The application pins `maplibre-contour` 0.0.5 (BSD-3-Clause), the implementation used by
the MapLibre contour example. Its registered protocol requests only visible DEM tiles,
honors MapLibre cancellation, decodes Terrarium elevation in the browser, and returns
vector tiles containing `ele` and minor/index `level` properties. The application uses
50 m minor and 200 m index thresholds by default, labels index lines only, and replaces
the source tile template atomically when spacing changes. No geometry, token, backend,
or hosted processing service is introduced.

One application-owned module worker runs DEM decode, repair, PNG encode, parsed-DEM
caching, and contour generation; MapLibre retains its own renderer worker. DEM requests
remain active during camera movement, while new contour requests wait in a bounded,
cancellation-aware queue until the camera settles. Ordinary provider and calculation
failures remain per-request. A broken worker channel is restarted once and then falls
back to the identical inline engine for the page session, preserving terrain features
with a possible responsiveness reduction.

MapLibre transfers protocol responses to a worker. The adapter therefore gives each
delivery its own `ArrayBuffer`; the contour library's cached buffer is never transferred
or detached. Repeated cache hits remain usable during rapid camera and zoom changes.

The terrain configuration validates filter thresholds, physical bounds, filter cache
size, contour minimum/maximum zoom, and contour cache size. The contour maximum cannot
exceed the DEM provider maximum. Replacing the provider requires compatible HTTPS/CORS
image tiles, correct Terrarium or Mapbox encoding, updated attribution, and a review of
contour density and cache bounds.

## Rejected defaults

- Public `tile.openstreetmap.org` raster tiles: rejected because the application uses a
  vector OSM foundation and the OSM Foundation raster service is not the application's
  production vector provider.
- MapTiler Cloud: technically suitable but rejected as the anonymous default because its
  hosted APIs require a public API key and account/plan policy. A public key is not a
  secret, but it adds an avoidable provider account dependency for this MVP.
- MapLibre demo vector/terrain endpoints: useful for examples and tests, but rejected as
  production defaults because they are demo infrastructure without a product SLA.

## Sentinel-2 catalog and raster feasibility

The evidence below was revalidated on **2026-07-19** against Earth Search v1 and public
AWS Sentinel objects. Earth Search remains the selected replaceable catalog candidate:

- Root/search origin: `https://earth-search.aws.element84.com/v1`.
- Collections: `sentinel-2-l1c` and `sentinel-2-l2a`.
- Search transport: anonymous STAC 1.0 JSON over HTTPS; production code must still
  validate every response and bounded pagination link.
- Service policy: public best-effort access with no SLA. A private catalog or silent
  provider fallback is not assumed.

The validated public configuration supplies the exact search URL, distinct collection
IDs, plain-text attribution, and a one-to-ten page cap (default five). The production
gateway sends a single collection, WGS84 point intersection, inclusive UTC interval,
scene-level cloud filter, descending acquisition sort, allowlisted fields, and at most
100 items. It follows only one unambiguous `POST` next link at a time when the link has
the configured HTTPS origin/path, no query or fragment, and a bounded opaque `next`
token. Invalid items, counts, assets, or pagination fail closed; raw bodies, links,
tokens, and exact geometry are never logged.

### L2A true-color COG

This was a non-product, time-boxed check. Earth Search v1 returned the item
`S2A_38TMM_20250731_0_L2A` for a Tbilisi-area bounding box. Its `visual` asset was the
public true-color COG:

`https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/38/T/MM/2025/7/S2A_38TMM_20250731_0_L2A/TCI.tif`

The asset declared `image/tiff; application=geotiff; profile=cloud-optimized`. From the
local browser origin, a request for bytes 0–16,383 succeeded with status 206, returned
exactly 16,384 bytes, and completed in 1,891 ms in the observed run. Thus the tested
Earth Search asset supports browser CORS and partial range access without credentials.
The [AWS dataset record](https://registry.opendata.aws/sentinel-2-l2a-cogs/) documents
the free/open Sentinel terms and public Earth Search catalog.

The 2026-07-19 Georgia sample `S2A_38TMN_20250731_0_L2A` reported EPSG:32638 and a
220,705,355-byte true-color COG. A bounded request for its first 65,536 bytes again
returned `206 Partial Content`, `Accept-Ranges: bytes`, and browser-permissive CORS.

The `visual` TCI COG is an 8-bit display product whose prior stretch may clip bright
snow to white. A later transform cannot reconstruct lost channel detail, so the
application instead renders Earth Search's separate `red`, `green`, and `blue` L2A
reflectance COGs.

MapLibre GL JS does not directly render a GeoTIFF/COG as a raster source, and the
inspected direct COG protocol accepts EPSG:3857 input but does not reproject the UTM
Sentinel sample. The application therefore uses a configured dynamic COG tile adapter.
The default template calls Development Seed's public
[TiTiler demo](https://developmentseed.org/titiler/examples/notebooks/Working_with_STAC_simple/)
[`/stac/tiles` endpoint](https://developmentseed.org/titiler/endpoints/stac/) with
`WebMercatorQuad`, the MapLibre tile coordinates, the validated STAC item, and ordered
red/green/blue assets. The default maps each channel over 0–10,000 reflectance before
display gamma. Users can persistently tune the upper reflectance bound, gamma, and up to
five times normal saturation in Settings; a lower bound brightens midtones but can clip
the brightest snow. TiTiler performs bounded COG reads, RGB composition, reprojection,
and web-tile encoding; MapLibre receives ordinary 256-pixel raster tiles.

The default is anonymous and requires no browser secret, but it is a best-effort demo
service with no project SLA. It is acceptable for the current low-traffic static MVP and
manual review, not sustained production traffic. The renderer ID, HTTPS template, tile
size, zoom bounds, and attribution are validated public configuration so a managed
TiTiler-compatible deployment can replace it without changing catalog, UI, or map
commands. There is no silent renderer fallback.

The renderer has its own validated 60-second request ceiling, separate from the shorter
catalog and terrain request policy. This accommodates slow imagery delivery while still
ending a stalled staging operation predictably; replacing, clearing, or superseding a
scene cancels the wait immediately.

The validated renderer template contains explicit `{reflectanceMax}`, `{gamma}`, and
`{saturation}` tokens. The controller substitutes only bounded numeric preferences and
never stores the resulting provider URL. Renderer HTTP rejection, throttling, server
failure, timeout, and an otherwise unusable tile are mapped to distinct safe UI errors.
TiTiler's CloudFront distribution reflects `Access-Control-Allow-Origin` but can reuse a
cached tile across request origins. Renderers that declare the `application-origin`
cache-partition policy therefore receive a sanitized, stable `application_origin` value
derived from scheme, host, and port. The default GitHub Pages deployment uses
`https-bogdandm-github-io`, while local ports receive distinct values; renderers
configured with `none` receive no extra parameter. This value contains no path, query,
user data, or secret. For an already active raster, HTTP 429, HTTP 5xx, timeout, and
network failures trigger up to three deduplicated failed-tile refreshes with exponential
delay. Refreshing only the failed canonical tile coordinates keeps already rendered
imagery available. The current status names the exact HTTP code when available;
developer diagnostics also retain the stable source ID, safe failure class, aggregate
count, recovery state, and retry attempt. URLs, queries, response bodies, and tile
coordinates remain excluded. MapLibre status zero is reported as `no-response`, which
accurately covers blocked CORS responses as well as connection failures without
inventing an HTTP status.

The map adapter prepares a replacement raster under a second stable source/layer slot
and reveals it only after MapLibre reports the source loaded. Transient staging failures
receive the same bounded failed-tile refreshes and stability check as active imagery. A
remaining transient tile does not reject otherwise usable partial imagery; it is
promoted after the bounded retries while its failure remains visible until MapLibre
later returns successful data for that exact tile. A non-retryable failure, timeout,
cancellation, or supersession removes only staging resources and leaves the prior scene
and basemap usable. The validated WGS84 footprint renders independently as GeoJSON,
making partial coverage explicit. The application never logs or stores the COG or tile
URL in shared state or support bundles.

A 2026-07-19 current-Chrome smoke searched the live Georgia viewport, applied
`S2A_38TLM_20260709_0_L2A`, and displayed the georeferenced true-color tiles plus the
independent footprint and combined provider attribution. Hiding/restoring the raster
through Layers left the footprint and basemap in place; the same applied source remained
usable after enabling 3D terrain and changing rail destinations.

### L1C true-color JP2

The same bounded Georgia query returned `S2A_38TMN_20250731_0_L1C`, EPSG:32638. Its
`visual` asset is a 10980-by-10980 JPEG 2000 object referenced as
`s3://sentinel-s2-l1c/tiles/38/T/MN/2025/7/31/0/TCI.jp2`; the concrete item has no
thumbnail. The public bucket/key maps to the equivalent anonymous HTTPS URL. A bounded
1,024-byte request returned `206 Partial Content`, `Accept-Ranges: bytes`, and
browser-permissive CORS; the complete object is 104,134,127 bytes.

This proves transport but not a production render path. Current general-purpose
[OpenJPEG](https://github.com/uclouvain/openjpeg)/WebAssembly decoders do not establish
a maintained browser adapter that requests only the visible region, reprojects UTM to
Web Mercator, feeds MapLibre, and supports bounded memory plus prompt cancellation.
Downloading and decoding the whole 104 MB object is rejected. L1C search metadata can be
implemented independently, but the application must label its visual asset as
unsupported until a bounded adapter or an approved raster tile service is selected. It
must never apply the corresponding L2A scene as a substitute.

## Verification record

The required Chromium suite uses generated local vector, glyph, and DEM fixtures. The
recorded 2026-07-18 run exercised the production style, camera reload, 2D/3D
transitions, terrain retry, vector failure, WebGL context loss/restoration, diagnostics,
attribution focus, accessibility, and rejection of every unexpected public request.
Public-provider availability is deliberately outside that required gate.

The live checks recorded above independently confirmed anonymous browser CORS for the
OpenFreeMap TileJSON and AWS terrain range request. A combined local Vite smoke in the
Codex in-app Chrome reached the application shell, but that embedded browser exposed no
IndexedDB API. The observation found a startup resilience gap: a non-settling camera
read could indefinitely delay MapLibre mount. The implementation now bounds that read
and falls back to the Georgia overview with a storage warning, with component coverage.

The in-app browser's local-navigation policy prevented a post-fix live-provider rerun.
Use the checklist below for normal-desktop-Chrome verification before public release; do
not treat the separate endpoint and deterministic fixture evidence as a completed
real-provider application smoke.

## Manual revalidation checklist

1. Open the GitHub Pages and local origins in current stable desktop Chrome.
2. Confirm vector TileJSON, a representative Georgia PBF, glyphs, and the DEM tile
   return over HTTPS with CORS and no credential.
3. Confirm attribution links remain visible and keyboard reachable in 2D and 3D.
4. Pan/zoom/pitch around Georgia; record style-ready and first-idle diagnostics.
5. Simulate vector and DEM failure separately and confirm the documented fatal/degraded
   behavior.
6. Recheck provider policy, schema version, source-layer list, and attribution text.
