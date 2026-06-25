import { definePlugin } from '@/lib/sidebar-plugins/types';
import { registerIntentHandler } from '@/lib/sidebar-plugins/intent-handlers';

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function dispatchSlashCommandsRefresh(reason: string, workingDirectory: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('ace:slash-commands-refresh', {
    detail: { reason, workingDirectory },
  }));
}

async function runCodespecInit(ctx: {
  workingDirectory?: string;
  toast?: (type: 'success' | 'error' | 'warning' | 'info', msg: string) => void;
}) {
  const workspace = typeof ctx.workingDirectory === 'string' ? ctx.workingDirectory.trim() : '';
  const toast = ctx.toast || (() => {});

  if (!workspace) {
    toast('warning', '请先选择当前工作目录');
    return;
  }

  toast('info', '正在执行 codespec init...');

  try {
    const response = await fetch('/api/codespec/init', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ workspace }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || data?.message || `codespec init 失败（HTTP ${response.status}）`);
    }
    toast('success', 'CodeSpec 初始化完成');
    dispatchSlashCommandsRefresh('codespec:init', workspace);
  } catch (error: any) {
    toast('error', error?.message || 'CodeSpec 初始化失败');
  }
}

async function runCodespecSync(ctx: {
  workingDirectory?: string;
  toast?: (type: 'success' | 'error' | 'warning' | 'info', msg: string) => void;
}, options?: { generate?: boolean }) {
  const workspace = typeof ctx.workingDirectory === 'string' ? ctx.workingDirectory.trim() : '';
  const toast = ctx.toast || (() => {});
  const generate = options?.generate === true;
  const label = generate ? 'codespec sync --generate' : 'codespec sync';

  if (!workspace) {
    toast('warning', '请先选择当前工作目录');
    return;
  }

  toast('info', `正在执行 ${label}...`);

  try {
    const response = await fetch('/api/codespec/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ workspace, generate }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.success === false) {
      throw new Error(data?.error || data?.message || `${label} 失败（HTTP ${response.status}）`);
    }
    toast('success', generate ? 'CodeWiki 文档生成完成' : 'CodeSpec 同步完成');
    dispatchSlashCommandsRefresh(generate ? 'codespec:sync-generate' : 'codespec:sync', workspace);
  } catch (error: any) {
    toast('error', error?.message || `${label} 失败`);
  }
}

registerIntentHandler('codespec:init', (ctx) => {
  void runCodespecInit(ctx);
});
registerIntentHandler('codespec:sync', (ctx) => {
  void runCodespecSync(ctx);
});
registerIntentHandler('codespec:sync-generate', (ctx) => {
  void runCodespecSync(ctx, { generate: true });
});

export default definePlugin({
  id: 'codespec',
  name: 'CodeSpec',
  version: '1.0.0',
  enabled: false,
  capabilities: [],

  actions: {
    categories: [
      { id: 'create', title: '创建', icon: 'add_circle', order: 20 },
    ],
    items: [
      {
        id: 'codespec-init',
        label: 'CodeSpec 初始化',
        icon: 'rule',
        color: 'from-cyan-600 to-blue-600',
        prompt: '__HOME_ACTION__:codespec:init',
        pinned: true,
        category: 'create',
        order: 5,
      },
      {
        id: 'codespec-sync',
        label: 'CodeSpec 同步',
        icon: 'sync',
        color: 'from-cyan-600 to-blue-600',
        prompt: '__HOME_ACTION__:codespec:sync',
        pinned: true,
        category: 'create',
        order: 6,
      },
      {
        id: 'codespec-sync-generate',
        label: '生成 CodeWiki',
        icon: 'auto_stories',
        color: 'from-cyan-600 to-blue-600',
        prompt: '__HOME_ACTION__:codespec:sync-generate',
        pinned: true,
        category: 'create',
        order: 7,
      },
    ],
  },

  intents: [
    { id: 'codespec:init', targetTab: 'home', description: '在当前工作目录执行 codespec init' },
    { id: 'codespec:sync', targetTab: 'home', description: '在当前工作目录执行 codespec sync，同步并匹配本地 CodeWiki 仓库' },
    { id: 'codespec:sync-generate', targetTab: 'home', description: '在当前工作目录执行 codespec sync --generate，生成 CodeWiki 文档' },
  ],
});
