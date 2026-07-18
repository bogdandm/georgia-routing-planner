import type { MapDiagnosticsSnapshot } from '@/presentation/map/mapTypes';

export class MapDiagnosticsSnapshotStore {
  readonly #listeners = new Set<() => void>();
  #snapshot: MapDiagnosticsSnapshot | null = null;

  public update(snapshot: MapDiagnosticsSnapshot): void {
    this.#snapshot = structuredClone(snapshot);
    for (const listener of this.#listeners) listener();
  }

  public getSnapshot(): MapDiagnosticsSnapshot | null {
    return this.#snapshot;
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
