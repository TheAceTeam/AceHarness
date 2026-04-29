import { mkdir, readFile, rm, writeFile, rename, chmod, cp, symlink } from 'fs/promises';
import { createWriteStream, existsSync, createReadStream } from 'fs';
import { dirname, join, normalize, resolve } from 'path';
import { pipeline, Readable, Transform } from 'stream';
import { promisify } from 'util';
import { createHash } from 'crypto';
import * as unzipper from 'unzipper';
import tar from 'tar-stream';
import { createGunzip } from 'zlib';
import { parse, stringify } from 'yaml';
import { getWorkspaceDataFile } from '@/lib/app-paths';
import { getRuntimeSdkSettingsPath } from '@/lib/runtime-configs';
import { loadSystemSettings } from '@/lib/system-settings';

const streamPipeline = promisify(pipeline);

const STATE_PATH = getWorkspaceDataFile('cangjie-sdk-state.yaml');
const DATA_ROOT = getWorkspaceDataFile('cangjie');
const CACHE_ROOT = resolve(DATA_ROOT, 'cache');
const STAGING_ROOT = resolve(DATA_ROOT, 'staging');
const INSTALL_ROOT = resolve(DATA_ROOT, 'sdk');

export type SdkChannel = 'nightly' | 'sts' | 'lts';
export type HostOs = 'darwin' | 'linux' | 'win32';
export type HostArch = 'x64' | 'arm64';
export type ArchiveType = 'tar.gz' | 'zip';

interface SdkSourceConfig {
  type: 'gitcode-latest-release' | 'gitcode-release-list';
  owner: string;
  repo: string;
  channels?: SdkChannel[];
}

interface ConfigFileShape {
  sources?: Record<string, SdkSourceConfig>;
}

export interface SdkPackage {
  os: HostOs;
  arch: HostArch;
  url: string;
  archiveType: ArchiveType;
  name: string;
  sha256Url?: string;
}

export interface SdkCatalogEntry {
  version: string;
  releaseName: string;
  tagName: string;
  channel: SdkChannel;
  createdAt?: string;
  packages: SdkPackage[];
}

export interface InstalledSdk {
  version: string;
  channel: SdkChannel;
  os: HostOs;
  arch: HostArch;
  installDir: string;
  status: 'ready' | 'failed';
  installedAt?: string;
  lastError?: string;
}

interface SdkState {
  activeVersion?: string;
  activeChannel?: SdkChannel;
  installs?: InstalledSdk[];
}

export interface EffectiveSdkInfo {
  source: 'managed' | 'none';
  cangjieHome: string | null;
  version?: string;
  channel?: SdkChannel;
  diagnostics: string[];
}

export interface SdkOverview {
  host: { os: HostOs; arch: HostArch };
  gitcodeTokenConfigured: boolean;
  catalog: SdkCatalogEntry[];
  installs: InstalledSdk[];
  active: InstalledSdk | null;
  effective: EffectiveSdkInfo;
}

function getHostOs(): HostOs {
  if (process.platform === 'win32') return 'win32';
  if (process.platform === 'darwin') return 'darwin';
  return 'linux';
}

