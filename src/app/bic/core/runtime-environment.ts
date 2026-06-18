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

export interface BicRuntimeProofsApi {
  saveRun(request: BicRuntimeProofSaveRequest): Promise<BicRuntimeProofSaveResponse>;
}

declare global {
  interface Window {
    readonly bicRuntime?: BicRuntimeInfo;
    readonly bicRuntimeProofs?: BicRuntimeProofsApi;
  }
}

export {};
