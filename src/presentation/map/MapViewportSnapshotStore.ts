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

function viewportsEqual(
  left: MapViewportSnapshot | null,
  right: MapViewportSnapshot | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.bounds.west === right.bounds.west &&
    left.bounds.south === right.bounds.south &&
    left.bounds.east === right.bounds.east &&
    left.bounds.north === right.bounds.north &&
    left.center.longitude === right.center.longitude &&
    left.center.latitude === right.center.latitude
  );
}

/** Shares the current visible map area with React without exposing MapLibre. */
export class MapViewportSnapshotStore {
  readonly #listeners = new Set<() => void>();
  readonly #movementListeners = new Set<() => void>();
  #snapshot: MapViewportSnapshot | null = null;
  #movementSnapshot: MapViewportMovementSnapshot = unavailableMovementSnapshot;
  #movementRevision = 0;

  /** Keeps the previous object for a numerically equal viewport so React does not re-render. */
  public update(snapshot: MapViewportSnapshot | null): void {
    if (viewportsEqual(this.#snapshot, snapshot)) return;
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
