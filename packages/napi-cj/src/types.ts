export type NativeInputValue = string | Buffer | Uint8Array;

export interface HostCallRequest {
  id: string;
  capability: string;
  timeoutMs?: number;
  payload?: unknown;
}

export interface HostCallResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type HostCallHandler = (
  request: HostCallRequest
) => Promise<HostCallResponse> | HostCallResponse;

export interface NativeFrame {
  seq: number;
  kind: number;
  flags: number;
  payload: Buffer;
  metadata?: unknown;
}

export interface NativeControlCallOptions {
  domain: string;
  operation: string;
  payloadJson?: string;
  onHostCall?: HostCallHandler;
}

export interface NativeDataCallOptions {
  requestId: string;
  domain: string;
  operation: string;
  optionsJson?: string;
  inputs?: Record<string, NativeInputValue | undefined>;
  onFrame?: (frame: NativeFrame) => void;
  onHostCall?: HostCallHandler;
}

export interface NativeDataCallResult {
  status: number;
  resultJson?: string;
  output?: Buffer;
  errorJson?: string;
}

export interface NativeLibrarySpec {
  path: string;
  initJson?: string;
  name?: string;
}

export interface NativeAddonBuildInfo {
  package: string;
  addon: string;
  abiVersion: number;
  sdkHeader?: string;
  target: string;
  gitCommit?: string;
  builtAt?: string;
  [key: string]: unknown;
}

export interface NativeLibraryBuildInfo {
  library?: string;
  abiVersion?: number;
  sdkVersion?: string;
  target?: string;
  gitCommit?: string;
  builtAt?: string;
  [key: string]: unknown;
}

export interface CangjieNativeLibrary {
  callControl(options: NativeControlCallOptions): Promise<string>;
  callData(options: NativeDataCallOptions): Promise<NativeDataCallResult>;
  getLibraryBuildInfo?(): NativeLibraryBuildInfo | string;
  dispose(): void;
}

export interface NapiCjAddon {
  openLibrary(spec: NativeLibrarySpec): CangjieNativeLibrary;
  getAddonBuildInfo?(): NativeAddonBuildInfo | string;
  getRuntimeInfo?(): unknown;
  isRuntimeAvailable?(): boolean;
}
