import { SurfaceBounds } from './surface-projection';

export interface SurfaceCompositionCandidate {
  readonly id: string;
  readonly bounds: SurfaceBounds;
  readonly cameraDistance: number;
  readonly interactive: boolean;
  readonly occlusionEnabled: boolean;
}

export interface SurfaceCompositionResult {
  readonly id: string;
  readonly stackingOrder: number;
  readonly inViewport: boolean;
  readonly fullyOccluded: boolean;
  readonly occludedBy: string | null;
}

export function composePlanarSurfaces(
  candidates: readonly SurfaceCompositionCandidate[],
  viewport: SurfaceBounds,
): readonly SurfaceCompositionResult[] {
  const farthestFirst = [...candidates].sort(
    (a, b) => b.cameraDistance - a.cameraDistance || a.id.localeCompare(b.id),
  );
  const nearestFirst = [...farthestFirst].reverse();

  return farthestFirst.map((candidate, stackingOrder) => {
    const inViewport = boundsIntersect(candidate.bounds, viewport);
    const occluder = candidate.occlusionEnabled
      ? nearestFirst.find((other) =>
          other.id !== candidate.id &&
          other.cameraDistance < candidate.cameraDistance &&
          containsBounds(other.bounds, candidate.bounds)
        )
      : undefined;

    return {
      id: candidate.id,
      stackingOrder,
      inViewport,
      fullyOccluded: Boolean(occluder),
      occludedBy: occluder?.id ?? null,
    };
  });
}

export function containsBounds(container: SurfaceBounds, target: SurfaceBounds): boolean {
  return (
    container.left <= target.left &&
    container.top <= target.top &&
    container.right >= target.right &&
    container.bottom >= target.bottom
  );
}

export function boundsIntersect(a: SurfaceBounds, b: SurfaceBounds): boolean {
  return !(
    a.right <= b.left ||
    a.left >= b.right ||
    a.bottom <= b.top ||
    a.top >= b.bottom
  );
}
