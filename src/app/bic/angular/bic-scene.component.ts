import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  signal,
  viewChild,
} from '@angular/core';
import * as BABYLON from '@babylonjs/core';
import { createHtmlInCanvasAdapter, HtmlInCanvasCapabilities } from '../core/html-in-canvas-adapter';
import {
  createHtmlSurfaceTexturePipeline,
  HtmlSurfaceTexturePipeline,
  HtmlSurfaceTextureSnapshot,
} from '../core/html-surface-texture-pipeline';
import { SurfaceState } from '../core/surface-types';
import { toSurfaceViewModel } from '../core/surface-machine';
import {
  SurfaceProjectionSnapshot,
  synchronizeSurfaceProjection,
} from '../core/surface-projection';

interface SceneResources {
  readonly engine: BABYLON.WebGPUEngine;
  readonly scene: BABYLON.Scene;
  readonly camera: BABYLON.ArcRotateCamera;
  readonly plane: BABYLON.Mesh;
  readonly material: BABYLON.StandardMaterial;
  readonly surfaceTexturePipeline: HtmlSurfaceTexturePipeline;
  readonly stopSurfaceTextureSnapshotListener: () => void;
  readonly stopResizeListener: () => void;
  readonly adapter: ReturnType<typeof createHtmlInCanvasAdapter>;
}

interface SceneRenderSnapshot {
  readonly canvas: {
    readonly clientWidth: number;
    readonly clientHeight: number;
    readonly width: number;
    readonly height: number;
  };
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly activeMeshes: number;
  readonly frameId: number;
  readonly projection: SurfaceProjectionSnapshot;
  readonly camera: {
    readonly position: string;
    readonly target: string;
    readonly radius: number;
    readonly alpha: number;
    readonly beta: number;
  };
  readonly plane: {
    readonly position: string;
    readonly scaling: string;
    readonly isEnabled: boolean;
    readonly isVisible: boolean;
    readonly materialHasTexture: boolean;
    readonly cameraSide: 'front' | 'back' | 'edge-on';
    readonly cameraFacingDot: number;
  };
}

