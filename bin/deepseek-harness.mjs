#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchDeepseekHarness } from '../runtime/deepseek-harness-launcher.mjs';

// The global npm bin may be invoked from an arbitrary project directory. Keep
// ACEHarness path resolution anchored to this installed package root.
process.env.ACE_INSTALL_ROOT = process.env.ACE_INSTALL_ROOT || path.resolve(fileURLToPath(new URL('..', import.meta.url)));

try {
  await launchDeepseekHarness();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
