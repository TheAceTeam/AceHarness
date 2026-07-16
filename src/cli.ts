import { existsSync, readFileSync } from 'fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { totalmem } from 'os';
import { spawn, ChildProcess } from 'child_process';
import { commandExists } from '@/lib/core/command-exists';
import {
  ACE_PACKAGE_NAME,
  DEFAULT_UPDATE_TARGET,
  buildNpmPackageSpec,
  fetchNpmPackageVersion,
  installNpmPackageGlobally,
  normalizeUpdateTarget,
  resolveNpmCommand,
} from '@/lib/core/self-update';
import { resolveBinary as resolveMagicCliBinary } from './lib/engines/magic-cli-wrapper';
import { isMacOS, isWindows } from '@/lib/core/runtime-platform';
import { parse, stringify } from 'yaml';
import { getModelOptions } from '@/lib/core/models';
import { ACPEngine } from './lib/engines/acp-engine';
import { isCursorAgentCommandAvailable, resolveCursorAgentCommand } from './lib/engines/cursor-wrapper';
import {
  getWorkspaceDirectory,
  getEngineConfigPath,
  getWorkspaceNotebookRoot,
  getWorkspaceDataDir,
  getRepoRoot,
  getWorkspaceDataFile,
} from '@/lib/core/app-paths';
import { assertSafeRuntimeTargets, ensureRuntimeHomeInitialized } from '@/lib/core/runtime-home';
import { SERVICE_STATE_DIR_NAME } from '@/lib/core/product-identity';

process.chdir(getRepoRoot());

type Locale = 'zh' | 'en';
type EngineType = 'claude-code' | 'kiro-cli' | 'codex' | 'cursor' | 'opencode' | 'nga' | 'codegenie' | 'trae-cli' | 'magic-cli';

interface ConfiguredEngine {
  engine?: EngineType;
  defaultModel?: string;
}

interface SystemSettings {
  gitcodeToken?: string;
  host?: string;
  port?: number;
  lanAccess?: boolean;
  locale?: Locale;
  runInBackground?: boolean;
  useDaemon?: boolean;
}

interface AceServiceState {
  serviceId: string;
  daemonPid: number | null;
  serverPid: number | null;
  host: string;
  port: number;
  url: string;
  mode: 'foreground' | 'background' | 'daemon';
  startedAt: string;
  updatedAt: string;
  installRoot: string;
}

interface PromptChoice<T extends string | number | boolean> {
  title: string;
  value: T;
}

interface PromptBase<T extends string> {
  type: T;
  name: string;
  message: string;
  initial?: unknown;
}

type PromptQuestion =
  | (PromptBase<'text'> & { validate?: (value: string) => true | string })
  | (PromptBase<'password'> & { validate?: (value: string) => true | string })
  | (PromptBase<'number'> & { min?: number; max?: number })
  | (PromptBase<'toggle'> & { active: string; inactive: string })
  | (PromptBase<'select'> & { choices: Array<PromptChoice<any>> });

interface CliMessages {
  setupCancelled: string;
  welcome: string;
  statusLabel: string;
  runtimeHome: string;
  localeStatus: (value: string) => string;
  engineStatus: (value: string) => string;
  adminStatus: (configured: boolean) => string;
  resetRequiresForce: string;
  resetDone: string;
  resetTarget: string;
  usage: string;
  unknownCommand: (command: string) => string;
  unknownOption: (option: string) => string;
  languagePrompt: string;
  languageChoices: Array<{ title: string; value: Locale }>;
  detectEngines: string;
  chooseEngine: string;
  chooseModel: string;
  noEnginesDetected: string;
  createAdmin: string;
  adminUsername: string;
  adminEmail: string;
  adminPassword: string;
  securityQuestion: string;
  securityAnswer: string;
  usernameRequired: string;
  validEmailRequired: string;
  passwordTooShort: string;
  securityQuestionRequired: string;
  securityAnswerRequired: string;
  defaultSecurityQuestion: string;
  portPrompt: string;
  lanAccessPrompt: string;
  backgroundPrompt: string;
  daemonPrompt: string;
  serviceEmpty: string;
  serviceHeader: string;
  serviceStopped: string;
  serviceStopping: string;
  serviceStopTimeout: string;
  serviceStopFailed: (message: string) => string;
  serviceSelectPrompt: string;
  serviceActionPrompt: string;
  serviceActionBack: string;
  serviceActionStop: string;
  serviceActionExit: string;
  serviceStatusRunning: string;
  serviceStatusStopped: string;
  serviceModeForeground: string;
  serviceModeBackground: string;
  serviceModeDaemon: string;
  serviceEntry: (state: AceServiceState, modeLabel: string, status: string) => string;
  updateChecking: (spec: string) => string;
  updateCurrentVersion: (version: string) => string;
  updateTargetVersion: (target: string, version: string) => string;
  updateAlreadyCurrent: string;
  updateDryRun: (spec: string) => string;
  updateRunningHeader: string;
  updateRunningPrompt: string;
  updateRunningStop: string;
  updateRunningContinue: string;
  updateRunningCancel: string;
  updateRunningBlocked: string;
  updateContinuingWithRunning: string;
  updateStoppingServices: string;
  updateStoppedServices: string;
  updateStopFailed: string;
  updateInstalling: (spec: string) => string;
  updateDone: (version: string) => string;
  updateRestartNeeded: string;
  updateFailed: (message: string) => string;
  yes: string;
  no: string;
  skip: string;
  openBrowserFallback: (url: string) => string;
  startingServer: (url: string) => string;
  failedToStart: (message: string) => string;
}

const SYSTEM_SETTINGS_PATH = getWorkspaceDataFile('system-settings.yaml');
const USERS_FILE = getWorkspaceDataFile('users.json');
const TOKENS_FILE = getWorkspaceDataFile('tokens.json');
const ADMIN_FILE = getWorkspaceDataFile('admin.json');
const NOTEBOOK_SHARES_FILE = getWorkspaceDataFile('notebook-shares.json');
const SERVICE_STATE_DIR = getWorkspaceDataFile(SERVICE_STATE_DIR_NAME);

async function ensureRuntimeHome(): Promise<void> {
  await ensureRuntimeHomeInitialized();
  await Promise.all([
    mkdir(getWorkspaceDirectory('workspace'), { recursive: true }),
    mkdir(getWorkspaceDirectory('config'), { recursive: true }),
    mkdir(getWorkspaceDirectory('data'), { recursive: true }),
    mkdir(getWorkspaceDirectory('cache'), { recursive: true }),
    mkdir(getWorkspaceDirectory('logs'), { recursive: true }),
  ]);
}

const ENGINE_META: Array<{ id: EngineType; name: string }> = [
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'kiro-cli', name: 'Kiro CLI' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'nga', name: 'NGA' },
  { id: 'codegenie', name: 'CodeGenie' },
  { id: 'cursor', name: 'Cursor CLI' },
  { id: 'trae-cli', name: 'Trae CLI' },
  { id: 'magic-cli', name: 'Magic CLI' },
];

