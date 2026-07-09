#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const options = parseArgs(process.argv.slice(2));

const runtimeProductionRoots = [
  'src/lib/runtime-agent',
  'src/server/runtime',
  'src/server/api-routes/runtime-sessions',
];

const runtimeCheckScripts = listFiles('scripts')
  .filter((file) => /^scripts\/check-runtime-.*\.(mjs|cjs|js)$/.test(file));

const boundaryTargets = [
  'src/client/query/query-keys.ts',
  'src/client/query/runtime-agent.ts',
  'src/client/query/runtime-client-state.ts',
  'src/client/db/runtime-agent-collections.ts',
  'src/client/db/collections.ts',
].filter((target) => exists(target));

const forbiddenNativeIds = [
  /\bacpxRecordId\b/,
  /\bbackendSessionId\b/,
  /\bproviderSessionId\b/,
  /\bexternalSessionId\b/,
  /\bexternalRecordId\b/,
];

const forbiddenRuntimeEngineImports = [];
const nativeIdFindings = [];

for (const target of [...runtimeProductionRoots.flatMap(listFiles), ...runtimeCheckScripts]) {
  const text = readFileSync(resolve(root, target), 'utf8');
  text.split(/\r?\n/).forEach((line, index) => {
    if (target === 'scripts/check-runtime-trace.mjs') return;
    if (line.includes('/lib/engines') || line.includes('@/lib/engines') || line.includes('../engines')) {
      forbiddenRuntimeEngineImports.push({
        file: target,
        line: index + 1,
        text: line.trim(),
      });
    }
  });
}

for (const target of ['src/lib/runtime-agent/contracts.ts', ...boundaryTargets]) {
  const text = readFileSync(resolve(root, target), 'utf8');
  text.split(/\r?\n/).forEach((line, index) => {
    if (isAllowedBlockingListLine(target, line)) return;
    for (const pattern of forbiddenNativeIds) {
      if (pattern.test(line)) {
        nativeIdFindings.push({
          file: target,
          line: index + 1,
          pattern: pattern.source,
          text: line.trim(),
        });
      }
    }
  });
}

const allowedContractFindings = nativeIdFindings.filter(
  (finding) =>
    finding.file === 'src/lib/runtime-agent/contracts.ts' &&
    /externalRecordId|externalSessionId|providerSessionId/.test(finding.text),
);
const blockingNativeIdFindings = nativeIdFindings.filter(
  (finding) => !allowedContractFindings.includes(finding),
);

const report = {
  ok: forbiddenRuntimeEngineImports.length === 0 && blockingNativeIdFindings.length === 0,
  scanned: {
    runtimeProductionRoots,
    runtimeCheckScripts,
    dtoQueryCacheTargets: boundaryTargets,
  },
  forbiddenRuntimeEngineImports,
  allowedContractFindings,
  blockingNativeIdFindings,
};

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('Runtime Trace Boundary Check');
  console.log(`runtime production roots: ${runtimeProductionRoots.join(', ')}`);
  console.log(`runtime check scripts: ${runtimeCheckScripts.length}`);
  console.log(`DTO/query/cache targets: ${boundaryTargets.join(', ')}`);
  console.log(`forbidden runtime engine imports: ${forbiddenRuntimeEngineImports.length}`);
  console.log(`allowed adapter contract references: ${allowedContractFindings.length}`);
  if (forbiddenRuntimeEngineImports.length) {
    console.log('forbidden runtime engine imports:');
    for (const finding of forbiddenRuntimeEngineImports) {
      console.log(`- ${finding.file}:${finding.line} ${finding.text}`);
    }
  }
  if (blockingNativeIdFindings.length) {
    console.log('blocking native id findings:');
    for (const finding of blockingNativeIdFindings) {
      console.log(`- ${finding.file}:${finding.line} ${finding.text}`);
    }
  } else {
    console.log('blocking native id findings: 0');
  }
}

process.exit(report.ok ? 0 : 1);

function parseArgs(argv) {
  const parsed = { json: false };
  for (const arg of argv) {
    if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`
Runtime trace boundary check

Usage:
  npm run check:runtime:trace

Scans runtime production code and runtime check scripts for imports from
src/lib/engines, then scans ordinary DTO/query/client cache surfaces for
provider/acpx native ids. Adapter binding contract references are allowed only
in runtime-agent contracts.
`);
      process.exit(0);
    }
  }
  return parsed;
}

function exists(target) {
  try {
    statSync(resolve(root, target));
    return true;
  } catch {
    return false;
  }
}

function listFiles(target) {
  if (!exists(target)) return [];
  const abs = resolve(root, target);
  const stats = statSync(abs);
  if (stats.isFile()) return [target.replaceAll('\\', '/')];

  const result = [];
  for (const entry of readdirSync(abs)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const child = join(target, entry).replaceAll('\\', '/');
    const childStats = statSync(resolve(root, child));
    if (childStats.isDirectory()) result.push(...listFiles(child));
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(child)) result.push(child);
  }
  return result;
}

function isAllowedBlockingListLine(target, line) {
  return target === 'src/client/db/runtime-agent-collections.ts'
    && /^\s*'[^']+',?\s*$/.test(line)
    && (
      line.includes('acpx')
      || line.includes('backend')
      || line.includes('external')
      || line.includes('provider')
    );
}
