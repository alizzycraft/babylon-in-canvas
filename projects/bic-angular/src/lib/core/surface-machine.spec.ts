import { describe, expect, it } from 'vitest';
import {
  createSurfaceMachine,
  moveSurface,
  rotateSurface,
  setSurfaceFocus,
} from './surface-machine';

describe('surface state transitions', () => {
  it('moves and rotates without mutating the previous state', () => {
    const initial = createSurfaceMachine();
    const moved = moveSurface(initial, { x: 1, y: -2, z: 0.5 });
    const rotated = rotateSurface(moved, { x: 0, y: 0.25, z: 0 });

    expect(initial.position).toEqual({ x: 0, y: 0, z: 2.8 });
    expect(moved.position).toEqual({ x: 1, y: -2, z: 3.3 });
    expect(rotated.rotation.y).toBe(0.25);
    expect(rotated.revision).toBe(2);
  });

  it('only increments focus state when the value changes', () => {
    const initial = createSurfaceMachine();
    const focused = setSurfaceFocus(initial, true);

    expect(focused.focused).toBe(true);
    expect(focused.revision).toBe(1);
    expect(setSurfaceFocus(focused, true)).toBe(focused);
  });
});
