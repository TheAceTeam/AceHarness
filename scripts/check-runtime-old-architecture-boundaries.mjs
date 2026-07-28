#!/usr/bin/env node

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const roots = ['src', 'scripts', 'tests', 'package.json'];
const forbidden = [
  'engine-factory',
  'acp-engine',
  'acp-wrapper-base',
  'claude-code-wrapper',
  'opencode-wrapper',
  'opencode-sdk-wrapper',
  'codex-wrapper',
  'nga-wrapper',
  'nga-sdk-wrapper',
  'codegenie-wrapper',
  'codegenie-sdk-wrapper',
  'cursor-wrapper',
  'kiro-cli-wrapper',
  'trae-cli-wrapper',
  'magic-cli-wrapper',
  '@agentclientprotocol/claude-agent-acp',
  '@anthropic-ai/claude-agent-sdk',
  '@anthropic-ai/sdk',
  '@openai/codex-sdk',
  '@opencode-ai/sdk',
];
const forbiddenRegex = [
  /\bEngineOptions\b/u,
  /\bEngineResult\b/u,
  /\bEngineStreamEvent\b/u,
  /\bEngineDriver\b/u,
  /@agentclientprotocol\/sdk["']\s*:/u,
];
const allowedFiles = new Set([
  'src/lib/engines/README.md',
  'scripts/check-runtime-old-architecture-boundaries.mjs',
]);

const files = [];
for (const item of roots) {
  await collect(join(root, item));
}

const violations = [];
for (const file of files) {
  const rel = relative(root, file).replace(/\\/g, '/');
  if (allowedFiles.has(rel)) continue;
  const text = await readFile(file, 'utf8');
  for (const token of forbidden) {
    if (text.includes(token)) {
      violations.push({ file: rel, token });
    }
  }
  for (const regex of forbiddenRegex) {
    if (regex.test(text)) {
      violations.push({ file: rel, token: regex.toString() });
    }
  }
}

if (violations.length > 0) {
  console.error('Old engine/wrapper architecture references found:');
  for (const item of violations) {
    console.error(`- ${item.file}: ${item.token}`);
  }
  process.exit(1);
}

console.log('Runtime old-architecture boundary check passed.');

async function collect(path) {
  const info = await stat(path);
  if (info.isFile()) {
    if (/\.(ts|tsx|js|jsx|mjs|cjs|json|md)$/iu.test(path)) files.push(path);
    return;
  }
  if (!info.isDirectory()) return;
  for (const entry of await readdir(path)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'dist-build') continue;
    await collect(join(path, entry));
  }
}
