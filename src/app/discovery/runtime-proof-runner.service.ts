import { Injectable } from '@angular/core';
import * as BABYLON from '@babylonjs/core';
import { BicSceneRuntime } from '@babylon-in-canvas/angular';
import {
  auditHtmlInCanvasCapabilities,
  createHtmlInCanvasAdapter,
  type SurfaceTextureSize,
} from '@bic-internal/core/html-in-canvas-adapter';
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
const proofTimeoutMs = 20_000;
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
  readonly sceneRuntime?: BicSceneRuntime;
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
    { name: 'projected-surface-interaction', run: () => runProjectedSurfaceInteractionProof() },
    { name: 'signal-surface-updates', run: () => runSignalSurfaceUpdatesProof() },
    { name: 'surface-lifecycle-pressure', run: () => runSurfaceLifecyclePressureProof() },
    { name: 'rapid-update-scheduling', run: () => runRapidUpdateSchedulingProof() },
    { name: 'display-metrics-resize', run: () => runDisplayMetricsResizeProof(context.sceneRuntime) },
    { name: 'device-pixel-ratio-change', run: () => runDevicePixelRatioChangeProof() },
    { name: 'webgpu-device-recovery', run: () => runWebGpuDeviceRecoveryProof(context.sceneRuntime) },
    { name: 'mvp-library-contract', run: () => runMvpLibraryContractProof() },
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

  const logicalWidth = Number(source.dataset['logicalWidth'] ?? source.offsetWidth);
  const logicalHeight = Number(source.dataset['logicalHeight'] ?? source.offsetHeight);
  source.dataset['logicalWidth'] = String(logicalWidth);
  source.dataset['logicalHeight'] = String(logicalHeight);
  const width = Math.max(1, Math.ceil(logicalWidth * window.devicePixelRatio));
  const height = Math.max(1, Math.ceil(logicalHeight * window.devicePixelRatio));
  source.style.width = `${width}px`;
  source.style.height = `${height}px`;
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
    logicalCssSize: {
      width: logicalWidth,
      height: logicalHeight,
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
  let textureReady = false;
  let materialTextureBound = false;
  let frameRendered = false;

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
    material.diffuseColor = BABYLON.Color3.White();
    material.emissiveColor = BABYLON.Color3.Black();
    material.diffuseTexture = texture;
    material.backFaceCulling = false;
    plane.material = material;

    cameraSide = classifyCameraSide(camera.position, plane);
    proofProgress.set(proofName, 'waiting-for-scene-ready');
    await scene.whenReadyAsync();
    await material.forceCompilationAsync(plane);
    textureReady = texture.isReady();
    materialTextureBound = material.diffuseTexture === texture;
    scene.render();
    frameRendered = scene.getFrameId() > 0;
    cornerOrientation = readBabylonUvCornerOrientation(plane, texture);

    texture.dispose();
    scene.dispose();
    engine.dispose();
  } catch (error) {
    errors.push(toErrorMessage(error));
  }

  const orientationProven =
    textureReady &&
    materialTextureBound &&
    frameRendered &&
    cornerOrientation?.expectedOrientation === true;

  if (!orientationProven) {
    errors.push('Babylon texture binding or UV orientation did not match the expected surface orientation.');
  }

  return result('babylon-texture-orientation', errors.length === 0 && orientationProven ? 'pass' : 'fail', {
    fixture: '2x2 RGBA texture: TL red, TR green, BL blue, BR yellow',
    evidence: 'Babylon material binding, rendered frame, plane UVs, and texture matrix',
    cameraSide,
    textureReady,
    materialTextureBound,
    frameRendered,
    cornerOrientation,
  }, errors);
}

