export interface MapViewportBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface MapViewportSnapshot {
  readonly bounds: MapViewportBounds;
  readonly center: {
    readonly longitude: number;
    readonly latitude: number;
  };
}

/** Supplies an immutable settled map area without exposing the native map instance. */
export interface MapViewportProvider {
  getViewportSnapshot(): MapViewportSnapshot | null;
}
