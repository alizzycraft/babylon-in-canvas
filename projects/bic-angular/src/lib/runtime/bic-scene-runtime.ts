import { Injectable, signal } from '@angular/core';
import * as BABYLON from '@babylonjs/core';
import { BicSurfaceEffects, BicSpatialEffectValues } from '../effects/surface-effects';
import {
  HtmlInCanvasCapabilities,
  createHtmlInCanvasAdapter,
} from '../core/html-in-canvas-adapter';
import {
  HtmlSurfaceTexturePipeline,
  HtmlSurfaceTextureSnapshot,
  createHtmlSurfaceTexturePipeline,
} from '../core/html-surface-texture-pipeline';
import {
  composePlanarSurfaces,
} from '../core/surface-composition';
import {
  SurfaceBounds,
  SurfaceProjectionSnapshot,
  projectSurfaceBounds,
  synchronizeSurfaceProjection,
} from '../core/surface-projection';
import { SurfacePrimitive, SurfaceState } from '../core/surface-types';

export interface BicSceneRuntimeOptions {
  readonly engineOptions?: BABYLON.WebGPUEngineOptions;
}

export type BicSceneRuntimeStatus =
  | { readonly kind: 'idle' | 'booting' }
  | {
      readonly kind: 'ready';
      readonly capabilities: HtmlInCanvasCapabilities;
      readonly deviceRecoveryCount: number;
    }
  | {
      readonly kind: 'recovering';
      readonly message: string;
      readonly deviceRecoveryCount: number;
    }
  | { readonly kind: 'failed'; readonly message: string };

export interface BicSurfaceRuntimeSnapshot {
  readonly id: string;
  readonly state: SurfaceState;
  readonly texture: HtmlSurfaceTextureSnapshot;
  readonly projection: SurfaceProjectionSnapshot | null;
  readonly effects: BicSpatialEffectValues;
  readonly composition: BicSurfaceCompositionSnapshot;
}

export interface BicSurfaceCompositionSnapshot {
  readonly primitive: SurfacePrimitive['kind'];
  readonly interaction: 'interactive' | 'visual-only' | 'disabled';
  readonly inViewport: boolean;
  readonly fullyOccluded: boolean;
  readonly occludedBy: string | null;
  readonly stackingOrder: number;
  readonly cameraDistance: number;
}

export interface BicDisplayMetricsSnapshot {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly backingWidth: number;
  readonly backingHeight: number;
  readonly devicePixelRatio: number;
  readonly revision: number;
}

export interface BicSurfaceRegistration {
  readonly host: HTMLElement;
  readonly state: SurfaceState;
}

interface SceneResources {
  readonly engine: BABYLON.WebGPUEngine;
  readonly scene: BABYLON.Scene;
  readonly camera: BABYLON.ArcRotateCamera;
  readonly canvas: HTMLCanvasElement;
  readonly surfaceCanvas: HTMLCanvasElement;
  readonly adapter: ReturnType<typeof createHtmlInCanvasAdapter>;
  readonly stopResize: () => void;
  readonly refreshDisplayMetrics: () => void;
  readonly stopDeviceLoss: () => void;
}

interface SurfaceResources {
  readonly host: HTMLElement;
  readonly mesh: BABYLON.Mesh;
  readonly renderMeshes: readonly BABYLON.Mesh[];
  readonly material: BABYLON.Material;
  readonly pipeline: HtmlSurfaceTexturePipeline;
  readonly effects: BicSurfaceEffects;
  stopPipelineListener: () => void;
  state: SurfaceState;
  projection: SurfaceProjectionSnapshot | null;
  effectValues: BicSpatialEffectValues;
  composition: BicSurfaceCompositionSnapshot;
}

@Injectable()
export class BicSceneRuntime {
  readonly status = signal<BicSceneRuntimeStatus>({ kind: 'idle' });
  readonly snapshots = signal<readonly BicSurfaceRuntimeSnapshot[]>([]);
  readonly devicePixelRatio = signal(readDevicePixelRatio());
  readonly displayMetrics = signal<BicDisplayMetricsSnapshot>({
    cssWidth: 0,
    cssHeight: 0,
    backingWidth: 0,
    backingHeight: 0,
    devicePixelRatio: readDevicePixelRatio(),
    revision: 0,
  });

