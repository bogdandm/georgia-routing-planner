import type {
  SatelliteRenderingMode,
  SatelliteRenderingTuning,
} from '@/application/ports/MapLayerPreferencesRepository';
import type { SatelliteScene } from '@/domain/satellite/SatelliteScene';

export {
  defaultSatelliteRenderingTuning,
  defaultSatelliteRenderingMode,
  type SatelliteRenderingMode,
  type SatelliteRenderingTuning,
} from '@/application/ports/MapLayerPreferencesRepository';

export type AppliedSatelliteImagerySnapshot =
  | { readonly status: 'empty' }
  | {
      readonly status: 'loading';
      readonly sceneKey: string;
      readonly previousSceneKey: string | null;
      readonly stage: 'preparing' | 'requesting-tiles' | 'rendering' | 'finalizing';
      readonly message: string;
      readonly startedAt: number;
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
  clearScene(): SatelliteImageryCommandResult;
  fitFootprint(): SatelliteImageryCommandResult;
  getAppliedScene(): SatelliteScene | null;
  getSelectedScene(): SatelliteScene | null;
  selectScene(scene: SatelliteScene): void;
  getRenderingMode(): SatelliteRenderingMode;
  getRenderingTuning(): SatelliteRenderingTuning;
  restorePersistedState(): Promise<void>;
  setRenderingTuning(
    tuning: SatelliteRenderingTuning,
    signal: AbortSignal,
  ): Promise<SatelliteImageryCommandResult>;
  setRenderingMode(
    mode: SatelliteRenderingMode,
    signal: AbortSignal,
  ): Promise<SatelliteImageryCommandResult>;
}