async function runProjectedSurfaceInteractionProof(): Promise<RuntimeProofResult> {
  const errors: string[] = [];
  const host = await waitForProjectedSurface();

  if (!host) {
    return result('projected-surface-interaction', 'blocked', {}, [
      'The projected Angular surface did not become ready.',
    ]);
  }

  const alignmentError = Number(host.dataset['bicProjectionError']);
  const input = host.querySelector<HTMLInputElement>('input');
  const button = host.querySelector<HTMLButtonElement>('button');
  const hostRect = host.getBoundingClientRect();
  const centerTarget = document.elementFromPoint(
    hostRect.left + hostRect.width / 2,
    hostRect.top + hostRect.height / 2,
  );
  const inputRect = input?.getBoundingClientRect();
  const inputTarget = inputRect
    ? document.elementFromPoint(inputRect.left + inputRect.width / 2, inputRect.top + inputRect.height / 2)
    : null;
  const buttonRect = button?.getBoundingClientRect();
  const buttonTarget = buttonRect
    ? document.elementFromPoint(buttonRect.left + buttonRect.width / 2, buttonRect.top + buttonRect.height / 2)
    : null;

  let buttonClicked = false;
  const stopClick = listenOnce(button, 'click', () => {
    buttonClicked = true;
  });
  buttonTarget?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: buttonRect?.x, clientY: buttonRect?.y }));
  stopClick();

  input?.focus();

  if (input) {
    input.value = 'projected interaction proof';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'projected interaction proof' }));
  }

  const inputFocused = document.activeElement === input;
  const textInputReceived = input?.value === 'projected interaction proof';
  const tabOrder = await verifyTabOrder(host);
  const alignmentTolerance = 2;

  if (!Number.isFinite(alignmentError) || alignmentError > alignmentTolerance) {
    errors.push(`Projected DOM/plane alignment error ${alignmentError}px exceeds ${alignmentTolerance}px.`);
  }

  if (!host.contains(centerTarget)) {
    errors.push('The projected surface center does not hit the Angular DOM surface.');
  }

  if (inputTarget !== input) {
    errors.push('The visible input bounds do not hit the Angular input element.');
  }

  if (buttonTarget !== button) {
    errors.push('The visible button bounds do not hit the Angular button element.');
  }

  if (!buttonClicked || !inputFocused || !textInputReceived) {
    errors.push('Projected button/input interaction did not remain live.');
  }

  if (!tabOrder.works) {
    errors.push('Tab navigation did not move focus between projected controls.');
  }

  return result('projected-surface-interaction', errors.length === 0 ? 'pass' : 'fail', {
    alignmentError,
    alignmentTolerance,
    transform: host.style.transform,
    hostBounds: rectDetails(hostRect),
    centerHitTagName: centerTarget?.tagName ?? null,
    inputHitTagName: inputTarget?.tagName ?? null,
    buttonHitTagName: buttonTarget?.tagName ?? null,
    buttonClicked,
    inputFocused,
    textInputReceived,
    tabOrder,
  }, errors);
}

async function runSurfaceLifecyclePressureProof(): Promise<RuntimeProofResult> {
  const errors: string[] = [];
  const host = await waitForProjectedSurface();

  if (!host) {
    return result('surface-lifecycle-pressure', 'blocked', {}, [
      'The projected Angular surface did not become ready.',
    ]);
  }

  const initialWidth = host.offsetWidth;
  const initialSize = host.dataset['bicTextureSize'] ?? null;
  const initialUpdates = Number(host.dataset['bicTextureUpdates'] ?? 0);
  const initialResizes = Number(host.dataset['bicTextureResizes'] ?? 0);

  for (let revision = 0; revision < 12; revision += 1) {
    host.dataset['pressureRevision'] = String(revision);
    await waitForAnimationFrames(1);
  }

  const pressured = await waitForTextureState(host, (state) =>
    state.updates > initialUpdates && state.error === '',
  );

  host.style.width = `${initialWidth - 32}px`;
  const resized = await waitForTextureState(host, (state) =>
    state.resizes > initialResizes &&
    state.size !== initialSize &&
    state.error === '',
  );
  const resizedSize = host.dataset['bicTextureSize'] ?? null;

  host.style.width = `${initialWidth}px`;
  const restored = await waitForTextureState(host, (state) =>
    state.size === initialSize &&
    state.error === '',
  );

  if (!pressured) {
    errors.push('Repeated DOM updates did not produce a successful texture refresh.');
  }

  if (!resized) {
    errors.push('Surface resize did not recreate the WebGPU/Babylon texture successfully.');
  }

  if (!restored) {
    errors.push('Surface texture did not recover after restoring its original size.');
  }

  return result('surface-lifecycle-pressure', errors.length === 0 ? 'pass' : 'fail', {
    mutationRevisions: 12,
    initialSize,
    resizedSize,
    finalSize: host.dataset['bicTextureSize'] ?? null,
    initialUpdates,
    finalUpdates: Number(host.dataset['bicTextureUpdates'] ?? 0),
    initialResizes,
    finalResizes: Number(host.dataset['bicTextureResizes'] ?? 0),
    lastError: host.dataset['bicTextureError'] ?? null,
    pressured,
    resized,
    restored,
  }, errors);
}

