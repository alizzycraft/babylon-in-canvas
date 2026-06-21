import * as BABYLON from '@babylonjs/core';
import { createHtmlInCanvasAdapter, type SurfaceTextureSize } from './html-in-canvas-adapter';

// Owns the zero-readback DOM-to-WebGPU-to-Babylon texture lifecycle.
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

export interface HtmlSurfaceTexturePipelineOptions {
  readonly engine: BABYLON.WebGPUEngine;
  readonly scene: BABYLON.Scene;
  readonly canvas: HTMLCanvasElement;
  readonly source: HTMLElement;
  readonly deviceRecoveryCount?: number;
}

export interface HtmlSurfaceTextureSnapshot {
  readonly size: SurfaceTextureSize;
  readonly copySignature: string | null;
  readonly paintObserved: boolean;
  readonly requestCount: number;
  readonly coalescedRequestCount: number;
  readonly updateCount: number;
  readonly mutationCount: number;
  readonly resizeCount: number;
  readonly paintRetryCount: number;
  readonly paintTimeoutCount: number;
  readonly deviceRecoveryCount: number;
  readonly updateInFlight: boolean;
  readonly updateQueued: boolean;
  readonly lastError: string | null;
  readonly lastUpdateReason: HtmlSurfaceTextureUpdateReason | null;
  readonly cornerOrientation: HtmlSurfaceCornerOrientation | null;
}

export interface HtmlSurfaceCornerOrientation {
  readonly topLeft: string;
  readonly topRight: string;
  readonly bottomLeft: string;
  readonly bottomRight: string;
  readonly horizontalMirrored: boolean;
  readonly verticalMirrored: boolean;
  readonly rotation180: boolean;
  readonly expectedOrientation: boolean;
}

export interface HtmlSurfaceTexturePipeline {
  readonly babylonTexture: BABYLON.Texture;
  onSnapshot(listener: HtmlSurfaceTextureSnapshotListener): () => void;
  requestUpdate(reason?: HtmlSurfaceTextureUpdateReason): Promise<void>;
  snapshot(): HtmlSurfaceTextureSnapshot;
  dispose(): void;
}

export type HtmlSurfaceTextureUpdateReason =
  | 'manual'
  | 'mutation'
  | 'resize'
  | 'surface-state'
  | 'device-pixel-ratio'
  | 'device-restored';
export type HtmlSurfaceTextureSnapshotListener = () => void;

type PaintableCanvas = HTMLCanvasElement & {
  onpaint?: ((event: Event) => void) | null;
};

type WebGpuTextureWrappingEngine = BABYLON.WebGPUEngine & {
  wrapWebGPUTexture(texture: GPUTexture): BABYLON.InternalTexture;
};

type WebGpuHardwareTextureBackedInternalTexture = BABYLON.InternalTexture & {
  readonly _hardwareTexture?: {
    setUsage(
      textureSource: number,
      generateMipMaps: boolean,
      is2DArray: boolean,
      isCube: boolean,
      is3D: boolean,
      width: number,
      height: number,
      depth: number,
    ): void;
  };
};

export function createHtmlSurfaceTexturePipeline(
  options: HtmlSurfaceTexturePipelineOptions,
): HtmlSurfaceTexturePipeline {
  return new DefaultHtmlSurfaceTexturePipeline(options);
}

class DefaultHtmlSurfaceTexturePipeline implements HtmlSurfaceTexturePipeline {
  readonly babylonTexture: BABYLON.Texture;

  private readonly adapter;
  private readonly device: GPUDevice;
  private gpuTexture: GPUTexture;
  private size: SurfaceTextureSize;
  private readonly mutationObserver: MutationObserver;
  private readonly resizeObserver: ResizeObserver;
  private readonly snapshotListeners = new Set<HtmlSurfaceTextureSnapshotListener>();
  private disposed = false;
  private updateInFlight = false;
  private updateQueued = false;
  private updatePromise: Promise<void> | null = null;
  private scheduledUpdate = 0;
  private requestCount = 0;
  private coalescedRequestCount = 0;
  private updateCount = 0;
  private mutationCount = 0;
  private resizeCount = 0;
  private paintRetryCount = 0;
  private paintTimeoutCount = 0;
  private readonly deviceRecoveryCount: number;
  private copySignature: string | null = null;
  private paintObserved = false;
  private lastError: string | null = null;
  private lastUpdateReason: HtmlSurfaceTextureUpdateReason | null = null;
  private cornerOrientation: HtmlSurfaceCornerOrientation | null = null;

