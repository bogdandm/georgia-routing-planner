import { addProtocol, removeProtocol, type AddProtocolAction } from 'maplibre-gl';

import type { SatelliteVisualAsset } from '@/domain/satellite/SatelliteScene';
import {
  isSatelliteCogTileResult,
  type SatelliteCogTileRequest,
} from '@/infrastructure/satellite/SatelliteCogProtocol';
import { satelliteCogWorkerMethods } from '@/infrastructure/satellite/SatelliteCogWorkerServer';
import {
  type WorkerRpcEndpoint,
  WorkerRpcClient,
} from '@/infrastructure/runtime/WorkerRpc';

interface RegisteredScene {
  readonly asset: Extract<SatelliteVisualAsset, { readonly kind: 'sentinel-l2a' }>;
}

interface ParsedTileAddress {
  readonly sceneKey: string;
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

export interface SatelliteCogTileProvider {
  registerScene(
    sceneKey: string,
    asset: Extract<SatelliteVisualAsset, { readonly kind: 'sentinel-l2a' }>,
  ): void;
  createTileUrl(sceneKey: string): string;
  dispose(): void;
}

type SatelliteCogWorkerFactory = () => WorkerRpcEndpoint;

const protocolId = 'georgia-satellite-cog';
const maximumRegisteredScenes = 2;

function defaultWorkerFactory(): WorkerRpcEndpoint {
  return new Worker(
    new URL('../../infrastructure/satellite/satelliteCog.worker.ts', import.meta.url),
    {
      type: 'module',
      name: 'satellite-cog-rasterizer',
    },
  );
}

function parseTileAddress(url: string): ParsedTileAddress | null {
  const match = new RegExp(
    `^${protocolId}://tiles/([^/]+)/(\\d+)/(\\d+)/(\\d+)\\.webp(?:\\?.*)?$`,
    'u',
  ).exec(url);
  if (match === null) return null;
  const sceneKey = match[1];
  const z = Number(match[2]);
  const x = Number(match[3]);
  const y = Number(match[4]);
  if (
    sceneKey === undefined ||
    !Number.isInteger(z) ||
    !Number.isInteger(x) ||
    !Number.isInteger(y)
  ) {
    return null;
  }
  return { sceneKey: decodeURIComponent(sceneKey), z, x, y };
}

/** Owns the opaque MapLibre protocol and the dedicated direct visual-COG worker. */
export class MapLibreSatelliteCogTileProvider implements SatelliteCogTileProvider {
  readonly #rpc: WorkerRpcClient;
  readonly #scenes = new Map<string, RegisteredScene>();
  #disposed = false;

  public constructor(workerFactory: SatelliteCogWorkerFactory = defaultWorkerFactory) {
    this.#rpc = new WorkerRpcClient(workerFactory());
    addProtocol(protocolId, this.loadTile);
  }

  public registerScene(
    sceneKey: string,
    asset: Extract<SatelliteVisualAsset, { readonly kind: 'sentinel-l2a' }>,
  ): void {
    this.#scenes.delete(sceneKey);
    this.#scenes.set(sceneKey, { asset });
    while (this.#scenes.size > maximumRegisteredScenes) {
      const oldestKey = this.#scenes.keys().next().value;
      if (oldestKey === undefined) break;
      this.#scenes.delete(oldestKey);
    }
  }

  public createTileUrl(sceneKey: string): string {
    if (!this.#scenes.has(sceneKey)) {
      throw new Error('The direct satellite scene is not registered.');
    }
    return `${protocolId}://tiles/${encodeURIComponent(sceneKey)}/{z}/{x}/{y}.webp`;
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    removeProtocol(protocolId);
    this.#rpc.dispose();
    this.#scenes.clear();
  }

  private readonly loadTile: AddProtocolAction = async (
    parameters,
    abortController,
  ) => {
    const address = parseTileAddress(parameters.url);
    if (address === null) throw new Error('Invalid direct satellite tile address.');
    const scene = this.#scenes.get(address.sceneKey);
    if (scene === undefined) throw new Error('Direct satellite scene is unavailable.');
    const request: SatelliteCogTileRequest = {
      sceneKey: address.sceneKey,
      visualHref: scene.asset.visualHref,
      projectionEpsg: scene.asset.projectionEpsg,
      z: address.z,
      x: address.x,
      y: address.y,
      tileSize: 256,
    };
    const result = await this.#rpc.request<unknown>(
      satelliteCogWorkerMethods.renderTile,
      request,
      abortController.signal,
    );
    if (!isSatelliteCogTileResult(result)) {
      throw new Error('The browser satellite worker returned an invalid tile.');
    }
    return { data: result.data };
  };
}