  private readonly pending = new Map<string, BicSurfaceRegistration>();
  private readonly surfaces = new Map<string, SurfaceResources>();
  private resources: SceneResources | null = null;
  private deviceRecoveryCount = 0;
  private canvas: HTMLCanvasElement | null = null;
  private surfaceCanvas: HTMLCanvasElement | null = null;
  private options: BicSceneRuntimeOptions = {};
  private recoveringDevice = false;
  private disposed = false;

  async initialize(
    canvas: HTMLCanvasElement,
    surfaceCanvas: HTMLCanvasElement,
    options: BicSceneRuntimeOptions = {},
  ): Promise<void> {
    if (this.resources) {
      throw new Error('BicSceneRuntime is already initialized.');
    }

    this.canvas = canvas;
    this.surfaceCanvas = surfaceCanvas;
    this.options = options;
    this.disposed = false;
    this.status.set({ kind: 'booting' });

    try {
      await this.bootScene();
    } catch (error) {
      const message = toErrorMessage(error);
      this.status.set({ kind: 'failed', message });
      throw error;
    }
  }

  register(registration: BicSurfaceRegistration): () => void {
    const id = registration.state.id;

    if (this.pending.has(id) || this.surfaces.has(id)) {
      throw new Error(`A bic-surface with id "${id}" is already registered.`);
    }

    if (this.resources) {
      this.createSurface(registration);
    } else {
      this.pending.set(id, registration);
    }

    return () => this.unregister(id);
  }

  update(id: string, state: SurfaceState): void {
    const pending = this.pending.get(id);

    if (pending) {
      this.pending.set(id, { ...pending, state });
      return;
    }

    const surface = this.surfaces.get(id);

    if (!surface) {
      return;
    }

    if (surfacePrimitiveKey(surface.state.primitive) !== surfacePrimitiveKey(state.primitive)) {
      const host = surface.host;
      this.unregister(id);
      this.createSurface({ host, state });
      return;
    }

    surface.state = state;
    applySurfaceState(surface.mesh, state);
    void surface.pipeline.requestUpdate('surface-state');
  }

  refreshDisplayMetrics(): void {
    this.resources?.refreshDisplayMetrics();
  }

  getSurfaceScreenBounds(id: string): SurfaceBounds | null {
    const resources = this.resources;
    const surface = this.surfaces.get(id);

    if (!resources || !surface) {
      return null;
    }

    return projectSurfaceBounds(surface.mesh, resources.scene, resources.canvas);
  }

  simulateDeviceLossForTesting(): void {
    const resources = this.requireResources();
    const device = getWebGpuDevice(resources.engine);

    if (!device) {
      throw new Error('Cannot simulate device loss because the WebGPU device is unavailable.');
    }

    device.destroy();
  }

  dispose(): void {
    this.disposed = true;
    this.disposeAllSurfaces();
    this.pending.clear();
    this.disposeSceneResources();
    this.resources = null;
    this.canvas = null;
    this.surfaceCanvas = null;
    this.status.set({ kind: 'idle' });
    this.snapshots.set([]);
    this.deviceRecoveryCount = 0;
  }

