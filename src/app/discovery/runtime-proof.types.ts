export type RuntimeProofStatus = 'pass' | 'partial' | 'fail' | 'blocked';

export interface RuntimeProofResult {
  readonly name: string;
  readonly status: RuntimeProofStatus;
  readonly details: Record<string, unknown>;
  readonly errors: string[];
}

export interface RuntimeProof {
  readonly name: string;
  run(): Promise<RuntimeProofResult>;
}