type SceneStatus =
  | { readonly kind: 'booting' }
  | { readonly kind: 'ready'; readonly capabilities: HtmlInCanvasCapabilities }
  | { readonly kind: 'unsupported'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

@Component({
  selector: 'bic-scene',
  template: `
    <section class="scene-shell">
      <canvas #canvas class="scene-canvas"></canvas>

      <canvas #surfaceCanvas class="surface-canvas" layoutsubtree aria-hidden="true">
        <div
          #surfaceHost
          class="surface-host"
          [class.surface-host--focused]="viewModel().focused"
          [style.width]="captureSize().width"
          [style.height]="captureSize().height"
          [style.--bic-depth]="viewModel().depth"
          [style.--bic-glow-intensity]="viewModel().glowIntensity"
          [attr.data-bic-surface]="viewModel().id"
        >
          <div
            class="surface-content"
            [style.width]="viewModel().cssWidth"
            [style.height]="viewModel().cssHeight"
            [style.transform]="captureSize().contentTransform"
          >
            <ng-content />
          </div>
        </div>
      </canvas>

      <aside class="diagnostics" [class.diagnostics--collapsed]="diagnosticsCollapsed()">
        <header class="diagnostics__header">
          <strong>{{ statusLabel() }}</strong>
          <button
            type="button"
            aria-controls="scene-diagnostics-detail"
            [attr.aria-expanded]="!diagnosticsCollapsed()"
            (click)="diagnosticsCollapsed.update(collapsed => !collapsed)"
          >
            {{ diagnosticsCollapsed() ? 'Expand' : 'Collapse' }}
          </button>
        </header>

        @if (!diagnosticsCollapsed()) {
          <span id="scene-diagnostics-detail" aria-live="polite">{{ statusDetail() }}</span>
        }
      </aside>
    </section>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .scene-shell {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background:
        radial-gradient(circle at 50% 35%, rgba(75, 112, 255, 0.22), transparent 34%),
        linear-gradient(145deg, #10131b, #171a24 52%, #0b0d13);
    }

    .scene-canvas {
      display: block;
      position: absolute;
      inset: 0;
      z-index: 1;
      width: 100%;
      height: 100%;
      outline: none;
    }

    .surface-canvas {
      position: absolute;
      inset: 0;
      z-index: 2;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    .surface-host {
      position: absolute;
      left: 0;
      top: 0;
      overflow: hidden;
      border-radius: 10px;
      background: rgba(24, 29, 42, 0.94);
      box-shadow:
        0 18px 48px rgba(0, 0, 0, 0.34),
        0 0 calc(var(--bic-glow-intensity) * 42px) rgba(97, 146, 255, var(--bic-glow-intensity));
      color: #f4f7fb;
      contain: layout paint style;
      pointer-events: auto;
      transform-origin: 0 0;
      will-change: transform;
    }

    .surface-content {
      transform-origin: 0 0;
    }

    .surface-host--focused {
      outline: 1px solid rgba(155, 190, 255, 0.85);
    }

    .diagnostics {
      position: absolute;
      left: 16px;
      bottom: 16px;
      z-index: 10;
      display: grid;
      gap: 3px;
      max-width: min(520px, calc(100vw - 32px));
      padding: 10px 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      background: rgba(10, 13, 20, 0.74);
      color: rgba(244, 247, 251, 0.78);
      font-size: 12px;
      line-height: 1.35;
      backdrop-filter: blur(16px);
    }

    .diagnostics strong {
      color: #ffffff;
      font-size: 12px;
    }

    .diagnostics--collapsed {
      width: min(300px, calc(100vw - 32px));
    }

    .diagnostics__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .diagnostics button {
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 6px;
      padding: 5px 8px;
      background: rgba(255, 255, 255, 0.08);
      color: #ffffff;
      font: inherit;
      cursor: pointer;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BicSceneComponent implements AfterViewInit, OnDestroy {
  readonly surface = input.required<SurfaceState>();

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly surfaceCanvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('surfaceCanvas');
  private readonly surfaceHostRef = viewChild.required<ElementRef<HTMLElement>>('surfaceHost');
  private readonly resources = signal<SceneResources | null>(null);
  private readonly status = signal<SceneStatus>({ kind: 'booting' });
  private readonly surfaceTextureSnapshot = signal<HtmlSurfaceTextureSnapshot | null>(null);
  private readonly renderSnapshot = signal<SceneRenderSnapshot | null>(null);
  readonly diagnosticsCollapsed = signal(true);

  readonly viewModel = computed(() => toSurfaceViewModel(this.surface()));
  readonly captureSize = computed(() => {
    const size = this.surface().size;
    const devicePixelRatio = window.devicePixelRatio;

    return {
      width: `${Math.ceil(size.width * devicePixelRatio)}px`,
      height: `${Math.ceil(size.height * devicePixelRatio)}px`,
      contentTransform: `scale(${devicePixelRatio})`,
    };
  });

  readonly statusLabel = computed(() => {
    const status = this.status();
    return status.kind === 'ready' ? 'Electron/WebGPU scene ready' : 'Electron/WebGPU scene';
  });

  readonly statusDetail = computed(() => {
    const status = this.status();

    if (status.kind === 'ready') {
      const texture = this.surfaceTextureSnapshot();
      const render = this.renderSnapshot();
      return `HTML-in-Canvas capabilities: ${JSON.stringify(status.capabilities)}; texture: ${JSON.stringify(texture)}; render: ${JSON.stringify(render)}`;
    }

    if (status.kind === 'unsupported' || status.kind === 'failed') {
      return status.message;
    }

    return 'Booting Babylon WebGPU and checking HTML-in-Canvas capabilities.';
  });

  constructor() {
    effect(() => {
      const resources = this.resources();
      const surface = this.surface();

      if (!resources) {
        return;
      }

      applySurfaceToPlane(resources.plane, surface);
      resources.camera.setTarget(resources.plane.position);
      void resources.surfaceTexturePipeline.requestUpdate('surface-state');
    });
  }

  async ngAfterViewInit(): Promise<void> {
    const canvas = this.canvasRef().nativeElement;
    const surfaceCanvas = this.surfaceCanvasRef().nativeElement;
    const surfaceHost = this.surfaceHostRef().nativeElement;

    try {
      const engine = new BABYLON.WebGPUEngine(canvas, {
        antialias: true,
      });

      await engine.initAsync();

      const { scene, camera } = createScene(engine, canvas);
      const plane = createSurfacePlane(scene, this.surface());
      const material = createSurfaceMaterial(scene);
      const stopResizeListener = listenForCanvasResize(engine, canvas, surfaceCanvas);

      plane.material = material;
      camera.setTarget(plane.position);
      const adapter = createHtmlInCanvasAdapter(surfaceCanvas, getWebGpuDevice(engine)?.queue);
      const surfaceTexturePipeline = createHtmlSurfaceTexturePipeline({
        engine,
        scene,
        canvas: surfaceCanvas,
        source: surfaceHost,
      });

      material.diffuseTexture = surfaceTexturePipeline.babylonTexture;
      const stopSurfaceTextureSnapshotListener = surfaceTexturePipeline.onSnapshot(() => {
        const snapshot = surfaceTexturePipeline.snapshot();
        this.surfaceTextureSnapshot.set(snapshot);
        surfaceHost.dataset['bicTextureSize'] = `${snapshot.size.width}x${snapshot.size.height}`;
        surfaceHost.dataset['bicTextureUpdates'] = String(snapshot.updateCount);
        surfaceHost.dataset['bicTextureResizes'] = String(snapshot.resizeCount);
        surfaceHost.dataset['bicTextureError'] = snapshot.lastError ?? '';
      });
      void surfaceTexturePipeline.requestUpdate('manual');

      engine.runRenderLoop(() => {
        scene.render();

        try {
          const projection = synchronizeSurfaceProjection(
            adapter,
            surfaceCanvas,
            surfaceHost,
            plane,
            scene,
          );
          surfaceHost.dataset['bicProjectionReady'] = 'true';
          surfaceHost.dataset['bicProjectionError'] = String(projection.maximumAlignmentError);
          this.renderSnapshot.set(readRenderSnapshot(engine, canvas, scene, camera, plane, material, projection));
        } catch (error) {
          if (!(error instanceof DOMException && error.name === 'InvalidStateError')) {
            throw error;
          }
        }
      });

      this.resources.set({
        engine,
        scene,
        camera,
        plane,
        material,
        surfaceTexturePipeline,
        stopSurfaceTextureSnapshotListener,
        stopResizeListener,
        adapter,
      });
      this.status.set({ kind: 'ready', capabilities: adapter.capabilities() });
    } catch (error) {
      this.status.set({
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  ngOnDestroy(): void {
    const resources = this.resources();

    if (!resources) {
      return;
    }

    resources.stopSurfaceTextureSnapshotListener();
    resources.stopResizeListener();
    resources.surfaceTexturePipeline.dispose();
    resources.scene.dispose();
    resources.engine.dispose();
    this.resources.set(null);
  }
}

function createScene(
  engine: BABYLON.WebGPUEngine,
  canvas: HTMLCanvasElement,
): { readonly scene: BABYLON.Scene; readonly camera: BABYLON.ArcRotateCamera } {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.02, 0.035, 0.07, 1);

  const camera = new BABYLON.ArcRotateCamera(
    'main-camera',
    -Math.PI / 2,
    Math.PI / 2.25,
    4.2,
    BABYLON.Vector3.Zero(),
    scene,
  );

  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 2.2;
  camera.upperRadiusLimit = 8;
  scene.activeCamera = camera;

  new BABYLON.HemisphericLight('key-light', new BABYLON.Vector3(0, 1, 0), scene);

  return { scene, camera };
}

function createSurfacePlane(scene: BABYLON.Scene, surface: SurfaceState): BABYLON.Mesh {
  const plane = BABYLON.MeshBuilder.CreatePlane(
    surface.id,
    {
      width: surface.size.width / 240,
      height: surface.size.height / 240,
    },
    scene,
  );

  applySurfaceToPlane(plane, surface);
  plane.enableEdgesRendering();
  plane.edgesWidth = 2;
  plane.edgesColor = new BABYLON.Color4(0.35, 0.86, 1, 1);

  return plane;
}

function createSurfaceMaterial(scene: BABYLON.Scene): BABYLON.StandardMaterial {
  const material = new BABYLON.StandardMaterial('surface-texture-material', scene);
  material.diffuseColor = new BABYLON.Color3(0.35, 0.75, 1);
  material.emissiveColor = new BABYLON.Color3(0.35, 0.75, 1);
  material.backFaceCulling = false;
  material.disableLighting = true;

  return material;
}

function getWebGpuDevice(engine: BABYLON.WebGPUEngine): GPUDevice | undefined {
  return (engine as unknown as { readonly _device?: GPUDevice })._device;
}

function applySurfaceToPlane(plane: BABYLON.Mesh, surface: SurfaceState): void {
  plane.position.set(surface.position.x, surface.position.y, surface.position.z);
  plane.rotation.set(surface.rotation.x, surface.rotation.y, surface.rotation.z);
  plane.scaling.set(surface.focused ? 1.03 : 1, surface.focused ? 1.03 : 1, 1);
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

function readRenderSnapshot(
  engine: BABYLON.WebGPUEngine,
  canvas: HTMLCanvasElement,
  scene: BABYLON.Scene,
  camera: BABYLON.ArcRotateCamera,
  plane: BABYLON.Mesh,
  material: BABYLON.StandardMaterial,
  projection: SurfaceProjectionSnapshot,
): SceneRenderSnapshot {
  const cameraFacing = readCameraFacing(camera, plane);

  return {
    canvas: {
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      width: canvas.width,
      height: canvas.height,
    },
    renderWidth: engine.getRenderWidth(),
    renderHeight: engine.getRenderHeight(),
    activeMeshes: scene.getActiveMeshes().length,
    frameId: scene.getFrameId(),
    projection,
    camera: {
      position: formatVector(camera.position),
      target: formatVector(camera.target),
      radius: round(camera.radius),
      alpha: round(camera.alpha),
      beta: round(camera.beta),
    },
    plane: {
      position: formatVector(plane.position),
      scaling: formatVector(plane.scaling),
      isEnabled: plane.isEnabled(),
      isVisible: plane.isVisible,
      materialHasTexture: material.diffuseTexture !== null,
      cameraSide: cameraFacing.side,
      cameraFacingDot: round(cameraFacing.dot),
    },
  };
}

function readCameraFacing(
  camera: BABYLON.Camera,
  plane: BABYLON.Mesh,
): { readonly side: 'front' | 'back' | 'edge-on'; readonly dot: number } {
  plane.computeWorldMatrix(true);
  const frontNormal = BABYLON.Vector3.TransformNormal(
    new BABYLON.Vector3(0, 0, -1),
    plane.getWorldMatrix(),
  ).normalize();
  const planeToCamera = camera.position.subtract(plane.getAbsolutePosition()).normalize();
  const dot = BABYLON.Vector3.Dot(frontNormal, planeToCamera);
  const side = dot > 0.001 ? 'front' : dot < -0.001 ? 'back' : 'edge-on';

  return { side, dot };
}

function formatVector(vector: BABYLON.Vector3): string {
  return `${round(vector.x)},${round(vector.y)},${round(vector.z)}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
