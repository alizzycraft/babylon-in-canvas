import { Injectable } from '@angular/core';
import * as BABYLON from '@babylonjs/core';
import { auditHtmlInCanvasCapabilities, createHtmlInCanvasAdapter, type SurfaceTextureSize } from '../bic/core/html-in-canvas-adapter';
import '../bic/core/runtime-environment';
import { RuntimeProof, RuntimeProofResult, RuntimeProofStatus } from './runtime-proof.types';

const requiredNodeRanges = '^22.22.3 || ^24.15.0 || ^26.0.0';
const gpuTextureUsage = {
  copySrc: 0x01,
  copyDst: 0x02,
  textureBinding: 0x04,
  renderAttachment: 0x10,
} as const;
const gpuBufferUsage = {
  mapRead: 0x0001,
  copyDst: 0x0008,
} as const;
const gpuMapMode = {
  read: 0x0001,
} as const;
const proofTimeoutMs = 10_000;
const proofProgress = new Map<string, string>();

@Injectable({ providedIn: 'root' })
export class RuntimeProofRunnerService {
  async runAll(context: RuntimeProofContext): Promise<readonly RuntimeProofResult[]> {
    const proofs = createRuntimeProofs(context);
    const results: RuntimeProofResult[] = [];

    for (const proof of proofs) {
      const result = await runProofWithTimeout(proof);
      results.push(result);
      console.info('[runtime-proof]', result.name, result);
    }

    return results;
  }
}

async function runProofWithTimeout(proof: RuntimeProof): Promise<RuntimeProofResult> {
  let timeout = 0;

  try {
    proofProgress.set(proof.name, 'started');
    return await Promise.race([
      proof.run(),
      new Promise<RuntimeProofResult>((resolve) => {
        timeout = window.setTimeout(() => {
          resolve(result(proof.name, 'blocked', {
            timeoutMs: proofTimeoutMs,
            lastProgress: proofProgress.get(proof.name) ?? 'unknown',
          }, [`Proof did not complete within ${proofTimeoutMs}ms.`]));
        }, proofTimeoutMs);
      }),
    ]);
  } catch (error) {
    return result(proof.name, 'fail', {}, [toErrorMessage(error)]);
  } finally {
    window.clearTimeout(timeout);
    proofProgress.delete(proof.name);
  }
}

export interface RuntimeProofContext {
  readonly babylonCanvas: HTMLCanvasElement;
  readonly htmlCanvas: HTMLCanvasElement;
  readonly copySurface: HTMLElement;
  readonly domSurface: HTMLElement;
}

function createRuntimeProofs(context: RuntimeProofContext): readonly RuntimeProof[] {
  return [
    { name: 'runtime-baseline', run: () => runRuntimeBaselineProof() },
    { name: 'electron-runtime', run: () => runElectronRuntimeProof() },
    { name: 'babylon-webgpu-scene', run: () => runBabylonWebGpuSceneProof(context.babylonCanvas) },
    { name: 'html-in-canvas-capability-audit', run: () => runHtmlInCanvasCapabilityAudit(context.htmlCanvas) },
    { name: 'copy-to-texture', run: () => runCopyToTextureProof(context.htmlCanvas, context.copySurface) },
    { name: 'babylon-texture-orientation', run: () => runBabylonTextureOrientationProof(context.babylonCanvas) },
    { name: 'direct-dom-surface', run: () => runDirectDomSurfaceProof(context.domSurface) },
  ];
}

async function runRuntimeBaselineProof(): Promise<RuntimeProofResult> {
  const runtime = window.bicRuntime;
  const node = runtime?.versions.node ?? 'unavailable';
  const nodeSupported = runtime?.versions.node ? isSupportedNodeVersion(runtime.versions.node) : false;
  const errors = nodeSupported ? [] : [`Node ${node} does not satisfy ${requiredNodeRanges}.`];

  return result('runtime-baseline', nodeSupported ? 'pass' : 'blocked', {
    node,
    pnpm: 'Run pnpm --version in the shell until package manager metadata is exposed to the renderer.',
    angular: '22.0.1',
    typescript: '6.0.3',
    electron: runtime?.versions.electron ?? 'unavailable',
    babylon: '9.12.0',
    requiredNodeRanges,
  }, errors);
}

