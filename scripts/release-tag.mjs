#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const PACKAGE_NAME = '@cangjielang/aceharness';
const NPM_REGISTRY = 'https://registry.npmjs.org/';
const GITCODE_REPO = 'Cangjie-SIG/ACEHarness';
const GITCODE_OWNER = 'Cangjie-SIG';
const GITCODE_NAME = 'ACEHarness';
const POWER_GITCODE = join(
  REPO_ROOT,
  '.agents',
  'skills',
  'power-gitcode',
  'scripts',
  'power-gitcode.py',
);
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const SEMVER_TAG = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DIST_TAGS = ['latest', 'beta', 'release'];
const TANSTACK_MANIFEST_PATH = /^dist\/server\/assets\/_tanstack-start-manifest_v-[0-9A-Za-z_-]+\.mjs$/;
const TANSTACK_MANIFEST_REFERENCE = /_tanstack-start-manifest_v-[0-9A-Za-z_-]+\.mjs/g;
const TANSTACK_ROUTE_SOURCE_PATH = /filePath: "[^"\r\n]*[\\/]src[\\/]routes[\\/]/g;

let tempRoot = null;
let releaseWorktree = null;
let cleanupStarted = false;

function info(message) {
  console.log(`[release] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function usage() {
  console.log(`Usage:
  npm run release:tag -- <tag> [--dry-run] [--yes] [--notes-file <path>]

Examples:
  npm run release:tag -- 1.0.0-rc.13 --dry-run
  npm run release:tag -- 1.0.0-rc.13
  npm run release:tag -- 1.0.0-rc.13 --yes --notes-file ./release-notes.md

Options:
  --dry-run            Run every validation through npm pack, but do not publish.
  --yes                Skip the exact-tag confirmation (for an approved automation run).
  --notes-file <path>  Use Markdown from this file as the release highlights.
  -h, --help           Show this help.

Required for a real release:
  ACE_NPM_TOKEN                 npm granular access token
  gitcode_token or gitcode_password
`);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    yes: false,
    notesFile: null,
    tag: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--yes') {
      options.yes = true;
    } else if (arg === '--notes-file') {
      const value = argv[index + 1];
      if (!value) fail('--notes-file requires a path.');
      options.notesFile = resolve(process.cwd(), value);
      index += 1;
    } else if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg.startsWith('-')) {
      fail(`Unknown option: ${arg}`);
    } else if (options.tag) {
      fail(`Unexpected argument: ${arg}`);
    } else {
      options.tag = arg;
    }
  }

  return options;
}

function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  // npm receives its token through a mode-0600 temporary userconfig. GitCode
  // credentials are exposed only to the Power GitCode release subprocess.
  delete env.ACE_NPM_TOKEN;
  delete env.gitcode_token;
  delete env.gitcode_password;
  return env;
}

function powerGitCodeEnv() {
  const env = childEnv();
  if (process.env.gitcode_token) env.gitcode_token = process.env.gitcode_token;
  if (process.env.gitcode_password) env.gitcode_password = process.env.gitcode_password;
  return env;
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? childEnv(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

function outputText(result) {
  return `${result.stdout}\n${result.stderr}`.trim();
}

function tail(text, lineCount = 80) {
  return text.split(/\r?\n/).slice(-lineCount).join('\n');
}

function requireSuccess(result, description) {
  if (result.error) fail(`${description}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${description} failed:\n${tail(outputText(result))}`);
  }
  return result.stdout.trim();
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], {
    env: childEnv(),
    stdio: 'ignore',
    shell: false,
  });
  // Some CLIs (notably gc) are present but reject a root-level --version flag.
  return !result.error;
}

function runLogged(label, command, args, options = {}) {
  const logPath = join(tempRoot, `${options.logName ?? label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.log`);
  const logFd = openSync(logPath, 'w');
  info(`${label}...`);

  let result;
  try {
    result = spawnSync(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? childEnv(),
      stdio: ['ignore', logFd, logFd],
      shell: false,
    });
  } finally {
    closeSync(logFd);
  }

  const logText = readFileSync(logPath, 'utf8');
  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${label} failed. Log tail:\n${tail(logText, options.failureLines ?? 120)}`);
  }

  info(`${label}: ok`);
  if (options.summaryLines && logText.trim()) {
    console.log(tail(logText.trim(), options.summaryLines));
  }
  return { logPath, logText };
}

