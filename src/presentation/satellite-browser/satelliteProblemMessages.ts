import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';

import type { SatelliteSearchErrorCode } from '@/application/satellite/SatelliteSearchError';
import type { SatelliteImageryProblem } from '@/presentation/map/mapLayerStore';
import type { MapFailureReason } from '@/presentation/map/mapTypes';

/** Localized copy for a typed satellite search failure. */
export function satelliteSearchErrorMessage(
  code: SatelliteSearchErrorCode,
): MessageDescriptor {
  switch (code) {
    case 'provider-timeout':
      return msg`Earth Search did not respond in time. Try again.`;
    case 'provider-rate-limited':
      return msg`Earth Search is rate limiting requests. Wait and try again.`;
    case 'provider-network':
      return msg`Earth Search could not be reached from this browser.`;
    case 'provider-http':
    case 'provider-invalid-response':
    case 'provider-pagination':
    case 'provider-capability':
      return msg`The satellite catalog could not complete this search.`;
    case 'result-limit-exceeded':
      return msg`This area needs too many Sentinel images. Zoom in and try again.`;
    case 'invalid-viewport':
      return msg`This map view cannot be searched. Pan or zoom the map and try again.`;
    case 'invalid-date':
    case 'date-range-reversed':
    case 'date-range-too-large':
      return msg`Choose a date within the Sentinel archive.`;
    case 'invalid-cloud-cover':
      return msg`Cloud cover must be between 0 and 100 percent.`;
    case 'invalid-scene-geometry':
      return msg`A returned scene has geometry that cannot be measured.`;
  }
}

/** Localized copy for a typed imagery application failure. */
export function satelliteImageryProblemMessage(
  problem: SatelliteImageryProblem,
): MessageDescriptor {
  switch (problem.code) {
    case 'map-not-ready':
      return msg`The map is not ready yet.`;
    case 'unsupported-asset':
      return msg`This scene has no supported true-color asset.`;
    case 'unrenderable-geometry':
      return msg`A returned scene has geometry that cannot be rendered.`;
    case 'too-many-scenes':
      return msg`This area needs too many Sentinel images. Zoom in and try again.`;
    case 'tuning-out-of-range':
      return msg`Imagery tuning values are out of range.`;
    case 'no-applied-scene':
      return msg`No applied scene is available to fit.`;
    case 'scene-render-failed':
      return msg`The true-color image could not be rendered. The vector basemap remains available.`;
    case 'mosaic-render-failed':
      return msg`A Sentinel mosaic image could not be rendered. Ready imagery remains visible.`;
    case 'mosaic-restore-failed':
      return msg`A Sentinel mosaic image could not be restored after the map style changed.`;
    case 'search-failed':
      return problem.searchErrorCode === null
        ? msg`Sentinel imagery could not be loaded. Try again.`
        : satelliteSearchErrorMessage(problem.searchErrorCode);
    case 'tile-failed':
      return tileFailureMessage(problem.reason, problem.httpStatus);
  }
}

function tileFailureMessage(
  reason: MapFailureReason,
  httpStatus: number | null,
): MessageDescriptor {
  if (reason === 'no-response') {
    return msg`The imagery tile request received no HTTP response (network, CORS, or provider connection failure). The current map remains usable; retry the scene.`;
  }
  if (reason === 'network') {
    return msg`The imagery tile request failed because of a network connection error. The current map remains usable; retry the scene.`;
  }
  if (httpStatus === null) {
    return reason === 'timeout'
      ? msg`The imagery renderer did not finish in time. The current map remains usable; retry the scene.`
      : msg`The imagery renderer did not return a usable tile. The current map remains usable; retry or reset the imagery stretch.`;
  }
  switch (reason) {
    case 'rate-limit':
      return msg`The imagery renderer is rate-limiting requests (HTTP ${httpStatus}). The current map remains usable; wait briefly, then retry.`;
    case 'timeout':
      return msg`The imagery renderer did not finish in time (HTTP ${httpStatus}). The current map remains usable; retry the scene.`;
    case 'http-server':
      return msg`The imagery renderer is temporarily unavailable (HTTP ${httpStatus}). The current map remains usable; retry shortly.`;
    case 'http-client':
      return httpStatus === 400 || httpStatus === 422
        ? msg`The imagery renderer rejected these stretch values (HTTP ${httpStatus}). Reset the imagery stretch or try less extreme values.`
        : msg`The imagery renderer rejected the tile request (HTTP ${httpStatus}). The current map remains usable; review the provider configuration.`;
    case 'unknown':
      return msg`The imagery renderer did not return a usable tile. The current map remains usable; retry or reset the imagery stretch.`;
  }
}