async function runElectronRuntimeProof(): Promise<RuntimeProofResult> {
  const errors: string[] = [];
  const runtime = window.bicRuntime;
  const adapter = await requestWebGpuAdapter(errors);
  const device = adapter ? await requestWebGpuDevice(adapter, errors) : undefined;
  const electronMetadataAvailable = Boolean(runtime?.versions.electron && runtime.versions.chrome && runtime.versions.node);

  if (!electronMetadataAvailable) {
    errors.push('Electron preload runtime metadata is unavailable; this proof must run inside the Electron host window.');
  }

  device?.destroy();

  const details = {
    host: electronMetadataAvailable ? 'electron' : 'browser-or-unknown',
    electron: runtime?.versions.electron ?? 'unavailable',
    chrome: runtime?.versions.chrome ?? 'unavailable',
    node: runtime?.versions.node ?? 'unavailable',
    navigatorGpuAvailable: Boolean(navigator.gpu),
    adapterFound: Boolean(adapter),
    deviceCreated: Boolean(device),
    appliedFlags: runtime?.chromiumFlags ?? 'unavailable',
  };

  return result('electron-runtime', errors.length === 0 ? 'pass' : 'blocked', details, errors);
}

async function runBabylonWebGpuSceneProof(canvas: HTMLCanvasElement): Promise<RuntimeProofResult> {
  const errors: string[] = [];
  let sceneCreated = false;
  let firstFrameRendered = false;
  let resizeHandled = false;
  let disposedWithoutErrors = false;

  try {
    const engine = new BABYLON.WebGPUEngine(canvas, { antialias: true });
    await engine.initAsync();

    const scene = new BABYLON.Scene(engine);
    sceneCreated = true;

    const camera = new BABYLON.ArcRotateCamera('proof-camera', Math.PI / 2, Math.PI / 2.4, 4, BABYLON.Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    new BABYLON.HemisphericLight('proof-light', new BABYLON.Vector3(0, 1, 0), scene);
    BABYLON.MeshBuilder.CreateBox('proof-box', { size: 1 }, scene);

    scene.render();
    firstFrameRendered = true;

    engine.resize();
    resizeHandled = true;

    scene.dispose();
    engine.dispose();
    disposedWithoutErrors = true;
  } catch (error) {
    errors.push(toErrorMessage(error));
  }

  return result('babylon-webgpu-scene', errors.length === 0 ? 'pass' : 'fail', {
    engine: 'WebGPUEngine',
    sceneCreated,
    firstFrameRendered,
    resizeHandled,
    disposedWithoutErrors,
  }, errors);
}

async function runHtmlInCanvasCapabilityAudit(canvas: HTMLCanvasElement): Promise<RuntimeProofResult> {
  const errors: string[] = [];
  const adapter = await requestWebGpuAdapter(errors);
  const device = adapter ? await requestWebGpuDevice(adapter, errors) : undefined;
  const capabilities = auditHtmlInCanvasCapabilities(canvas, device?.queue);
  const adapterCapabilities = createHtmlInCanvasAdapter(canvas, device?.queue).capabilities();
  const hasDrawOrCopy = capabilities.some((capability) =>
    ['drawElementImage', 'texElementImage2D', 'copyElementImageToTexture'].includes(capability.name) && capability.exists,
  );
  const status: RuntimeProofStatus = capabilities.every((capability) => capability.exists) ? 'pass' : 'partial';

  device?.destroy();

  return result('html-in-canvas-capability-audit', status, {
    capabilities,
    adapterCapabilities,
    drawOrCopyPrimitiveAvailable: hasDrawOrCopy,
  }, errors);
}

async function runCopyToTextureProof(canvas: HTMLCanvasElement, source: HTMLElement): Promise<RuntimeProofResult> {
  const proofName = 'copy-to-texture';
  const errors: string[] = [];
  proofProgress.set(proofName, 'requesting-adapter');
  const adapter = await requestWebGpuAdapter(errors);
  proofProgress.set(proofName, 'requesting-device');
  const device = adapter ? await requestWebGpuDevice(adapter, errors) : undefined;

  if (!device) {
    return result('copy-to-texture', 'blocked', {
      deviceCreated: false,
    }, errors);
  }

  const width = Math.max(1, Math.ceil(source.offsetWidth * window.devicePixelRatio));
  const height = Math.max(1, Math.ceil(source.offsetHeight * window.devicePixelRatio));
  const texture = device.createTexture({
    label: 'runtime-proof-html-copy-texture',
    size: { width, height },
    format: 'rgba8unorm',
    usage:
      gpuTextureUsage.copyDst |
      gpuTextureUsage.copySrc |
      gpuTextureUsage.textureBinding |
      gpuTextureUsage.renderAttachment,
  });
  const htmlInCanvas = createHtmlInCanvasAdapter(canvas, device.queue);
  const contextPrepared = prepareHtmlInCanvasRoot(canvas, source, width, height);
  let paintObserved = false;
  let copySucceeded = false;
  let copySignature: string | null = null;
  let nonZeroColorSamples = 0;
  let nonZeroAlphaSamples = 0;
  let cornerOrientation: TextureCornerOrientation | null = null;
  const paintDelayFrames = 2;

  try {
    proofProgress.set(proofName, 'waiting-for-animation-frames');
    source.dataset['copyProofRevision'] = String(Date.now());
    await waitForAnimationFrames(paintDelayFrames);

    proofProgress.set(proofName, 'waiting-for-paint-copy');
    const copyResult = await copyElementOnNextPaint(canvas, htmlInCanvas, source, texture, {
      width,
      height,
      devicePixelRatio: window.devicePixelRatio,
    });

    paintObserved = copyResult.paintObserved;
    copySignature = copyResult.copySignature;
    copySucceeded = copyResult.copySucceeded;

    if (copyResult.error) {
      throw new Error(copyResult.error);
    }

    proofProgress.set(proofName, 'reading-texture');
    const samples = await readTextureSample(device, texture, width, height);
    nonZeroColorSamples = samples.nonZeroColorSamples;
    nonZeroAlphaSamples = samples.nonZeroAlphaSamples;
    cornerOrientation = samples.cornerOrientation;
  } catch (error) {
    errors.push(toErrorMessage(error));
  } finally {
    texture.destroy();
    device.destroy();
  }

  return result('copy-to-texture', copySucceeded && nonZeroAlphaSamples > 0 ? 'pass' : 'fail', {
    sourceIsDirectCanvasChild: source.parentElement === canvas,
    sourceCssSize: {
      width: source.offsetWidth,
      height: source.offsetHeight,
    },
    textureSize: {
      width,
      height,
      devicePixelRatio: window.devicePixelRatio,
    },
    canvasBackingSize: {
      width: canvas.width,
      height: canvas.height,
    },
    contextPrepared,
    paintDelayFrames,
    paintObserved,
    copySucceeded,
    copySignature,
    nonZeroColorSamples,
    nonZeroAlphaSamples,
    cornerOrientation,
  }, errors);
}

async function runBabylonTextureOrientationProof(canvas: HTMLCanvasElement): Promise<RuntimeProofResult> {
  const proofName = 'babylon-texture-orientation';
  const errors: string[] = [];
  let cornerOrientation: TextureCornerOrientation | null = null;
  let cameraSide: 'front' | 'back' | 'edge-on' | null = null;

  try {
    proofProgress.set(proofName, 'initializing-engine');
    canvas.width = 128;
    canvas.height = 96;

    const engine = new BABYLON.WebGPUEngine(canvas, { antialias: false });
    await engine.initAsync();
    proofProgress.set(proofName, 'creating-scene');

    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);

    const camera = new BABYLON.FreeCamera('orientation-proof-camera', new BABYLON.Vector3(0, 0, -2), scene);
    camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    camera.orthoLeft = -1;
    camera.orthoRight = 1;
    camera.orthoTop = 0.75;
    camera.orthoBottom = -0.75;
    camera.setTarget(BABYLON.Vector3.Zero());
    scene.activeCamera = camera;

    const plane = BABYLON.MeshBuilder.CreatePlane('orientation-proof-plane', {
      width: 2,
      height: 1.5,
    }, scene);
    const material = new BABYLON.StandardMaterial('orientation-proof-material', scene);
    const texture = createBabylonOrientationTexture(scene);

    material.disableLighting = true;
    material.emissiveColor = BABYLON.Color3.White();
    material.diffuseTexture = texture;
    material.backFaceCulling = false;
    plane.material = material;

    cameraSide = classifyCameraSide(camera.position, plane);
    proofProgress.set(proofName, 'waiting-for-scene-ready');
    await scene.whenReadyAsync();
    proofProgress.set(proofName, 'rendering-first-frame');
    scene.render();
    proofProgress.set(proofName, 'waiting-for-animation-frames');
    await waitForAnimationFrames(2);
    proofProgress.set(proofName, 'rendering-readback-frame');
    scene.render();

    proofProgress.set(proofName, 'reading-render-target');
    const pixels = await engine.readPixels(0, 0, canvas.width, canvas.height);
    cornerOrientation = classifyTextureCorners(
      new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      canvas.width,
      canvas.height,
      canvas.width * 4,
    );

    texture.dispose();
    scene.dispose();
    engine.dispose();
  } catch (error) {
    errors.push(toErrorMessage(error));
  }

  return result('babylon-texture-orientation', errors.length === 0 ? 'pass' : 'fail', {
    fixture: '2x2 RGBA texture: TL red, TR green, BL blue, BR yellow',
    cameraSide,
    cornerOrientation,
  }, errors);
}

