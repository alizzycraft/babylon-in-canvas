import { contextBridge, ipcRenderer } from 'electron';

const chromiumFeatureFlags = [
  'CanvasDrawElement',
  'WebGPUDeveloperFeatures',
] as const;

const chromiumSwitches = [
  ['enable-experimental-web-platform-features'],
  ['enable-unsafe-webgpu'],
  ['ignore-gpu-blocklist'],
  ['enable-features', chromiumFeatureFlags.join(',')],
] as const;

contextBridge.exposeInMainWorld('bicRuntime', {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  chromiumFlags: {
    features: [...chromiumFeatureFlags],
    switches: chromiumSwitches.map(([name, value]) => ({ name, value })),
  },
});

contextBridge.exposeInMainWorld('bicRuntimeProofs', {
  saveRun(request: RuntimeProofSaveRequest): Promise<RuntimeProofSaveResponse> {
    return ipcRenderer.invoke('bic:runtime-proofs:save-run', request) as Promise<RuntimeProofSaveResponse>;
  },
  captureVisual(request: VisualCaptureRequest): Promise<VisualCaptureResponse> {
    return ipcRenderer.invoke('bic:runtime-proofs:capture-visual', request) as Promise<VisualCaptureResponse>;
  },
  getZoomFactor(): Promise<number> {
    return ipcRenderer.invoke('bic:runtime-proofs:get-zoom-factor') as Promise<number>;
  },
  setZoomFactor(factor: number): Promise<number> {
    return ipcRenderer.invoke('bic:runtime-proofs:set-zoom-factor', factor) as Promise<number>;
  },
  getSecurityState(): Promise<ElectronSecurityState> {
    return ipcRenderer.invoke('bic:runtime-proofs:get-security-state') as Promise<ElectronSecurityState>;
  },
});

interface RuntimeProofSaveRequest {
  readonly generatedAt: string;
  readonly summary: string;
  readonly results: readonly unknown[];
}

interface RuntimeProofSaveResponse {
  readonly jsonPath: string;
  readonly markdownPath: string;
}

interface VisualCaptureRequest {
  readonly label: string;
  readonly clip: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

interface VisualCaptureResponse {
  readonly pngPath: string;
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}

interface ElectronSecurityState {
  readonly packaged: boolean;
  readonly contextIsolation: boolean;
  readonly nodeIntegration: boolean;
  readonly sandbox: boolean;
  readonly devTools: boolean;
  readonly experimentalFeatures: boolean;
  readonly contentSecurityPolicy: string;
  readonly navigationLocked: boolean;
  readonly permissionsDeniedByDefault: boolean;
}
