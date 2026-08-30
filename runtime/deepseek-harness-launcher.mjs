import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ACP_PACKAGE = '@openma/deepseek-harness-acp';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resolveDefaultDshHome() {
  return resolve(homedir(), '.dsh');
}

function resolvePackageRoot(packageName) {
  const require = createRequire(import.meta.url);
  try {
    return dirname(require.resolve(`${packageName}/package.json`));
  } catch {
    return undefined;
  }
}

/** Resolve the ACPX server shipped by @openma/deepseek-harness-acp. */
export function resolveDeepseekHarnessCliEntry() {
  const packageRoot = resolvePackageRoot(ACP_PACKAGE);
  if (!packageRoot) {
    throw new Error(`ACEHarness could not resolve the installed ${ACP_PACKAGE}`);
  }
  return join(packageRoot, 'dist', 'bin.js');
}

function normalizeModel(value, provider) {
  const model = nonEmpty(value);
  if (!model) return undefined;
  const route = nonEmpty(provider);
  if (route && model.startsWith(`${route}/`)) return model.slice(route.length + 1);
  const slash = model.indexOf('/');
  return slash > 0 ? model.slice(slash + 1) : model;
}

/**
 * Map the historical ACEHarness DeepSeek variables to the names consumed by
 * @openma/deepseek-harness-acp. Explicit DSH_* values always win so users can
 * override the adapter defaults from their shell or ACPX session options.
 */
export function adaptDeepseekHarnessEnvironment(env = process.env) {
  const provider = nonEmpty(env.DSH_PROVIDER) || nonEmpty(env.ACEH_DEEPSEEK_PROVIDER);
  const model = normalizeModel(env.DSH_MODEL || env.ACEH_DEEPSEEK_MODEL, provider);
  const dshHome = nonEmpty(env.DSH_HOME) || resolveDefaultDshHome();

  env.DSH_HOME = dshHome;
  if (provider && !nonEmpty(env.DSH_PROVIDER)) env.DSH_PROVIDER = provider;
  if (model && !nonEmpty(env.DSH_MODEL)) env.DSH_MODEL = model;

  const permission = nonEmpty(env.DSH_PERMISSION_MODE)
    || nonEmpty(env.ACEH_DEEPSEEK_PERMISSION_MODE)
    || nonEmpty(env.ACEH_PERMISSION_MODE);
  if (permission && !nonEmpty(env.DSH_PERMISSION_MODE)) env.DSH_PERMISSION_MODE = permission;

  const sessionRoot = nonEmpty(env.DSH_SESSION_ROOT)
    || nonEmpty(env.ACEH_DEEPSEEK_SESSION_ROOT);
  if (sessionRoot && !nonEmpty(env.DSH_SESSION_ROOT)) env.DSH_SESSION_ROOT = sessionRoot;

  return env;
}

/** Import the OpenMa ACP entry while preserving every ACPX argv argument. */
export async function launchDeepseekHarness(options = {}) {
  adaptDeepseekHarnessEnvironment(options.env ?? process.env);
  const entry = options.resolveEntry?.() ?? resolveDeepseekHarnessCliEntry();
  const importEntry = options.importEntry ?? ((specifier) => import(specifier));
  await importEntry(pathToFileURL(entry).href);
}
