export type {
  CangjieNativeLibrary,
  HostCallHandler,
  HostCallRequest,
  HostCallResponse,
  NapiCjAddon,
  NativeAddonBuildInfo,
  NativeControlCallOptions,
  NativeDataCallOptions,
  NativeDataCallResult,
  NativeFrame,
  NativeInputValue,
  NativeLibraryBuildInfo,
  NativeLibrarySpec,
} from './types';

export {
  NapiCjError,
  NapiCjNativeUnavailableError,
  type NativeDiagnostic,
} from './errors';

export {
  getPackageRoot,
  isNativeAddonAvailable,
  readAddonBuildInfo,
  resolveAddonDirectory,
  resolveAddonPath,
  resolveNativeTarget,
} from './resolve-addon';

export {
  getDynamicLibraryExtension,
  isNativeLibraryAvailable,
  normalizeNativeLibraryPath,
  readLibraryBuildInfo,
  resolveLibraryArtifactPath,
} from './resolve-library';

export {
  getNativeAddonDiagnostic,
  loadNapiCjAddon,
  tryLoadNapiCjAddon,
} from './load-addon';

import { loadNapiCjAddon } from './load-addon';
import type { CangjieNativeLibrary, NativeLibrarySpec } from './types';

export function openCangjieNativeLibrary(spec: NativeLibrarySpec): CangjieNativeLibrary {
  const addon = loadNapiCjAddon();
  if (typeof addon.openLibrary !== 'function') {
    throw new Error('napi-cj native addon does not expose openLibrary(spec)');
  }
  return addon.openLibrary(spec);
}