function createBabylonOrientationTexture(scene: BABYLON.Scene): BABYLON.RawTexture {
  const pixels = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 0, 255,
  ]);
  const texture = BABYLON.RawTexture.CreateRGBATexture(
    pixels,
    2,
    2,
    scene,
    false,
    false,
    BABYLON.Texture.NEAREST_SAMPLINGMODE,
  );

  texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  return texture;
}

function classifyCameraSide(cameraPosition: BABYLON.Vector3, plane: BABYLON.Mesh): 'front' | 'back' | 'edge-on' {
  plane.computeWorldMatrix(true);
  const frontNormal = BABYLON.Vector3.TransformNormal(
    new BABYLON.Vector3(0, 0, -1),
    plane.getWorldMatrix(),
  ).normalize();
  const planeToCamera = cameraPosition.subtract(plane.getAbsolutePosition()).normalize();
  const facingDot = BABYLON.Vector3.Dot(frontNormal, planeToCamera);

  if (facingDot > 0.001) {
    return 'front';
  }

  if (facingDot < -0.001) {
    return 'back';
  }

  return 'edge-on';
}

async function waitForAnimationFrames(frameCount: number): Promise<void> {
  for (let index = 0; index < frameCount; index += 1) {
    await new Promise<void>((resolve) => {
      let resolved = false;
      const resolveOnce = () => {
        if (resolved) {
          return;
        }

        resolved = true;
        window.clearTimeout(fallback);
        resolve();
      };
      const fallback = window.setTimeout(resolveOnce, 100);

      requestAnimationFrame(resolveOnce);
    });
  }
}

