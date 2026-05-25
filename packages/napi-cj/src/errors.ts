export interface NativeDiagnostic {
  code: string;
  message: string;
  target?: string;
  addonPath?: string;
  libraryPath?: string;
  cause?: unknown;
}

export class NapiCjError extends Error {
  readonly code: string;
  readonly diagnostic?: NativeDiagnostic;

  constructor(code: string, message: string, diagnostic?: NativeDiagnostic) {
    super(message);
    this.name = 'NapiCjError';
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

export class NapiCjNativeUnavailableError extends NapiCjError {
  constructor(diagnostic: NativeDiagnostic) {
    super(diagnostic.code, diagnostic.message, diagnostic);
    this.name = 'NapiCjNativeUnavailableError';
  }
}