function getHostArch(): HostArch {
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

function archiveTypeFromName(name: string): ArchiveType | null {
  if (name.endsWith('.tar.gz')) return 'tar.gz';
  if (name.endsWith('.zip')) return 'zip';
  return null;
}

function isBaseSdkAsset(name: string): boolean {
  if (!name.startsWith('cangjie-sdk-')) return false;
  if (name.includes('sanitizer') || name.includes('android') || name.includes('ohos') || name.includes('ios')) return false;
  if (name.endsWith('.sha256') || name.endsWith('.exe')) return false;
  return name.endsWith('.tar.gz') || name.endsWith('.zip');
}

function detectChannel(releaseName: string, tagName: string): SdkChannel | null {
  if (releaseName.startsWith('STS-') || /beta/i.test(tagName)) return 'sts';
  if (releaseName.startsWith('LTS-')) return 'lts';
  return null;
}

function parsePackage(name: string, url: string): SdkPackage | null {
  const archiveType = archiveTypeFromName(name);
  if (!archiveType) return null;
  const match = name.match(/^cangjie-sdk-(mac|linux|windows)-(aarch64|x64)-(.+)\.(tar\.gz|zip)$/);
  if (!match) return null;
  const [, osToken, archToken] = match;
  const os: HostOs = osToken === 'mac' ? 'darwin' : osToken === 'windows' ? 'win32' : 'linux';
  const arch: HostArch = archToken === 'aarch64' ? 'arm64' : 'x64';
  return { os, arch, url, archiveType, name };
}

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`);
  }
  return response.json();
}

async function loadConfig(): Promise<ConfigFileShape> {
  try {
    const content = await readFile(await getRuntimeSdkSettingsPath(), 'utf-8');
    const parsed = parse(content);
    return parsed && typeof parsed === 'object' ? parsed as ConfigFileShape : {};
  } catch {
    return {};
  }
}

async function loadState(): Promise<SdkState> {
  try {
    const content = await readFile(STATE_PATH, 'utf-8');
    const parsed = parse(content);
    return parsed && typeof parsed === 'object' ? parsed as SdkState : {};
  } catch {
    return {};
  }
}

async function saveState(state: SdkState): Promise<void> {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, stringify(state), 'utf-8');
}

function buildInstallDir(version: string, channel: SdkChannel, os: HostOs, arch: HostArch): string {
  return resolve(INSTALL_ROOT, `${channel}-${version}-${os}-${arch}`);
}

async function resolveGitcodeToken(): Promise<string> {
  const settings = await loadSystemSettings();
  const token = settings.gitcodeToken?.trim();
  if (!token) throw new Error('未配置 gitcode_token');
  return token;
}

async function loadNightlyCatalog(source: SdkSourceConfig, token: string): Promise<SdkCatalogEntry[]> {
  const url = `https://api.gitcode.com/api/v5/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/releases/latest?access_token=${encodeURIComponent(token)}`;
  const release = await fetchJson(url);
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const packages = assets
    .map((asset: any) => ({ name: asset?.name || '', url: asset?.browser_download_url || '' }))
    .filter((asset: { name: string }) => isBaseSdkAsset(asset.name))
    .map((asset: { name: string; url: string }) => parsePackage(asset.name, asset.url))
    .filter(Boolean) as SdkPackage[];

  return [{
    version: release?.tag_name || release?.name || 'nightly',
    releaseName: release?.name || release?.tag_name || 'nightly',
    tagName: release?.tag_name || '',
    channel: 'nightly',
    createdAt: release?.created_at,
    packages,
  }];
}

async function loadStableCatalog(source: SdkSourceConfig, token: string): Promise<SdkCatalogEntry[]> {
  const url = `https://api.gitcode.com/api/v5/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/releases?access_token=${encodeURIComponent(token)}&per_page=100`;
  const releases = await fetchJson(url);
  if (!Array.isArray(releases)) return [];

  return releases.map((release: any) => {
    const channel = detectChannel(release?.name || '', release?.tag_name || '');
    if (!channel) return null;
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const packages = assets
      .map((asset: any) => ({ name: asset?.name || '', url: asset?.browser_download_url || '' }))
      .filter((asset: { name: string }) => isBaseSdkAsset(asset.name))
      .map((asset: { name: string; url: string }) => parsePackage(asset.name, asset.url))
      .filter(Boolean) as SdkPackage[];

    return {
      version: release?.tag_name || release?.name || 'unknown',
      releaseName: release?.name || release?.tag_name || 'unknown',
      tagName: release?.tag_name || '',
      channel,
      createdAt: release?.created_at,
      packages,
    } satisfies SdkCatalogEntry;
  }).filter(Boolean) as SdkCatalogEntry[];
}

export async function loadSdkCatalog(): Promise<SdkCatalogEntry[]> {
  const config = await loadConfig();
  const token = await resolveGitcodeToken();
  const entries: SdkCatalogEntry[] = [];
  for (const source of Object.values(config.sources || {})) {
    if (!source) continue;
    if (source.type === 'gitcode-latest-release') {
      entries.push(...await loadNightlyCatalog(source, token));
    } else if (source.type === 'gitcode-release-list') {
      entries.push(...await loadStableCatalog(source, token));
    }
  }
  return entries.sort((a, b) => `${a.channel}:${b.createdAt || ''}`.localeCompare(`${b.channel}:${a.createdAt || ''}`));
}

export async function getEffectiveManagedCangjieHome(): Promise<EffectiveSdkInfo> {
  const state = await loadState();
  const installs = state.installs || [];
  const active = installs.find(item => item.version === state.activeVersion && item.channel === state.activeChannel);
  if (!active) {
    return { source: 'none', cangjieHome: null, diagnostics: ['未激活任何托管 SDK'] };
  }
  if (active.status !== 'ready' || !existsSync(active.installDir)) {
    return { source: 'none', cangjieHome: null, diagnostics: ['激活的托管 SDK 不可用'] };
  }
  return {
    source: 'managed',
    cangjieHome: active.installDir,
    version: active.version,
    channel: active.channel,
    diagnostics: [],
  };
}