interface CopyOnPaintResult {
  readonly paintObserved: boolean;
  readonly copySucceeded: boolean;
  readonly copySignature: string | null;
  readonly error?: string;
}

type PaintableCanvas = HTMLCanvasElement & {
  onpaint?: ((event: Event) => void) | null;
};

function copyElementOnNextPaint(
  canvas: HTMLCanvasElement,
  adapter: ReturnType<typeof createHtmlInCanvasAdapter>,
  source: HTMLElement,
  texture: GPUTexture,
  size: SurfaceTextureSize,
): Promise<CopyOnPaintResult> {
  return new Promise<CopyOnPaintResult>((resolve) => {
    const paintableCanvas = canvas as PaintableCanvas;
    const previousOnPaint = paintableCanvas.onpaint;
    let resolved = false;

    const resolveOnce = (result: CopyOnPaintResult) => {
      if (resolved) {
        return;
      }

      resolved = true;
      paintableCanvas.onpaint = previousOnPaint ?? null;
      window.clearTimeout(timeout);
      resolve(result);
    };

    const timeout = window.setTimeout(() => {
      resolveOnce({
        paintObserved: false,
        copySucceeded: false,
        copySignature: null,
        error: 'Timed out waiting for HTML-in-Canvas paint event before copying to texture.',
      });
    }, 750);

    paintableCanvas.onpaint = (event: Event) => {
      previousOnPaint?.call(canvas, event);

      try {
        const copySignature = adapter.copyElementToTexture(source, texture, size);
        resolveOnce({
          paintObserved: true,
          copySucceeded: true,
          copySignature,
        });
      } catch (error) {
        resolveOnce({
          paintObserved: true,
          copySucceeded: false,
          copySignature: null,
          error: toErrorMessage(error),
        });
      }
    };

    adapter.requestPaint();
  });
}