  constructor(private readonly options: HtmlSurfaceTexturePipelineOptions) {
    const device = getWebGpuDevice(options.engine);

    if (!device) {
      throw new Error('Babylon WebGPU device is unavailable; cannot create HTML surface texture pipeline.');
    }

    this.device = device;
    this.deviceRecoveryCount = options.deviceRecoveryCount ?? 0;
    this.size = readTextureSize(options.source);
    prepareHtmlInCanvasRoot(options.canvas);
    this.gpuTexture = createSurfaceGpuTexture(device, this.size);
    this.adapter = createHtmlInCanvasAdapter(options.canvas, device.queue);

    const internalTexture = (options.engine as WebGpuTextureWrappingEngine).wrapWebGPUTexture(this.gpuTexture);
    initializeWrappedTextureView(internalTexture, this.size);
    this.babylonTexture = new BABYLON.Texture(null, options.scene, {
      noMipmap: true,
      invertY: false,
      samplingMode: BABYLON.Texture.BILINEAR_SAMPLINGMODE,
      internalTexture,
      gammaSpace: false,
    });
    this.babylonTexture.name = `${options.source.dataset['bicSurface'] ?? 'html-surface'}-texture`;
    this.babylonTexture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    this.babylonTexture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    // HTML-in-Canvas copies DOM pixels with a top-left texture origin, while
    // Babylon's plane UVs address V from bottom to top. Convert that boundary
    // once in texture space without changing world, camera, or surface state.
    this.babylonTexture.vScale = -1;
    this.babylonTexture.vOffset = 1;

    this.mutationObserver = new MutationObserver((records) => {
      if (records.every((record) =>
        record.type === 'attributes' &&
        record.target === options.source &&
        (
          record.attributeName === 'style' ||
          record.attributeName?.startsWith('data-bic-') === true
        )
      )) {
        return;
      }

      this.mutationCount += 1;
      this.scheduleUpdate('mutation');
    });
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCount += 1;
      this.scheduleUpdate('resize');
    });

    this.mutationObserver.observe(options.source, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    this.resizeObserver.observe(options.source);
  }

  onSnapshot(listener: HtmlSurfaceTextureSnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  requestUpdate(reason: HtmlSurfaceTextureUpdateReason = 'manual'): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }

    this.requestCount += 1;

    if (this.updateInFlight) {
      this.updateQueued = true;
      this.coalescedRequestCount += 1;
      this.lastUpdateReason = reason;
      return this.updatePromise ?? Promise.resolve();
    }

    const updatePromise = this.drainUpdates(reason);
    this.updatePromise = updatePromise;
    void updatePromise.finally(() => {
      if (this.updatePromise === updatePromise) {
        this.updatePromise = null;
      }
    });

    return updatePromise;
  }

  snapshot(): HtmlSurfaceTextureSnapshot {
    return {
      size: this.size,
      copySignature: this.copySignature,
      paintObserved: this.paintObserved,
      requestCount: this.requestCount,
      coalescedRequestCount: this.coalescedRequestCount,
      updateCount: this.updateCount,
      mutationCount: this.mutationCount,
      resizeCount: this.resizeCount,
      paintRetryCount: this.paintRetryCount,
      paintTimeoutCount: this.paintTimeoutCount,
      deviceRecoveryCount: this.deviceRecoveryCount,
      updateInFlight: this.updateInFlight,
      updateQueued: this.updateQueued,
      lastError: this.lastError,
      lastUpdateReason: this.lastUpdateReason,
      cornerOrientation: this.cornerOrientation,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.mutationObserver.disconnect();
    this.resizeObserver.disconnect();
    this.snapshotListeners.clear();
    window.cancelAnimationFrame(this.scheduledUpdate);
    this.babylonTexture.dispose();
    safelyDestroyTexture(this.gpuTexture);
  }

  private scheduleUpdate(reason: HtmlSurfaceTextureUpdateReason): void {
    if (this.disposed || this.scheduledUpdate !== 0) {
      return;
    }

    this.scheduledUpdate = requestAnimationFrame(() => {
      this.scheduledUpdate = 0;
      void this.requestUpdate(reason);
    });
  }

  private async drainUpdates(reason: HtmlSurfaceTextureUpdateReason): Promise<void> {
    this.updateInFlight = true;

    try {
      let nextReason = reason;

      do {
        this.updateQueued = false;
        this.lastUpdateReason = nextReason;
        await this.runUpdateCycle();
        nextReason = this.lastUpdateReason ?? 'manual';
      } while (this.updateQueued && !this.disposed);
    } finally {
      this.updateInFlight = false;
      this.notifySnapshotListeners();
    }
  }

  private async runUpdateCycle(): Promise<void> {
    try {
      await waitForAnimationFrames(2);
      const currentSize = readTextureSize(this.options.source);

      if (!sameTextureSize(this.size, currentSize)) {
        this.recreateTexture(currentSize);
      }

      const result = await copyElementWithPaintRetry(
        this.options.canvas,
        this.adapter,
        this.options.source,
        this.gpuTexture,
        this.size,
      );

      this.paintObserved = result.paintObserved;
      this.copySignature = result.copySignature;
      this.lastError = result.error ?? null;
      this.paintRetryCount += result.retryCount;

      if (result.timedOut) {
        this.paintTimeoutCount += 1;
      }

      if (result.copySucceeded) {
        this.updateCount += 1;

        if (!this.cornerOrientation) {
          this.cornerOrientation = await readCornerOrientation(this.device, this.gpuTexture, this.size);
        }
      }
    } catch (error) {
      this.lastError = toErrorMessage(error);
    } finally {
      this.notifySnapshotListeners();
    }
  }

  private notifySnapshotListeners(): void {
    for (const listener of this.snapshotListeners) {
      listener();
    }
  }

  private recreateTexture(size: SurfaceTextureSize): void {
    const previousGpuTexture = this.gpuTexture;
    const nextGpuTexture = createSurfaceGpuTexture(this.device, size);
    const nextInternalTexture = (this.options.engine as WebGpuTextureWrappingEngine)
      .wrapWebGPUTexture(nextGpuTexture);

    initializeWrappedTextureView(nextInternalTexture, size);
    this.babylonTexture.releaseInternalTexture();
    this.babylonTexture._texture = nextInternalTexture;
    this.gpuTexture = nextGpuTexture;
    this.size = size;
    this.cornerOrientation = null;
    safelyDestroyTexture(previousGpuTexture);
  }
}

