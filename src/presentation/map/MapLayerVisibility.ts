export const logicalMapLayerIds = [
  'satellite-imagery',
  'scene-footprint',
  'hiking-paths',
  'roads',
  'places-and-pois',
] as const;

export type LogicalMapLayerId = (typeof logicalMapLayerIds)[number];

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