  private createSurface(registration: BicSurfaceRegistration): void {
    const resources = this.requireResources();
    const { state, host } = registration;
    const primitive = normalizeSurfacePrimitive(state.primitive);
    const surfaceMesh = createSurfaceMesh(state.id, primitive, resources.scene);
    const { mesh, renderMeshes } = surfaceMesh;
    applySurfaceState(mesh, state);

    const pipeline = createHtmlSurfaceTexturePipeline({
      engine: resources.engine,
      scene: resources.scene,
      canvas: resources.surfaceCanvas,
      source: host,
      deviceRecoveryCount: this.deviceRecoveryCount,
    });
    const material = createSurfaceMaterial(
      state.id,
      pipeline.babylonTexture,
      primitive,
      resources.scene,
    );

    for (const renderMesh of renderMeshes) {
      renderMesh.material = material;
    }

    const effects = new BicSurfaceEffects(
      resources.scene,
      mesh,
      renderMeshes,
      host,
      state.id,
      primitive.kind === 'plane',
    );
    const surface: SurfaceResources = {
      host,
      mesh,
      renderMeshes,
      material,
      pipeline,
      effects,
      stopPipelineListener: () => undefined,
      state,
      projection: null,
      effectValues: effects.update(),
      composition: {
        primitive: primitive.kind,
        interaction: primitive.kind === 'plane' ? 'interactive' : 'visual-only',
        inViewport: primitive.kind === 'plane',
        fullyOccluded: false,
        occludedBy: null,
        stackingOrder: 0,
        cameraDistance: 0,
      },
    };
    const stopPipelineListener = pipeline.onSnapshot(() => {
      const snapshot = pipeline.snapshot();
      host.dataset['bicTextureSize'] = `${snapshot.size.width}x${snapshot.size.height}`;
      host.dataset['bicTextureUpdates'] = String(snapshot.updateCount);
      host.dataset['bicTextureResizes'] = String(snapshot.resizeCount);
      host.dataset['bicTextureRequests'] = String(snapshot.requestCount);
      host.dataset['bicTextureCoalesced'] = String(snapshot.coalescedRequestCount);
      host.dataset['bicTextureRetries'] = String(snapshot.paintRetryCount);
      host.dataset['bicTextureTimeouts'] = String(snapshot.paintTimeoutCount);
      host.dataset['bicTextureInFlight'] = String(snapshot.updateInFlight);
      host.dataset['bicTextureQueued'] = String(snapshot.updateQueued);
      host.dataset['bicDeviceRecoveries'] = String(snapshot.deviceRecoveryCount);
      host.dataset['bicTextureError'] = snapshot.lastError ?? '';
      this.publishSnapshots();
    });

    surface.stopPipelineListener = stopPipelineListener;
    this.surfaces.set(state.id, surface);

    if (this.surfaces.size === 1) {
      resources.camera.setTarget(mesh.position);
    }

    void pipeline.requestUpdate('manual');
    this.publishSnapshots();
  }

  private unregister(id: string): void {
    if (this.pending.delete(id)) {
      return;
    }

    const surface = this.surfaces.get(id);

    if (!surface) {
      return;
    }

    surface.stopPipelineListener();
    disposeSurfaceResources(surface);
    this.surfaces.delete(id);
    this.publishSnapshots();
  }

  private render(): void {
    const resources = this.requireResources();
    resources.scene.render();

    for (const surface of this.surfaces.values()) {
      surface.effectValues = surface.effects.update();
      const primitive = normalizeSurfacePrimitive(surface.state.primitive);

      if (primitive.kind === 'plane') {
        try {
          surface.projection = synchronizeSurfaceProjection(
            resources.adapter,
            resources.surfaceCanvas,
            surface.host,
            surface.mesh,
            resources.scene,
          );
          surface.host.dataset['bicProjectionReady'] = 'true';
          surface.host.dataset['bicProjectionError'] =
            String(surface.projection.maximumAlignmentError);
          surface.host.dataset['bicProjectionStrategy'] = surface.projection.strategy;
        } catch (error) {
          if (!(error instanceof DOMException && error.name === 'InvalidStateError')) {
            throw error;
          }
        }
      } else {
        surface.projection = null;
        surface.host.dataset['bicProjectionReady'] = 'false';
        surface.host.dataset['bicProjectionError'] = '';
        surface.host.dataset['bicProjectionStrategy'] = 'visual-only';
      }
    }

    this.applySurfaceComposition(resources);

    if (resources.scene.getFrameId() % 15 === 0) {
      this.publishSnapshots();
    }
  }

  private publishSnapshots(): void {
    this.snapshots.set([...this.surfaces.values()].map((surface) => ({
      id: surface.state.id,
      state: surface.state,
      texture: surface.pipeline.snapshot(),
      projection: surface.projection,
      effects: surface.effectValues,
      composition: surface.composition,
    })));
  }