function parseJson(text, description) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${description} returned invalid JSON: ${error.message}\n${tail(text)}`);
  }
}

function readGitFile(tag, path) {
  return requireSuccess(
    capture('git', ['-C', REPO_ROOT, 'show', `${tag}:${path}`]),
    `Read ${path} from ${tag}`,
  );
}

function hashFile(path, algorithm) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

function normalizeGeneratedPackageFile(path, content) {
  let normalizedPath = path;
  let normalizedContent = content;
  if (TANSTACK_MANIFEST_PATH.test(path)) {
    // Vite may choose a different content-hash suffix for this equivalent generated chunk.
    normalizedPath = 'dist/server/assets/_tanstack-start-manifest_v-HASH.mjs';
  }
  if (TANSTACK_MANIFEST_PATH.test(path) || path === 'dist/server/server.mjs') {
    normalizedContent = Buffer.from(
      content
        .toString('utf8')
        .replaceAll(TANSTACK_MANIFEST_REFERENCE, '_tanstack-start-manifest_v-HASH.mjs')
        .replaceAll(TANSTACK_ROUTE_SOURCE_PATH, 'filePath: "<WORKTREE>/src/routes/'),
      'utf8',
    );
  }
  return { path: normalizedPath, content: normalizedContent };
}

function fingerprintPackageDirectory(packageRoot) {
  const records = [];

  function walk(directory, prefix = '') {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) {
        walk(absolute, relative);
      } else if (stat.isSymbolicLink()) {
        records.push({ path: relative, type: 'link', target: readlinkSync(absolute) });
      } else if (stat.isFile()) {
        const normalized = normalizeGeneratedPackageFile(relative, readFileSync(absolute));
        records.push({
          path: normalized.path,
          type: 'file',
          executable: Boolean(stat.mode & 0o111),
          size: normalized.content.length,
          sha256: createHash('sha256').update(normalized.content).digest('hex'),
        });
      } else {
        fail(`Unsupported archive entry type: ${relative}`);
      }
    }
  }

  walk(packageRoot);
  records.sort((left, right) => left.path.localeCompare(right.path));
  const digest = createHash('sha256');
  for (const record of records) {
    digest.update(JSON.stringify(record));
    digest.update('\n');
  }
  return { digest: digest.digest('hex'), records };
}

function comparePublishedPackage(npmSpec, localTarball, npmCache) {
  const publishedArtifactDir = join(tempRoot, 'published-artifact');
  const localExtractDir = join(tempRoot, 'local-package');
  const publishedExtractDir = join(tempRoot, 'published-package');
  mkdirSync(publishedArtifactDir, { recursive: true });
  mkdirSync(localExtractDir, { recursive: true });
  mkdirSync(publishedExtractDir, { recursive: true });

  runLogged(
    `Download published ${npmSpec}`,
    NPM_COMMAND,
    [
      'pack',
      npmSpec,
      '--ignore-scripts',
      '--pack-destination',
      publishedArtifactDir,
      `--registry=${NPM_REGISTRY}`,
      '--loglevel=error',
    ],
    { env: childEnv({ NPM_CONFIG_CACHE: npmCache }), summaryLines: 2, failureLines: 120 },
  );
  const publishedTarballs = readdirSync(publishedArtifactDir).filter((file) => file.endsWith('.tgz'));
  if (publishedTarballs.length !== 1) {
    fail(`Expected one downloaded npm tarball, found ${publishedTarballs.length}.`);
  }
  const publishedTarball = join(publishedArtifactDir, publishedTarballs[0]);

  runLogged('Extract local npm tarball', 'tar', ['-xzf', localTarball, '-C', localExtractDir]);
  runLogged('Extract published npm tarball', 'tar', ['-xzf', publishedTarball, '-C', publishedExtractDir]);
  const localFingerprint = fingerprintPackageDirectory(join(localExtractDir, 'package'));
  const publishedFingerprint = fingerprintPackageDirectory(join(publishedExtractDir, 'package'));
  if (localFingerprint.digest === publishedFingerprint.digest) {
    info(`Published package content fingerprint matches (${localFingerprint.digest}).`);
    return;
  }

  const localRecords = new Map(localFingerprint.records.map((record) => [record.path, record]));
  const publishedRecords = new Map(publishedFingerprint.records.map((record) => [record.path, record]));
  const paths = [...new Set([...localRecords.keys(), ...publishedRecords.keys()])].sort();
  const differences = paths.filter((path) => {
    return JSON.stringify(localRecords.get(path)) !== JSON.stringify(publishedRecords.get(path));
  }).slice(0, 20);
  fail(
    `Published package content does not match a fresh build of the tag. ` +
      `local=${localFingerprint.digest}, published=${publishedFingerprint.digest}.\n` +
      `First differing paths:\n${differences.join('\n')}`,
  );
}

function validateExistingRelease(release, tag, targetCommit) {
  const target = String(release.target_commitish ?? '').trim();
  if (target === tag || target === targetCommit || target === targetCommit.slice(0, 8)) return;

  if (target) {
    const resolved = capture('git', ['-C', REPO_ROOT, 'rev-parse', `${target}^{commit}`]);
    if (resolved.status === 0 && resolved.stdout.trim() === targetCommit) return;
  }

  fail(
    `GitCode Release ${tag} already exists but targets ${target || '<empty>'}, ` +
      `not ${targetCommit}. Reconcile it manually before continuing.`,
  );
}

function findPreviousTag(targetTag, targetCommit, currentReleaseVersion) {
  if (currentReleaseVersion && currentReleaseVersion !== targetTag && SEMVER_TAG.test(currentReleaseVersion)) {
    const fetchPrevious = capture('git', [
      '-C',
      REPO_ROOT,
      'fetch',
      'origin',
      `refs/tags/${currentReleaseVersion}:refs/tags/${currentReleaseVersion}`,
    ]);
    const previousCommit = capture('git', [
      '-C',
      REPO_ROOT,
      'rev-parse',
      `${currentReleaseVersion}^{commit}`,
    ]);
    if (fetchPrevious.status === 0 && previousCommit.status === 0) {
      return currentReleaseVersion;
    }
  }

  const described = capture('git', [
    '-C',
    REPO_ROOT,
    'describe',
    '--tags',
    '--match',
    '[0-9]*',
    '--abbrev=0',
    `${targetCommit}^`,
  ]);
  return described.status === 0 ? described.stdout.trim() : null;
}

function releaseHighlights(options, previousTag, targetCommit) {
  if (options.notesFile) {
    if (!existsSync(options.notesFile) || !statSync(options.notesFile).isFile()) {
      fail(`Release notes file does not exist: ${options.notesFile}`);
    }
    return readFileSync(options.notesFile, 'utf8').trim();
  }

  if (previousTag) {
    const commits = capture('git', [
      '-C',
      REPO_ROOT,
      'log',
      '--no-merges',
      '--pretty=format:- %s (`%h`)',
      `${previousTag}..${targetCommit}`,
    ]);
    if (commits.status === 0 && commits.stdout.trim()) return commits.stdout.trim();
  }

  return requireSuccess(
    capture('git', ['-C', REPO_ROOT, 'show', '-s', '--pretty=format:- %s (`%h`)', targetCommit]),
    'Generate release highlights',
  );
}

function makeReleaseBody(options, tag, targetCommit, previousTag) {
  const highlights = releaseHighlights(options, previousTag, targetCommit);
  const body = `## 版本亮点

