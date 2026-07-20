import type { DiagnosticInput } from '@/application/ports/DiagnosticLogger';

export type TerrainComputeStatus = 'worker' | 'restarting' | 'inline';
export type TerrainComputePriority = 'high' | 'low';

export interface TerrainDemResponse {
  readonly data: Blob;
  readonly cacheControl?: string;
  readonly expires?: string;
}

export interface TerrainDecodedDemTile {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

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
  readonly operation: 'dem' | 'contour';
  readonly status: 'success' | 'failed' | 'canceled';
}

/** Capability boundary used by MapLibre protocols without exposing Worker or engine objects. */
export interface TerrainComputeBackend {
  readonly loaded: Promise<void>;
  fetchTile(
    zoom: number,
    x: number,
    y: number,
    abortController: AbortController,
  ): Promise<TerrainDemResponse>;
  fetchAndParseTile(
    zoom: number,
    x: number,
    y: number,
    abortController: AbortController,
  ): Promise<TerrainDecodedDemTile>;
  fetchContourTile(
    zoom: number,
    x: number,
    y: number,
    options: TerrainContourOptions,
    abortController: AbortController,
  ): Promise<TerrainContourTile>;
  setFilterEnabled(enabled: boolean): void;
  setInteractionActive(active: boolean): void;
  getStatus(): TerrainComputeStatus;
  subscribeStatus(listener: (status: TerrainComputeStatus) => void): () => void;
  subscribeMetrics(listener: (metrics: TerrainComputeMetrics) => void): () => void;
  subscribeDiagnostic(listener: (input: DiagnosticInput) => void): () => void;
  dispose(): void;
}
