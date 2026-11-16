import { beforeEach, describe, expect, it } from 'vitest';

import {
  defaultTerrainLightingTuning,
  effectiveTerrainLightingTuning,
  parseStoredTerrainLightingTuning,
  resetTerrainLighting,
  setTerrainLightingValue,
  terrainLightingStorageKey,
  terrainLightingTuningStore,
  terrainShadowShadingFromTuning,
} from '@/presentation/map/terrainLightingTuning';

beforeEach(() => {
  terrainLightingTuningStore.setState({
    values: defaultTerrainLightingTuning,
    showDefaults: false,
    panelOpen: false,
  });
});

describe('terrain lighting tuning', () => {
  it('drives the shade pass and the lookup table from one sky-light share', () => {
    const shading = terrainShadowShadingFromTuning({
      ...defaultTerrainLightingTuning,
      terrainShadeSkyLightShare: 0.5,
    });
    expect(shading.lighting.skyLightShare).toBe(0.5);
    expect(shading.palette).not.toHaveProperty('skyLightShare');
  });

  it('compares with the defaults without losing the tuned values', () => {
    setTerrainLightingValue('sunHighlightOpacity', 0.2);
    setTerrainLightingValue('sunSky.night.fog', '#ABCDEF');
    const tuned = terrainLightingTuningStore.getState().values;

    terrainLightingTuningStore.setState({ showDefaults: true });
    expect(effectiveTerrainLightingTuning(terrainLightingTuningStore.getState())).toBe(
      defaultTerrainLightingTuning,
    );
    terrainLightingTuningStore.setState({ showDefaults: false });
    expect(effectiveTerrainLightingTuning(terrainLightingTuningStore.getState())).toBe(
      tuned,
    );

    // Editing while Before is shown returns to After with the edit applied.
    terrainLightingTuningStore.setState({ showDefaults: true });
    setTerrainLightingValue('sunShadowOpacity', 0.7);
    expect(terrainLightingTuningStore.getState()).toMatchObject({
      showDefaults: false,
      values: { sunHighlightOpacity: 0.2, sunShadowOpacity: 0.7 },
    });
  });

  it('resets one section or every value', () => {
    setTerrainLightingValue('sunShadowOpacity', 0.9);
    setTerrainLightingValue('skyOcclusionStrength', 2.5);
    setTerrainLightingValue('sunAlpenglow', '#000000');

    resetTerrainLighting('light');
    expect(terrainLightingTuningStore.getState().values).toMatchObject({
      sunShadowOpacity: defaultTerrainLightingTuning.sunShadowOpacity,
      skyOcclusionStrength: 2.5,
      sunAlpenglow: '#000000',
    });

    resetTerrainLighting();
    expect(terrainLightingTuningStore.getState().values).toEqual(
      defaultTerrainLightingTuning,
    );
  });

  it('keeps tuned values in localStorage and reads back only valid ones', () => {
    setTerrainLightingValue('sunLowShadowLift', 0.75);
    const stored = localStorage.getItem(terrainLightingStorageKey);
    expect(parseStoredTerrainLightingTuning(stored)).toMatchObject({
      sunLowShadowLift: 0.75,
    });

    expect(
      parseStoredTerrainLightingTuning(
        JSON.stringify({
          sunShadowOpacity: 0.3,
          // Outside its slider range, not a color, and unknown: all ignored.
          shadeNeutralBrightness: 5,
          sunShadow: 'red',
          rimLightGain: 2,
        }),
      ),
    ).toEqual({ ...defaultTerrainLightingTuning, sunShadowOpacity: 0.3 });
    expect(parseStoredTerrainLightingTuning('{')).toBe(defaultTerrainLightingTuning);
    expect(parseStoredTerrainLightingTuning(null)).toBe(defaultTerrainLightingTuning);
  });
});