const CLI_MESSAGES: Record<Locale, CliMessages> = {
  zh: {
    setupCancelled: '初始化已取消',
    welcome: '[ACE] 本地配置检查',
    statusLabel: '[ACE] 当前状态',
    runtimeHome: '系统数据保存目录',
    localeStatus: (value: string) => `语言: ${value}`,
    engineStatus: (value: string) => `默认引擎: ${value}`,
    adminStatus: (configured: boolean) => `管理员: ${configured ? '已配置' : '未配置'}`,
    resetRequiresForce: '[ACE] 请使用 `ace reset --force` 确认重置本地 ACE 配置。',
    resetDone: '[ACE] 重置完成。下次运行 `ace` 时会重新初始化。',
    resetTarget: '[ACE] 已清理',
    usage: [
      '用法:',
      '  ace              启动 ACEHarness',
      '  ace start        启动 ACEHarness',
      '  ace service      查看并停止 ACE 进程',
      '  ace update [tag|version] 从 npm 更新 ACEHarness',
      '  ace reset --force 重置本地 ACE 配置',
      '  ace --help       查看帮助',
    ].join('\n'),
    unknownCommand: (command: string) => `[ACE] 无效命令：${command}`,
    unknownOption: (option: string) => `[ACE] 无效选项：${option}`,
    languagePrompt: '请选择语言',
    languageChoices: [
      { title: '中文', value: 'zh' },
      { title: 'English', value: 'en' },
    ],
    detectEngines: '现在检测可用引擎吗？',
    chooseEngine: '选择默认引擎',
    chooseModel: '选择默认模型',
    noEnginesDetected: '[ACE] 未检测到受支持的引擎，将使用当前/默认引擎。',
    createAdmin: '现在创建管理员账号吗？',
    adminUsername: '管理员用户名',
    adminEmail: '管理员邮箱',
    adminPassword: '管理员密码',
    securityQuestion: '安全问题',
    securityAnswer: '安全答案',
    usernameRequired: '用户名不能为空',
    validEmailRequired: '请输入有效邮箱',
    passwordTooShort: '至少 6 个字符',
    securityQuestionRequired: '安全问题不能为空',
    securityAnswerRequired: '安全答案不能为空',
    defaultSecurityQuestion: '你的团队名称是什么？',
    portPrompt: '使用的端口',
    lanAccessPrompt: '启用局域网访问吗？',
    backgroundPrompt: '启动后是否转入后台运行？',
    daemonPrompt: '后台运行时是否启用进程守护与异常自动重启？',
    serviceEmpty: '[ACE] 当前没有受管的 ACE 进程。',
    serviceHeader: '[ACE] 当前 ACE 进程：',
    serviceStopped: '[ACE] 已发送停止请求。',
    serviceStopping: '[ACE] 正在停止实例...',
    serviceStopTimeout: '[ACE] 停止请求已发送，但进程尚未退出，请稍后刷新。',
    serviceStopFailed: (message: string) => `[ACE] 停止失败：${message}`,
    serviceSelectPrompt: '选择要管理的 ACE 实例',
    serviceActionPrompt: '选择操作',
    serviceActionBack: '返回',
    serviceActionStop: '停止该实例',
    serviceActionExit: '退出',
    serviceStatusRunning: '运行中',
    serviceStatusStopped: '已停止',
    serviceModeForeground: '前台',
    serviceModeBackground: '后台',
    serviceModeDaemon: '守护',
    serviceEntry: (state: AceServiceState, modeLabel: string, status: string) => `${state.serviceId} | ${state.url} | ${modeLabel} | daemon ${state.daemonPid ?? '-'} | server ${state.serverPid ?? '-'} | ${status}`,
    updateChecking: (spec: string) => `[ACE] 正在检查更新：${spec}`,
    updateCurrentVersion: (version: string) => `[ACE] 当前版本：${version}`,
    updateTargetVersion: (target: string, version: string) => `[ACE] 目标 ${target} 版本：${version}`,
    updateAlreadyCurrent: '[ACE] 当前已经是目标版本。如需重新安装，请使用 `ace update --force`。',
    updateDryRun: (spec: string) => `[ACE] dry-run：将执行 npm install -g ${spec}`,
    updateRunningHeader: '[ACE] 检测到运行中的 ACE 实例：',
    updateRunningPrompt: '升级前如何处理这些运行中的实例？',
    updateRunningStop: '停止后升级',
    updateRunningContinue: '继续升级但不停止',
    updateRunningCancel: '取消升级',
    updateRunningBlocked: '[ACE] 检测到运行中的 ACE 实例。非交互模式请使用 `--stop-running` 停止后升级，或使用 `--force` 继续升级但不停止。',
    updateContinuingWithRunning: '[ACE] 将在 ACE 实例仍运行时继续升级；这些实例需要重启后才会使用新版本。',
    updateStoppingServices: '[ACE] 正在停止运行中的 ACE 实例...',
    updateStoppedServices: '[ACE] 运行中的 ACE 实例已停止。',
    updateStopFailed: '[ACE] 部分 ACE 实例未能停止，请先运行 `ace service` 手动处理。',
    updateInstalling: (spec: string) => `[ACE] 正在安装：${spec}`,
    updateDone: (version: string) => `[ACE] 更新完成：${version}`,
    updateRestartNeeded: '[ACE] 如需继续使用，请重新运行 `ace` 启动服务。',
    updateFailed: (message: string) => `[ACE] 更新失败：${message}`,
    yes: '是',
    no: '否',
    skip: '跳过',
    openBrowserFallback: (url: string) => `[ACE] 请在浏览器中打开 ${url}`,
    startingServer: (url: string) => `[ACE] 正在启动服务：${url}`,
    failedToStart: (message: string) => `[ACE] 启动失败：${message}`,
  },
  en: {
    setupCancelled: 'Setup cancelled',
    welcome: '[ACE] Local configuration check',
    statusLabel: '[ACE] Current status',
    runtimeHome: 'System data directory',
    localeStatus: (value: string) => `Language: ${value}`,
    engineStatus: (value: string) => `Default engine: ${value}`,
    adminStatus: (configured: boolean) => `Admin: ${configured ? 'configured' : 'missing'}`,
    resetRequiresForce: '[ACE] Re-run with `ace reset --force` to confirm resetting local ACE state.',
    resetDone: '[ACE] Reset complete. The next `ace` run will initialize again.',
    resetTarget: '[ACE] Removed',
    usage: [
      'Usage:',
      '  ace               Start ACEHarness',
      '  ace start         Start ACEHarness',
      '  ace service       Inspect and stop ACE processes',
      '  ace update [tag|version] Update ACEHarness from npm',
      '  ace reset --force Reset local ACE state',
      '  ace --help        Show help',
    ].join('\n'),
    unknownCommand: (command: string) => `[ACE] Unknown command: ${command}`,
    unknownOption: (option: string) => `[ACE] Unknown option: ${option}`,
    languagePrompt: 'Choose your language',
    languageChoices: [
      { title: 'English', value: 'en' },
      { title: '中文', value: 'zh' },
    ],
    detectEngines: 'Detect available engines now?',
    chooseEngine: 'Choose a default engine',
    chooseModel: 'Choose a default model',
    noEnginesDetected: '[ACE] No supported engines were detected. Using the current/default engine.',
    createAdmin: 'Create an admin account now?',
    adminUsername: 'Admin username',
    adminEmail: 'Admin email',
    adminPassword: 'Admin password',
    securityQuestion: 'Security question',
    securityAnswer: 'Security answer',
    usernameRequired: 'Username is required',
    validEmailRequired: 'Enter a valid email',
    passwordTooShort: 'At least 6 characters',
    securityQuestionRequired: 'Security question is required',
    securityAnswerRequired: 'Security answer is required',
    defaultSecurityQuestion: 'What is your team name?',
    portPrompt: 'Port to use',
    lanAccessPrompt: 'Enable LAN access?',
    backgroundPrompt: 'Run the service in the background after startup?',
    daemonPrompt: 'Enable process supervision with automatic restart for the background service?',
    serviceEmpty: '[ACE] No managed ACE process is running.',
    serviceHeader: '[ACE] Current ACE processes:',
    serviceStopped: '[ACE] Stop request sent.',
    serviceStopping: '[ACE] Stopping instance...',
    serviceStopTimeout: '[ACE] Stop request sent, but the process is still exiting. Refresh shortly.',
    serviceStopFailed: (message: string) => `[ACE] Failed to stop service: ${message}`,
    serviceSelectPrompt: 'Choose an ACE instance',
    serviceActionPrompt: 'Choose an action',
    serviceActionBack: 'Back',
    serviceActionStop: 'Stop this instance',
    serviceActionExit: 'Exit',
    serviceStatusRunning: 'running',
    serviceStatusStopped: 'stopped',
    serviceModeForeground: 'foreground',
    serviceModeBackground: 'background',
    serviceModeDaemon: 'daemon',
    serviceEntry: (state: AceServiceState, modeLabel: string, status: string) => `${state.serviceId} | ${state.url} | ${modeLabel} | daemon ${state.daemonPid ?? '-'} | server ${state.serverPid ?? '-'} | ${status}`,
    updateChecking: (spec: string) => `[ACE] Checking update: ${spec}`,
    updateCurrentVersion: (version: string) => `[ACE] Current version: ${version}`,
    updateTargetVersion: (target: string, version: string) => `[ACE] Target ${target} version: ${version}`,
    updateAlreadyCurrent: '[ACE] Already on the target version. Use `ace update --force` to reinstall it.',
    updateDryRun: (spec: string) => `[ACE] dry-run: would run npm install -g ${spec}`,
    updateRunningHeader: '[ACE] Running ACE instances detected:',
    updateRunningPrompt: 'How should these running instances be handled before update?',
    updateRunningStop: 'Stop then update',
    updateRunningContinue: 'Update without stopping',
    updateRunningCancel: 'Cancel update',
    updateRunningBlocked: '[ACE] Running ACE instances detected. In non-interactive mode, use `--stop-running` to stop them before updating, or `--force` to update without stopping.',
    updateContinuingWithRunning: '[ACE] Continuing while ACE instances are still running. Restart them to use the new version.',
    updateStoppingServices: '[ACE] Stopping running ACE instances...',
    updateStoppedServices: '[ACE] Running ACE instances stopped.',
    updateStopFailed: '[ACE] Some ACE instances did not stop. Run `ace service` and handle them manually.',
    updateInstalling: (spec: string) => `[ACE] Installing: ${spec}`,
    updateDone: (version: string) => `[ACE] Update complete: ${version}`,
    updateRestartNeeded: '[ACE] Run `ace` again to start the service.',
    updateFailed: (message: string) => `[ACE] Update failed: ${message}`,
    yes: 'yes',
    no: 'no',
    skip: 'skip',
    openBrowserFallback: (url: string) => `[ACE] Open ${url} in your browser.`,
    startingServer: (url: string) => `[ACE] Starting server on ${url}`,
    failedToStart: (message: string) => `[ACE] Failed to start: ${message}`,
  },
};