export async function getSdkOverview(): Promise<SdkOverview> {
  const settings = await loadSystemSettings();
  const state = await loadState();
  let catalog: SdkCatalogEntry[] = [];
  try {
    catalog = await loadSdkCatalog();
  } catch {
    catalog = [];
  }
  const active = (state.installs || []).find(item => item.version === state.activeVersion && item.channel === state.activeChannel) || null;
  return {
    host: { os: getHostOs(), arch: getHostArch() },
    gitcodeTokenConfigured: Boolean(settings.gitcodeToken),
    catalog,
    installs: state.installs || [],
    active,
    effective: await getEffectiveManagedCangjieHome(),
  };
}

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

async function verifyArchiveSha256(filePath: string, sha256Url?: string) {
  if (!sha256Url) return;
  const response = await fetch(sha256Url);
  if (!response.ok) return;
  const text = (await response.text()).trim();
  const expected = text.split(/\s+/)[0];
  if (!expected) return;
  const buffer = await readFile(filePath);
  const actual = createHash('sha256').update(buffer).digest('hex');
  if (actual !== expected) {
    throw new Error('SDK 压缩包 sha256 校验失败');
  }
}

function safeJoin(base: string, target: string): string {
  const normalized = normalize(target).replace(/^([/\\])+/, '');
  const finalPath = resolve(base, normalized);
  if (!finalPath.startsWith(base)) {
    throw new Error('压缩包包含非法路径');
  }
  return finalPath;
}

async function extractZip(archivePath: string, targetDir: string) {
  const isWindows = process.platform === 'win32';
  const directory = await unzipper.Open.file(archivePath);
  for (const entry of directory.files) {
    const destination = safeJoin(targetDir, entry.path);
    if (entry.type === 'Directory') {
      await mkdir(destination, { recursive: true });
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    await streamPipeline(entry.stream(), createWriteStream(destination));
    if (!isWindows) {
      const unixMode = entry.externalFileAttributes ? (entry.externalFileAttributes >>> 16) & 0o777 : 0;
      if (unixMode) await chmod(destination, unixMode);
    }
  }
}

async function extractTarGz(archivePath: string, targetDir: string) {
  const isWindows = process.platform === 'win32';
  await new Promise<void>((resolvePromise, rejectPromise) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) rejectPromise(error);
      else resolvePromise();
    };

    const extract = tar.extract();
    extract.on('entry', async (header: { name: string; type: string; mode?: number; linkname?: string }, stream: NodeJS.ReadableStream, next: () => void) => {
      try {
        const destination = safeJoin(targetDir, header.name);
        if (header.type === 'directory') {
          await mkdir(destination, { recursive: true });
          stream.resume();
          next();
          return;
        }
        if (header.type === 'symlink' || header.type === 'link') {
          stream.resume();
          if (header.linkname) {
            await mkdir(dirname(destination), { recursive: true });
            await symlink(header.linkname, destination).catch(() => {});
          }
          next();
          return;
        }
        await mkdir(dirname(destination), { recursive: true });
        await streamPipeline(stream, createWriteStream(destination));
        if (!isWindows && header.mode) {
          await chmod(destination, header.mode & 0o777);
        }
        next();
      } catch (error) {
        finish(error);
      }
    });
    extract.on('finish', () => finish());
    extract.on('error', finish);

    const source = createReadStream(archivePath);
    source.on('error', finish);
    const gunzip = createGunzip();
    gunzip.on('error', finish);
    source.pipe(gunzip).pipe(extract);
  });
}

async function ensureExecutable(filePath: string) {
  if (process.platform === 'win32') return;
  if (!existsSync(filePath)) return;
  await chmod(filePath, 0o755);
}

async function finalizeSdkLayout(sdkRoot: string): Promise<string> {
  if (process.platform === 'win32') return sdkRoot;
  const binDir = join(sdkRoot, 'bin');
  const toolsBinDir = join(sdkRoot, 'tools', 'bin');
  const cjpmSource = join(toolsBinDir, 'cjpm');
  const cjpmTarget = join(binDir, 'cjpm');

  if (existsSync(cjpmSource) && !existsSync(cjpmTarget)) {
    await cp(cjpmSource, cjpmTarget);
  }

  await ensureExecutable(join(binDir, 'cjc'));
  await ensureExecutable(join(binDir, 'cjc-frontend'));
  await ensureExecutable(join(binDir, 'cjpm'));

  return sdkRoot;
}

async function findSdkRoot(dir: string): Promise<string> {
  const candidates = [dir, join(dir, 'cangjie'), join(dir, 'sdk')];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const hasBin = existsSync(join(candidate, 'bin'));
    const hasEnvSetup = process.platform === 'win32' || existsSync(join(candidate, 'envsetup.sh'));
    if (hasBin && hasEnvSetup) return candidate;
  }
  throw new Error('未找到有效的 Cangjie SDK 根目录');
}

