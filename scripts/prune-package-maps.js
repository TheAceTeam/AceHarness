#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const targets = [path.join(root, 'dist')];
let removed = 0;

function pruneMaps(dir) {
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      pruneMaps(fullPath);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.map')) {
      fs.rmSync(fullPath, { force: true });
      removed += 1;
    }
  }
}

for (const target of targets) {
  pruneMaps(target);
}

console.log(`[prune-package-maps] Removed ${removed} source map files`);
