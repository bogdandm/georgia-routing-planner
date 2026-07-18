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

| Application concept | Source layer          | Relevant fields/values                          |
| ------------------- | --------------------- | ----------------------------------------------- |
| Land cover          | `landcover`           | `class`, `subclass`                             |
| Human land use      | `landuse`             | `class`                                         |
| Protected land      | `park`                | `class`, `name`                                 |
| Water               | `water`, `waterway`   | geometry and `class`                            |
| Boundaries          | `boundary`            | `admin_level`, `disputed`, `maritime`           |
| Roads and paths     | `transportation`      | `class`, `subclass`, `brunnel`                  |
| Road/path labels    | `transportation_name` | `name`, `class`, `subclass`                     |
| Peaks and passes    | `mountain_peak`       | `class` (`peak`, `saddle`, etc.), `name`, `ele` |
| Hiking POIs         | `poi`                 | `class`, `subclass`, `name`, `rank`             |
| Settlements         | `place`               | `class`, `name`, `rank`, `capital`              |
| Water labels        | `water_name`          | `name`, geometry-specific fields                |

The transportation schema explicitly includes `path`, `track`, `footway`, `steps`,
`bridleway`, and `cycleway` classifications. OpenMapTiles does not expose hiking route
relations as a dedicated source layer in this default schema, so the current style shows
physical ways rather than claiming to show official marked routes.

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

## Terrain: AWS Open Data Mapzen Terrain Tiles

The terrain default is
`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` with:

- Encoding: `terrarium`.
- Tile size: 256 pixels.
- Zoom range: 0 through 15; higher map zooms overzoom the last DEM level.
- HTTPS and anonymous access.
- Exaggeration: 1.15, deliberately conservative for route-planning context.

The [AWS Open Data entry](https://registry.opendata.aws/terrain-tiles/) describes global
bare-earth elevation and anonymous bucket access. The upstream
[service documentation](https://github.com/tilezen/joerd/blob/master/docs/use-service.md)
documents the Terrarium endpoint, 256-pixel size, and zoom limit.

A browser-origin single-range request to a Georgia-covering PNG returned status 206 and
exactly 1,024 requested bytes in 538 ms. This verifies HTTPS, CORS, and byte-range
behavior for the observed endpoint.

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
networking. This is acceptable for an explicitly enabled, low-traffic terrain mode, but
it is the main production risk. A missing/no-data tile or network failure must return
the application to flat 2D and never block the vector basemap. There is no silent
terrain provider failover because a replacement could have different licensing and
elevation semantics.

## Rejected defaults

- Public `tile.openstreetmap.org` raster tiles: rejected because the application uses a
  vector OSM foundation and the OSM Foundation raster service is not the application's
  production vector provider.
- MapTiler Cloud: technically suitable but rejected as the anonymous default because its
  hosted APIs require a public API key and account/plan policy. A public key is not a
  secret, but it adds an avoidable provider account dependency for this MVP.
- MapLibre demo vector/terrain endpoints: useful for examples and tests, but rejected as
  production defaults because they are demo infrastructure without a product SLA.

## Sentinel-2 true-color COG feasibility spike

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

No product render was added. MapLibre GL JS does not directly render a GeoTIFF/COG as a
raster source, and Chrome does not provide the geospatial windowing/reprojection needed
by itself. The spike therefore has no meaningful full render-time number: it stopped
after the successful 16 KiB range read rather than downloading or decoding the full
asset. Rendering Sentinel imagery requires a replaceable imagery adapter, such as:

1. Browser-side COG range reading, reprojection, and tile generation behind a worker.
2. A standards-compatible dynamic tile service, if a provider policy is approved.

The adapter must expose raster tiles/texture data to MapLibre without changing catalog
search or scene-selection workflows. The current application does not implement STAC
search, scene choice, imagery caching/UI, or production COG decoding.

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