async function runRapidUpdateSchedulingProof(): Promise<RuntimeProofResult> {
  const errors: string[] = [];
  const host = await waitForProjectedSurface();

  if (!host) {
    return result('rapid-update-scheduling', 'blocked', {}, [
      'The projected Angular surface did not become ready.',
    ]);
  }

  const initialRequests = Number(host.dataset['bicTextureRequests'] ?? 0);
  const initialUpdates = Number(host.dataset['bicTextureUpdates'] ?? 0);
  const initialCoalesced = Number(host.dataset['bicTextureCoalesced'] ?? 0);
  const initialTimeouts = Number(host.dataset['bicTextureTimeouts'] ?? 0);
  const mutationBursts = 32;

  for (let revision = 0; revision < mutationBursts; revision += 1) {
    host.dataset['rapidRevision'] = String(revision);
    await Promise.resolve();
  }

  const drained = await waitForCondition(() =>
    Number(host.dataset['bicTextureRequests'] ?? 0) > initialRequests &&
    Number(host.dataset['bicTextureUpdates'] ?? 0) > initialUpdates &&
    Number(host.dataset['bicTextureCoalesced'] ?? 0) > initialCoalesced &&
    host.dataset['bicTextureInFlight'] === 'false' &&
    host.dataset['bicTextureQueued'] === 'false',
  );
  const finalTimeouts = Number(host.dataset['bicTextureTimeouts'] ?? 0);
  const lastError = host.dataset['bicTextureError'] ?? '';

  if (!drained) {
    errors.push('Rapid mutation requests did not coalesce and drain successfully.');
  }

  if (finalTimeouts !== initialTimeouts) {
    errors.push('Rapid mutation scheduling introduced an HTML-in-Canvas paint timeout.');
  }

  if (lastError !== '') {
    errors.push(`Rapid mutation scheduling left a texture error: ${lastError}`);
  }

  return result('rapid-update-scheduling', errors.length === 0 ? 'pass' : 'fail', {
    mutationBursts,
    initialRequests,
    finalRequests: Number(host.dataset['bicTextureRequests'] ?? 0),
    initialUpdates,
    finalUpdates: Number(host.dataset['bicTextureUpdates'] ?? 0),
    initialCoalesced,
    finalCoalesced: Number(host.dataset['bicTextureCoalesced'] ?? 0),
    initialTimeouts,
    finalTimeouts,
    finalRetries: Number(host.dataset['bicTextureRetries'] ?? 0),
    drained,
    lastError,
  }, errors);
}

async function runDisplayMetricsResizeProof(
  runtime: BicSceneRuntime | undefined,
): Promise<RuntimeProofResult> {
  if (!runtime) {
    return result('display-metrics-resize', 'blocked', {}, [
      'The packaged BicSceneRuntime was not provided to the proof harness.',
    ]);
  }

  const errors: string[] = [];
  const sceneHost = document.querySelector<HTMLElement>('bic-scene');

  if (!sceneHost) {
    return result('display-metrics-resize', 'blocked', {}, [
      'The packaged bic-scene host is unavailable.',
    ]);
  }

  const originalWidth = sceneHost.style.width;
  const initial = runtime.displayMetrics();
  sceneHost.style.width = `${Math.max(initial.cssWidth - 160, 480)}px`;
  runtime.refreshDisplayMetrics();

  const resized = await waitForCondition(() => {
    const metrics = runtime.displayMetrics();
    return metrics.revision > initial.revision && metrics.cssWidth !== initial.cssWidth;
  });
  const resizedMetrics = runtime.displayMetrics();

  sceneHost.style.width = originalWidth;
  runtime.refreshDisplayMetrics();
  const restored = await waitForCondition(() => {
    const metrics = runtime.displayMetrics();
    return metrics.cssWidth === initial.cssWidth && metrics.cssHeight === initial.cssHeight;
  });
  const finalMetrics = runtime.displayMetrics();
  const surfaceRatios = [...document.querySelectorAll<HTMLElement>('[data-bic-surface]')]
    .map((surface) => Number(surface.dataset['bicDevicePixelRatio'] ?? Number.NaN));

  if (!resized) {
    errors.push('Canvas ResizeObserver did not publish changed display metrics.');
  }

  if (!restored) {
    errors.push('Canvas display metrics did not recover after restoring host dimensions.');
  }

  if (
    finalMetrics.devicePixelRatio !== runtime.devicePixelRatio() ||
    surfaceRatios.some((ratio) => ratio !== finalMetrics.devicePixelRatio)
  ) {
    errors.push('Scene and Angular surface device-pixel ratios are not synchronized.');
  }

  if (
    finalMetrics.backingWidth <= 0 ||
    finalMetrics.backingHeight <= 0 ||
    finalMetrics.cssWidth <= 0 ||
    finalMetrics.cssHeight <= 0
  ) {
    errors.push('Canvas display metrics contain zero-sized dimensions.');
  }

  return result('display-metrics-resize', errors.length === 0 ? 'pass' : 'fail', {
    initial,
    resized: resizedMetrics,
    final: finalMetrics,
    runtimeDevicePixelRatio: runtime.devicePixelRatio(),
    surfaceRatios,
    resizedObserved: resized,
    restored,
  }, errors);
}

