# Data model and storage ownership

This document defines persisted records, their authoritative storage, and the privacy
boundary between browser-local data, optional user-owned Supabase copies, and
provider-owned online data. Executable contracts live in the Zod schemas of
`src/infrastructure/persistence/AppDatabase.ts`, the domain types under `src/domain`,
the SQL in `supabase/migrations`, and the Edge Function validators in
`supabase/functions`.

## Ownership rules

1. IndexedDB is authoritative for retained local tracks, flat personal folders, saved
   markers, and durable preferences. Local saves never depend on the network. Tracks,
   folders, markers, and their synchronization metadata leave the browser only after the
   user explicitly enables synchronization.
2. Supabase Postgres and private Storage are authoritative for a signed-in user's remote
   track revisions and geometry, folder records, marker records, compressed-byte usage,
   and public share capabilities.
3. Sentinel STAC, imagery, vector-tile, DEM, place-search, and weather providers are
   authoritative for online source data; see [map-providers.md](map-providers.md).
   Browser query and cache state is disposable and never becomes the source of truth.
4. Zustand and component state hold transient interaction and request state only.
5. Derived values carry their algorithm version. A version mismatch causes recalculation
   rather than silently mixing policies.
6. Every persisted or external record is validated at its boundary. Invalid local rows
   are skipped or removed with a `storage.*` diagnostic instead of breaking startup.

## Storage inventory

| Data                                    | Authority and location                              | Retention/network rule                                                      |
| --------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| Imported GPX/FIT/KML before retention   | Browser memory                                      | Discarded unless the user saves it; original file bytes are never kept      |
| Retained local track summary and points | IndexedDB `localTracks` and `localTrackContents`    | Saved and deleted atomically; summary owns nullable folder placement        |
| Saved-track list thumbnails             | IndexedDB `localTrackThumbnails`                    | Derived and disposable; deleted with the track, recomputed when stale       |
| Flat personal folders                   | IndexedDB `trackFolders`; Supabase                  | Ordered and revisioned; at most 1,000 remote folders per user               |
| Saved markers                           | IndexedDB `savedMarkers`; Supabase `marker_records` | Owner-only; at most 10,000 remote markers per user                          |
| Synchronized track metadata             | Supabase Postgres `track_records`                   | Owner-readable; writes pass through the authenticated `track-sync` function |
| Synchronized compressed geometry        | Private Supabase Storage bucket `track-geometries`  | Owner-readable; server writes and hard-deletes immutable per-upload objects |
| Synchronized geometry quota             | Supabase Postgres `user_track_usage`                | 8 MiB compressed bytes per user; mutations serialize on this row            |
| Public track share capabilities         | Supabase Postgres `track_shares`                    | Service-role only; resolved by the public `track-share` function            |
| Unsaved route plans                     | Browser memory                                      | Discarded on close or reload; Save converts the plan into a local track     |
| Opened shared track                     | Browser memory                                      | Transient `shared:<content-hash>` selection until the viewer saves it       |
| Map camera and durable preferences      | IndexedDB `settings`                                | Validated per key; corrupt values are removed and defaults used             |
| Selection, filters, visible tracks      | Browser memory/Zustand/components                   | Lost on reload unless a preference below persists it                        |
| Satellite results and applied imagery   | Component state and map facade memory               | Cancellable and disposable; never written to IndexedDB                      |
| Diagnostics                             | Bounded in-memory ring buffer (200 events)          | Local-only; leaves the browser only through explicit export                 |

## IndexedDB schema

`AppDatabase` opens the Dexie database `GeorgiaRoutingPlanner` at version 10. Earlier
versions exist only as upgrade steps.

| Store                  | Key        | Record                                                             |
| ---------------------- | ---------- | ------------------------------------------------------------------ |
| `settings`             | `key`      | `{ key, value, updatedAt }`; one record per preference or sync key |
| `diagnostics`          | `++id`     | Declared but not written; diagnostics stay in memory               |
| `localTracks`          | `id`       | `LocalTrackSummary`, schema version 6                              |
| `localTrackContents`   | `trackId`  | `LocalTrackContent`, schema version 6                              |
| `localTrackThumbnails` | `trackId`  | `TrackThumbnail`, algorithm version 1                              |
| `trackFolders`         | `id`       | `TrackFolder`, schema version 1                                    |
| `savedMarkers`         | `id`       | `SavedMarker`, schema version 2                                    |
| `trackSyncStates`      | `trackId`  | Browser-local track synchronization queue                          |
| `folderSyncStates`     | `folderId` | Browser-local folder synchronization queue                         |
| `markerSyncStates`     | `markerId` | Browser-local marker synchronization queue                         |

