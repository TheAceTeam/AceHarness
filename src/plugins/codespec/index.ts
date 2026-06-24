import { definePlugin } from '@/lib/sidebar-plugins/types';
import { registerIntentHandler } from '@/lib/sidebar-plugins/intent-handlers';

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
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
  } catch (error: any) {
    toast('error', error?.message || 'CodeSpec 初始化失败');
  }
}

registerIntentHandler('codespec:init', (ctx) => {
  void runCodespecInit(ctx);
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
    ],
  },

  intents: [
    { id: 'codespec:init', targetTab: 'home', description: '在当前工作目录执行 codespec init' },
  ],
});
