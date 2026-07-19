import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';

export type AppliedSatelliteImagerySnapshot =
  | { readonly status: 'empty' }
  | {
      readonly status: 'loading';
      readonly sceneKey: string;
      readonly previousSceneKey: string | null;
    }
  | {
      readonly status: 'preview' | 'ready';
      readonly sceneKey: string;
      readonly sceneId: string;
      readonly visible: true;
    }
  | {
      readonly status: 'hidden';
      readonly sceneKey: string;
      readonly sceneId: string;
      readonly visible: false;
    }
  | {
      readonly status: 'failed';
      readonly sceneKey: string;
      readonly previousSceneKey: string | null;
      readonly message: string;
    };

export type SatelliteImageryCommandResult =
  | { readonly status: 'success' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly message: string };

/** Narrow async capability for applying one validated Sentinel scene to the live map. */
export interface SatelliteImageryMap {
  applyScene(
    scene: SatelliteScene,
    signal: AbortSignal,
  ): Promise<SatelliteImageryCommandResult>;
  fitFootprint(): SatelliteImageryCommandResult;
}
