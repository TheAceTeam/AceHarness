import { definePlugin } from '@/lib/sidebar-plugins/types';
import { registerIntentHandler } from '@/lib/sidebar-plugins/intent-handlers';

type ToastFn = (type: 'success' | 'error' | 'warning' | 'info', msg: string) => void;

type CodespecRunOptions = {
  title: string;
  args: string[];
  successMessage: string;
  refreshReason: string;
  input?: {
    title: string;
    description: string;
    label: string;
    placeholder: string;
    validationPattern: string;
    validationMessage: string;
  };
};

function runCodespecCommand(ctx: {
  workingDirectory?: string;
  toast?: ToastFn;
}, options: CodespecRunOptions) {
  const workspace = typeof ctx.workingDirectory === 'string' ? ctx.workingDirectory.trim() : '';
  const toast = ctx.toast || (() => {});

  if (!workspace) {
    toast('warning', '请先选择当前工作目录');
    return;
  }

  if (typeof window === 'undefined') {
    toast('error', '当前环境无法打开 CLI 执行窗口');
    return;
  }

  if (typeof (ctx as { stopStreaming?: () => void }).stopStreaming === 'function') {
    (ctx as { stopStreaming?: () => void }).stopStreaming?.();
  }

  window.dispatchEvent(new CustomEvent('ace:cli-run', {
    detail: {
      commandName: 'codespec',
      args: options.args,
      title: options.title,
      workingDirectory: workspace,
      successMessage: options.successMessage,
      refreshSlashCommandsOnSuccess: {
        reason: options.refreshReason,
        workingDirectory: workspace,
      },
      input: options.input,
    },
  }));
}

registerIntentHandler('codespec:init', (ctx) => {
  runCodespecCommand(ctx, {
    title: 'CodeSpec 初始化',
    args: ['init'],
    successMessage: 'CodeSpec 初始化完成',
    refreshReason: 'codespec:init',
  });
});
registerIntentHandler('codespec:sync', (ctx) => {
  runCodespecCommand(ctx, {
    title: 'CodeSpec 同步',
    args: ['sync'],
    successMessage: 'CodeSpec 同步完成',
    refreshReason: 'codespec:sync',
  });
});
registerIntentHandler('codespec:sync-generate', (ctx) => {
  runCodespecCommand(ctx, {
    title: '生成 CodeWiki',
    args: ['sync', '--generate'],
    successMessage: 'CodeWiki 文档生成完成',
    refreshReason: 'codespec:sync-generate',
  });
});
registerIntentHandler('codespec:start', (ctx) => {
  runCodespecCommand(ctx, {
    title: 'CodeSpec 创建 AR',
    args: ['start'],
    successMessage: 'CodeSpec AR 创建完成',
    refreshReason: 'codespec:start',
    input: {
      title: '创建 AR',
      description: '输入要传给 codespec start 的 AR 编号。',
      label: 'AR 编号',
      placeholder: 'AR-feature-xxx',
      validationPattern: '^AR-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',
      validationMessage: '请输入 AR-feature-xxx 形式的编号，只能包含字母、数字、点、下划线和连字符。',
    },
  });
});

export default definePlugin({
  id: 'codespec',
  name: 'CodeSpec',
  version: '1.0.0',
  enabled: false,
  capabilities: [],

  actions: {
    categories: [
      { id: 'codespec', title: 'CodeSpec', icon: 'rule', order: 25 },
    ],
    items: [
      {
        id: 'codespec-init',
        label: 'CodeSpec 初始化',
        icon: 'rule',
        color: 'from-emerald-600 to-teal-600',
        prompt: '__HOME_ACTION__:codespec:init',
        pinned: false,
        category: 'codespec',
        order: 5,
      },
      {
        id: 'codespec-sync',
        label: 'CodeSpec 同步',
        icon: 'sync',
        color: 'from-sky-600 to-indigo-600',
        prompt: '__HOME_ACTION__:codespec:sync',
        pinned: false,
        category: 'codespec',
        order: 6,
      },
      {
        id: 'codespec-sync-generate',
        label: '生成 CodeWiki',
        icon: 'auto_stories',
        color: 'from-amber-600 to-orange-600',
        prompt: '__HOME_ACTION__:codespec:sync-generate',
        pinned: false,
        category: 'codespec',
        order: 7,
      },
      {
        id: 'codespec-start',
        label: 'CodeSpec 创建 AR',
        icon: 'play_circle',
        color: 'from-fuchsia-600 to-rose-600',
        prompt: '__HOME_ACTION__:codespec:start',
        pinned: false,
        category: 'codespec',
        order: 8,
      },
    ],
  },

  intents: [
    { id: 'codespec:init', targetTab: 'home', description: '在当前工作目录执行 codespec init' },
    { id: 'codespec:sync', targetTab: 'home', description: '在当前工作目录执行 codespec sync，同步并匹配本地 CodeWiki 仓库' },
    { id: 'codespec:sync-generate', targetTab: 'home', description: '在当前工作目录执行 codespec sync --generate，生成 CodeWiki 文档' },
    { id: 'codespec:start', targetTab: 'home', description: '在当前工作目录执行 codespec start <AR 编号>' },
  ],
});
