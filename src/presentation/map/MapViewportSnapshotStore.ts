import type {
  MapViewportProvider,
  MapViewportSnapshot,
} from '@/application/ports/MapViewportProvider';

/** Shares the current visible map area with React without exposing MapLibre. */
export class MapViewportSnapshotStore implements MapViewportProvider {
  readonly #listeners = new Set<() => void>();
  #snapshot: MapViewportSnapshot | null = null;

  public update(snapshot: MapViewportSnapshot | null): void {
    this.#snapshot = snapshot === null ? null : structuredClone(snapshot);
    for (const listener of this.#listeners) listener();
  }

  public getViewportSnapshot(): MapViewportSnapshot | null {
    return this.#snapshot;
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
