import { describe, expect, it } from 'vitest';
import {
  BIC_DEPTH_SURFACE_CLEARANCE,
  getBicDepthMeshPosition,
  readBicSpatialEffectValues,
} from './surface-effects';

describe('CSS spatial effect values', () => {
  it('reads namespaced custom properties from computed CSS', () => {
    const element = document.createElement('div');
    element.style.setProperty('--bic-depth', '0.12');
    element.style.setProperty('--bic-glow-radius', '26px');
    element.style.setProperty('--bic-glow-intensity', '0.72');
    document.body.append(element);

    expect(readBicSpatialEffectValues(element)).toEqual({
      depth: 0.12,
      glowRadius: 26,
      glowIntensity: 0.72,
    });

    element.remove();
  });

  it('uses stable defaults for missing values', () => {
    const element = document.createElement('div');
    document.body.append(element);

    expect(readBicSpatialEffectValues(element)).toEqual({
      depth: 0,
      glowRadius: 18,
      glowIntensity: 0,
    });

    element.remove();
  });

  it('keeps depth geometry behind the textured surface', () => {
    const depth = 0.12;
    const boxCenter = getBicDepthMeshPosition(depth);
    const boxSurfaceFacingFace = boxCenter + depth / 2;

    expect(boxSurfaceFacingFace).toBeCloseTo(-BIC_DEPTH_SURFACE_CLEARANCE);
    expect(boxSurfaceFacingFace).toBeLessThan(0);
  });
});