function prepareHtmlInCanvasRoot(
  canvas: HTMLCanvasElement,
  source: HTMLElement,
  backingWidth: number,
  backingHeight: number,
): boolean {
  canvas.width = backingWidth;
  canvas.height = backingHeight;
  canvas.style.width = `${source.offsetWidth}px`;
  canvas.style.height = `${source.offsetHeight}px`;

  const context = canvas.getContext('2d');

  if (!context) {
    return false;
  }

  context.clearRect(0, 0, backingWidth, backingHeight);
  return true;
}

async function runDirectDomSurfaceProof(surface: HTMLElement): Promise<RuntimeProofResult> {
  const errors: string[] = [];
  const button = surface.querySelector<HTMLButtonElement>('button');
  const input = surface.querySelector<HTMLInputElement>('input');
  const select = surface.querySelector<HTMLSelectElement>('select');

  let buttonClicked = false;
  const stopClick = listenOnce(button, 'click', () => {
    buttonClicked = true;
  });
  button?.click();
  stopClick();

  input?.focus();
  const inputFocused = document.activeElement === input;

  if (input) {
    input.value = 'edited by runtime proof';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'runtime proof' }));
  }

  const textInputReceived = input?.value === 'edited by runtime proof';

  if (select) {
    select.selectedIndex = 1;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const computedStyle = getComputedStyle(surface);
  const computedStyleMatches = computedStyle.position !== '' && computedStyle.display !== 'none';

  if (!button) {
    errors.push('Proof surface is missing a button.');
  }

  if (!input) {
    errors.push('Proof surface is missing an input.');
  }

  if (!select) {
    errors.push('Proof surface is missing a select.');
  }

  return result('direct-dom-surface', errors.length === 0 && buttonClicked && inputFocused && textInputReceived ? 'pass' : 'fail', {
    inspectableInDevTools: surface.isConnected,
    computedStyleMatches,
    buttonClicked,
    inputFocused,
    textInputReceived,
    selectChanged: select?.selectedIndex === 1,
    tabNavigationWorks: 'manual-check-required',
    activeElementTagName: document.activeElement?.tagName ?? null,
  }, errors);
}

