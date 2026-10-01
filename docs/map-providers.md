# Map providers

The application is an anonymous static client hosted on GitHub Pages. Every default
provider is keyless: no API key, cookie, account, signed request, or referrer-restricted
secret is bundled. Provider behavior and policy are time-sensitive; recheck this file
before a public traffic increase or whenever a default changes.

## Configuration

Schemas and defaults live in `src/bootstrap/configuration`:

| Area                               | Schema and defaults                 | Public override                         |
| ---------------------------------- | ----------------------------------- | --------------------------------------- |
| Basemap, terrain, and imagery      | `MapProviderConfiguration.ts`       | `VITE_MAP_PROVIDER_CONFIGURATION`       |
| Place search, reverse, nearby name | `GeocodingProviderConfiguration.ts` | `VITE_GEOCODING_PROVIDER_CONFIGURATION` |
| Point forecast and weather map     | `WeatherProviderConfiguration.ts`   | none                                    |

Overrides are JSON validated by strict Zod schemas; see the
[map](./map-provider-configuration.example.json) and
[geocoding](./geocoding-provider-configuration.example.json) examples, which equal the
defaults. Map endpoints must be HTTPS or application-relative, templates must contain
their tile tokens, and attribution rejects script markup. The imagery basemap sections
(`satelliteBasemap`, `bingSatelliteBasemap`, `esriSatelliteBasemap`, `naprOrthophoto`)
fall back to their defaults when omitted. An invalid override fails closed with a
message that never echoes URLs or contents; diagnostics record only provider IDs and
origins.

Replacing a provider requires a compatible schema or tile format, updated attribution,
and a review of the style mapping and limits below, not changes to React workflows.

## Hiking vector: OpenFreeMap/OpenMapTiles