interface CopyOnPaintResult {
  readonly paintObserved: boolean;
  readonly copySucceeded: boolean;
  readonly copySignature: string | null;
  readonly retryCount: number;
  readonly timedOut: boolean;
  readonly error?: string;
}

async function copyElementWithPaintRetry(
  canvas: HTMLCanvasElement,
  adapter: ReturnType<typeof createHtmlInCanvasAdapter>,
  source: HTMLElement,
  texture: GPUTexture,
  size: SurfaceTextureSize,
): Promise<CopyOnPaintResult> {
  const maximumAttempts = 3;
  let lastResult: CopyOnPaintAttemptResult | null = null;

  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    lastResult = await copyElementOnNextPaint(canvas, adapter, source, texture, size);

    if (lastResult.copySucceeded || lastResult.paintObserved) {
      return {
        ...lastResult,
        retryCount: attempt,
        timedOut: false,
      };
    }

    await waitForAnimationFrames(1);
  }

  return {
    ...(lastResult ?? {
      paintObserved: false,
      copySucceeded: false,
      copySignature: null,
      error: 'HTML-in-Canvas paint copy did not run.',
    }),
    retryCount: maximumAttempts - 1,
    timedOut: true,
  };
}

interface CopyOnPaintAttemptResult {
  readonly paintObserved: boolean;
  readonly copySucceeded: boolean;
  readonly copySignature: string | null;
  readonly error?: string;
}

function createSurfaceGpuTexture(device: GPUDevice, size: SurfaceTextureSize): GPUTexture {
  return device.createTexture({
    label: 'bic-html-surface-texture',
    size: {
      width: size.width,
      height: size.height,
    },
    format: 'rgba8unorm',
    usage:
      gpuTextureUsage.copyDst |
      gpuTextureUsage.copySrc |
      gpuTextureUsage.textureBinding |
      gpuTextureUsage.renderAttachment,
  });
}

function initializeWrappedTextureView(
  internalTexture: BABYLON.InternalTexture,
  size: SurfaceTextureSize,
): void {
  const texture = internalTexture as WebGpuHardwareTextureBackedInternalTexture;

  texture._hardwareTexture?.setUsage(
    texture.source,
    false,
    false,
    false,
    false,
    size.width,
    size.height,
    1,
  );
}