async function safeReplaceDir(src: string, dest: string): Promise<void> {
  const destExists = existsSync(dest);
  const tempDest = `${dest}.__old_${Date.now()}`;

  if (destExists) {
    await rename(dest, tempDest);
  }
  try {
    await rename(src, dest);
  } catch (error) {
    if (destExists) {
      await rename(tempDest, dest).catch(() => {});
    }
    throw error;
  }
  if (destExists) {
    rm(tempDest, { recursive: true, force: true }).catch(() => {});
  }
}

export type InstallProgressCallback = (event: { phase: 'download'; downloaded: number; total: number } | { phase: 'extract' | 'finalize' }) => void;

async function downloadToFile(url: string, destinationPath: string, extraHeaders?: Record<string, string>, onProgress?: InstallProgressCallback): Promise<void> {
  const response = await fetch(url, { headers: extraHeaders });
  if (!response.ok || !response.body) {
    throw new Error(`下载 SDK 失败: ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
  }
  const total = Number(response.headers.get('content-length') || '0');
  let downloaded = 0;
  const progressTransform = new Transform({
    transform(chunk, _encoding, callback) {
      downloaded += chunk.length;
      onProgress?.({ phase: 'download', downloaded, total });
      callback(null, chunk);
    },
  });
  await streamPipeline(Readable.fromWeb(response.body as any), progressTransform, createWriteStream(destinationPath));
}

export async function installSdk(version: string, channel: SdkChannel, onProgress?: InstallProgressCallback): Promise<InstalledSdk> {
  const overview = await getSdkOverview();
  const entry = overview.catalog.find((item: SdkCatalogEntry) => item.version === version && item.channel === channel);
  if (!entry) throw new Error('未找到指定 SDK 版本');
  const hostOs = getHostOs();
  const hostArch = getHostArch();
  const pkg = entry.packages.find((item: SdkPackage) => item.os === hostOs && item.arch === hostArch);
  if (!pkg) throw new Error('当前服务器平台没有对应安装包');

  await ensureDir(CACHE_ROOT);
  await ensureDir(STAGING_ROOT);
  await ensureDir(INSTALL_ROOT);

  const archivePath = resolve(CACHE_ROOT, pkg.name);
  const token = await resolveGitcodeToken();
  const downloadHeaders = pkg.url.includes('gitcode.com')
    ? { Authorization: `Bearer ${token}` }
    : undefined;
  await downloadToFile(pkg.url, archivePath, downloadHeaders, onProgress);

  onProgress?.({ phase: 'extract' });
  const stagingDir = resolve(STAGING_ROOT, `${channel}-${version}-${Date.now()}`);
  await ensureDir(stagingDir);
  if (pkg.archiveType === 'zip') await extractZip(archivePath, stagingDir);
  else await extractTarGz(archivePath, stagingDir);

  onProgress?.({ phase: 'finalize' });
  const sdkRoot = await finalizeSdkLayout(await findSdkRoot(stagingDir));
  const finalDir = buildInstallDir(version, channel, hostOs, hostArch);
  await mkdir(dirname(finalDir), { recursive: true });
  await safeReplaceDir(sdkRoot, finalDir);
  await rm(stagingDir, { recursive: true, force: true });
  await rm(archivePath, { force: true }).catch(() => {});

  const state = await loadState();
  const install: InstalledSdk = {
    version,
    channel,
    os: hostOs,
    arch: hostArch,
    installDir: finalDir,
    status: 'ready',
    installedAt: new Date().toISOString(),
  };
  const installs = (state.installs || []).filter(item => !(item.version === version && item.channel === channel && item.os === hostOs && item.arch === hostArch));
  installs.push(install);
  await saveState({ ...state, installs });
  return install;
}

export async function activateSdk(version: string, channel: SdkChannel): Promise<void> {
  const state = await loadState();
  const install = (state.installs || []).find(item => item.version === version && item.channel === channel && item.os === getHostOs() && item.arch === getHostArch());
  if (!install || install.status !== 'ready') {
    throw new Error('指定 SDK 尚未安装');
  }
  await saveState({ ...state, activeVersion: version, activeChannel: channel });
}

export async function deactivateSdk(): Promise<void> {
  const state = await loadState();
  const { activeVersion: _, activeChannel: __, ...rest } = state;
  await saveState(rest);
}

export async function removeSdk(version: string, channel: SdkChannel): Promise<void> {
  const state = await loadState();
  if (state.activeVersion === version && state.activeChannel === channel) {
    throw new Error('不能删除当前激活的 SDK');
  }
  const target = (state.installs || []).find(item => item.version === version && item.channel === channel && item.os === getHostOs() && item.arch === getHostArch());
  if (target?.installDir) {
    await rm(target.installDir, { recursive: true, force: true });
  }
  await saveState({
    ...state,
    installs: (state.installs || []).filter(item => !(item.version === version && item.channel === channel && item.os === getHostOs() && item.arch === getHostArch())),
  });
}
