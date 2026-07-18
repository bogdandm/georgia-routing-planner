/** Indicates that validated provider geometry cannot support deterministic calculations. */
export class SatelliteGeometryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SatelliteGeometryError';
  }
}