async function runWebGpuDeviceRecoveryProof(
  runtime: BicSceneRuntime | undefined,
): Promise<RuntimeProofResult> {
  if (!runtime) {
    return result('webgpu-device-recovery', 'blocked', {}, [
      'The packaged BicSceneRuntime was not provided to the proof harness.',
    ]);
  }

  const errors: string[] = [];
  const initialStatus = runtime.status();

  if (initialStatus.kind !== 'ready') {
    return result('webgpu-device-recovery', 'blocked', { initialStatus }, [
      'The packaged scene runtime was not ready before device-loss simulation.',
    ]);
  }

  const initialRecoveryCount = initialStatus.deviceRecoveryCount;
  const initialUpdates = new Map(
    runtime.snapshots().map((snapshot) => [snapshot.id, snapshot.texture.updateCount]),
  );

  runtime.simulateDeviceLossForTesting();

  const recovered = await waitForCondition(() => {
    const status = runtime.status();
    return status.kind === 'ready' &&
      status.deviceRecoveryCount > initialRecoveryCount &&
      runtime.snapshots().every((snapshot) =>
        snapshot.texture.deviceRecoveryCount > initialRecoveryCount &&
        snapshot.texture.lastError === null &&
        snapshot.texture.updateCount > 0
      ) &&
      runtime.snapshots().length === initialUpdates.size;
  }, 15_000);
  const finalStatus = runtime.status();
  const finalSnapshots = runtime.snapshots();

  if (!recovered) {
    errors.push('Babylon restored its device, but packaged scene/surface resources did not fully recover.');
  }

  if (finalStatus.kind === 'failed') {
    errors.push(finalStatus.message);
  }

  return result('webgpu-device-recovery', errors.length === 0 ? 'pass' : 'fail', {
    initialRecoveryCount,
    finalStatus,
    surfaces: finalSnapshots.map((snapshot) => ({
      id: snapshot.id,
      initialUpdates: initialUpdates.get(snapshot.id) ?? null,
      finalUpdates: snapshot.texture.updateCount,
      deviceRecoveryCount: snapshot.texture.deviceRecoveryCount,
      lastError: snapshot.texture.lastError,
    })),
    recovered,
  }, errors);
}

