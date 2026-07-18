export interface MapCamera {
  readonly longitude: number;
  readonly latitude: number;
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
}

export interface MapCameraRepository {
  load(): Promise<MapCamera | null>;
  save(camera: MapCamera): Promise<void>;
}

const cameraKeys = [
  'longitude',
  'latitude',
  'zoom',
  'bearing',
  'pitch',
] as const satisfies readonly (keyof MapCamera)[];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeMapCamera(value: unknown): MapCamera | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    cameraKeys.some(
      (key) => typeof candidate[key] !== 'number' || !Number.isFinite(candidate[key]),
    )
  ) {
    return null;
  }

  return {
    longitude: clamp(candidate.longitude as number, -180, 180),
    latitude: clamp(candidate.latitude as number, -85, 85),
    zoom: clamp(candidate.zoom as number, 2, 20),
    bearing: clamp(candidate.bearing as number, -180, 180),
    pitch: clamp(candidate.pitch as number, 0, 85),
  };
}