The basemap is a hybrid of two vector sources. OpenFreeMap serves the unmodified
[OpenMapTiles schema](https://openmaptiles.org/schema/) through the TileJSON endpoint
`https://tiles.openfreemap.org/planet` (z0–14) and glyphs from
`https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`. The
[provider](https://openfreemap.org/) requires no registration or key and currently
imposes no request limit, but offers no SLA. Provider sprites are not used; hiking
points render as circles and text.

| Application concept           | Source layer          | Relevant fields/values                                                       |
| ----------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| Land cover                    | `landcover`           | `class` (`wood`, `grass`, `farmland`, `wetland`, `ice`, etc.) and `subclass` |
| Human land use                | `landuse`             | `class` (`military`, residential, and other uses)                            |
| Protected land                | `park`                | `class`, names                                                               |
| Water                         | `water`, `waterway`   | geometry and `class`                                                         |
| Boundaries                    | `boundary`            | `admin_level`, `disputed`, `maritime`                                        |
| Overview paths and bridleways | `transportation`      | `class`, `subclass`, `brunnel`; overview paths stop at z13                   |
| Road/path labels              | `transportation_name` | names, `class`, `subclass`                                                   |
| Peaks and passes              | `mountain_peak`       | `class` (`peak`, `saddle`, etc.), names, `ele`                               |
| Hiking POIs                   | `poi`                 | `class`, `subclass`, names, `rank`                                           |
| Settlements                   | `place`               | `class`, names, `rank`, `capital`                                            |
| Water labels                  | `water_name`          | names and geometry-specific fields                                           |

OpenMapTiles has no hiking-route relation layer, so the style shows physical ways
(`path`, `track`, `footway`, `steps`, `bridleway`, `cycleway`) rather than official
marked routes. Map labels are English-first in every UI language: `name:en`, then the
provider-generated `name:latin`, then legacy fallbacks
(`src/presentation/map/mapStyleFactory.ts`). Land-cover `ice` supplies glaciers and
land-use `military` supplies restricted areas; the schema has no dependable
access/ownership field, so private-property closures are not inferred. New source-layer
families must get a Layers control in the same change as their style.

## Detail vector: OSM Shortbread v1

The OSM Foundation endpoint
`https://vector.openstreetmap.org/shortbread_v1/tilejson.json` (z0–14, overzoomed above)
is a second source, not a replacement. Shortbread supplies `land` (`kind = brownfield`),
unfiltered `buildings`, and `streets`; OpenFreeMap stays authoritative for peaks,
saddles, ridges, POIs, water and place labels, glyphs, and z10–12 overview paths.

Visible roads use Shortbread `motorway`, `trunk`, `primary`, `secondary`, `tertiary`,
`unclassified`, `residential`, `living_street`, and `service`; from z13 it also supplies
`track`, `footway`, `path`, `cycleway`, `pedestrian`, and `steps`. Bridleway styling
still comes from OpenMapTiles because Shortbread v1 has no such distinction.

OSM Foundation tiles are best-effort public infrastructure for normal attributed
interactive use: keep the browser's Referer and User-Agent, allow ordinary caching, add
no cache-busting or synthetic headers, and never bulk-download, prefetch, archive, or
prepare offline data. The application requests tiles only for the current view or a
user-triggered bounded route and has no proxy, retry, or fallback provider.

### Attribution and licensing

Desktop MapLibre attribution shows:

> OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors

The OpenFreeMap source credits OpenFreeMap and OpenMapTiles; the Shortbread source
credits OSM contributors once. The smartphone map omits the attribution control to keep
the map-first surface (`MapWorkspace.tsx`). OpenFreeMap's
[attribution section](https://openfreemap.org/#attribution) requires OpenMapTiles and
OpenStreetMap credit. The OpenMapTiles schema is CC-BY, its implementation BSD; OSM data
is ODbL.

## Routing tiles

In-browser routing (`src/infrastructure/routing`) reads the configured `detailVector`
`streets` layer at z14, the same geometry drawn from z13, so routes do not diverge from
the visible detail map. Limits:

- Each leg's endpoint bounds expand by the larger of 2,000 m or 25% of the geodesic
  distance; coverage above 256 tiles is rejected. A disconnected search that reaches the
  boundary retries once with doubled padding.
- Tile fetches run at most eight at a time into a worker-owned 128-entry LRU; MapLibre's
  viewport and tile cache do not participate. A calculation times out after 60 s.
- Every street kind participates except construction/proposed, rail, and non-road
  aeroway kinds. Explicit `foot=no` or `foot=private` is rejected when a replacement
  provider supplies it; Shortbread publishes no foot/access values or feature IDs, and
  the router infers no access or one-way rules absent from the data.
- Topology uses one 4,096-unit MVT grid: exact shared vertices connect, and a 512-unit
  spatial index splits crossings, T junctions, overlaps, and gaps of at most two units.
  Inferred junctions require matching layer and bridge/tunnel metadata.

`pnpm diagnostics:routing-inspect` inspects the configured TileJSON and layer outside
MapLibre to detect provider drift (`tools/diagnostics/inspectRoutingTiles.ts`).
Shortbread can still omit, misclassify, or grade-separate a physical connection.

## Place search and names: Nominatim and Overpass

The defaults are the public OpenStreetMap Nominatim search and reverse endpoints under
`https://nominatim.openstreetmap.org/` plus the Overpass interpreter at
`https://overpass-api.de/api/interpreter`
(`src/infrastructure/geocoding/NominatimPlaceSearchGateway.ts`). Operating limits:

- Search is submit-only because the Nominatim usage policy forbids client autocomplete.
- Each search sends a bounded `viewbox`, starting at the visible viewport and doubling
  up to a 500 km radius, and selects the `address`, `natural`, and `manmade` layers.
- All three endpoints share a minimum one-second request interval, a five-minute cache,
  the configured timeout and result cap (default 12 s and 10), Zod validation, and typed
  timeout, rate-limit, invalid-response, provider, and network failures.
- JSONv2 `category`/`type` is an open-ended OSM tag, so the adapter allowlists reviewed
  settlement, administrative, mountain, and water tags and classifies everything else as
  `other`.
- Imported-track naming requests reverse lookups (zoom 14, `addressdetails=1`,
  `Accept-Language: en`) that return only the largest enclosing city, town, village,
  hamlet, or isolated dwelling, so a town quarter resolves to its town and an
  administrative-only match names nothing.
- Landmark lookups send one Overpass query per anchor: a single `around:2000` scan of
  named objects into a set, in-memory filters for the categories naming ranks, at most
  50 centres, and a declared 32 MiB `maxsize`. On the public endpoint this finished in
  1–7 s, while a key-regex filter took up to 20 s and per-tag `around` unions timed out.
- Overpass reports query timeouts as HTTP 200 with a `runtime error` remark; that and
  HTTP 504 are retried twice (after 2 s and 5 s). HTTP 429 means this client's slots are
  used and is reported without a retry. Failed lookups are skipped and explained in the
  preview; they never block import.

Queries, coordinates, and returned names are not written to diagnostics. UI attribution
links to the OpenStreetMap copyright page.

## Terrain: AWS Open Data Mapzen Terrain Tiles

The DEM is `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`:
Terrarium encoding, 256-pixel tiles, z0–15 (overzoomed above), anonymous HTTPS with
browser CORS and byte ranges. The
[AWS Open Data entry](https://registry.opendata.aws/terrain-tiles/) and
[service documentation](https://github.com/tilezen/joerd/blob/master/docs/use-service.md)
describe the dataset and limits. One filtered protocol feeds hillshade relief, 3D
terrain (exaggeration 1.15), browser-generated contours (z11–15), and DEM elevation
sampling for tracks, point inspection, and forecast downscaling
(`src/infrastructure/elevation/RasterDemElevationProvider.ts`).

### Terrarium repair

The provider publishes corrupted pixels, for example a complete −700 m scanline near
Stepantsminda and compact downward spikes of −315 m to −1,826 m at Lisi Lake.
`TerrariumDemFilter.ts` repairs them in one stencil pass over the tile plus a one-pixel
halo from its eight neighbors. It rejects transparent pixels, sentinel values
(`-32768`), elevations outside −500 m to 9,000 m, and isolated extremes whose residual
from a consistent neighborhood (at least five neighbors, MAD ≤ 80 m, at most one
supporting neighbor) is at least 500 m upward or 300 m downward. Rejected pixels take
the neighbor median; accepted pixels are never resampled, and an unrepaired tile returns
its original bytes. All thresholds and the 48-entry caches are validated configuration.

Layers exposes `Repair invalid DEM elevation pixels`, enabled by default and persisted
locally. Changing it reloads relief, 3D terrain, and contours together so they cannot
disagree. Diagnostics export only durations and aggregate repair counts, never tile
URLs, indices, coordinates, or pixels.

### Contours and compute worker

`maplibre-contour` 0.0.5 (BSD-3-Clause) generates contour vector tiles for visible DEM
tiles only, with a user-selected minor interval (default 50 m), 200 m index lines, and a
32-tile cache. One application-owned module worker runs DEM decode, repair, encode, and
contour generation; contour requests wait until the camera settles. A broken worker is
restarted once, then the identical inline engine takes over for the session. Relief and
3D rendering stay on MapLibre's own workers and the GPU.

### Attribution, limits, and failure policy

Desktop attribution reads `Terrain data: Mapzen/AWS Open Data providers` and links to
the authoritative
[attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md);
for Georgia, Copernicus/EU and USGS/NOAA inputs are the relevant ones.

The S3 endpoint has no CDN or SLA and is the main production risk. A missing tile or
network failure may omit an overlay or return 3D to flat mode but never blocks the
vector basemap. There is no terrain failover because a replacement could differ in
licensing and elevation semantics; it needs HTTPS/CORS tiles, Terrarium or Mapbox
encoding, updated attribution, and a contour density review.

## Imagery basemaps

Google, Bing, Esri, and NAPR are optional raster basemaps, disabled by default and
persisted only after an explicit choice. They are mutually exclusive with each other and
with applied Sentinel-2 imagery. The vector map stays opaque until the selected raster
reports content, then uses the separately persisted OpenStreetMap overlay opacity.
Failures have no retry or fallback; the vector map remains usable. Endpoint evidence
below is point-in-time, not an availability guarantee.

### Google satellite

Tiles come from `https://mt{0-3}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}` (JPEG, CORS `*`
observed 2026-08-06) with attribution `© Google`. `mt*.google.com/vt` is undocumented,
is not the official Map Tiles API, and has no SLA. The application sends no key, session
token, or viewport-attribution request and must not claim Google Maps Platform
compliance.

### Bing aerial

Tiles come from `https://ecn.t{0-3}.tiles.virtualearth.net/tiles/a{quadkey}.jpeg` using
MapLibre's `{quadkey}` token (JPEG, CORS `*` observed 2026-09-21); attribution links to
the Microsoft Maps terms. Microsoft's
[direct tile guidance](https://learn.microsoft.com/en-us/bingmaps/rest-services/directly-accessing-the-bing-maps-tiles)
forbids hard-coded tile URLs, requires the keyed Imagery Metadata service, and restricts
mixing with competing platforms; that API is enterprise-only until June 30, 2028. This
source is experimental and must be removed or migrated if enforcement, availability, or
distribution requirements change.

### Esri World Imagery

Tiles come from the anonymous ArcGIS Online template
`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`
(JPEG, CORS `*` observed 2026-09-21) with attribution
`Esri, Maxar, Earthstar Geographics, and the GIS User Community`. Esri's documented
MapLibre path uses the credentialed `ibasemaps-api.arcgis.com`; migrating would need a
reviewed public-client credential strategy, never a bundled secret.

### NAPR orthophoto mosaic

The National Agency of Public Registry mosaic stacks four fixed Web Mercator sources
bottom-to-top (tile URLs and bounds in the configuration):

| Source key           | Service                | Zoom | Role                                                |
| -------------------- | ---------------------- | ---- | --------------------------------------------------- |
| `national2016To2017` | `ORTHO_GEORGIA_4`      | 0–19 | Opaque nationwide JPEG fallback (`nt0.napr.gov.ge`) |
| `westernGeorgia2020` | `ORTHO_2020_DASAVLETI` | 0–19 | Western Georgia                                     |
| `kutaisi2020`        | `ORTHO_2020_KUTAISI`   | 0–20 | Higher-resolution same-year tie-breaker             |
| `racha2025`          | `ORTHO_2025_BLK4`      | 0–19 | Racha                                               |

The 2020 and 2025 WMTS services return fully transparent PNGs outside their footprints,
so ordinary alpha composition exposes the next older source without clipping. All four
returned imagery with CORS `*` on 2026-08-09. Capabilities follow
`https://mp.napr.gov.ge/<SERVICE>/wmts/1.0.0/WMTSCapabilities.xml`. Older services
(`ORTHO_2015_*`, `ORTHO_2014_*`, `ORTHO_2000_10_SATEL`, `ORTHO_2006_07_SATKEO`,
`ORTHO_2005_JICA`, `ORTHO_2000_KFW`) are not loaded because the nationwide fallback
already covers them without extra requests; `ORTHO_net` is a Bing mirror. The
attribution credits the National Agency of Public Registry (NAPR) orthophotos 2016–2017,
2020, and 2025 and links to `https://maps.gov.ge/`.

## Rejected defaults

- Public `tile.openstreetmap.org` raster tiles: the application uses vector OSM data.
- MapTiler Cloud: suitable, but its public key and account/plan policy add an avoidable
  provider account dependency.
- MapLibre demo vector/terrain endpoints: demo infrastructure without a product SLA.

## Sentinel-2: Earth Search and TiTiler

The catalog is Earth Search v1 (`https://earth-search.aws.element84.com/v1/search`,
collections `sentinel-2-l1c` and `sentinel-2-l2a`), anonymous STAC 1.0 JSON with no SLA
(`src/infrastructure/stac`). Requests send one collection, a UTC interval, descending
sort, allowlisted fields, and at most 100 items per page, up to the configured page cap
(default 10). Scene search sends a center point and a cloud filter; Mosaic sends the
settled-viewport polygon without a cloud filter. The gateway follows only an unambiguous
`POST` next link on the configured origin and path; invalid items, assets, or pagination
fail closed, and raw bodies, tokens, and exact geometry are never logged. The
[AWS dataset record](https://registry.opendata.aws/sentinel-2-l2a-cogs/) documents the
free/open Sentinel terms.

### L2A rendering

MapLibre cannot render a UTM GeoTIFF directly, so the default renderer is Development
Seed's public [TiTiler](https://developmentseed.org/titiler/endpoints/stac/) demo at
`https://titiler.xyz/stac/tiles/WebMercatorQuad/...`. It composes the item's
red/green/blue assets over 0–`{reflectanceMax}` with user-tunable gamma and saturation
and returns 256-pixel WebP tiles for z5–14; MapLibre overzooms beyond z14, near
Sentinel-2's 10 m resolution. The template is validated configuration; the controller
substitutes only bounded numbers and never stores the resulting URL. Because the
CloudFront cache can reuse a tile across origins, renderers declaring the
`application-origin` cache partition receive a sanitized `application_origin` value
(scheme, host, and port only).

The demo is best-effort, suitable for low traffic but not sustained production use. The
persisted Satellite render mode is Auto, Server, or Direct:

- Auto starts on TiTiler and switches to Direct on HTTP 429 or status zero (a renderer
  can omit CORS headers on 429).
- Server stays on TiTiler and reports those failures.
- Direct sends no TiTiler requests: a module worker range-reads the item's 8-bit
  `visual` COG, reprojects from the declared northern UTM CRS, and returns WebP tiles
  without the reflectance controls. The worker keeps only the two most recent GeoTIFF
  readers.

HTTP 5xx, timeouts, and network failures get up to three deduplicated failed-tile
refreshes with exponential delay; 429 and status zero are never retried. Status and
diagnostics name the HTTP code or `no-response` but never URLs or tile coordinates. The
raster reveals only after its first data, above the still-visible vector map, and the
validated WGS84 footprint renders independently.

Mosaic reuses these endpoints for one explicit action: it walks calendar months newest
first and keeps at most 128 scenes that add measurable union coverage of the exact
viewport, each as one bounded raster source. There is no background prefetching or
unbounded traversal.

### L1C

L1C `visual` assets are 10980×10980 JPEG 2000 objects (about 100 MB) on the public
`sentinel-s2-l1c` bucket. Range requests work, but no maintained browser decoder reads
only the visible region with bounded memory, so L1C imagery is labeled unsupported and
the corresponding L2A scene is never substituted.

## Weather: Open-Meteo

### Point forecast

Point, marker, and map-point forecasts use the anonymous generic endpoint
`https://api.open-meteo.com/v1/forecast` with `models=ecmwf_ifs`
(`src/infrastructure/weather/OpenMeteoWeatherForecastGateway.ts`). IFS HRES is ECMWF's 9
km global deterministic model; the run time comes from the model's `meta.json`, and a
metadata failure never substitutes the fetch time. Requests send the coordinate,
`timezone=auto`, `forecast_days=8`, Celsius/km/h/mm units, allowlisted `current` and
`hourly` fields, and, when a local DEM sample exists, `elevation` for downscaling. They
omit `daily` and `precipitation_probability`. The generic endpoint returns null
`precipitation_type`, so the phase is derived from precipitation, rain, showers,
snowfall, and WMO codes. Coordinates and responses are not persisted or logged.

Forecast and `meta.json` requests retry HTTP 429, 500, 502, 503, and 504 up to three
times with jittered exponential backoff from 1 s, or after the provider's `Retry-After`
(capped at 10 s) for 429 and 503. Other 4xx, network failures, timeouts, and aborts are
not retried; each attempt gets the full 15 s timeout.

### Weather map layer

The Layers weather overlay uses `@openmeteo/weather-map-layer` through an `om://`
MapLibre protocol. It reads ECMWF IFS 0.25° spatial data from Open-Meteo's public
bucket, starting with
`https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs025/latest.json`, which must
list cloud cover, precipitation, and 10 m wind components. It adds cloud and
precipitation rasters (z≤12) and a wind-arrow vector layer below roads and labels, and
hides relief and isolines while enabled (`MapLibreLayerController.ts`).

### Limits and attribution

Anonymous access is limited to Open-Meteo's non-commercial terms: 600 calls per minute,
5,000 per hour, and 10,000 per day. Commercial use requires a separate customer endpoint
and licence, not a secret in this client. Forecast panels keep
[Open-Meteo attribution](https://open-meteo.com/) adjacent, map sources credit
`Weather data © Open-Meteo · ECMWF`, and About links the
[CC BY 4.0 licence](https://creativecommons.org/licenses/by/4.0/).

Map-point and forecast menus also link out to meteoblue and Windy for the same
coordinate (`src/presentation/weather/weatherForecastLinks.ts`); these are plain
navigation links, not data providers.

## Manual revalidation checklist

The Chromium end-to-end suite uses local vector, glyph, and DEM fixtures and rejects
unexpected public requests, so live providers are outside that gate. Before a public
release:

1. Open the GitHub Pages and local origins in current stable desktop Chrome.
2. Confirm vector TileJSON, a Georgia PBF, glyphs, and a DEM tile load over HTTPS with
   CORS and no credential.
3. Confirm desktop attribution stays visible and keyboard reachable in 2D and 3D.
4. Simulate vector and DEM failure separately and confirm the documented behavior.
5. Recheck provider policy, schema version, source-layer list, and attribution text.
