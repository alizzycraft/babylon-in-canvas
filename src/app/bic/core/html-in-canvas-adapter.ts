export interface HtmlInCanvasCapabilities {
  readonly layoutSubtree: boolean;
  readonly paintEvent: boolean;
  readonly drawElementImage: boolean;
  readonly texElementImage2D: boolean;
  readonly copyElementImageToTexture: boolean;
  readonly getElementTransform: boolean;
}

export interface HtmlInCanvasCapability {
  readonly name: string;
  readonly exists: boolean;
  readonly type: string;
  readonly callable: boolean;
  readonly signatureHint?: string;
  readonly error?: string;
}

export interface HtmlInCanvasPaintEntry {
  readonly target: Element;
}

export interface SurfaceTextureSize {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

export interface HtmlInCanvasAdapter {
  assertCapabilities(): void;
  capabilities(): HtmlInCanvasCapabilities;
  onPaint(callback: (entries: readonly HtmlInCanvasPaintEntry[]) => void): () => void;
  requestPaint(): void;
  copyElementToTexture(source: HTMLElement, destination: GPUTexture, size: SurfaceTextureSize): string;
  getElementTransform(source: HTMLElement, drawTransform: DOMMatrixInit): DOMMatrix;
}

type ExperimentalCanvas = HTMLCanvasElement & {
  onpaint?: unknown;
  requestPaint?: () => void;
  getElementTransform?: (source: HTMLElement, drawTransform: DOMMatrixInit) => DOMMatrix;
};

type ExperimentalGpuQueue = GPUQueue & {
  copyElementImageToTexture?: (...args: unknown[]) => void;
};

interface GPUCopyElementImageSource {
  readonly source: HTMLElement;
  readonly sx?: number;
  readonly sy?: number;
  readonly swidth?: number;
  readonly sheight?: number;
}

interface GPUCopyElementImageDestination {
  readonly destination: {
    readonly texture: GPUTexture;
    readonly mipLevel?: number;
    readonly origin?: GPUOrigin3D;
    readonly aspect?: GPUTextureAspect;
  };
  readonly width?: number;
  readonly height?: number;
}

export function createHtmlInCanvasAdapter(canvas: HTMLCanvasElement, queue?: GPUQueue): HtmlInCanvasAdapter {
  const readCapabilities = (): HtmlInCanvasCapabilities => detectCapabilities(canvas, queue);

  return {
    assertCapabilities(): void {
      const missing = missingCapabilities(readCapabilities());

      if (missing.length > 0) {
        throw new Error(`Missing HTML-in-Canvas capabilities: ${missing.join(', ')}`);
      }
    },
    capabilities: readCapabilities,
    onPaint(callback): () => void {
      const listener = (event: Event) => {
        callback([{ target: event.target as Element }]);
      };

      canvas.addEventListener('paint', listener);

      return () => canvas.removeEventListener('paint', listener);
    },
    requestPaint(): void {
      (canvas as ExperimentalCanvas).requestPaint?.call(canvas);
    },
    copyElementToTexture(source, destination, size): string {
      const copyElementImageToTexture = (queue as ExperimentalGpuQueue | undefined)?.copyElementImageToTexture;

      if (!copyElementImageToTexture || !queue) {
        throw new Error('GPUQueue.copyElementImageToTexture is unavailable.');
      }

      const runtimeDestination = { texture: destination };

      try {
        copyElementImageToTexture.call(queue, source, runtimeDestination);
        return 'element-texture';
      } catch (runtimeShapeError) {
        try {
          copyElementImageToTexture.call(
            queue,
            { source },
            {
              destination: runtimeDestination,
              width: size.width,
              height: size.height,
            },
          );
          return 'source-destination';
        } catch (idlShapeError) {
          throw new Error([
            'GPUQueue.copyElementImageToTexture failed for known signatures.',
            `element-texture: ${toErrorMessage(runtimeShapeError)}`,
            `source-destination: ${toErrorMessage(idlShapeError)}`,
          ].join(' '));
        }
      }
    },
    getElementTransform(_source, drawTransform): DOMMatrix {
      const transform = (canvas as ExperimentalCanvas).getElementTransform;
      return transform?.(_source, drawTransform) ?? DOMMatrix.fromMatrix(drawTransform);
    },
  };
}

export function auditHtmlInCanvasCapabilities(canvas: HTMLCanvasElement, queue?: GPUQueue): readonly HtmlInCanvasCapability[] {
  const experimentalCanvas = canvas as ExperimentalCanvas;
  const experimentalQueue = queue as ExperimentalGpuQueue | undefined;
  const canvasContextPrototype = CanvasRenderingContext2D.prototype as object;
  const webGlPrototype = typeof WebGL2RenderingContext === 'undefined'
    ? undefined
    : WebGL2RenderingContext.prototype as object;

  return [
    describeCapability('layoutsubtree', canvas.hasAttribute('layoutsubtree') ? true : undefined, 'canvas attribute'),
    describeCapability('paint', experimentalCanvas.onpaint, 'canvas paint event handler'),
    describeCapability('drawElementImage', readPrototypeMember(canvasContextPrototype, 'drawElementImage'), 'CanvasRenderingContext2D.prototype.drawElementImage(source, ...)'),
    describeCapability('texElementImage2D', webGlPrototype ? readPrototypeMember(webGlPrototype, 'texElementImage2D') : undefined, 'WebGL2RenderingContext.prototype.texElementImage2D(...)'),
    describeCapability('copyElementImageToTexture', experimentalQueue?.copyElementImageToTexture, 'GPUQueue.copyElementImageToTexture(source, destination, size)'),
    describeCapability('getElementTransform', experimentalCanvas.getElementTransform, 'canvas.getElementTransform(source, drawTransform)'),
  ];
}

function detectCapabilities(canvas: HTMLCanvasElement, queue?: GPUQueue): HtmlInCanvasCapabilities {
  const experimentalCanvas = canvas as ExperimentalCanvas;
  const experimentalQueue = queue as ExperimentalGpuQueue | undefined;

  return {
    layoutSubtree: canvas.hasAttribute('layoutsubtree'),
    paintEvent: 'onpaint' in experimentalCanvas,
    drawElementImage: 'drawElementImage' in CanvasRenderingContext2D.prototype,
    texElementImage2D: typeof WebGL2RenderingContext !== 'undefined' && 'texElementImage2D' in WebGL2RenderingContext.prototype,
    copyElementImageToTexture: Boolean(experimentalQueue && 'copyElementImageToTexture' in experimentalQueue),
    getElementTransform: 'getElementTransform' in experimentalCanvas,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeCapability(name: string, value: unknown, signatureHint?: string): HtmlInCanvasCapability {
  return {
    name,
    exists: value !== undefined,
    type: value === undefined ? 'undefined' : typeof value,
    callable: typeof value === 'function',
    signatureHint,
  };
}

function readPrototypeMember(prototype: object, name: string): unknown {
  return (prototype as Record<string, unknown>)[name];
}

function missingCapabilities(capabilities: HtmlInCanvasCapabilities): string[] {
  const drawOrCopy =
    capabilities.drawElementImage ||
    capabilities.texElementImage2D ||
    capabilities.copyElementImageToTexture;

  return [
    capabilities.layoutSubtree ? '' : 'layoutsubtree',
    capabilities.paintEvent ? '' : 'paint event',
    drawOrCopy ? '' : 'draw/copy primitive',
    capabilities.getElementTransform ? '' : 'getElementTransform',
  ].filter(Boolean);
}