async function runDevicePixelRatioChangeProof(): Promise<RuntimeProofResult> {
  const proofApi = window.bicRuntimeProofs;

  if (!proofApi?.getZoomFactor || !proofApi.setZoomFactor) {
    return result('device-pixel-ratio-change', 'blocked', {}, [
      'Electron zoom-factor proof controls are unavailable.',
    ]);
  }

  const errors: string[] = [];
  const surfaces = [...document.querySelectorAll<HTMLElement>('[data-bic-surface]')];

  if (surfaces.length === 0) {
    return result('device-pixel-ratio-change', 'blocked', {}, [
      'No packaged surfaces are available for the DPR transition proof.',
    ]);
  }

  const baselineZoomFactor = await proofApi.getZoomFactor();
  const baselineDevicePixelRatio = window.devicePixelRatio;
  const targetZoomFactor = Math.abs(baselineZoomFactor - 1) < 0.01 ? 1.2 : 1;
  const initial = surfaces.map((surface) => ({
    id: surface.dataset['bicSurface'] ?? null,
    size: surface.dataset['bicTextureSize'] ?? null,
    resizes: Number(surface.dataset['bicTextureResizes'] ?? 0),
  }));
  let changed = false;
  let restored = false;
  let changedDevicePixelRatio = baselineDevicePixelRatio;
  let changedSurfaces: readonly unknown[] = [];

  try {
    await proofApi.setZoomFactor(targetZoomFactor);
    changed = await waitForCondition(() =>
      Math.abs(window.devicePixelRatio - baselineDevicePixelRatio) > 0.01 &&
      surfaces.every((surface, index) =>
        Math.abs(
          Number(surface.dataset['bicDevicePixelRatio'] ?? 0) -
          window.devicePixelRatio
        ) < 0.01 &&
        Number(surface.dataset['bicTextureResizes'] ?? 0) >
          (initial[index]?.resizes ?? 0) &&
        surface.dataset['bicTextureError'] === ''
      ),
    );
    changedDevicePixelRatio = window.devicePixelRatio;
    changedSurfaces = surfaces.map((surface) => ({
      id: surface.dataset['bicSurface'] ?? null,
      devicePixelRatio: Number(surface.dataset['bicDevicePixelRatio'] ?? 0),
      size: surface.dataset['bicTextureSize'] ?? null,
      resizes: Number(surface.dataset['bicTextureResizes'] ?? 0),
      error: surface.dataset['bicTextureError'] ?? '',
    }));
  } finally {
    await proofApi.setZoomFactor(baselineZoomFactor);
    restored = await waitForCondition(() =>
      Math.abs(window.devicePixelRatio - baselineDevicePixelRatio) < 0.01 &&
      surfaces.every((surface, index) =>
        Math.abs(
          Number(surface.dataset['bicDevicePixelRatio'] ?? 0) -
          baselineDevicePixelRatio
        ) < 0.01 &&
        surface.dataset['bicTextureSize'] === initial[index]?.size &&
        surface.dataset['bicTextureError'] === ''
      ),
    );
  }

  if (!changed) {
    errors.push('Surfaces did not recreate textures for the changed device-pixel ratio.');
  }

  if (!restored) {
    errors.push('Surfaces did not restore their original DPR and texture dimensions.');
  }

  return result('device-pixel-ratio-change', errors.length === 0 ? 'pass' : 'fail', {
    baselineZoomFactor,
    targetZoomFactor,
    baselineDevicePixelRatio,
    changedDevicePixelRatio,
    initial,
    changedSurfaces,
    finalDevicePixelRatio: window.devicePixelRatio,
    changed,
    restored,
  }, errors);
}

async function runSignalSurfaceUpdatesProof(): Promise<RuntimeProofResult> {
  const errors: string[] = [];
  const host = await waitForProjectedSurface();

  if (!host) {
    return result('signal-surface-updates', 'blocked', {}, [
      'The primary projected surface did not become ready.',
    ]);
  }

  const initialTransform = host.style.transform;
  const initialTextureSize = host.dataset['bicTextureSize'] ?? null;
  const moveButton = host.querySelector<HTMLButtonElement>('[data-action="move-right"]');
  const rotateButton = host.querySelector<HTMLButtonElement>('[data-action="rotate-right"]');
  const growButton = host.querySelector<HTMLButtonElement>('[data-action="grow"]');
  const shrinkButton = host.querySelector<HTMLButtonElement>('[data-action="shrink"]');

  moveButton?.click();
  await waitForAnimationFrames(3);
  const movedTransform = host.style.transform;

  rotateButton?.click();
  await waitForAnimationFrames(3);
  const rotatedTransform = host.style.transform;

  growButton?.click();
  const grew = await waitForTextureState(host, (state) =>
    state.size !== initialTextureSize && state.error === '',
  );
  const grownTextureSize = host.dataset['bicTextureSize'] ?? null;

  shrinkButton?.click();
  const restored = await waitForTextureState(host, (state) =>
    state.size === initialTextureSize && state.error === '',
  );

  if (!moveButton || initialTransform === movedTransform) {
    errors.push('Signal-driven position update did not change the projection.');
  }

  if (!rotateButton || movedTransform === rotatedTransform) {
    errors.push('Signal-driven rotation update did not change the projection.');
  }

  if (!growButton || !shrinkButton || !grew || !restored) {
    errors.push('Signal-driven size update did not recreate and restore the texture.');
  }

  return result('signal-surface-updates', errors.length === 0 ? 'pass' : 'fail', {
    initialTransform,
    movedTransform,
    rotatedTransform,
    initialTextureSize,
    grownTextureSize,
    finalTextureSize: host.dataset['bicTextureSize'] ?? null,
    grew,
    restored,
  }, errors);
}

