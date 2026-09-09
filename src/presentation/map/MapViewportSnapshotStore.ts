import type { MapViewportSnapshot } from '@/presentation/map/mapTypes';

export type MapViewportMovementSnapshot =
  | { readonly phase: 'unavailable' }
  | { readonly phase: 'moving' }
  | {
      readonly phase: 'settled';
      readonly viewport: MapViewportSnapshot;
      readonly revision: number;
    };

const unavailableMovementSnapshot: MapViewportMovementSnapshot = {
  phase: 'unavailable',
};
const movingMovementSnapshot: MapViewportMovementSnapshot = { phase: 'moving' };

/** Shares the current visible map area with React without exposing MapLibre. */
export class MapViewportSnapshotStore {
  readonly #listeners = new Set<() => void>();
  readonly #movementListeners = new Set<() => void>();
  #snapshot: MapViewportSnapshot | null = null;
  #movementSnapshot: MapViewportMovementSnapshot = unavailableMovementSnapshot;
  #movementRevision = 0;

  public update(snapshot: MapViewportSnapshot | null): void {
    this.#snapshot = snapshot;
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

  public markMoving(): void {
    if (this.#movementSnapshot === movingMovementSnapshot) return;
    this.#movementSnapshot = movingMovementSnapshot;
    for (const listener of this.#movementListeners) listener();
  }

  public settle(viewport: MapViewportSnapshot): void {
    this.#movementRevision += 1;
    this.#movementSnapshot = {
      phase: 'settled',
      viewport,
      revision: this.#movementRevision,
    };
    for (const listener of this.#movementListeners) listener();
  }

  public clearMovement(): void {
    if (this.#movementSnapshot === unavailableMovementSnapshot) return;
    this.#movementSnapshot = unavailableMovementSnapshot;
    for (const listener of this.#movementListeners) listener();
  }

  public getMovementSnapshot(): MapViewportMovementSnapshot {
    return this.#movementSnapshot;
  }

  public subscribeMovement(listener: () => void): () => void {
    this.#movementListeners.add(listener);
    return () => {
      this.#movementListeners.delete(listener);
    };
  }
}
