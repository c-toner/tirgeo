# Chainage Offline Map Strategy

## Decision

TirGeo should support offline chainage maps, but not by bulk-downloading public OpenStreetMap raster tiles. The production path is:

1. Keep the existing online map for day-to-day viewing.
2. Cache only tiles and data a user has already viewed when the provider permits normal browser caching.
3. Add managed offline map packs for each organisation/project using a provider or self-hosted pipeline that explicitly permits offline storage.
4. Always render project-owned chainage data offline, even when no basemap is available.

This lets field crews retain map context out of service without depending on a public tile service in a way that can be blocked.

## Why Not Bulk Download Public OSM Tiles

The public OpenStreetMap tile service is suitable for interactive map viewing, not managed offline packs. Their tile policy prohibits bulk downloading, pre-seeding large areas, building archives from public tiles, and offline “download area” features.

That means a “download 200 square miles around HQ” feature must use one of these sources instead:

- TirGeo-hosted vector tiles generated from OpenStreetMap data.
- A commercial provider with contract terms allowing offline storage.
- A prebuilt PMTiles/MBTiles package for the organisation/project region.

## Recommended Architecture

### Basemap Packs

Use vector tiles rather than raster tiles. A 200 square mile raster pack across useful civil zoom levels becomes large very quickly, while vector tiles compress better, style consistently, and can be updated/versioned.

Preferred packaging:

- `PMTiles` for web/PWA and simple static hosting.
- `MBTiles` for native/mobile tooling if TirGeo later ships native apps.
- Optional lightweight raster fallback only for very low zoom overview maps.

Each offline pack should be scoped to:

- Organisation HQ region.
- Active project boundary plus buffer.
- Optional route corridor buffer for linear works.

Suggested defaults:

- HQ pack: 200 square miles at overview/detail zooms.
- Project pack: project boundary plus 5-10 km buffer.
- Corridor pack: alignment geometry plus 1-2 km buffer.

### Chainage Operational Data

Basemap availability should not control whether users can work. Store these locally in IndexedDB:

- Alignments and geometry.
- Observations, statuses, photos and pending uploads.
- Draft observations captured offline.
- Last known project selection and map viewport.
- Offline pack manifest and version.

When offline:

- Render cached basemap pack if present.
- Render alignment geometry and observations on top.
- If no basemap pack exists, render the chainage grid, road polyline, markers and GPS/draft point so crews still have a usable reference.
- Queue creates/updates/photo uploads for sync when service returns.

### Media GPS

Photo uploads should be treated as location evidence. The web app extracts JPEG EXIF GPS where available before image compression and stores the coordinates in file metadata. If the issue form has no location yet, the first GPS-tagged photo can place the draft marker and calculate nearest chainage from the selected alignment.

Bulk media workflows need a second server-side phase:

- GoPro and dashcam videos often store GPS in embedded telemetry streams rather than ordinary EXIF.
- Server-side processing should extract track points, timestamps and still-frame references from uploaded video.
- The user should then review suggested markers before creating observations, rather than the system silently creating a large defect register.
- Large disaster-recovery uploads should use direct-to-blob upload, background processing, and a review queue.

### Backend Shape

Add a map-pack manifest API:

- `GET /api/v1/chainage/offline-packs`
- `POST /api/v1/chainage/offline-packs` for admins
- `GET /api/v1/chainage/offline-packs/:id/manifest`
- Signed download URLs for pack files

Pack manifest fields:

- `id`
- `organisationId`
- `projectId`
- `name`
- `source`
- `format` such as `PMTILES`
- `bounds`
- `minZoom`
- `maxZoom`
- `bytes`
- `version`
- `checksum`
- `expiresAt`
- `downloadUrl`

### Frontend Shape

Add an Offline Maps panel in Chainage:

- Current online/offline state.
- Available HQ/project packs.
- Pack size and coverage.
- Download/update/remove controls.
- Last updated and storage usage.
- Warning when a selected project has no offline pack.

For the current React web app, store downloaded packs in browser-managed storage where possible. For large packs, OPFS is preferred over ordinary localStorage/sessionStorage.

## Rollout Plan

### Phase 1: Reliable Offline Reference

- Keep rendering chainage alignments and observations when tiles fail.
- Add clear offline/limited basemap state in the map UI.
- Persist selected project, alignments and observations locally.
- Queue offline observation edits.

### Phase 2: Managed Offline Packs

- Add offline pack manifest models and API.
- Add an Offline Maps panel.
- Support provider-approved PMTiles downloads.
- Render vector basemap packs in the Chainage map.

### Phase 3: Standalone Chainage App

- Extract `frontend/src/lib/chainage.ts` into a shared package.
- Split map rendering and offline storage into app-neutral modules.
- Keep TirGeo parent linking through project/organisation IDs and signed API sessions.
- Let the standalone app sync with TirGeo but continue recording work while disconnected.

## Product Rule

The chainage module should never have a hard dependency on online map tiles. The basemap is helpful context; the source-of-truth field record is the project alignment, chainage, GPS point, observation detail, photos and sync queue.