function getLocaleMessages(locale: Locale): CliMessages {
  return CLI_MESSAGES[locale];
}

function normalizeLocale(value: unknown): Locale {
  return value === 'en' ? 'en' : 'zh';
}

function formatLocaleLabel(locale?: Locale): string {
  return locale === 'en' ? 'English' : '中文';
}

function formatEngineLabel(engine?: EngineType): string {
  const hit = ENGINE_META.find((item) => item.id === engine);
  return hit?.name || '未设置';
}

function resolveCliLocale(): Locale {
  return normalizeLocale(process.env.ACE_LOCALE || process.env.LANG || process.env.LC_ALL);
}

type CliCommand = '' | 'start' | 'reset' | 'help' | 'servive' | 'service' | 'update' | '__run-server' | '__daemon';

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const help = args.includes('--help') || args.includes('-h');
  const positionals = args.filter((arg) => !arg.startsWith('-'));
  const command = help ? 'help' : (positionals[0] || '');
  const validCommands = new Set<CliCommand>(['', 'start', 'reset', 'help', 'servive', 'service', 'update', '__run-server', '__daemon']);
  const commandIsValid = validCommands.has(command as CliCommand);
  const allowedOptions = command === 'reset'
    ? new Set(['--force', '--help', '-h'])
    : command === 'update'
      ? new Set(['--force', '--yes', '-y', '--dry-run', '--stop-running', '--tag', '--version', '--target', '--help', '-h'])
      : new Set(['--help', '-h', '--service-id', '-V', '--verbose']);
  const unknownOption = args.find((arg) => arg.startsWith('-') && !allowedOptions.has(arg));
  const serviceIdIndex = args.findIndex((arg) => arg === '--service-id');
  const getOptionValue = (names: string[]) => {
    for (const name of names) {
      const index = args.findIndex((arg) => arg === name);
      const value = index >= 0 ? args[index + 1] || '' : '';
      if (value && !value.startsWith('-')) return value;
    }
    return '';
  };
  const updateTarget = getOptionValue(['--target', '--tag', '--version']) || positionals[1] || '';
  return {
    command: command as CliCommand | string,
    force: args.includes('--force'),
    yes: args.includes('--yes') || args.includes('-y'),
    dryRun: args.includes('--dry-run'),
    stopRunning: args.includes('--stop-running'),
    updateTarget,
    verbose: args.includes('-V') || args.includes('--verbose'),
    serviceId: serviceIdIndex >= 0 ? args[serviceIdIndex + 1] || '' : '',
    unknownCommand: commandIsValid ? '' : command,
    unknownOption: unknownOption || '',
  };
}

function printUsage(locale = resolveCliLocale(), stream: NodeJS.WriteStream = process.stdout) {
  stream.write(`${getLocaleMessages(locale).usage}\n`);
}

function getCurrentAcePackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(getRepoRoot(), 'package.json'), 'utf-8')) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : 'unknown';
  } catch {
    return 'unknown';
  }
}

function getServiceStateFile(serviceId: string): string {
  return join(SERVICE_STATE_DIR, `${serviceId}.json`);
}

function getServiceStopFile(serviceId: string): string {
  return join(SERVICE_STATE_DIR, `${serviceId}.stop`);
}

