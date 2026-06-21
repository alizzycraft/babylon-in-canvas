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
import { SurfaceProjectionSnapshot, synchronizeSurfaceProjection } from '../core/surface-projection';
import { SurfaceState } from '../core/surface-types';

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
  readonly texture: HtmlSurfaceTextureSnapshot;
  readonly projection: SurfaceProjectionSnapshot | null;
  readonly effects: BicSpatialEffectValues;
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
  readonly plane: BABYLON.Mesh;
  readonly material: BABYLON.StandardMaterial;
  readonly pipeline: HtmlSurfaceTexturePipeline;
  readonly effects: BicSurfaceEffects;
  stopPipelineListener: () => void;
  state: SurfaceState;
  projection: SurfaceProjectionSnapshot | null;
  effectValues: BicSpatialEffectValues;
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

    surface.state = state;
    applySurfaceState(surface.plane, state);
    void surface.pipeline.requestUpdate('surface-state');
  }

  refreshDisplayMetrics(): void {
    this.resources?.refreshDisplayMetrics();
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
    const plane = BABYLON.MeshBuilder.CreatePlane(state.id, { size: 1 }, resources.scene);
    const material = new BABYLON.StandardMaterial(`${state.id}-material`, resources.scene);

    material.diffuseColor = BABYLON.Color3.Black();
    material.emissiveColor = BABYLON.Color3.White();
    material.specularColor = BABYLON.Color3.Black();
    material.backFaceCulling = false;
    material.disableLighting = true;
    plane.material = material;
    applySurfaceState(plane, state);

    const pipeline = createHtmlSurfaceTexturePipeline({
      engine: resources.engine,
      scene: resources.scene,
      canvas: resources.surfaceCanvas,
      source: host,
      deviceRecoveryCount: this.deviceRecoveryCount,
    });
    material.emissiveTexture = pipeline.babylonTexture;

    const effects = new BicSurfaceEffects(resources.scene, plane, host, state.id);
    const surface: SurfaceResources = {
      host,
      plane,
      material,
      pipeline,
      effects,
      stopPipelineListener: () => undefined,
      state,
      projection: null,
      effectValues: effects.update(),
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
      resources.camera.setTarget(plane.position);
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

      try {
        surface.projection = synchronizeSurfaceProjection(
          resources.adapter,
          resources.surfaceCanvas,
          surface.host,
          surface.plane,
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
    }

    if (resources.scene.getFrameId() % 15 === 0) {
      this.publishSnapshots();
    }
  }

  private publishSnapshots(): void {
    this.snapshots.set([...this.surfaces.values()].map((surface) => ({
      id: surface.state.id,
      texture: surface.pipeline.snapshot(),
      projection: surface.projection,
      effects: surface.effectValues,
    })));
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

function applySurfaceState(plane: BABYLON.Mesh, state: SurfaceState): void {
  plane.position.set(state.position.x, state.position.y, state.position.z);
  plane.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
  plane.scaling.set(state.size.width / 240, state.size.height / 240, 1);
}

function disposeSurfaceResources(surface: SurfaceResources): void {
  surface.effects.dispose();
  surface.pipeline.dispose();
  surface.material.dispose();
  surface.plane.dispose();
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
