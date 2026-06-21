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
  | { readonly kind: 'ready'; readonly capabilities: HtmlInCanvasCapabilities }
  | { readonly kind: 'failed'; readonly message: string };

export interface BicSurfaceRuntimeSnapshot {
  readonly id: string;
  readonly texture: HtmlSurfaceTextureSnapshot;
  readonly projection: SurfaceProjectionSnapshot | null;
  readonly effects: BicSpatialEffectValues;
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

  private readonly pending = new Map<string, BicSurfaceRegistration>();
  private readonly surfaces = new Map<string, SurfaceResources>();
  private resources: SceneResources | null = null;

  async initialize(
    canvas: HTMLCanvasElement,
    surfaceCanvas: HTMLCanvasElement,
    options: BicSceneRuntimeOptions = {},
  ): Promise<void> {
    if (this.resources) {
      throw new Error('BicSceneRuntime is already initialized.');
    }

    this.status.set({ kind: 'booting' });

    try {
      const engine = new BABYLON.WebGPUEngine(canvas, {
        antialias: true,
        ...options.engineOptions,
      });
      await engine.initAsync();

      const scene = new BABYLON.Scene(engine);
      scene.clearColor = new BABYLON.Color4(0.015, 0.025, 0.055, 1);
      const camera = createCamera(scene, canvas);
      new BABYLON.HemisphericLight('bic-key-light', new BABYLON.Vector3(0, 1, 0), scene);

      const adapter = createHtmlInCanvasAdapter(surfaceCanvas, getWebGpuDevice(engine)?.queue);
      adapter.assertCapabilities();
      const stopResize = listenForCanvasResize(engine, canvas, surfaceCanvas);

      this.resources = {
        engine,
        scene,
        camera,
        canvas,
        surfaceCanvas,
        adapter,
        stopResize,
      };

      for (const registration of this.pending.values()) {
        this.createSurface(registration);
      }
      this.pending.clear();

      engine.runRenderLoop(() => this.render());
      this.status.set({ kind: 'ready', capabilities: adapter.capabilities() });
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

  dispose(): void {
    for (const id of [...this.surfaces.keys()]) {
      this.unregister(id);
    }
    this.pending.clear();

    if (!this.resources) {
      return;
    }

    this.resources.engine.stopRenderLoop();
    this.resources.stopResize();
    this.resources.scene.dispose();
    this.resources.engine.dispose();
    this.resources = null;
    this.status.set({ kind: 'idle' });
    this.snapshots.set([]);
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
    surface.effects.dispose();
    surface.pipeline.dispose();
    surface.material.dispose();
    surface.plane.dispose();
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

function listenForCanvasResize(
  engine: BABYLON.WebGPUEngine,
  canvas: HTMLCanvasElement,
  surfaceCanvas: HTMLCanvasElement,
): () => void {
  const resize = () => {
    engine.resize();
    surfaceCanvas.width = canvas.width;
    surfaceCanvas.height = canvas.height;
  };
  const observer = new ResizeObserver(resize);

  observer.observe(canvas);
  window.addEventListener('resize', resize);
  resize();

  return () => {
    observer.disconnect();
    window.removeEventListener('resize', resize);
  };
}

function getWebGpuDevice(engine: BABYLON.WebGPUEngine): GPUDevice | undefined {
  return (engine as unknown as { readonly _device?: GPUDevice })._device;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