async function resetAceState(force: boolean) {
  const messages = getLocaleMessages(resolveCliLocale());
  if (!force) {
    console.log(messages.resetRequiresForce);
    process.exit(1);
  }

  await ensureRuntimeHome();

  const targets = [
    getEngineConfigPath(),
    SYSTEM_SETTINGS_PATH,
    USERS_FILE,
    TOKENS_FILE,
    ADMIN_FILE,
    NOTEBOOK_SHARES_FILE,
    SERVICE_STATE_DIR,
  ];
  await assertSafeRuntimeTargets(getWorkspaceDirectory('workspace'), targets);

  for (const target of targets) {
    await rm(target, { force: true, recursive: true });
    console.log(`${messages.resetTarget}: ${target}`);
  }

  console.log(messages.resetDone);
}

async function loadConfiguredEngine(): Promise<ConfiguredEngine> {
  if (!existsSync(getEngineConfigPath())) return {};
  try {
    const content = JSON.parse(await readFile(getEngineConfigPath(), 'utf-8'));
    return {
      engine: content.engine as EngineType | undefined,
      defaultModel: typeof content.defaultModel === 'string' ? content.defaultModel : '',
    };
  } catch {
    return {};
  }
}

async function saveConfiguredEngine(engine: EngineType, defaultModel: string) {
  await mkdir(dirname(getEngineConfigPath()), { recursive: true });
  await writeFile(
    getEngineConfigPath(),
    JSON.stringify({ engine, defaultModel, updatedAt: new Date().toISOString() }, null, 2),
    'utf-8'
  );
}

async function loadSystemSettings(): Promise<SystemSettings> {
  try {
    const content = await readFile(SYSTEM_SETTINGS_PATH, 'utf-8');
    const parsed = parse(content);
    return parsed && typeof parsed === 'object' ? parsed as SystemSettings : {};
  } catch {
    return {};
  }
}

async function saveSystemSettings(settings: SystemSettings): Promise<void> {
  await mkdir(dirname(SYSTEM_SETTINGS_PATH), { recursive: true });
  await writeFile(SYSTEM_SETTINGS_PATH, stringify(settings), 'utf-8');
}

async function loadServiceState(serviceId: string): Promise<AceServiceState | null> {
  try {
    const raw = await readFile(getServiceStateFile(serviceId), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as AceServiceState;
  } catch {
    return null;
  }
}

async function listServiceStates(): Promise<AceServiceState[]> {
  try {
    const names = await readdir(SERVICE_STATE_DIR);
    const states = await Promise.all(names
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        try {
          const raw = await readFile(join(SERVICE_STATE_DIR, name), 'utf-8');
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? parsed as AceServiceState : null;
        } catch {
          return null;
        }
      }));
    return states.filter(Boolean) as AceServiceState[];
  } catch {
    return [];
  }
}

async function saveServiceState(state: AceServiceState): Promise<void> {
  await mkdir(SERVICE_STATE_DIR, { recursive: true });
  await writeFile(getServiceStateFile(state.serviceId), JSON.stringify(state, null, 2), 'utf-8');
}

async function clearServiceState(serviceId: string): Promise<void> {
  await rm(getServiceStateFile(serviceId), { force: true });
  await rm(getServiceStopFile(serviceId), { force: true });
}

