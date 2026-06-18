import { SurfaceState, SurfaceViewModel, Vec3 } from './surface-types';

const defaultSurfaceState: SurfaceState = {
  id: 'primary-panel',
  position: { x: 0, y: 0, z: 2.8 },
  rotation: { x: 0, y: 0, z: 0 },
  size: { width: 640, height: 420 },
  focused: false,
  revision: 0,
};

export function createSurfaceMachine(seed: Partial<SurfaceState> = {}): SurfaceState {
  return {
    ...defaultSurfaceState,
    ...seed,
    position: {
      ...defaultSurfaceState.position,
      ...seed.position,
    },
    rotation: {
      ...defaultSurfaceState.rotation,
      ...seed.rotation,
    },
    size: {
      ...defaultSurfaceState.size,
      ...seed.size,
    },
  };
}

export function moveSurface(state: SurfaceState, delta: Vec3): SurfaceState {
  return nextRevision({
    ...state,
    position: addVec3(state.position, delta),
  });
}

export function setSurfaceFocus(state: SurfaceState, focused: boolean): SurfaceState {
  if (state.focused === focused) {
    return state;
  }

  return nextRevision({
    ...state,
    focused,
  });
}

export function toSurfaceViewModel(state: SurfaceState): SurfaceViewModel {
  return {
    ...state,
    cssWidth: `${state.size.width}px`,
    cssHeight: `${state.size.height}px`,
    depth: state.focused ? 0.1 : 0.06,
    glowIntensity: state.focused ? 0.68 : 0.28,
  };
}

function addVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

function nextRevision(state: SurfaceState): SurfaceState {
  return {
    ...state,
    revision: state.revision + 1,
  };
}
