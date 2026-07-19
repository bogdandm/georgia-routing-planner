export {
  logicalMapLayerIds,
  type LogicalMapLayerId,
} from '@/application/ports/MapLayerPreferencesRepository';

import type { LogicalMapLayerId } from '@/application/ports/MapLayerPreferencesRepository';

export type MapLayerVisibilityResult =
  | { readonly status: 'success' }
  | { readonly status: 'failed'; readonly message: string };

/** Controls allowlisted logical layer groups without exposing native style identifiers. */
export interface MapLayerVisibility {
  setLayerVisibility(
    layerId: LogicalMapLayerId,
    visible: boolean,
  ): MapLayerVisibilityResult;
}