async function waitForPaint(adapter: ReturnType<typeof createHtmlInCanvasAdapter>, timeoutMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let resolved = false;
    const stopPaint = adapter.onPaint(() => {
      if (resolved) {
        return;
      }

      resolved = true;
      stopPaint();
      window.clearTimeout(timeout);
      resolve(true);
    });
    const timeout = window.setTimeout(() => {
      if (resolved) {
        return;
      }

      resolved = true;
      stopPaint();
      resolve(false);
    }, timeoutMs);
  });
}

interface TextureSampleResult {
  readonly nonZeroColorSamples: number;
  readonly nonZeroAlphaSamples: number;
  readonly cornerOrientation: TextureCornerOrientation;
}

interface TextureCornerOrientation {
  readonly topLeft: TextureCornerLabel;
  readonly topRight: TextureCornerLabel;
  readonly bottomLeft: TextureCornerLabel;
  readonly bottomRight: TextureCornerLabel;
  readonly raw: {
    readonly topLeft: readonly number[];
    readonly topRight: readonly number[];
    readonly bottomLeft: readonly number[];
    readonly bottomRight: readonly number[];
  };
  readonly horizontalMirrored: boolean;
  readonly verticalMirrored: boolean;
  readonly rotation180: boolean;
  readonly expectedOrientation: boolean;
}

type TextureCornerLabel = 'red' | 'green' | 'blue' | 'yellow' | 'unknown';

async function readTextureSample(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
): Promise<TextureSampleResult> {
  const bytesPerPixel = 4;
  const bytesPerRow = alignTo(width * bytesPerPixel, 256);
  const buffer = device.createBuffer({
    label: 'runtime-proof-html-copy-readback',
    size: bytesPerRow * height,
    usage: gpuBufferUsage.copyDst | gpuBufferUsage.mapRead,
  });
  const encoder = device.createCommandEncoder();

  encoder.copyTextureToBuffer(
    { texture },
    {
      buffer,
      bytesPerRow,
      rowsPerImage: height,
    },
    { width, height },
  );

  device.queue.submit([encoder.finish()]);
  await withTimeout(device.queue.onSubmittedWorkDone(), 3_000, 'GPU queue completion');
  await withTimeout(buffer.mapAsync(gpuMapMode.read), 3_000, 'GPU readback mapping');

  const bytes = new Uint8Array(buffer.getMappedRange());
  const sampleStrideX = Math.max(1, Math.floor(width / 8));
  const sampleStrideY = Math.max(1, Math.floor(height / 8));
  let nonZeroColorSamples = 0;
  let nonZeroAlphaSamples = 0;

  for (let y = 0; y < height; y += sampleStrideY) {
    for (let x = 0; x < width; x += sampleStrideX) {
      const offset = y * bytesPerRow + x * bytesPerPixel;
      const red = bytes[offset] ?? 0;
      const green = bytes[offset + 1] ?? 0;
      const blue = bytes[offset + 2] ?? 0;
      const alpha = bytes[offset + 3] ?? 0;

      if (red > 0 || green > 0 || blue > 0) {
        nonZeroColorSamples += 1;
      }

      if (alpha > 0) {
        nonZeroAlphaSamples += 1;
      }
    }
  }

  const cornerOrientation = classifyTextureCorners(bytes, width, height, bytesPerRow);

  const result = {
    nonZeroColorSamples,
    nonZeroAlphaSamples,
    cornerOrientation,
  };

  buffer.unmap();
  buffer.destroy();
  return result;
}

