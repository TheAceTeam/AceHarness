import { resolveAddonPath, resolveNativeTarget } from './resolve-addon';
import { NapiCjNativeUnavailableError, type NativeDiagnostic } from './errors';
import type { NapiCjAddon } from './types';

let cachedAddon: NapiCjAddon | null = null;
let cachedDiagnostic: NativeDiagnostic | null = null;

function createUnavailableDiagnostic(cause?: unknown): NativeDiagnostic {
  const target = resolveNativeTarget();
  const addonPath = resolveAddonPath(target);
  return {
    code: 'NAPI_CJ_NATIVE_ADDON_UNAVAILABLE',
    message: `napi-cj native addon is not available for target ${target}: ${addonPath}`,
    target,
    addonPath,
    cause,
  };
}

export function getNativeAddonDiagnostic(): NativeDiagnostic | null {
  return cachedDiagnostic || createUnavailableDiagnostic();
}

export function loadNapiCjAddon(): NapiCjAddon {
  if (cachedAddon) return cachedAddon;

  const target = resolveNativeTarget();
  const addonPath = resolveAddonPath(target);
  try {
    // Native addon loading must stay lazy so JS-only runtime paths never touch it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const addon = require(addonPath) as NapiCjAddon;
    cachedAddon = addon;
    cachedDiagnostic = null;
    return addon;
  } catch (error) {
    cachedDiagnostic = createUnavailableDiagnostic(error);
    throw new NapiCjNativeUnavailableError(cachedDiagnostic);
  }
}

export function tryLoadNapiCjAddon(): NapiCjAddon | null {
  try {
    return loadNapiCjAddon();
  } catch {
    return null;
  }
}
