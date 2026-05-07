import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { dirname } from 'path';
import { spawn } from 'child_process';
import { parse, stringify } from 'yaml';
import { getModelOptions } from './lib/models';
import { ACPEngine } from './lib/engines/acp-engine';
import {
  getWorkspaceDirectory,
  getEngineConfigPath,
  getWorkspaceNotebookRoot,
  getWorkspaceDataDir,
  getRepoRoot,
  getWorkspaceDataFile,
} from './lib/app-paths';

process.chdir(getRepoRoot());

type Locale = 'zh' | 'en';
type EngineType = 'claude-code' | 'kiro-cli' | 'codex' | 'cursor' | 'cangjie-magic' | 'opencode' | 'nga' | 'codegenie' | 'trae-cli';

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

const ENGINE_META: Array<{ id: EngineType; name: string }> = [
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'kiro-cli', name: 'Kiro CLI' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'nga', name: 'NGA' },
  { id: 'codegenie', name: 'CodeGenie' },
  { id: 'cursor', name: 'Cursor CLI' },
  { id: 'cangjie-magic', name: 'CangjieMagic' },
  { id: 'trae-cli', name: 'Trae CLI' },
];

const CLI_MESSAGES: Record<Locale, CliMessages> = {
  zh: {
    setupCancelled: '初始化已取消',
    welcome: '[ACE] 本地配置检查',
    statusLabel: '[ACE] 当前状态',
    runtimeHome: '运行目录',
    localeStatus: (value: string) => `语言: ${value}`,
    engineStatus: (value: string) => `默认引擎: ${value}`,
    adminStatus: (configured: boolean) => `管理员: ${configured ? '已配置' : '未配置'}`,
    resetRequiresForce: '[ACE] 请使用 `ace reset --force` 确认重置本地 ACE 配置。',
    resetDone: '[ACE] 重置完成。下次运行 `ace` 时会重新初始化。',
    resetTarget: '[ACE] 已清理',
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
    runtimeHome: 'Runtime home',
    localeStatus: (value: string) => `Language: ${value}`,
    engineStatus: (value: string) => `Default engine: ${value}`,
    adminStatus: (configured: boolean) => `Admin: ${configured ? 'configured' : 'missing'}`,
    resetRequiresForce: '[ACE] Re-run with `ace reset --force` to confirm resetting local ACE state.',
    resetDone: '[ACE] Reset complete. The next `ace` run will initialize again.',
    resetTarget: '[ACE] Removed',
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

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  return {
    command: args[0] || '',
    force: args.includes('--force'),
    verbose: args.includes('-V') || args.includes('--verbose'),
  };
}

async function resetAceState(force: boolean) {
  const messages = getLocaleMessages(resolveCliLocale());
  if (!force) {
    console.log(messages.resetRequiresForce);
    process.exit(1);
  }

  const targets = [
    getEngineConfigPath(),
    SYSTEM_SETTINGS_PATH,
    USERS_FILE,
    TOKENS_FILE,
    ADMIN_FILE,
    NOTEBOOK_SHARES_FILE,
  ];

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

function commandExists(command: string): boolean {
  const envPath = process.env.PATH || '';
  const paths = envPath.split(process.platform === 'win32' ? ';' : ':').filter(Boolean);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];

  for (const dir of paths) {
    for (const ext of exts) {
      const fullPath = `${dir}/${command}${ext}`;
      if (existsSync(fullPath)) {
        return true;
      }
    }
  }

  return false;
}

async function moduleExists(moduleName: string): Promise<boolean> {
  try {
    await import(moduleName);
    return true;
  } catch {
    return false;
  }
}

function isCangjieMagicAvailable(): boolean {
  return Boolean(process.env.CANGJIE_MAGIC_PATH) && commandExists('cjpm');
}

async function detectEngines() {
  const availability = await Promise.all(ENGINE_META.map(async (engine) => ({
    ...engine,
    available:
      engine.id === 'claude-code' ? await moduleExists('@anthropic-ai/claude-agent-sdk')
        : engine.id === 'codex' ? (await moduleExists('@openai/codex-sdk')) || commandExists('codex')
          : engine.id === 'cangjie-magic' ? isCangjieMagicAvailable()
            : commandExists(engine.id === 'cursor' ? 'agent' : engine.id),
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
    cursor: 'agent',
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
  ], getPromptOptions(locale));

  const lanAccess = Boolean(networkForm.lanAccess);
  return {
    ...settings,
    locale,
    port: Number(networkForm.port || settings.port || 3000),
    lanAccess,
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
  console.log(`  ${messages.localeStatus(formatLocaleLabel(settings.locale ? initialLocale : undefined))}`);
  console.log(`  ${messages.engineStatus(configuredEngine.engine ? formatEngineLabel(configuredEngine.engine) : '未设置')}`);
  console.log(`  ${messages.adminStatus(adminExists)}`);
  const { verbose } = parseArgs(process.argv);
  if (verbose) {
    console.log(`[ACE] ${messages.runtimeHome}: ${getWorkspaceDirectory('workspace')}`);
  }

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
  const commands: Array<[string, string[]]> = process.platform === 'darwin'
    ? [['open', [url]]]
    : process.platform === 'win32'
      ? [['cmd', ['/c', 'start', '', url]]]
      : [['xdg-open', [url]]];

  for (const [command, args] of commands) {
    if (!commandExists(command)) {
      continue;
    }

    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
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

async function start() {
  const settings = await loadSystemSettings();
  const configuredEngine = await loadConfiguredEngine();
  const adminExists = await isSetup();
  if (!settings.locale || !configuredEngine.engine || !configuredEngine.defaultModel || !adminExists) {
    await runFirstLaunchWizard();
  }

  const nextSettings = await loadSystemSettings();
  const locale = normalizeLocale(nextSettings.locale);
  const updatedSettings = await promptForNetworkSettings(nextSettings, locale);
  await saveSystemSettings({
    ...updatedSettings,
  });
  const messages = getLocaleMessages(locale);
  await syncBrowserLocale({ ...updatedSettings, locale });

  process.env.ACE_HOST = updatedSettings.host || (updatedSettings.lanAccess ? '0.0.0.0' : '127.0.0.1');
  process.env.ACE_PORT = String(updatedSettings.port || 3000);
  process.env.PORT = process.env.ACE_PORT;
  process.env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'production',
  };

  const urlHost = process.env.ACE_HOST === '0.0.0.0' ? '127.0.0.1' : process.env.ACE_HOST;
  const url = `http://${urlHost}:${process.env.ACE_PORT}`;

  setTimeout(() => {
    if (!tryOpenBrowser(url)) {
      console.log(messages.openBrowserFallback(url));
    }
  }, 1200);

  console.log(messages.startingServer(url));
  require('../server.js');
}

async function main() {
  const { command, force } = parseArgs(process.argv);
  if (command === 'reset') {
    await resetAceState(force);
    return;
  }

  await start();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const locale = resolveCliLocale();
  console.error(getLocaleMessages(locale).failedToStart(message));
  process.exit(1);
});
