export type TerrainComputeStatus = 'worker' | 'restarting' | 'inline';
export const defaultTerrainContourQueueCapacity = 32;

export interface TerrainContourTile {
  readonly arrayBuffer: ArrayBuffer;
}

export interface TerrainContourOptions {
  readonly levels: number[];
  readonly multiplier?: number;
  readonly overzoom?: number;
  readonly elevationKey?: string;
  readonly levelKey?: string;
  readonly contourLayer?: string;
  readonly extent?: number;
  readonly buffer?: number;
  readonly subsampleBelow?: number;
}

export interface TerrainComputeMetrics {
  readonly executionMode: TerrainComputeStatus;
  readonly queueDurationMs: number;
  readonly computeDurationMs: number;
  readonly pendingCount: number;
  readonly status: 'success' | 'failed' | 'canceled';
}

/** Serializable live contour workload state; it intentionally excludes tile identity and data. */
export interface TerrainComputeQueueState {
  readonly executionMode: TerrainComputeStatus;
  readonly activeCount: number;
  readonly queuedContourCount: number;
  readonly queueCapacity: number;
}

/** Capability boundary used by the MapLibre contour protocol without exposing Worker or engine objects. */
export interface TerrainComputeBackend {
  readonly loaded: Promise<void>;
  fetchContourTile(
    zoom: number,
    x: number,
    y: number,
    options: TerrainContourOptions,
    abortController: AbortController,
  ): Promise<TerrainContourTile>;
  setInteractionActive(active: boolean): void;
  getStatus(): TerrainComputeStatus;
  getQueueState(): TerrainComputeQueueState;
  subscribeStatus(listener: (status: TerrainComputeStatus) => void): () => void;
  subscribeQueueState(listener: (state: TerrainComputeQueueState) => void): () => void;
  subscribeMetrics(listener: (metrics: TerrainComputeMetrics) => void): () => void;
  dispose(): void;
}
