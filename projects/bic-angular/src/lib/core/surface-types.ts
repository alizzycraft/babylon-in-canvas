// Public value types intentionally avoid leaking Babylon classes into Angular inputs.
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SurfaceSize {
  readonly width: number;
  readonly height: number;
}

export interface SurfaceState {
  readonly id: string;
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly size: SurfaceSize;
  readonly focused: boolean;
  readonly revision: number;
}

export interface SurfaceViewModel {
  readonly id: string;
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly size: SurfaceSize;
  readonly focused: boolean;
  readonly cssWidth: string;
  readonly cssHeight: string;
  readonly depth: number;
  readonly glowIntensity: number;
}