function isPidRunning(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function serviceUrlFromSettings(settings: SystemSettings): string {
  const host = settings.host || (settings.lanAccess ? '0.0.0.0' : '127.0.0.1');
  const port = settings.port || 3000;
  const urlHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  return `http://${urlHost}:${port}`;
}

function buildServiceState(
  serviceId: string,
  settings: SystemSettings,
  mode: AceServiceState['mode'],
  daemonPid: number | null,
  serverPid: number | null,
): AceServiceState {
  const host = settings.host || (settings.lanAccess ? '0.0.0.0' : '127.0.0.1');
  const port = settings.port || 3000;
  const now = new Date().toISOString();
  return {
    serviceId,
    daemonPid,
    serverPid,
    host,
    port,
    url: serviceUrlFromSettings(settings),
    mode,
    startedAt: now,
    updatedAt: now,
    installRoot: getRepoRoot(),
  };
}

async function updateServiceState(serviceId: string, patch: Partial<AceServiceState>): Promise<void> {
  const current = await loadServiceState(serviceId);
  if (!current) return;
  await saveServiceState({
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

async function requestServiceStop(serviceId: string): Promise<void> {
  await mkdir(SERVICE_STATE_DIR, { recursive: true });
  await writeFile(getServiceStopFile(serviceId), String(Date.now()), 'utf-8');
}

async function isSetup(): Promise<boolean> {
  if (!existsSync(USERS_FILE)) {
    if (!existsSync(ADMIN_FILE)) return false;
    try {
      const admin = JSON.parse(await readFile(ADMIN_FILE, 'utf-8'));
      return Boolean(admin?.username || admin?.email);
    } catch {
      return false;
    }
  }
  try {
    const users = JSON.parse(await readFile(USERS_FILE, 'utf-8'));
    return Array.isArray(users) && users.some((user) => user?.role === 'admin');
  } catch {
    return false;
  }
}

function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(password + salt).digest('hex');
}

function hashAnswer(answer: string, salt: string): string {
  return createHash('sha256').update(answer.toLowerCase().trim() + salt).digest('hex');
}

async function setupFirstAdmin(data: {
  username: string;
  email: string;
  password: string;
  question: string;
  answer: string;
  personalDir: string;
}) {
  const users = existsSync(USERS_FILE) ? JSON.parse(await readFile(USERS_FILE, 'utf-8')) : [];
  if (Array.isArray(users) && users.length > 0) return;

  const salt = randomBytes(16).toString('hex');
  const user = {
    id: randomUUID(),
    username: data.username,
    email: data.email,
    passwordHash: hashPassword(data.password, salt),
    salt,
    question: data.question,
    answerHash: hashAnswer(data.answer, salt),
    role: 'admin',
    personalDir: data.personalDir,
    createdAt: Date.now(),
  };

  await mkdir(getWorkspaceDataDir(), { recursive: true });
  await writeFile(USERS_FILE, JSON.stringify([user], null, 2), 'utf-8');
}

async function moduleExists(moduleName: string): Promise<boolean> {
  try {
    await import(moduleName);
    return true;
  } catch {
    return false;
  }
}

async function detectEngines() {
  const availability = await Promise.all(ENGINE_META.map(async (engine) => ({
    ...engine,
    available:
      engine.id === 'claude-code' ? await moduleExists('@anthropic-ai/claude-agent-sdk')
        : engine.id === 'codex' ? (await moduleExists('@openai/codex-sdk')) || commandExists('codex')
          : engine.id === 'magic-cli' ? resolveMagicCliBinary() !== null
            : engine.id === 'cursor' ? isCursorAgentCommandAvailable() : commandExists(engine.id),
  })));

  return availability;
}

async function discoverAcpModels(engineType: EngineType): Promise<Array<{ value: string; title: string }>> {
  const commandMap: Partial<Record<EngineType, string>> = {
    opencode: 'opencode',
    // Some distributions expose a separate `ngagent` intended for ACP stdio.
    nga: commandExists('ngagent') ? 'ngagent' : 'nga',
    codegenie: 'codegenie',
    'kiro-cli': 'kiro-cli',
    cursor: resolveCursorAgentCommand(),
    'trae-cli': 'trae-cli',
  };
  const command = commandMap[engineType];
  if (!command) return [];

  const engine = new ACPEngine({
    engineType,
    command,
    workingDirectory: process.cwd(),
  });

  try {
    await engine.start();
    await engine.createSession();
    const models = await engine.getAvailableModels();
    return models.map((item) => ({
      value: item.modelId,
      title: item.name || item.modelId,
    }));
  } finally {
    engine.stop();
  }
}

async function getEngineModelChoices(engineType: EngineType): Promise<Array<{ value: string; title: string }>> {
  if (['opencode', 'nga', 'codegenie', 'kiro-cli', 'cursor', 'trae-cli'].includes(engineType)) {
    return discoverAcpModels(engineType);
  }

  const models = await getModelOptions();
  return models
    .filter((model) => !model.engines || model.engines.length === 0 || model.engines.includes(engineType))
    .map((model) => ({
      value: model.value,
      title: `${model.label} (${model.costMultiplier}x)`,
    }));
}

type PromptFn = (questions: PromptQuestion | PromptQuestion[], options?: { onCancel?: () => void }) => Promise<Record<string, any>>;

async function loadPrompts(): Promise<PromptFn | null> {
  try {
    const mod = require('prompts');
    return mod.default || mod;
  } catch {
    return null;
  }
}

async function fallbackPrompt(questions: PromptQuestion | PromptQuestion[], options?: { onCancel?: () => void }) {
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (message: string) => new Promise<string>((resolve) => rl.question(message, resolve));
  const list = Array.isArray(questions) ? questions : [questions];
  const answers: Record<string, any> = {};

  try {
    for (const question of list) {
      if (question.type === 'select') {
        console.log(question.message);
        question.choices.forEach((choice, index) => {
          console.log(`  ${index + 1}. ${choice.title}`);
        });
        const input = (await ask(`> [${Number(question.initial || 0) + 1}]: `)).trim();
        const index = input ? Number(input) - 1 : Number(question.initial || 0);
        answers[question.name] = question.choices[Math.max(0, Math.min(question.choices.length - 1, index))]?.value;
        continue;
      }

      if (question.type === 'toggle') {
        const initial = question.initial ? question.active : question.inactive;
        const input = (await ask(`${question.message} (${question.active}/${question.inactive}) [${initial}]: `)).trim().toLowerCase();
        answers[question.name] = input
          ? input === question.active.toLowerCase() || input === 'y' || input === 'yes' || input === '1' || input === 'true'
          : Boolean(question.initial);
        continue;
      }

      const suffix = question.initial !== undefined ? ` [${String(question.initial)}]` : '';
      const raw = await ask(`${question.message}${suffix}: `);
      const value = raw === '' && question.initial !== undefined ? question.initial : raw;

      if (value === '\u0003') {
        options?.onCancel?.();
      }

      if (question.type === 'number') {
        answers[question.name] = Number(value);
        continue;
      }

      if ((question.type === 'text' || question.type === 'password') && question.validate) {
        const validation = question.validate(String(value));
        if (validation !== true) {
          console.log(validation);
          const retry = await fallbackPrompt(question, options);
          answers[question.name] = retry[question.name];
          continue;
        }
      }

      answers[question.name] = value;
    }
  } finally {
    rl.close();
  }

  return answers;
}

async function prompt(questions: PromptQuestion | PromptQuestion[], options?: { onCancel?: () => void }) {
  const promptsImpl = await loadPrompts();
  if (promptsImpl) {
    return promptsImpl(questions as any, options);
  }
  return fallbackPrompt(questions, options);
}

function getPromptOptions(locale: Locale) {
  return {
    onCancel: () => {
      throw new Error(getLocaleMessages(locale).setupCancelled);
    },
  };
}

async function promptForLocale(initialLocale: Locale): Promise<Locale> {
  const messages = getLocaleMessages(initialLocale);
  const answer = await prompt({
    type: 'select',
    name: 'value',
    message: messages.languagePrompt,
    choices: messages.languageChoices,
    initial: messages.languageChoices.findIndex((choice) => choice.value === initialLocale),
  }, getPromptOptions(initialLocale));

  return normalizeLocale(answer.value);
}

function buildAdminPrompts(messages: CliMessages): PromptQuestion[] {
  return [
    {
      type: 'text',
      name: 'username',
      message: messages.adminUsername,
      initial: 'admin',
      validate: (value: string) => value.trim() ? true : messages.usernameRequired,
    },
    {
      type: 'text',
      name: 'email',
      message: messages.adminEmail,
      validate: (value: string) => value.includes('@') ? true : messages.validEmailRequired,
    },
    {
      type: 'password',
      name: 'password',
      message: messages.adminPassword,
      validate: (value: string) => value.length >= 6 ? true : messages.passwordTooShort,
    },
    {
      type: 'text',
      name: 'question',
      message: messages.securityQuestion,
      initial: messages.defaultSecurityQuestion,
      validate: (value: string) => value.trim() ? true : messages.securityQuestionRequired,
    },
    {
      type: 'text',
      name: 'answer',
      message: messages.securityAnswer,
      validate: (value: string) => value.trim() ? true : messages.securityAnswerRequired,
    },
  ];
}

async function promptForNetworkSettings(settings: SystemSettings, locale: Locale): Promise<SystemSettings> {
  const messages = getLocaleMessages(locale);
  const networkForm = await prompt([
    {
      type: 'number',
      name: 'port',
      message: messages.portPrompt,
      initial: settings.port || 3000,
      min: 1,
      max: 65535,
    },
    {
      type: 'toggle',
      name: 'lanAccess',
      message: messages.lanAccessPrompt,
      initial: Boolean(settings.lanAccess),
      active: messages.yes,
      inactive: messages.no,
    },
    {
      type: 'toggle',
      name: 'runInBackground',
      message: messages.backgroundPrompt,
      initial: Boolean(settings.runInBackground),
      active: messages.yes,
      inactive: messages.no,
    },
    {
      type: 'toggle',
      name: 'useDaemon',
      message: messages.daemonPrompt,
      initial: settings.useDaemon !== false,
      active: messages.yes,
      inactive: messages.no,
    },
  ], getPromptOptions(locale));

  const lanAccess = Boolean(networkForm.lanAccess);
  const runInBackground = Boolean(networkForm.runInBackground);
  const useDaemon = Boolean(networkForm.useDaemon);
  return {
    ...settings,
    locale,
    port: Number(networkForm.port || settings.port || 3000),
    lanAccess,
    runInBackground,
    useDaemon,
    host: lanAccess ? '0.0.0.0' : '127.0.0.1',
  };
}

async function runFirstLaunchWizard() {
  const settings = await loadSystemSettings();
  const configuredEngine = await loadConfiguredEngine();
  const adminExists = await isSetup();

  const initialLocale = normalizeLocale(settings.locale);
  const locale = settings.locale ? initialLocale : await promptForLocale(initialLocale);
  const messages = getLocaleMessages(locale);

  console.log(messages.welcome);
  console.log(messages.statusLabel);
  console.log(`  ${messages.runtimeHome}: ${getWorkspaceDirectory('workspace')}`);
  console.log(`  ${messages.localeStatus(formatLocaleLabel(settings.locale ? initialLocale : undefined))}`);
  console.log(`  ${messages.engineStatus(configuredEngine.engine ? formatEngineLabel(configuredEngine.engine) : '未设置')}`);
  console.log(`  ${messages.adminStatus(adminExists)}`);

  let selectedEngine = configuredEngine.engine;
  if (!selectedEngine) {
    const shouldDetectEnginesAnswer = await prompt({
      type: 'toggle',
      name: 'value',
      message: messages.detectEngines,
      initial: true,
      active: messages.yes,
      inactive: messages.skip,
    }, getPromptOptions(locale));

    const shouldDetectEngines = Boolean(shouldDetectEnginesAnswer.value);
    const detected = shouldDetectEngines ? await detectEngines() : [];
    const availableChoices = detected.filter((item) => item.available);

    if (shouldDetectEngines) {
      if (availableChoices.length > 0) {
        const engineAnswer = await prompt({
          type: 'select',
          name: 'value',
          message: messages.chooseEngine,
          choices: availableChoices.map((item) => ({ title: item.name, value: item.id })),
          initial: Math.max(availableChoices.findIndex((item) => item.id === selectedEngine), 0),
        }, getPromptOptions(locale));

        if (engineAnswer.value) {
          selectedEngine = engineAnswer.value as EngineType;
        }
      } else {
        console.log(messages.noEnginesDetected);
        const engineAnswer = await prompt({
          type: 'select',
          name: 'value',
          message: messages.chooseEngine,
          choices: ENGINE_META.map((item) => ({ title: item.name, value: item.id })),
          initial: 0,
        }, getPromptOptions(locale));
        selectedEngine = engineAnswer.value as EngineType;
      }
    } else {
      const engineAnswer = await prompt({
        type: 'select',
        name: 'value',
        message: messages.chooseEngine,
        choices: ENGINE_META.map((item) => ({ title: item.name, value: item.id })),
        initial: 0,
      }, getPromptOptions(locale));
      selectedEngine = engineAnswer.value as EngineType;
    }
  }

  if (!selectedEngine) {
    throw new Error('默认引擎未配置');
  }

  let selectedModel = configuredEngine.defaultModel || '';
  if (!selectedModel) {
    const modelChoices = await getEngineModelChoices(selectedEngine);
    if (modelChoices.length === 0) {
      throw new Error(`未发现可用于 ${formatEngineLabel(selectedEngine)} 的模型`);
    }
    const modelAnswer = await prompt({
      type: 'select',
      name: 'value',
      message: messages.chooseModel,
      choices: modelChoices,
      initial: Math.max(modelChoices.findIndex((item) => item.value === selectedModel), 0),
    }, getPromptOptions(locale));
    selectedModel = modelAnswer.value as string;
  }

  if (!adminExists) {
    const adminAnswer = await prompt({
      type: 'toggle',
      name: 'value',
      message: messages.createAdmin,
      initial: false,
      active: messages.yes,
      inactive: messages.skip,
    }, getPromptOptions(locale));

    if (adminAnswer.value) {
      const adminForm = await prompt(buildAdminPrompts(messages), getPromptOptions(locale));

      await setupFirstAdmin({
        username: String(adminForm.username).trim(),
        email: String(adminForm.email).trim(),
        password: String(adminForm.password),
        question: String(adminForm.question).trim(),
        answer: String(adminForm.answer).trim(),
        personalDir: '',
      });
    }
  }

  await saveConfiguredEngine(selectedEngine, selectedModel);

  await saveSystemSettings({
    ...settings,
    locale,
  });
}

async function syncBrowserLocale(settings: SystemSettings) {
  if (!settings.locale) return;
  process.env.ACE_LOCALE = settings.locale;
}

function tryOpenBrowser(url: string): boolean {
  const resolveWindowsCmd = () => {
    const roots = [process.env.SystemRoot, process.env.windir, 'C:\\Windows']
      .map((item) => item?.trim())
      .filter(Boolean) as string[];
    const candidates = [
      process.env.ComSpec?.trim(),
      ...roots.flatMap((root) => [join(root, 'System32', 'cmd.exe'), join(root, 'Sysnative', 'cmd.exe')]),
      'C:\\Windows\\System32\\cmd.exe',
      'cmd.exe',
    ].filter(Boolean) as string[];
    return candidates.find((candidate) => candidate.toLowerCase().endsWith('cmd.exe') && existsSync(candidate)) || candidates[0];
  };

  const commands: Array<[string, string[]]> = isMacOS()
    ? [['open', [url]]]
    : isWindows()
      ? [[resolveWindowsCmd(), ['/c', 'start', '', url]]]
      : [['xdg-open', [url]]];

  for (const [command, args] of commands) {
    if (!isWindows() && !commandExists(command)) {
      continue;
    }

    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => {
        // ignore launcher failures and fall back to printing the URL
      });
      child.unref();
      return true;
    } catch {
      // ignore and fall through
    }
  }

  return false;
}

function buildChildEnv(settings: SystemSettings): NodeJS.ProcessEnv {
  const host = settings.host || (settings.lanAccess ? '0.0.0.0' : '127.0.0.1');
  const port = String(settings.port || 3000);
  return {
    ...process.env,
    ACE_HOST: host,
    ACE_PORT: port,
    PORT: port,
    NODE_ENV: process.env.NODE_ENV || 'production',
    ACE_LOCALE: settings.locale || resolveCliLocale(),
  };
}

function formatServiceMode(locale: Locale, mode: AceServiceState['mode']): string {
  const messages = getLocaleMessages(locale);
  if (mode === 'daemon') return messages.serviceModeDaemon;
  if (mode === 'background') return messages.serviceModeBackground;
  return messages.serviceModeForeground;
}

function isServiceRunning(state: AceServiceState): boolean {
  return isPidRunning(state.daemonPid) || isPidRunning(state.serverPid);
}

async function listLiveServiceStates(): Promise<AceServiceState[]> {
  const states = await listServiceStates();
  const liveStates: AceServiceState[] = [];
  for (const state of states) {
    if (isServiceRunning(state)) {
      liveStates.push(state);
    } else {
      await clearServiceState(state.serviceId);
    }
  }
  return liveStates;
}

function getServiceTargetPids(state: AceServiceState): number[] {
  const seen = new Set<number>();
  const pids = [state.daemonPid, state.serverPid]
    .filter((pid): pid is number => typeof pid === 'number' && pid > 0)
    .filter((pid) => {
      if (seen.has(pid)) return false;
      seen.add(pid);
      return true;
    });
  return pids;
}

async function terminatePidTree(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): Promise<void> {
  if (!pid || pid <= 0) return;

  if (isWindows()) {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => {
        try { process.kill(pid, signal); } catch {}
        resolve();
      });
      killer.once('exit', () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, signal);
  } catch {}
}

