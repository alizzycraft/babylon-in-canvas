import { Mesh, Scene, Vector3, Viewport } from '@babylonjs/core/pure.js';
import { HtmlInCanvasAdapter } from './html-in-canvas-adapter';

// Version-one projection contract: one flat rectangular DOM surface per plane.
export interface SurfaceProjectionSnapshot {
  readonly transform: string;
  readonly strategy: 'get-element-transform' | 'planar-mvp-fallback';
  readonly hostBounds: SurfaceBounds;
  readonly projectedBounds: SurfaceBounds;
  readonly maximumAlignmentError: number;
}

export interface SurfaceBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export function synchronizeSurfaceProjection(
  adapter: HtmlInCanvasAdapter,
  canvas: HTMLCanvasElement,
  source: HTMLElement,
  plane: Mesh,
  scene: Scene,
): SurfaceProjectionSnapshot {
  const width = source.offsetWidth;
  const height = source.offsetHeight;

  if (width === 0 || height === 0) {
    throw new Error('Cannot synchronize a zero-sized HTML surface.');
  }

  plane.computeWorldMatrix(true);
  const mvp = plane.getWorldMatrix().multiply(scene.getTransformMatrix());
  const mvpDom = new DOMMatrix(Array.from(mvp.m));
  const boundingBox = plane.getBoundingInfo().boundingBox;
  const localWidth = boundingBox.maximum.x - boundingBox.minimum.x;
  const localHeight = boundingBox.maximum.y - boundingBox.minimum.y;
  const cssToPlane = new DOMMatrix()
    .translate(boundingBox.minimum.x, boundingBox.maximum.y)
    .scale(localWidth / width, -localHeight / height, 1);
  const clipToCanvasGrid = new DOMMatrix()
    .translate(canvas.width / 2, canvas.height / 2)
    .scale(canvas.width / 2, -canvas.height / 2, 1);
  const drawTransform = clipToCanvasGrid
    .multiply(mvpDom)
    .multiply(cssToPlane);
  const helperTransform = adapter.getElementTransform(source, drawTransform);

  applyTransform(source, helperTransform);

  const projectedBounds = projectSurfaceBounds(plane, scene, canvas);
  let hostBounds = toBounds(source.getBoundingClientRect());
  let maximumAlignmentError = maximumBoundsError(hostBounds, projectedBounds);
  let transform = helperTransform;
  let strategy: SurfaceProjectionSnapshot['strategy'] = 'get-element-transform';

  if (maximumAlignmentError > 2) {
    const clipToCssViewport = new DOMMatrix()
      .translate(canvas.clientWidth / 2, canvas.clientHeight / 2)
      .scale(canvas.clientWidth / 2, -canvas.clientHeight / 2, 1);
    transform = clipToCssViewport
      .multiply(mvpDom)
      .multiply(cssToPlane);
    strategy = 'planar-mvp-fallback';
    applyTransform(source, transform);
    hostBounds = toBounds(source.getBoundingClientRect());
    maximumAlignmentError = maximumBoundsError(hostBounds, projectedBounds);
  }

  return {
    transform: transform.toString(),
    strategy,
    hostBounds,
    projectedBounds,
    maximumAlignmentError,
  };
}

function applyTransform(source: HTMLElement, transform: DOMMatrix): void {
  const value = transform.toString();

  if (source.style.transform !== value) {
    source.style.transform = value;
  }
}

export function projectSurfaceBounds(
  mesh: Mesh,
  scene: Scene,
  canvas: HTMLCanvasElement,
): SurfaceBounds {
  mesh.computeWorldMatrix(true);
  const boundingBox = mesh.getBoundingInfo().boundingBox;
  const viewport = new Viewport(0, 0, canvas.width, canvas.height);
  const projected = boundingBox.vectors.map((corner) =>
    Vector3.Project(
      corner,
      mesh.getWorldMatrix(),
      scene.getTransformMatrix(),
      viewport,
    ),
  );
  const gridToCssX = canvas.clientWidth / canvas.width;
  const gridToCssY = canvas.clientHeight / canvas.height;
  const x = projected.map((point) => point.x * gridToCssX);
  const y = projected.map((point) => point.y * gridToCssY);
  const canvasBounds = canvas.getBoundingClientRect();
  const left = canvasBounds.left + Math.min(...x);
  const right = canvasBounds.left + Math.max(...x);
  const top = canvasBounds.top + Math.min(...y);
  const bottom = canvasBounds.top + Math.max(...y);

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function toBounds(rect: DOMRect): SurfaceBounds {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function maximumBoundsError(a: SurfaceBounds, b: SurfaceBounds): number {
  return Math.max(
    Math.abs(a.left - b.left),
    Math.abs(a.top - b.top),
    Math.abs(a.right - b.right),
    Math.abs(a.bottom - b.bottom),
  );
}