Database creation provisions the **Imports** folder (`id = imports`) with a pending
upsert.

### Settings keys

| Key                             | Value                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ui.preferences`                | Developer mode, locale (`null` follows the browser), navigation collapse, dismissed grade legend, marker and track sort |
| `map.camera`                    | Schema version 3: last settled longitude, latitude, and zoom; bearing and pitch are session-only                        |
| `map.layers`                    | Per-layer visibility, OSM/track/weather opacity, Sentinel rendering mode and tuning, terrain overlay options            |
| `satellite.maximum-cloud-cover` | Percentage 0-100, default 50                                                                                            |
| `weather.interval-preferences`  | Up to two weekdays, a day, night, or custom-hour period, and whether marker weather shows on the map                    |
| `markers.recent-icons`          | Up to 21 unique recently used marker icon keys                                                                          |
| `local-tracks.latest-opened`    | ID of the last opened saved track                                                                                       |
| `track-folders.collapsed`       | IDs of folders collapsed in this browser; never uploaded                                                                |
| `sync.enabled`                  | Boolean, default `false`; alone permits startup or lifecycle synchronization                                            |
| `sync.user-id`                  | Opaque account ID that owns local sync preparation; coordination metadata, not a credential                             |
| `sync.usage`                    | Last validated remote used/reserved bytes and the 8 MiB limit                                                           |
| `sync.folder-order-version`     | Version of an unsynchronized local folder reorder; absent when the order is clean                                       |

## Local tracks

Code: `src/domain/tracks/localTrack.ts`, `trackFolder.ts`, `trackThumbnail.ts`.

`LocalTrackSummary` is the listable record: normalized name, `savedAt`/`updatedAt`,
optional `contentHash`, source filename and format (`gpx | fit | kml`), favorite flag,
`geometryKind` (`track | route`), nullable `folderId`, point and segment counts,
`metrics`, optional DEM-derived `calculatedMetrics`, the bounded GPX metadata
projection, up to 50 validation warnings, and optional generated-name fields
(`generatedName`, `middleAnchorKind`, start/middle/end/fallback POI candidates).

`LocalTrackContent` shares the track ID and holds normalized `trackPoints` (1-512
segments of at least two points, each with coordinate and optional source elevation and
timestamp), optional DEM-derived `calculatedTrackPoints`, and up to 32 track-owned
`markers` (`id`, `name`, `coordinate`) taken from GPX waypoints. Rows from older schema
versions are migrated on read.

`TrackMetrics` holds distance (algorithm version 1), start/end coordinates,
antimeridian-aware bounds, center, optional recorded start/end and elapsed seconds, and
optional ascent/descent/min/max elevation with `elevationSource` (`gpx | dem-assisted`)
and a matching `elevationAlgorithmVersion`. `calculatedMetrics` must be DEM-assisted
version 4. Recorded duration is absent unless every rendered point has an ordered valid
timestamp.

`contentHash` is the lowercase SHA-256 of canonical GRPT v2 bytes of `trackPoints`
(`src/infrastructure/runtime/WebCryptoTrackContentHasher.ts`). It is absent only on rows
migrated from local schema v2 or earlier. Calculated points and metrics are
browser-local derivations and never affect the hash.

`TrackThumbnail` stores the source `contentHash` (null for unhashed rows), algorithm
version, a loop flag, and simplified per-segment vertices whose longitudes are unwrapped
across the antimeridian. A hash or version mismatch makes it stale.

### Folders and placement

`TrackFolder` has a stable ID, normalized XML-safe name (1-200 characters), icon key
(`folder` or any marker icon), non-negative `position`, and `createdAt`/`updatedAt`.
Folders are flat, names need not be unique, and order is by position then ID.

Placement is `LocalTrackSummary.folderId`; `null` or an unknown folder ID means
**Unfiled**. Saved imports go to **Imports**, which is recreated when missing and cannot
be deleted. Saved route plans stay unfiled. Migrating pre-folder rows assigns tracks to
**Imports** and routes to **Unfiled** without queuing synchronized tracks for upload.
Deleting a folder moves its tracks to **Unfiled**, marks their sync state for a metadata
update, and queues the folder deletion in one transaction; remaining positions are
unchanged. A local reorder rewrites positions and records `sync.folder-order-version`
instead of per-folder sync state.

## Plans and saved markers

An unsaved route plan is a transient Tracks-owned aggregate of ordered waypoints,
accepted routed or direct leg geometry, metrics, and optional elevation samples. It has
no IndexedDB record. Save converts it into `LocalTrackSummary` and `LocalTrackContent`
with `geometryKind = route`, after which it follows the normal local-track contracts.

`SavedMarker` (`src/domain/markers/savedMarker.ts`) has `id`, normalized XML-safe
`name`, `normalizedName`, `[longitude, latitude]` coordinate, nullable
`elevationMeters`, `iconKey`, `colorKey`, and `createdAt`/`updatedAt`. Version 1 rows
upgrade with a null elevation. Planning waypoints are coordinate snapshots, so later
marker edits do not change accepted route geometry.

## Browser synchronization state

Each sync-state store is a preparation queue keyed by the domain record ID.

| Store              | Fields                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `trackSyncStates`  | `contentHash`, `lineageHash`, `geometryVersion` (1 or 2), nullable `remoteRevision`, `pendingKind` (`upsert \| metadata \| delete \| null`) |
| `folderSyncStates` | Nullable `remoteRevision`, `pendingKind` (`upsert \| delete \| null`), monotonic `localVersion`                                             |
| `markerSyncStates` | Nullable `remoteRevision`, `pendingKind` (`upsert \| delete \| null`), monotonic `localVersion`                                             |

A clean folder or marker state requires a remote revision. Every save, rename, placement
change, or deletion updates the domain rows and sync state in one IndexedDB transaction.

When `sync.user-id` is missing, malformed, or changed, preparation keeps every valid
local track, folder, and marker, collapses duplicate track content by the canonical
rule, drops stale sync states and delete records, writes pending upserts with null
revisions, stores the new owner, and resets `sync.usage` in one transaction.

When a same-account remote deletion needs a decision, one transaction removes the
selected summary, content, thumbnail, and state rows and clears
`local-tracks.latest-opened` when it names a removed track. Unselected pairs receive
null-revision pending upserts; an already absent pair only loses its stale state.
Deleting an unsent upsert removes its intent; deleting a synchronized track keeps only a
minimal delete retry record. `sync.usage` is written only after a validated remote
merge. The synchronization flow itself is in
[runtime-flows.md](runtime-flows.md#explicit-cross-device-synchronization).

## Supabase backend

Browser roles receive only owner-scoped `SELECT` (`auth.uid() = user_id`) on
`track_records`, `user_track_usage`, `track_folder_records`, and `marker_records`, and
owner-only reads in the `track-geometries` bucket. All writes run through
security-definer RPCs that only `service_role` may execute, invoked by the authenticated
`track-sync` Edge Function. Per-user revision and count counters for folders and markers
live in `private.user_folder_sync_state` and `private.user_marker_sync_state`, which no
API role can read.

### Tracks

`track_records` is keyed by `(user_id, content_hash)` and stores JSON `metadata`, a
per-user `revision`, `reserved | ready` state, a unique `object_path`, compressed byte
count, timestamps, and a 10-minute reservation expiry for reserved rows. There is no
tombstone column. `user_track_usage` holds non-negative used and reserved bytes plus the
next per-user revision.

Uploaded metadata is the local summary without POI coordinates and without elevation
metrics, plus `lineageHash`, `geometryVersion`, track-owned `markers`, nullable
`folderId`, and distance/elapsed-time metrics. The function caps it at 64 KiB and
rejects a `lineageHash` or `geometryVersion` that does not match the uploaded geometry.

The RPCs reserve, finalize, and release uploads, apply metadata, and hard-delete one
track. Every mutation locks the user's usage row, and
`used_bytes + reserved_bytes + incoming` may not exceed `8_388_608`. Under that lock an
expired reservation is finalized when its exact object exists in Storage; otherwise its
bytes are released and its row removed. A ready duplicate receives no new path or quota
charge. A nonzero base revision must match the ready record before metadata is applied
with a new revision.

Objects use `<user-id>/<content-hash>/<upload-id>.grpt.gz`, accept only
`application/gzip`, and are capped at 8 MiB. A fresh UUID per reservation keeps late
cleanup of an old upload from touching a later upload with the same hash. Deletion
removes the row and decrements usage in one transaction, then idempotently removes the
object. Before later mutations and status reads, the function removes user-owned objects
absent from every current reserved and ready path.

### Folders and markers

`track_folder_records` and `marker_records` are keyed by `(user_id, folder_id)` and
`(user_id, marker_id)`. Each stores the validated JSON payload of the local record
(folder payloads up to 4 KiB, marker payloads validated at 4 KiB by the function), a
positive per-user revision, and `updated_at`. Upsert and delete take a base revision and
return `conflict` with the current record on mismatch. Folder content upserts keep an
existing position; only `reorder_track_folders` changes positions, applying one complete
order atomically. A trigger on `auth.users` provisions every account's **Imports**
folder.

### Public track shares

`track_shares` is keyed by the SHA-256 digest of the share token and stores
`(user_id, content_hash)` (unique, with an `on delete cascade` foreign key to the ready
`track_records` row), a public 43-character nonce, and `created_at`. No raw token is
stored: the `track-share` function derives it with HMAC from the owner ID, nonce, and
the per-environment `TRACK_SHARE_TOKEN_SECRET`. The table has RLS enabled and no
`PUBLIC`, `anon`, or `authenticated` table or RPC privileges.

A share can be enabled, read, or resolved only while its ready record has string `name`
and `updatedAt`, a `gpx | fit | kml` source format, and a `track | route` geometry kind.
Resolution returns only the content hash, byte count, object path, and that public
name/format/kind/updated-at projection; it never changes usage or private access.

## Canonical GRPT geometry

Code: `src/domain/tracks/trackSyncGeometry.ts` and
`supabase/functions/track-sync/internal/geometry.ts`; reference vectors in
`tests/fixtures/track-sync/geometry-v1.json` and `geometry-v2.json`.

Coordinates are rounded to $10^{-6}$ degrees. The stream is ASCII `GRPT`, a version
byte, a flags byte (bit 0: timestamps; bit 1: elevations, version 2 only), and an
unsigned-varint segment count. Each segment has an unsigned-varint point count followed
by ZigZag-varint longitude and latitude deltas that restart per segment. With
timestamps, each point adds `0` for a missing timestamp or the ZigZag millisecond delta
plus one. With elevations, each point adds `0x00` for none or `0x01` and a big-endian
Float64. Limits are 512 segments and 100,000 points; trailing bytes are invalid.

New content uses version 2, which preserves source elevations. `contentHash` is the
SHA-256 of the canonical bytes. `lineageHash` is the SHA-256 of the elevation-free
version 1 projection, so versions of the same geometry share a lineage; the remote head
of a lineage is the highest geometry version, then the highest revision. Legacy remote
records without lineage fields are version 1 with `lineageHash = content_hash`. Stored
objects are GZIP-compressed canonical bytes.

## Import parsing boundary

GPX, FIT, and KML files parse to one `ParsedGpx` shape (`src/domain/tracks/gpx.ts`,
`fit.ts`, `kml.ts`, `trackImport.ts`): geometry kind, segments, up to 32 named
waypoints, point count, bounded metadata projection, and up to 50 warnings. Failures use
a stable `GpxParseError` code. GPX limits cover a 10 MiB file, XML depth, 128
tracks/routes, 512 segments, 100,000 points, and text length; parsing is cancellable.
Renderable track segments win over companion routes, and segment boundaries are kept.

## Transient map and satellite state

MapLibre objects, satellite search results, selected scenes, Mosaic selections, and
applied imagery are runtime state and never enter IndexedDB. A shared map URL carries
only the camera, optional 3D orientation, one scene key, and weather point/time
(`src/presentation/map/mapShareUrl.ts`). Mosaic state and scene lists do not enter URLs
or diagnostic exports.

## Diagnostics

`BoundedDiagnosticLogger` redacts each event and keeps the latest 200 in memory. Events
never become an alternate store for domain data: raw files, complete geometry,
filenames, paths, secrets, headers, and bodies are excluded from export. Logging
failures never block the primary operation.

## Deletion and consistency rules

- Deleting a local track removes its content, thumbnail, and sync state atomically,
  keeping only a delete retry record for synchronized tracks. Folders and saved markers
  are unaffected.
- Deleting a folder moves its tracks to **Unfiled**; **Imports** cannot be deleted.
- Deleting a remote track cascades to its public share.
- Changing a calculation policy version recalculates derived metrics or thumbnails from
  authoritative geometry.