async function stopServiceProcesses(state: AceServiceState): Promise<void> {
  const pids = getServiceTargetPids(state);
  if (pids.length === 0) return;

  for (const pid of pids) {
    await terminatePidTree(pid, 'SIGTERM');
  }

  if (isWindows()) return;

  await new Promise((resolve) => setTimeout(resolve, 1200));

  for (const pid of pids) {
    if (isPidRunning(pid)) {
      await terminatePidTree(pid, 'SIGKILL');
    }
  }
}

async function waitForServiceStop(state: AceServiceState, timeoutMs = 4000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const daemonRunning = isPidRunning(state.daemonPid);
    const serverRunning = isPidRunning(state.serverPid);
    if (!daemonRunning && !serverRunning) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return !isPidRunning(state.daemonPid) && !isPidRunning(state.serverPid);
}

function printServiceStates(locale: Locale, states: AceServiceState[]): void {
  const messages = getLocaleMessages(locale);
  for (const state of states) {
    const status = isServiceRunning(state) ? messages.serviceStatusRunning : messages.serviceStatusStopped;
    console.log(`  ${messages.serviceEntry(state, formatServiceMode(locale, state.mode), status)}`);
  }
}

async function stopLiveServicesForUpdate(states: AceServiceState[], locale: Locale): Promise<void> {
  const messages = getLocaleMessages(locale);
  console.log(messages.updateStoppingServices);
  let allStopped = true;

  for (const state of states) {
    await requestServiceStop(state.serviceId);
    await stopServiceProcesses(state);
    const stopped = await waitForServiceStop(state, isWindows() ? 7000 : 5000);
    if (stopped) {
      await clearServiceState(state.serviceId);
    } else {
      allStopped = false;
    }
  }

  if (!allStopped) {
    throw new Error(messages.updateStopFailed);
  }
  console.log(messages.updateStoppedServices);
}