function readTextureSize(source: HTMLElement): SurfaceTextureSize {
  const devicePixelRatio = window.devicePixelRatio;

  return {
    width: Math.max(1, source.offsetWidth),
    // Electron 42's legacy two-argument copy path rasterizes the bottom edge
    // inclusively for custom-element capture roots.
    height: Math.max(1, source.offsetHeight + 1),
    devicePixelRatio,
  };
}

function sameTextureSize(a: SurfaceTextureSize, b: SurfaceTextureSize): boolean {
  return a.width === b.width && a.height === b.height && a.devicePixelRatio === b.devicePixelRatio;
}

function prepareHtmlInCanvasRoot(
  canvas: HTMLCanvasElement,
): void {
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('HTML-in-Canvas root could not create a 2D rendering context.');
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
}

function copyElementOnNextPaint(
  canvas: HTMLCanvasElement,
  adapter: ReturnType<typeof createHtmlInCanvasAdapter>,
  source: HTMLElement,
  texture: GPUTexture,
  size: SurfaceTextureSize,
): Promise<CopyOnPaintAttemptResult> {
  return new Promise<CopyOnPaintAttemptResult>((resolve) => {
    let resolved = false;
    let stopPaint: () => void = () => undefined;

    const resolveOnce = (result: CopyOnPaintAttemptResult) => {
      if (resolved) {
        return;
      }

      resolved = true;
      stopPaint();
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

    stopPaint = adapter.onPaint(() => {
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
    });

    adapter.requestPaint();
  });
}

function safelyDestroyTexture(texture: GPUTexture): void {
  try {
    texture.destroy();
  } catch {
    // A texture from a lost WebGPU device may already be invalid.
  }
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

async function readCornerOrientation(
  device: GPUDevice,
  texture: GPUTexture,
  size: SurfaceTextureSize,
): Promise<HtmlSurfaceCornerOrientation> {
  const bytesPerPixel = 4;
  const bytesPerRow = Math.ceil((size.width * bytesPerPixel) / 256) * 256;
  const buffer = device.createBuffer({
    label: 'bic-html-surface-orientation-readback',
    size: bytesPerRow * size.height,
    usage: gpuBufferUsage.copyDst | gpuBufferUsage.mapRead,
  });
  const encoder = device.createCommandEncoder();

  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow, rowsPerImage: size.height },
    { width: size.width, height: size.height },
  );
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(gpuMapMode.read);

  const bytes = new Uint8Array(buffer.getMappedRange());
  const insetX = Math.max(1, Math.floor(size.width * 0.08));
  const insetY = Math.max(1, Math.floor(size.height * 0.08));
  const topLeft = classifyCorner(readPixel(bytes, insetX, insetY, bytesPerRow));
  const topRight = classifyCorner(readPixel(bytes, size.width - insetX - 1, insetY, bytesPerRow));
  const bottomLeft = classifyCorner(readPixel(bytes, insetX, size.height - insetY - 1, bytesPerRow));
  const bottomRight = classifyCorner(readPixel(bytes, size.width - insetX - 1, size.height - insetY - 1, bytesPerRow));

  publishTextureDiagnostic(bytes, size.width, size.height, bytesPerRow);
  buffer.unmap();
  buffer.destroy();

  return {
    topLeft,
    topRight,
    bottomLeft,
    bottomRight,
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

function publishTextureDiagnostic(
  bytes: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
): void {
  const contiguous = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * bytesPerRow;
    const destinationStart = y * width * 4;
    contiguous.set(bytes.subarray(sourceStart, sourceStart + width * 4), destinationStart);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.putImageData(new ImageData(contiguous, width, height), 0, 0);
  (globalThis as typeof globalThis & { __bicTextureDiagnosticDataUrl?: string }).__bicTextureDiagnosticDataUrl =
    canvas.toDataURL('image/png');
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

function classifyCorner([red, green, blue, alpha]: readonly number[]): string {
  if (alpha < 128) {
    return 'unknown';
  }

  const colors = [
    ['red', [255, 0, 0]],
    ['green', [0, 255, 0]],
    ['blue', [0, 0, 255]],
    ['yellow', [255, 255, 0]],
  ] as const;
  let closest = 'unknown';
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

function getWebGpuDevice(engine: BABYLON.WebGPUEngine): GPUDevice | undefined {
  return (engine as unknown as { readonly _device?: GPUDevice })._device;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
