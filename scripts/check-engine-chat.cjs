#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const args = process.argv.slice(2).flatMap((arg, index, all) => {
  if (arg === '--engine' || arg === '-e') return ['--agent'];
  if (arg === '--driver') return ['--ignored-driver'];
  if (index > 0 && all[index - 1] === '--driver') return [];
  return [arg];
}).filter((arg) => arg !== '--ignored-driver');

const result = spawnSync(process.execPath, [resolve(__dirname, 'check-runtime-chat.cjs'), ...args], {
  stdio: 'inherit',
  cwd: resolve(__dirname, '..'),
});

process.exit(result.status ?? 1);