async function handleRunningServicesBeforeUpdate(
  states: AceServiceState[],
  locale: Locale,
  options: { force: boolean; yes: boolean; stopRunning: boolean; dryRun: boolean },
): Promise<void> {
  if (states.length === 0) return;
  const messages = getLocaleMessages(locale);

  console.log(messages.updateRunningHeader);
  printServiceStates(locale, states);

  if (options.dryRun) return;
  if (options.stopRunning) {
    await stopLiveServicesForUpdate(states, locale);
    return;
  }
  if (options.force) {
    console.log(messages.updateContinuingWithRunning);
    return;
  }
  if (options.yes || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(messages.updateRunningBlocked);
  }

  const answer = await prompt({
    type: 'select',
    name: 'action',
    message: messages.updateRunningPrompt,
    choices: [
      { title: messages.updateRunningStop, value: 'stop' },
      { title: messages.updateRunningContinue, value: 'continue' },
      { title: messages.updateRunningCancel, value: 'cancel' },
    ],
    initial: 0,
  }, getPromptOptions(locale));

  if (answer.action === 'stop') {
    await stopLiveServicesForUpdate(states, locale);
    return;
  }
  if (answer.action === 'continue') {
    console.log(messages.updateContinuingWithRunning);
    return;
  }

  throw new Error(messages.updateRunningCancel);
}

async function updateCommand(
  locale: Locale,
  options: { updateTarget: string; force: boolean; yes: boolean; dryRun: boolean; stopRunning: boolean },
): Promise<void> {
  const messages = getLocaleMessages(locale);
  const target = normalizeUpdateTarget(options.updateTarget || DEFAULT_UPDATE_TARGET);
  const npmCommand = resolveNpmCommand(process.env.ACE_UPDATE_NPM_COMMAND);
  const packageSpec = buildNpmPackageSpec(ACE_PACKAGE_NAME, target);
  const currentVersion = getCurrentAcePackageVersion();

  console.log(messages.updateChecking(packageSpec));
  const targetVersion = await fetchNpmPackageVersion({
    packageName: ACE_PACKAGE_NAME,
    target,
    npmCommand,
  });

  console.log(messages.updateCurrentVersion(currentVersion));
  console.log(messages.updateTargetVersion(target, targetVersion));

  if (currentVersion !== 'unknown' && targetVersion === currentVersion && !options.force) {
    console.log(messages.updateAlreadyCurrent);
    return;
  }

  const liveStates = await listLiveServiceStates();
  await handleRunningServicesBeforeUpdate(liveStates, locale, options);

  if (options.dryRun) {
    console.log(messages.updateDryRun(packageSpec));
    return;
  }

  console.log(messages.updateInstalling(packageSpec));
  await installNpmPackageGlobally({
    packageName: ACE_PACKAGE_NAME,
    target,
    npmCommand,
  });
  console.log(messages.updateDone(targetVersion));
  if (liveStates.length > 0 && (options.stopRunning || !options.force)) {
    console.log(messages.updateRestartNeeded);
  }
}

const DEFAULT_SERVER_HEAP_MB = 4096;
const MAX_SERVER_HEAP_MB = 8192;

// The long-running Next.js server holds the workflow state machine, collab docs
// and streamed agent output in a single V8 heap. Node's default old-space cap
// (~4 GB on 64-bit) is easy to hit, which surfaces as a `JavaScript heap out of
// memory` crash (typically while UTF-8 decoding a large streamed chunk). Size the
// cap from physical RAM so the server gets headroom on capable machines without
// over-committing on small ones.
function resolveServerHeapMB(): number {
  const override = Number(process.env.ACE_MAX_OLD_SPACE_MB);
  if (Number.isFinite(override) && override >= 1024) {
    return Math.floor(override);
  }
  const totalMB = Math.floor(totalmem() / (1024 * 1024));
  const target = Math.floor(totalMB * 0.6);
  return Math.min(MAX_SERVER_HEAP_MB, Math.max(DEFAULT_SERVER_HEAP_MB, target));
}

function buildServerNodeArgs(): string[] {
  // Respect an explicit --max-old-space-size the operator already set.
  if ((process.env.NODE_OPTIONS || '').includes('--max-old-space-size')) {
    return [];
  }
  return [`--max-old-space-size=${resolveServerHeapMB()}`];
}

function spawnCliProcess(args: string[], env: NodeJS.ProcessEnv, detached: boolean): ChildProcess {
  return spawn(process.execPath, [...buildServerNodeArgs(), __filename, ...args], {
    cwd: getRepoRoot(),
    env,
    detached,
    stdio: detached ? 'ignore' : 'inherit',
    windowsHide: true,
  });
}

async function startServerProcess(settings: SystemSettings, serviceId: string): Promise<void> {
  await syncBrowserLocale(settings);
  Object.assign(process.env, buildChildEnv(settings));
  const messages = getLocaleMessages(normalizeLocale(settings.locale));
  const url = serviceUrlFromSettings(settings);
  const state = buildServiceState(serviceId, settings, 'foreground', null, process.pid);
  await saveServiceState(state);
  const cleanup = () => {
    void clearServiceState(serviceId);
  };
  process.once('SIGTERM', cleanup);
  process.once('SIGINT', cleanup);
  process.once('exit', cleanup);
  setTimeout(() => {
    if (!tryOpenBrowser(url)) {
      console.log(messages.openBrowserFallback(url));
    }
  }, 1200);
  console.log(messages.startingServer(url));
  console.log(`[ACE] ${messages.runtimeHome}: ${getWorkspaceDirectory('workspace')}`);
  require('../server.js');
}