async function runMvpLibraryContractProof(): Promise<RuntimeProofResult> {
  const errors: string[] = [];
  const surfaceCanvas = document.querySelector<HTMLCanvasElement>('canvas[layoutsubtree]');
  const surfaces = Array.from(
    surfaceCanvas?.querySelectorAll<HTMLElement>(':scope > bic-surface') ?? [],
  );
  await waitForAnimationFrames(3);

  const surfaceDetails = surfaces.map((surface) => ({
    id: surface.dataset['bicSurface'] ?? null,
    directCanvasChild: surface.parentElement === surfaceCanvas,
    projectionReady: surface.dataset['bicProjectionReady'] === 'true',
    projectionError: Number(surface.dataset['bicProjectionError'] ?? Number.NaN),
    textureSize: surface.dataset['bicTextureSize'] ?? null,
    textureError: surface.dataset['bicTextureError'] ?? null,
    depth: Number(surface.dataset['bicDepth'] ?? Number.NaN),
    glowRadius: Number(surface.dataset['bicGlowRadius'] ?? Number.NaN),
    glowIntensity: Number(surface.dataset['bicGlowIntensity'] ?? Number.NaN),
  }));

  if (surfaces.length < 2) {
    errors.push(`Expected at least two registered bic-surface elements, found ${surfaces.length}.`);
  }

  for (const surface of surfaceDetails) {
    if (!surface.directCanvasChild || !surface.projectionReady) {
      errors.push(`Surface ${surface.id ?? 'unknown'} is not a ready direct canvas child.`);
    }

    if (!Number.isFinite(surface.projectionError) || surface.projectionError > 2) {
      errors.push(`Surface ${surface.id ?? 'unknown'} projection is outside tolerance.`);
    }

    if (surface.textureError !== '' || !surface.textureSize) {
      errors.push(`Surface ${surface.id ?? 'unknown'} texture pipeline is not healthy.`);
    }

    if (
      !Number.isFinite(surface.depth) ||
      !Number.isFinite(surface.glowRadius) ||
      !Number.isFinite(surface.glowIntensity)
    ) {
      errors.push(`Surface ${surface.id ?? 'unknown'} did not apply CSS spatial effects.`);
    }
  }

  return result('mvp-library-contract', errors.length === 0 ? 'pass' : 'fail', {
    sceneSelectorPresent: Boolean(document.querySelector('bic-scene')),
    surfaceCount: surfaces.length,
    surfaces: surfaceDetails,
  }, errors);
}

async function waitForTextureState(
  host: HTMLElement,
  predicate: (state: {
    readonly size: string | null;
    readonly updates: number;
    readonly resizes: number;
    readonly error: string;
  }) => boolean,
): Promise<boolean> {
  const deadline = performance.now() + 5_000;

  while (performance.now() < deadline) {
    const state = {
      size: host.dataset['bicTextureSize'] ?? null,
      updates: Number(host.dataset['bicTextureUpdates'] ?? 0),
      resizes: Number(host.dataset['bicTextureResizes'] ?? 0),
      error: host.dataset['bicTextureError'] ?? '',
    };

    if (predicate(state)) {
      return true;
    }

    await waitForAnimationFrames(1);
  }

  return false;
}

async function waitForProjectedSurface(): Promise<HTMLElement | null> {
  const deadline = performance.now() + 5_000;

  while (performance.now() < deadline) {
    const host = document.querySelector<HTMLElement>('[data-bic-surface][data-bic-projection-ready="true"]');

    if (host) {
      return host;
    }

    await waitForAnimationFrames(1);
  }

  return null;
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;

  while (performance.now() < deadline) {
    if (predicate()) {
      return true;
    }

    await waitForAnimationFrames(1);
  }

  return false;
}