  private applySurfaceComposition(resources: SceneResources): void {
    const canvasBounds = resources.canvas.getBoundingClientRect();
    const viewport = {
      left: canvasBounds.left,
      top: canvasBounds.top,
      right: canvasBounds.right,
      bottom: canvasBounds.bottom,
      width: canvasBounds.width,
      height: canvasBounds.height,
    };
    const planarCandidates = [...this.surfaces.values()]
      .filter((surface) => surface.projection !== null)
      .map((surface) => ({
        id: surface.state.id,
        bounds: surface.projection!.projectedBounds,
        cameraDistance: BABYLON.Vector3.Distance(
          resources.camera.globalPosition,
          surface.mesh.getAbsolutePosition(),
        ),
        interactive: (surface.state.interaction ?? 'auto') === 'auto',
        occlusionEnabled: (surface.state.occlusion ?? 'auto') === 'auto',
      }));
    const composition = new Map(
      composePlanarSurfaces(planarCandidates, viewport)
        .map((result) => [result.id, result]),
    );

    for (const surface of this.surfaces.values()) {
      const primitive = normalizeSurfacePrimitive(surface.state.primitive);
      const result = composition.get(surface.state.id);
      const cameraDistance = BABYLON.Vector3.Distance(
        resources.camera.globalPosition,
        surface.mesh.getAbsolutePosition(),
      );
      const requestedInteraction = surface.state.interaction ?? 'auto';
      const interaction = primitive.kind !== 'plane'
        ? 'visual-only'
        : requestedInteraction === 'none'
          ? 'disabled'
          : 'interactive';
      const interactive =
        interaction === 'interactive' &&
        result?.inViewport === true &&
        result.fullyOccluded === false;
      const stackingOrder = result?.stackingOrder ?? -1;

      surface.composition = {
        primitive: primitive.kind,
        interaction,
        inViewport: result?.inViewport ?? false,
        fullyOccluded: result?.fullyOccluded ?? false,
        occludedBy: result?.occludedBy ?? null,
        stackingOrder,
        cameraDistance,
      };
      applyDomComposition(surface.host, surface.composition, interactive);
    }
  }

  private handleDisplayMetricsChange(
    metrics: Omit<BicDisplayMetricsSnapshot, 'revision'>,
  ): void {
    const previous = this.displayMetrics();
    const devicePixelRatioChanged =
      metrics.devicePixelRatio !== previous.devicePixelRatio;

    this.displayMetrics.set({
      ...metrics,
      revision: previous.revision + 1,
    });
    this.devicePixelRatio.set(metrics.devicePixelRatio);

    if (devicePixelRatioChanged) {
      for (const surface of this.surfaces.values()) {
        void surface.pipeline.requestUpdate('device-pixel-ratio');
      }
    }
  }

  private async handleDeviceLost(): Promise<void> {
    if (this.recoveringDevice || this.disposed) {
      return;
    }

    this.recoveringDevice = true;
    this.status.set({
      kind: 'recovering',
      message: 'The WebGPU device was lost. Rebuilding the Babylon scene and HTML surfaces.',
      deviceRecoveryCount: this.deviceRecoveryCount,
    });

    try {
      for (const surface of this.surfaces.values()) {
        this.pending.set(surface.state.id, {
          host: surface.host,
          state: surface.state,
        });
      }
      this.disposeAllSurfaces();
      this.disposeSceneResources();
      this.resources = null;
      this.deviceRecoveryCount += 1;
      await this.bootScene();
    } catch (error) {
      this.status.set({
        kind: 'failed',
        message: `WebGPU device recovery failed: ${toErrorMessage(error)}`,
      });
    } finally {
      this.recoveringDevice = false;
    }
  }

  private async bootScene(): Promise<void> {
    if (!this.canvas || !this.surfaceCanvas) {
      throw new Error('BicSceneRuntime cannot boot without its scene canvases.');
    }

    const engine = new BABYLON.WebGPUEngine(this.canvas, {
      antialias: true,
      ...this.options.engineOptions,
      doNotHandleContextLost: true,
    });
    await engine.initAsync();

    const device = getWebGpuDevice(engine);

    if (!device) {
      engine.dispose();
      throw new Error('Babylon WebGPU device is unavailable after engine initialization.');
    }

    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.015, 0.025, 0.055, 1);
    const camera = createCamera(scene, this.canvas);
    new BABYLON.HemisphericLight('bic-key-light', new BABYLON.Vector3(0, 1, 0), scene);

    const adapter = createHtmlInCanvasAdapter(this.surfaceCanvas, device.queue);
    adapter.assertCapabilities();
    const displayMetrics = listenForCanvasResize(
      engine,
      this.canvas,
      this.surfaceCanvas,
      (metrics) => this.handleDisplayMetricsChange(metrics),
    );
    this.resources = {
      engine,
      scene,
      camera,
      canvas: this.canvas,
      surfaceCanvas: this.surfaceCanvas,
      adapter,
      stopResize: displayMetrics.stop,
      refreshDisplayMetrics: displayMetrics.refresh,
      stopDeviceLoss: listenForDeviceLoss(device, () => {
        void this.handleDeviceLost();
      }),
    };