function classifyTextureCorners(
  bytes: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
): TextureCornerOrientation {
  const insetX = Math.max(1, Math.floor(width * 0.08));
  const insetY = Math.max(1, Math.floor(height * 0.08));
  const rawTopLeft = readPixel(bytes, insetX, insetY, bytesPerRow);
  const rawTopRight = readPixel(bytes, width - insetX - 1, insetY, bytesPerRow);
  const rawBottomLeft = readPixel(bytes, insetX, height - insetY - 1, bytesPerRow);
  const rawBottomRight = readPixel(bytes, width - insetX - 1, height - insetY - 1, bytesPerRow);
  const topLeft = classifyCornerColor(rawTopLeft);
  const topRight = classifyCornerColor(rawTopRight);
  const bottomLeft = classifyCornerColor(rawBottomLeft);
  const bottomRight = classifyCornerColor(rawBottomRight);

  return {
    topLeft,
    topRight,
    bottomLeft,
    bottomRight,
    raw: {
      topLeft: rawTopLeft,
      topRight: rawTopRight,
      bottomLeft: rawBottomLeft,
      bottomRight: rawBottomRight,
    },
    horizontalMirrored:
      topLeft === 'green' && topRight === 'red' && bottomLeft === 'yellow' && bottomRight === 'blue',
    verticalMirrored:
      topLeft === 'blue' && topRight === 'yellow' && bottomLeft === 'red' && bottomRight === 'green',
    rotation180:
      topLeft === 'yellow' && topRight === 'blue' && bottomLeft === 'green' && bottomRight === 'red',
    expectedOrientation:
      topLeft === 'red' && topRight === 'green' && bottomLeft === 'blue' && bottomRight === 'yellow',
  };
}

function readPixel(
  bytes: Uint8Array,
  x: number,
  y: number,
  bytesPerRow: number,
): readonly [number, number, number, number] {
  const offset = y * bytesPerRow + x * 4;
  return [
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  ];
}

function classifyCornerColor([red, green, blue, alpha]: readonly number[]): TextureCornerLabel {
  if (alpha < 128) {
    return 'unknown';
  }

  const colors: readonly [TextureCornerLabel, readonly [number, number, number]][] = [
    ['red', [255, 0, 0]],
    ['green', [0, 255, 0]],
    ['blue', [0, 0, 255]],
    ['yellow', [255, 255, 0]],
  ];
  let closest: TextureCornerLabel = 'unknown';
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const [label, color] of colors) {
    const distance =
      Math.abs(red - color[0]) +
      Math.abs(green - color[1]) +
      Math.abs(blue - color[2]);

    if (distance < closestDistance) {
      closest = label;
      closestDistance = distance;
    }
  }

  return closestDistance <= 220 ? closest : 'unknown';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  let timeout = 0;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = window.setTimeout(() => {
          reject(new Error(`${operation} did not complete within ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

async function requestWebGpuAdapter(errors: string[]): Promise<GPUAdapter | undefined> {
  try {
    if (!navigator.gpu) {
      errors.push('navigator.gpu is unavailable.');
      return undefined;
    }

    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
      errors.push('navigator.gpu.requestAdapter() returned null.');
    }

    return adapter ?? undefined;
  } catch (error) {
    errors.push(toErrorMessage(error));
    return undefined;
  }
}

async function requestWebGpuDevice(adapter: GPUAdapter, errors: string[]): Promise<GPUDevice | undefined> {
  try {
    return await adapter.requestDevice();
  } catch (error) {
    errors.push(toErrorMessage(error));
    return undefined;
  }
}

function isSupportedNodeVersion(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map((part) => Number.parseInt(part, 10));

  if (major === 22) {
    return minor > 22 || (minor === 22 && patch >= 3);
  }

  if (major === 24) {
    return minor > 15 || (minor === 15 && patch >= 0);
  }

  return major >= 26;
}

function listenOnce<T extends EventTarget | null>(target: T, type: string, listener: EventListener): () => void {
  target?.addEventListener(type, listener, { once: true });
  return () => target?.removeEventListener(type, listener);
}

function result(name: string, status: RuntimeProofStatus, details: Record<string, unknown>, errors: string[]): RuntimeProofResult {
  return {
    name,
    status,
    details,
    errors,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
