export interface BicRuntimeVersions {
  readonly electron?: string;
  readonly chrome?: string;
  readonly node?: string;
}

export interface BicChromiumSwitch {
  readonly name: string;
  readonly value?: string;
}

export interface BicRuntimeInfo {
  readonly versions: BicRuntimeVersions;
  readonly chromiumFlags: {
    readonly features: readonly string[];
    readonly switches: readonly BicChromiumSwitch[];
  };
}

export interface BicRuntimeProofSaveRequest {
  readonly generatedAt: string;
  readonly summary: string;
  readonly results: readonly unknown[];
}

export interface BicRuntimeProofSaveResponse {
  readonly jsonPath: string;
  readonly markdownPath: string;
}

export interface BicVisualCaptureRequest {
  readonly label: string;
  readonly clip: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface BicVisualCaptureResponse {
  readonly pngPath: string;
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}

export interface BicRuntimeProofsApi {
  saveRun(request: BicRuntimeProofSaveRequest): Promise<BicRuntimeProofSaveResponse>;
  captureVisual(request: BicVisualCaptureRequest): Promise<BicVisualCaptureResponse>;
  getZoomFactor(): Promise<number>;
  setZoomFactor(factor: number): Promise<number>;
  getSecurityState(): Promise<BicElectronSecurityState>;
}

export interface BicElectronSecurityState {
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

declare global {
  interface Window {
    readonly bicRuntime?: BicRuntimeInfo;
    readonly bicRuntimeProofs?: BicRuntimeProofsApi;
  }
}

export {};