    const registrations = [...this.pending.values()];
    this.pending.clear();

    for (const registration of registrations) {
      this.createSurface(registration);
    }

    engine.runRenderLoop(() => this.render());
    this.status.set({
      kind: 'ready',
      capabilities: adapter.capabilities(),
      deviceRecoveryCount: this.deviceRecoveryCount,
    });
  }

  private disposeAllSurfaces(): void {
    for (const surface of this.surfaces.values()) {
      surface.stopPipelineListener();
      disposeSurfaceResources(surface);
    }

    this.surfaces.clear();
    this.publishSnapshots();
  }

  private disposeSceneResources(): void {
    if (!this.resources) {
      return;
    }

    this.resources.engine.stopRenderLoop();
    this.resources.stopResize();
    this.resources.stopDeviceLoss();
    this.resources.scene.dispose();
    this.resources.engine.dispose();
  }

  private requireResources(): SceneResources {
    if (!this.resources) {
      throw new Error('BicSceneRuntime has not been initialized.');
    }

    return this.resources;
  }
}

function createCamera(
  scene: BABYLON.Scene,
  canvas: HTMLCanvasElement,
): BABYLON.ArcRotateCamera {
  const camera = new BABYLON.ArcRotateCamera(
    'bic-camera',
    -Math.PI / 2,
    Math.PI / 2.25,
    4.2,
    BABYLON.Vector3.Zero(),
    scene,
  );
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 2.2;
  camera.upperRadiusLimit = 12;
  scene.activeCamera = camera;
  return camera;
}

function applySurfaceState(mesh: BABYLON.Mesh, state: SurfaceState): void {
  mesh.position.set(state.position.x, state.position.y, state.position.z);
  mesh.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
  mesh.scaling.set(state.size.width / 240, state.size.height / 240, 1);
}

function disposeSurfaceResources(surface: SurfaceResources): void {
  surface.effects.dispose();
  surface.pipeline.dispose();
  surface.material.dispose();
  surface.mesh.dispose();
}

interface CreatedSurfaceMesh {
  readonly mesh: BABYLON.Mesh;
  readonly renderMeshes: readonly BABYLON.Mesh[];
}

function createSurfaceMesh(
  id: string,
  primitive: SurfacePrimitive,
  scene: BABYLON.Scene,
): CreatedSurfaceMesh {
  if (primitive.kind === 'plane') {
    const plane = BABYLON.MeshBuilder.CreatePlane(id, { size: 1 }, scene);
    return { mesh: plane, renderMeshes: [plane] };
  }

  const arc = clamp(primitive.arc, 0.05, Math.PI * 1.75);
  const tessellation = Math.round(clamp(primitive.tessellation ?? 32, 8, 128));
  const radius = 1 / arc;
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];

  for (let column = 0; column <= tessellation; column += 1) {
    const u = column / tessellation;
    const angle = (u - 0.5) * arc;
    const x = Math.sin(angle) * radius;
    const z = (Math.cos(angle) - 1) * radius;

    positions.push(x, -0.5, z, x, 0.5, z);
    uvs.push(u, 0, u, 1);
  }

  for (let column = 0; column < tessellation; column += 1) {
    const lowerLeft = column * 2;
    const upperLeft = lowerLeft + 1;
    const lowerRight = lowerLeft + 2;
    const upperRight = lowerLeft + 3;

    indices.push(
      lowerLeft, lowerRight, upperRight,
      lowerLeft, upperRight, upperLeft,
    );
  }

  BABYLON.VertexData.ComputeNormals(positions, indices, normals);

  const mesh = new BABYLON.Mesh(id, scene);
  const vertexData = new BABYLON.VertexData();

  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.applyToMesh(mesh);

  return { mesh, renderMeshes: [mesh] };
}

