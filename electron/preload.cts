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