${highlights}

## 安装

\`\`\`bash
npm install -g ${PACKAGE_NAME}@${tag}
\`\`\`

[npm 包页面](https://www.npmjs.com/package/${PACKAGE_NAME}/v/${tag})

## 发布验证

- TypeScript 类型检查通过
- ESLint 检查通过
- Vitest 完整测试通过
- npm \`latest\`、\`beta\`、\`release\` 均指向 \`${tag}\`

Tag commit: \`${targetCommit}\`
`;
  const path = join(tempRoot, 'release-notes.md');
  writeFileSync(path, body, 'utf8');
  return { body, path };
}

function createNpmUserConfig(token) {
  if (!token || /[\r\n]/.test(token)) fail('ACE_NPM_TOKEN is missing or malformed.');
  const path = join(tempRoot, 'npmrc');
  writeFileSync(
    path,
    `registry=${NPM_REGISTRY}\n//registry.npmjs.org/:_authToken=${token}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  chmodSync(path, 0o600);
  return path;
}

function cleanup() {
  if (cleanupStarted) return;
  cleanupStarted = true;

  if (releaseWorktree && existsSync(releaseWorktree)) {
    spawnSync('git', ['-C', REPO_ROOT, 'worktree', 'remove', '--force', releaseWorktree], {
      env: childEnv(),
      stdio: 'ignore',
      shell: false,
    });
  }

  if (tempRoot && existsSync(tempRoot)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function confirmRelease(tag, targetCommit, npmExists, releaseExists) {
  console.log(`\nRelease target:
  tag:             ${tag}
  commit:          ${targetCommit}
  npm version:     ${npmExists ? 'already exists; checksum will be verified' : 'will be published'}
  GitCode Release: ${releaseExists ? 'already exists; target will be verified' : 'will be created'}
`);

  if (!process.stdin.isTTY) {
    fail('Interactive confirmation is unavailable. Re-run with --yes after approval.');
  }
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Type the exact tag to continue (${tag}): `);
    if (answer.trim() !== tag) fail('Release cancelled: confirmation did not match the tag.');
  } finally {
    prompt.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (!options.tag) {
    usage();
    fail('A release tag is required.');
  }
  if (!SEMVER_TAG.test(options.tag)) {
    fail(`Tag must be a SemVer value without a v prefix: ${options.tag}`);
  }
  if (options.notesFile && (!existsSync(options.notesFile) || !statSync(options.notesFile).isFile())) {
    fail(`Release notes file does not exist: ${options.notesFile}`);
  }

  for (const command of ['git', NPM_COMMAND, 'gc', 'tar']) {
    if (!commandExists(command)) fail(`Required command is unavailable: ${command}`);
  }
  const pythonCommand = process.env.PYTHON || (commandExists('python3') ? 'python3' : 'python');
  if (!commandExists(pythonCommand)) fail('Python 3 is required for Power GitCode.');
  if (!existsSync(POWER_GITCODE)) fail(`Power GitCode script is missing: ${POWER_GITCODE}`);

  const origin = requireSuccess(
    capture('git', ['-C', REPO_ROOT, 'remote', 'get-url', 'origin']),
    'Read origin URL',
  );
  if (!origin.toLowerCase().includes('gitcode.com:cangjie-sig/aceharness') &&
      !origin.toLowerCase().includes('gitcode.com/cangjie-sig/aceharness')) {
    fail(`origin does not point to ${GITCODE_REPO}: ${origin}`);
  }

  tempRoot = mkdtempSync(join(tmpdir(), 'aceharness-release-'));
  releaseWorktree = join(tempRoot, 'worktree');
  const npmCache = resolve(
    process.env.ACE_RELEASE_NPM_CACHE || join(tmpdir(), 'aceharness-release-npm-cache'),
  );
  const artifactDir = join(tempRoot, 'artifacts');
  mkdirSync(npmCache, { recursive: true });
  mkdirSync(artifactDir, { recursive: true });

  info(`Checking remote tag ${options.tag}...`);
  requireSuccess(
    capture('git', ['-C', REPO_ROOT, 'ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${options.tag}`]),
    `Remote tag ${options.tag}`,
  );
  requireSuccess(
    capture('git', [
      '-C',
      REPO_ROOT,
      'fetch',
      'origin',
      `refs/tags/${options.tag}:refs/tags/${options.tag}`,
    ]),
    `Fetch tag ${options.tag}`,
  );
  const targetCommit = requireSuccess(
    capture('git', ['-C', REPO_ROOT, 'rev-parse', `${options.tag}^{commit}`]),
    `Resolve tag ${options.tag}`,
  );

  const tagPackage = parseJson(readGitFile(options.tag, 'package.json'), 'package.json');
  const tagLock = parseJson(readGitFile(options.tag, 'package-lock.json'), 'package-lock.json');
  const lockVersion = tagLock.packages?.['']?.version ?? tagLock.version;
  if (tagPackage.name !== PACKAGE_NAME) {
    fail(`Tag package name is ${tagPackage.name}, expected ${PACKAGE_NAME}.`);
  }
  if (tagPackage.version !== options.tag || lockVersion !== options.tag) {
    fail(
      `Version mismatch: tag=${options.tag}, package.json=${tagPackage.version}, ` +
        `package-lock.json=${lockVersion}.`,
    );
  }
  info(`Tag manifest verified (${tagPackage.name}@${tagPackage.version}, Node ${tagPackage.engines?.node ?? 'unspecified'}).`);

  const npmSpec = `${PACKAGE_NAME}@${options.tag}`;
  const npmLookup = capture(NPM_COMMAND, [
    'view',
    npmSpec,
    'version',
    'dist.shasum',
    '--json',
    `--registry=${NPM_REGISTRY}`,
    '--fetch-retries=1',
    '--fetch-timeout=20000',
    '--loglevel=error',
  ], { env: childEnv({ NPM_CONFIG_CACHE: npmCache }) });
  let npmExists = false;
  let publishedSha1 = null;
  if (npmLookup.status === 0) {
    const metadata = parseJson(npmLookup.stdout, `npm view ${npmSpec}`);
    npmExists = metadata.version === options.tag;
    publishedSha1 = metadata['dist.shasum'] ?? null;
  } else if (!/E404|404 No match|not found/i.test(outputText(npmLookup))) {
    fail(`Unable to query npm:\n${tail(outputText(npmLookup))}`);
  }
  const npmExistedAtStart = npmExists;

  const currentReleaseLookup = capture(NPM_COMMAND, [
    'view',
    PACKAGE_NAME,
    'dist-tags.release',
    '--json',
    `--registry=${NPM_REGISTRY}`,
    '--fetch-retries=1',
    '--fetch-timeout=20000',
    '--loglevel=error',
  ], { env: childEnv({ NPM_CONFIG_CACHE: npmCache }) });
  if (currentReleaseLookup.status !== 0) {
    fail(`Unable to read the current npm release dist-tag:\n${tail(outputText(currentReleaseLookup))}`);
  }
  const currentReleaseVersion = parseJson(currentReleaseLookup.stdout, 'npm release dist-tag');

  const releaseLookup = capture('gc', [
    'release',
    'view',
    options.tag,
    '-R',
    GITCODE_REPO,
    '--json',
  ]);
  let releaseExists = false;
  let existingRelease = null;
  if (releaseLookup.status === 0) {
    existingRelease = parseJson(releaseLookup.stdout, `GitCode Release ${options.tag}`);
    releaseExists = true;
    validateExistingRelease(existingRelease, options.tag, targetCommit);
  } else if (!/404|not found/i.test(outputText(releaseLookup))) {
    fail(`Unable to query GitCode Release:\n${tail(outputText(releaseLookup))}`);
  }

  if (releaseExists && !npmExists) {
    fail(
      `GitCode Release ${options.tag} exists while ${npmSpec} does not. ` +
        'Reconcile this inconsistent external state before publishing.',
    );
  }

  if (!options.dryRun) {
    if (!process.env.ACE_NPM_TOKEN) fail('ACE_NPM_TOKEN is required for a real release.');
    if (!releaseExists && !process.env.gitcode_token && !process.env.gitcode_password) {
      fail('gitcode_token or gitcode_password is required to create the GitCode Release.');
    }
    if (!options.yes) {
      await confirmRelease(options.tag, targetCommit, npmExists, releaseExists);
    }
  }

  runLogged(
    'Create isolated tag worktree',
    'git',
    ['-C', REPO_ROOT, 'worktree', 'add', '--detach', releaseWorktree, options.tag],
    { summaryLines: 3 },
  );
  runLogged(
    'Install locked dependencies',
    NPM_COMMAND,
    ['ci', '--engine-strict', `--registry=${NPM_REGISTRY}`, '--fetch-retries=2', '--fetch-timeout=60000'],
    {
      cwd: releaseWorktree,
      env: childEnv({ NPM_CONFIG_CACHE: npmCache }),
      summaryLines: 12,
      failureLines: 160,
    },
  );
  runLogged('TypeScript typecheck', NPM_COMMAND, ['exec', '--', 'tsc', '--noEmit', '--pretty', 'false'], {
    cwd: releaseWorktree,
    env: childEnv({ NPM_CONFIG_CACHE: npmCache }),
    failureLines: 160,
  });
  runLogged('ESLint', NPM_COMMAND, ['run', 'lint'], {
    cwd: releaseWorktree,
    env: childEnv({ NPM_CONFIG_CACHE: npmCache }),
    summaryLines: 16,
    failureLines: 200,
  });
  runLogged('Vitest full suite', NPM_COMMAND, ['test'], {
    cwd: releaseWorktree,
    env: childEnv({
      NPM_CONFIG_CACHE: npmCache,
      GIT_ASSISTED_BY: process.env.GIT_ASSISTED_BY || 'aceharness/release-script',
    }),
    summaryLines: 10,
    failureLines: 220,
  });
  runLogged(
    'Build and pack npm tarball',
    NPM_COMMAND,
    ['pack', '--pack-destination', artifactDir, '--loglevel=error'],
    {
      cwd: releaseWorktree,
      env: childEnv({ NPM_CONFIG_CACHE: npmCache }),
      summaryLines: 3,
      failureLines: 240,
    },
  );

  const tarballs = readdirSync(artifactDir).filter((file) => file.endsWith('.tgz'));
  if (tarballs.length !== 1) fail(`Expected one npm tarball, found ${tarballs.length}.`);
  const tarball = join(artifactDir, tarballs[0]);
  const packedManifest = parseJson(
    requireSuccess(capture('tar', ['-xOf', tarball, 'package/package.json']), 'Read packed package.json'),
    'packed package.json',
  );
  if (packedManifest.name !== PACKAGE_NAME || packedManifest.version !== options.tag) {
    fail(`Packed manifest is ${packedManifest.name}@${packedManifest.version}, expected ${npmSpec}.`);
  }

  const archiveEntries = requireSuccess(capture('tar', ['-tzf', tarball]), 'List npm tarball').split(/\r?\n/);
  const sensitiveEntries = archiveEntries.filter((entry) => {
    const file = basename(entry).toLowerCase();
    return ['.env', '.npmrc', 'id_rsa', 'id_ed25519'].includes(file) || /\.(pem|key)$/.test(file);
  });
  const unsafeEntries = archiveEntries.filter((entry) => entry.startsWith('/') || entry.includes('../'));
  if (sensitiveEntries.length > 0) {
    fail(`Sensitive-looking files found in npm tarball:\n${sensitiveEntries.join('\n')}`);
  }
  if (unsafeEntries.length > 0) {
    fail(`Unsafe paths found in npm tarball:\n${unsafeEntries.join('\n')}`);
  }
  for (const requiredEntry of ['package/bin/ace.js', 'package/dist/cli.js']) {
    if (!archiveEntries.includes(requiredEntry)) fail(`Required tarball entry is missing: ${requiredEntry}`);
  }

  const [localSha1, localSha256] = await Promise.all([
    hashFile(tarball, 'sha1'),
    hashFile(tarball, 'sha256'),
  ]);
  info(
    `Tarball verified: ${basename(tarball)}, ${archiveEntries.filter(Boolean).length} files, ` +
      `${(statSync(tarball).size / 1024 / 1024).toFixed(1)} MiB, sha256=${localSha256}`,
  );
  if (npmExists && publishedSha1 !== localSha1) {
    info(
      `${npmSpec} archive sha1 differs from this rebuild; comparing unpacked paths and file contents.`,
    );
    comparePublishedPackage(npmSpec, tarball, npmCache);
  }

  const previousTag = findPreviousTag(options.tag, targetCommit, currentReleaseVersion);
  const releaseNotes = makeReleaseBody(options, options.tag, targetCommit, previousTag);
  info(`Release notes prepared${previousTag ? ` from ${previousTag}..${options.tag}` : ' from the tag commit'}.`);

  if (options.dryRun) {
    info('Dry run complete. No npm package, dist-tag, or GitCode Release was changed.');
    return;
  }

  const npmUserConfig = createNpmUserConfig(process.env.ACE_NPM_TOKEN);
  const npmAuthArgs = [`--registry=${NPM_REGISTRY}`, `--userconfig=${npmUserConfig}`, '--loglevel=error'];
  const npmUser = requireSuccess(
    capture(NPM_COMMAND, ['whoami', ...npmAuthArgs], {
      env: childEnv({ NPM_CONFIG_CACHE: npmCache }),
    }),
    'Authenticate to npm',
  );
  info(`Authenticated to npm as ${npmUser}.`);

  if (!npmExists) {
    runLogged(
      `Publish ${npmSpec}`,
      NPM_COMMAND,
      ['publish', tarball, '--access', 'public', '--tag', 'latest', ...npmAuthArgs],
      { env: childEnv({ NPM_CONFIG_CACHE: npmCache }), summaryLines: 4, failureLines: 160 },
    );
    npmExists = true;
  } else {
    info(`${npmSpec} already exists and matches the verified tarball; skipping npm publish.`);
  }

  for (const distTag of DIST_TAGS) {
    runLogged(
      `Set npm dist-tag ${distTag}`,
      NPM_COMMAND,
      ['dist-tag', 'add', npmSpec, distTag, ...npmAuthArgs],
      { env: childEnv({ NPM_CONFIG_CACHE: npmCache }), summaryLines: 2, failureLines: 100 },
    );
  }

  if (!releaseExists) {
    runLogged(
      `Create GitCode Release ${options.tag}`,
      pythonCommand,
      [
        POWER_GITCODE,
        'create_release',
        '--owner',
        GITCODE_OWNER,
        '--repo',
        GITCODE_NAME,
        '--tag',
        options.tag,
        '--name',
        `ACEHarness ${options.tag}`,
        '--target',
        targetCommit,
        '--body',
        releaseNotes.body,
      ],
      { env: powerGitCodeEnv(), summaryLines: 8, failureLines: 160 },
    );
    releaseExists = true;
  } else {
    info(`GitCode Release ${options.tag} already exists and targets the expected commit; skipping creation.`);
  }

  const npmVerify = requireSuccess(
    capture(NPM_COMMAND, [
      'view',
      npmSpec,
      'version',
      'dist-tags',
      'dist.shasum',
      '--json',
      `--registry=${NPM_REGISTRY}`,
      '--fetch-retries=2',
      '--fetch-timeout=20000',
      '--loglevel=error',
    ], { env: childEnv({ NPM_CONFIG_CACHE: npmCache }) }),
    'Verify npm publication',
  );
  const npmMetadata = parseJson(npmVerify, 'npm verification');
  const expectedRegistrySha1 = npmExistedAtStart ? publishedSha1 : localSha1;
  if (npmMetadata.version !== options.tag || npmMetadata['dist.shasum'] !== expectedRegistrySha1) {
    fail('npm verification returned a version or checksum mismatch.');
  }
  for (const distTag of DIST_TAGS) {
    if (npmMetadata['dist-tags']?.[distTag] !== options.tag) {
      fail(`npm dist-tag ${distTag} does not point to ${options.tag}.`);
    }
  }

  const releaseVerify = requireSuccess(
    capture('gc', ['release', 'view', options.tag, '-R', GITCODE_REPO, '--json']),
    'Verify GitCode Release',
  );
  validateExistingRelease(parseJson(releaseVerify, 'GitCode release verification'), options.tag, targetCommit);

  info(`Release complete: ${npmSpec}`);
  console.log(`npm:     https://www.npmjs.com/package/${PACKAGE_NAME}/v/${options.tag}`);
  console.log(`GitCode: https://gitcode.com/${GITCODE_REPO}/releases`);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    cleanup();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

try {
  await main();
} catch (error) {
  console.error(`[release] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  cleanup();
}