function createSurfaceMaterial(
  id: string,
  texture: BABYLON.Texture,
  primitive: SurfacePrimitive,
  scene: BABYLON.Scene,
): BABYLON.Material {
  const material = new BABYLON.StandardMaterial(`${id}-material`, scene);

  material.diffuseColor = BABYLON.Color3.Black();
  // StandardMaterial's back/front lighting path saturates a bent unlit mesh
  // when a white emissive color is combined with the copied DOM texture.
  // Planes retain the established value; curved primitives use the texture as
  // the emissive contribution without adding a white base.
  material.emissiveColor = primitive.kind === 'plane'
    ? BABYLON.Color3.White()
    : BABYLON.Color3.Black();
  material.specularColor = BABYLON.Color3.Black();
  material.backFaceCulling = false;
  material.disableLighting = true;
  material.emissiveTexture = texture;
  return material;
}

function normalizeSurfacePrimitive(primitive: SurfacePrimitive | undefined): SurfacePrimitive {
  return primitive ?? { kind: 'plane' };
}

function surfacePrimitiveKey(primitive: SurfacePrimitive | undefined): string {
  const normalized = normalizeSurfacePrimitive(primitive);
  return normalized.kind === 'plane'
    ? 'plane'
    : `cylinder:${normalized.arc}:${normalized.tessellation ?? 32}`;
}

function applyDomComposition(
  host: HTMLElement,
  composition: BicSurfaceCompositionSnapshot,
  interactive: boolean,
): void {
  host.style.zIndex = String(100 + Math.max(composition.stackingOrder, 0));
  host.style.pointerEvents = interactive ? 'auto' : 'none';
  const inert = !interactive;
  const ariaHidden = String(composition.interaction === 'visual-only');

  if (host.inert !== inert) {
    host.inert = inert;
  }

  if (host.getAttribute('aria-hidden') !== ariaHidden) {
    host.setAttribute('aria-hidden', ariaHidden);
  }
  host.dataset['bicInteraction'] = composition.interaction;
  host.dataset['bicInViewport'] = String(composition.inViewport);
  host.dataset['bicFullyOccluded'] = String(composition.fullyOccluded);
  host.dataset['bicOccludedBy'] = composition.occludedBy ?? '';
  host.dataset['bicStackingOrder'] = String(composition.stackingOrder);
  host.dataset['bicCameraDistance'] = String(composition.cameraDistance);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

interface DisplayMetricsListener {
  readonly refresh: () => void;
  readonly stop: () => void;
}

function listenForCanvasResize(
  engine: BABYLON.WebGPUEngine,
  canvas: HTMLCanvasElement,
  surfaceCanvas: HTMLCanvasElement,
  onMetrics: (metrics: Omit<BicDisplayMetricsSnapshot, 'revision'>) => void,
): DisplayMetricsListener {
  let currentDevicePixelRatio = readDevicePixelRatio();
  let resolutionQuery: MediaQueryList | null = null;

  const resize = () => {
    engine.resize();
    surfaceCanvas.width = canvas.width;
    surfaceCanvas.height = canvas.height;

    const nextDevicePixelRatio = readDevicePixelRatio();
    onMetrics({
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      backingWidth: canvas.width,
      backingHeight: canvas.height,
      devicePixelRatio: nextDevicePixelRatio,
    });

    if (nextDevicePixelRatio !== currentDevicePixelRatio) {
      currentDevicePixelRatio = nextDevicePixelRatio;
      armResolutionQuery();
    }
  };
  const handleResolutionChange = () => resize();
  const armResolutionQuery = () => {
    resolutionQuery?.removeEventListener('change', handleResolutionChange);
    resolutionQuery = window.matchMedia(`(resolution: ${currentDevicePixelRatio}dppx)`);
    resolutionQuery.addEventListener('change', handleResolutionChange);
  };
  const observer = new ResizeObserver(resize);

  observer.observe(canvas);
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  armResolutionQuery();
  resize();

  return {
    refresh: resize,
    stop: () => {
      observer.disconnect();
      resolutionQuery?.removeEventListener('change', handleResolutionChange);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    },
  };
}

function listenForDeviceLoss(
  device: GPUDevice,
  onLost: () => void,
): () => void {
  let active = true;

  void device.lost.then(() => {
    if (active) {
      onLost();
    }
  });

  return () => {
    active = false;
  };
}

function readDevicePixelRatio(): number {
  return Math.max(window.devicePixelRatio || 1, 1);
}

function getWebGpuDevice(engine: BABYLON.WebGPUEngine): GPUDevice | undefined {
  return (engine as unknown as { readonly _device?: GPUDevice })._device;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