async function runManagedServerChild(serviceId: string): Promise<void> {
  const settings = await loadSystemSettings();
  const env = buildChildEnv(settings);
  Object.assign(process.env, env);
  await updateServiceState(serviceId, { serverPid: process.pid });
  const cleanup = () => {
    void (async () => {
      const current = await loadServiceState(serviceId);
      if (!current) return;
      if (current.daemonPid && current.daemonPid !== process.pid) {
        await updateServiceState(serviceId, { serverPid: null });
        return;
      }
      await clearServiceState(serviceId);
    })();
  };
  process.once('SIGTERM', cleanup);
  process.once('SIGINT', cleanup);
  process.once('exit', cleanup);
  require('../server.js');
}

async function runDaemonSupervisor(serviceId: string): Promise<void> {
  const settings = await loadSystemSettings();
  const env = buildChildEnv(settings);
  // Mark the server child as supervised so its memory watchdog is allowed to
  // self-restart (this loop will respawn it). Unmanaged runs only warn.
  env.ACE_MANAGED = '1';
  let shuttingDown = false;
  let child: ChildProcess | null = null;

  const stopChild = () => {
    if (!child || child.exitCode !== null || child.killed) return;
    try {
      child.kill('SIGTERM');
    } catch {}
  };

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopChild();
    await clearServiceState(serviceId);
    process.exit(0);
  };

  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  process.once('exit', () => { stopChild(); });

  while (!shuttingDown) {
    child = spawnCliProcess(['__run-server', '--service-id', serviceId], env, false);
    await updateServiceState(serviceId, { daemonPid: process.pid, serverPid: child.pid ?? null, mode: 'daemon' });

    const exitInfo = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child!.once('exit', (code, signal) => resolve({ code, signal }));
      child!.once('error', () => resolve({ code: 1, signal: null }));
    });

    child = null;
    if (shuttingDown || existsSync(getServiceStopFile(serviceId))) {
      await shutdown();
      return;
    }
    await updateServiceState(serviceId, { serverPid: null });
    if (exitInfo.code === 0) {
      await clearServiceState(serviceId);
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
}

async function startManagedBackground(settings: SystemSettings): Promise<void> {
  const locale = normalizeLocale(settings.locale);
  const messages = getLocaleMessages(locale);
  const serviceId = randomUUID().slice(0, 8);
  const env = buildChildEnv(settings);
  const mode = settings.useDaemon === false ? 'background' : 'daemon';
  const child = spawnCliProcess([mode === 'daemon' ? '__daemon' : '__run-server', '--service-id', serviceId], env, true);
  child.unref();

  const state = buildServiceState(serviceId, settings, mode, mode === 'daemon' ? (child.pid ?? null) : null, mode === 'background' ? (child.pid ?? null) : null);
  await saveServiceState(state);
  console.log(messages.startingServer(state.url));
  console.log(`[ACE] ${messages.runtimeHome}: ${getWorkspaceDirectory('workspace')}`);
}

async function serviceCommand(locale: Locale): Promise<void> {
  const messages = getLocaleMessages(locale);
  while (true) {
    const liveStates = await listLiveServiceStates();

    if (liveStates.length === 0) {
      console.log(messages.serviceEmpty);
      return;
    }

    console.log(messages.serviceHeader);
    for (const state of liveStates) {
      const status = isServiceRunning(state) ? messages.serviceStatusRunning : messages.serviceStatusStopped;
      console.log(`  ${messages.serviceEntry(state, formatServiceMode(locale, state.mode), status)}`);
    }

    const selected = await prompt({
      type: 'select',
      name: 'serviceId',
      message: messages.serviceSelectPrompt,
      choices: [
        ...liveStates.map((state) => ({
          title: messages.serviceEntry(state, formatServiceMode(locale, state.mode), messages.serviceStatusRunning),
          value: state.serviceId,
        })),
        { title: messages.serviceActionExit, value: '' },
      ],
      initial: 0,
    }, getPromptOptions(locale));

    if (!selected.serviceId) return;

    const answer = await prompt({
      type: 'select',
      name: 'action',
      message: messages.serviceActionPrompt,
      choices: [
        { title: messages.serviceActionStop, value: 'stop' },
        { title: messages.serviceActionBack, value: 'back' },
        { title: messages.serviceActionExit, value: 'exit' },
      ],
      initial: 0,
    }, getPromptOptions(locale));

    if (answer.action === 'exit') return;
    if (answer.action !== 'stop') continue;

    const state = liveStates.find((item) => item.serviceId === selected.serviceId);
    if (!state) continue;

    try {
      await requestServiceStop(state.serviceId);
      console.log(messages.serviceStopping);
      await stopServiceProcesses(state);
      const stopped = await waitForServiceStop(state, isWindows() ? 7000 : 5000);
      if (stopped) {
        await clearServiceState(state.serviceId);
        console.log(messages.serviceStopped);
      } else {
        console.log(messages.serviceStopTimeout);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(messages.serviceStopFailed(message));
    }
  }
}

async function start(interactive: boolean) {
  await ensureRuntimeHome();

  const settings = await loadSystemSettings();
  const configuredEngine = await loadConfiguredEngine();
  const adminExists = await isSetup();
  if (!settings.locale || !configuredEngine.engine || !configuredEngine.defaultModel || !adminExists) {
    await runFirstLaunchWizard();
  }

  const nextSettings = await loadSystemSettings();
  const locale = normalizeLocale(nextSettings.locale);
  const resolvedSettings = interactive ? await promptForNetworkSettings(nextSettings, locale) : nextSettings;
  if (interactive) {
    await saveSystemSettings({
      ...resolvedSettings,
    });
  }

  if (resolvedSettings.runInBackground) {
    await startManagedBackground(resolvedSettings);
    return;
  }

  await startServerProcess(resolvedSettings, randomUUID().slice(0, 8));
}

async function main() {
  const { command, force, yes, dryRun, stopRunning, updateTarget, serviceId, unknownCommand, unknownOption } = parseArgs(process.argv);
  const locale = resolveCliLocale();
  const messages = getLocaleMessages(locale);

  if (command === 'help') {
    printUsage(locale);
    return;
  }
  if (unknownCommand) {
    console.error(messages.unknownCommand(unknownCommand));
    printUsage(locale, process.stderr);
    process.exit(1);
  }
  if (unknownOption) {
    console.error(messages.unknownOption(unknownOption));
    printUsage(locale, process.stderr);
    process.exit(1);
  }
  if (command === 'reset') {
    await resetAceState(force);
    return;
  }
  if (command === 'servive' || command === 'service') {
    await serviceCommand(locale);
    return;
  }
  if (command === 'update') {
    try {
      await updateCommand(locale, { updateTarget, force, yes, dryRun, stopRunning });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message.startsWith('[ACE]') ? message : messages.updateFailed(message));
      process.exit(1);
    }
    return;
  }
  if (command === '__run-server') {
    await runManagedServerChild(serviceId || randomUUID().slice(0, 8));
    return;
  }
  if (command === '__daemon') {
    await runDaemonSupervisor(serviceId || randomUUID().slice(0, 8));
    return;
  }

  await start(true);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const locale = resolveCliLocale();
  console.error(getLocaleMessages(locale).failedToStart(message));
  process.exit(1);
});
