import { describe, expect, it } from 'vitest';
import { composePlanarSurfaces } from './surface-composition';

const viewport = {
  left: 0,
  top: 0,
  right: 1000,
  bottom: 800,
  width: 1000,
  height: 800,
};

describe('surface composition', () => {
  it('stacks nearer surfaces above farther surfaces and marks full occlusion', () => {
    const results = composePlanarSurfaces([
      {
        id: 'rear',
        bounds: { left: 200, top: 200, right: 400, bottom: 400, width: 200, height: 200 },
        cameraDistance: 5,
        interactive: true,
        occlusionEnabled: true,
      },
      {
        id: 'front',
        bounds: { left: 150, top: 150, right: 450, bottom: 450, width: 300, height: 300 },
        cameraDistance: 3,
        interactive: true,
        occlusionEnabled: true,
      },
    ], viewport);

    expect(results.find((result) => result.id === 'front')?.stackingOrder).toBeGreaterThan(
      results.find((result) => result.id === 'rear')?.stackingOrder ?? -1,
    );
    expect(results.find((result) => result.id === 'rear')).toMatchObject({
      fullyOccluded: true,
      occludedBy: 'front',
    });
  });

  it('does not mark partial overlap as full occlusion', () => {
    const [rear] = composePlanarSurfaces([
      {
        id: 'rear',
        bounds: { left: 200, top: 200, right: 500, bottom: 500, width: 300, height: 300 },
        cameraDistance: 5,
        interactive: true,
        occlusionEnabled: true,
      },
      {
        id: 'front',
        bounds: { left: 350, top: 350, right: 650, bottom: 650, width: 300, height: 300 },
        cameraDistance: 3,
        interactive: true,
        occlusionEnabled: true,
      },
    ], viewport);

    expect(rear?.fullyOccluded).toBe(false);
  });
});
