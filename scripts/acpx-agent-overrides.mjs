import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
let overridesResolver;
let sessionStoreWrapper;

/**
 * Diagnostic commands must use the same resolver as runtime sessions. In
 * particular, this preserves explicit ACP executable overrides and configured
 * search paths instead of maintaining a second bare-command policy here.
 */
function runtimeOverridesResolver() {
  if (overridesResolver) return overridesResolver;

  const tsNodeRegister = resolve(root, 'node_modules', 'ts-node', 'register', 'transpile-only.js');
  const tsconfigPathsRegister = resolve(root, 'node_modules', 'tsconfig-paths', 'register.js');
  if (!existsSync(tsNodeRegister)) {
    throw new Error('Missing ts-node. Run npm install before runtime checks.');
  }

  process.env.TS_NODE_PROJECT = process.env.TS_NODE_PROJECT || resolve(root, 'tsconfig.json');
  process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
    module: 'CommonJS',
    moduleResolution: 'Node',
  });
  require(tsNodeRegister);
  if (existsSync(tsconfigPathsRegister)) require(tsconfigPathsRegister);

  const adapter = require('../src/lib/runtime-agent/adapters/acpx-adapter.ts');
  if (typeof adapter.getAcpxAgentRegistryOverrides !== 'function') {
    throw new Error('ACPX runtime override resolver is unavailable.');
  }
  overridesResolver = adapter.getAcpxAgentRegistryOverrides;
  return overridesResolver;
}

export function getAcpxAgentRegistryOverrides() {
  return runtimeOverridesResolver()();
}

export function createAcpxCompatibleSessionStore(store) {
  if (!sessionStoreWrapper) {
    runtimeOverridesResolver();
    const client = require('../src/lib/runtime-agent/adapters/acpx-runtime-client.ts');
    sessionStoreWrapper = client.createAcpxCompatibleSessionStore;
  }
  return sessionStoreWrapper(store);
}