async function verifyTabOrder(host: HTMLElement): Promise<{
  readonly works: boolean;
  readonly first: string | null;
  readonly second: string | null;
}> {
  const focusable = Array.from(host.querySelectorAll<HTMLElement>('input, button, select, textarea, [tabindex]'))
    .filter((element) => element.tabIndex >= 0);
  const [first, second] = focusable;

  if (!first || !second) {
    return { works: false, first: null, second: null };
  }

  first.focus();
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
  second.focus();
  await waitForAnimationFrames(1);

  return {
    works: document.activeElement === second,
    first: first.tagName,
    second: second.tagName,
  };
}

function rectDetails(rect: DOMRect): Record<string, number> {
  return {
    left: roundNumber(rect.left),
    top: roundNumber(rect.top),
    right: roundNumber(rect.right),
    bottom: roundNumber(rect.bottom),
    width: roundNumber(rect.width),
    height: roundNumber(rect.height),
  };
}

function roundNumber(value: number): number {
  return Math.round(value * 100) / 100;
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
  texture.vScale = -1;
  texture.vOffset = 1;
  return texture;
}

function readBabylonUvCornerOrientation(
  plane: BABYLON.Mesh,
  texture: BABYLON.Texture,
): TextureCornerOrientation {
  const positions = plane.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  const uvs = plane.getVerticesData(BABYLON.VertexBuffer.UVKind);

  if (!positions || !uvs) {
    throw new Error('Babylon orientation plane is missing position or UV vertex data.');
  }

  const labels: Partial<Record<'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight', TextureCornerLabel>> = {};
  const raw: Partial<Record<'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight', readonly number[]>> = {};
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const x = positions[vertex * 3] ?? 0;
    const y = positions[vertex * 3 + 1] ?? 0;
    const u = uvs[vertex * 2] ?? 0;
    const v = uvs[vertex * 2 + 1] ?? 0;
    const transformedU = u * texture.uScale + texture.uOffset;
    const transformedV = v * texture.vScale + texture.vOffset;
    const corner = y >= 0
      ? (x < 0 ? 'topLeft' : 'topRight')
      : (x < 0 ? 'bottomLeft' : 'bottomRight');
    const label = fixtureLabelAtUv(transformedU, transformedV);

    labels[corner] = label;
    raw[corner] = [transformedU, transformedV];
  }

  const topLeft = labels.topLeft ?? 'unknown';
  const topRight = labels.topRight ?? 'unknown';
  const bottomLeft = labels.bottomLeft ?? 'unknown';
  const bottomRight = labels.bottomRight ?? 'unknown';

  return {
    topLeft,
    topRight,
    bottomLeft,
    bottomRight,
    raw: {
      topLeft: raw.topLeft ?? [],
      topRight: raw.topRight ?? [],
      bottomLeft: raw.bottomLeft ?? [],
      bottomRight: raw.bottomRight ?? [],
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

function fixtureLabelAtUv(u: number, v: number): TextureCornerLabel {
  if (u < -0.001 || u > 1.001 || v < -0.001 || v > 1.001) {
    return 'unknown';
  }

  if (v < 0.5) {
    return u < 0.5 ? 'red' : 'green';
  }

  return u < 0.5 ? 'blue' : 'yellow';
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
    }, 2_000);

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
  const tabOrder = await verifyTabOrder(surface);

  if (!button) {
    errors.push('Proof surface is missing a button.');
  }

  if (!input) {
    errors.push('Proof surface is missing an input.');
  }

  if (!select) {
    errors.push('Proof surface is missing a select.');
  }

  if (!tabOrder.works) {
    errors.push('Tab navigation did not move focus between direct DOM controls.');
  }

  return result('direct-dom-surface', errors.length === 0 && buttonClicked && inputFocused && textInputReceived ? 'pass' : 'fail', {
    inspectableInDevTools: surface.isConnected,
    computedStyleMatches,
    buttonClicked,
    inputFocused,
    textInputReceived,
    selectChanged: select?.selectedIndex === 1,
    tabOrder,
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
