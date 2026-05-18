import { definePlugin } from '@/lib/sidebar-plugins';

/**
 * AI 狼人杀插件
 *
 * 多 Agent 回合制身份推理测试，包含完整的游戏状态机、
 * 角色行为、投票计算、断点恢复和主题系统。
 */
export default definePlugin({
  id: 'werewolf-lab',
  name: 'AI 狼人杀',
  version: '1.0.0',
  enabled: true,
  capabilities: [
    'agent-calling',
    'result-extraction',
    'breakpoint-resume',
    'roundtable',
    'persistence',
    'streaming-display',
    'theme',
    'animations',
    'modals',
  ],

  actions: {
    categories: [
      { id: 'lab', title: '多Agent能力实验室', icon: 'groups', order: 40 },
    ],
    items: [
      {
        id: 'werewolf-lab',
        label: 'AI 狼人杀',
        icon: 'psychology_alt',
        color: 'from-slate-700 via-fuchsia-700 to-rose-600',
        prompt: '__HOME_ACTION__:werewolf_lab',
        category: 'lab',
        order: 10,
      },
    ],
  },

  tab: {
    id: 'commander',
    label: '指挥官',
    order: 10,
    availableWhen: (ctx) => ctx.werewolfMode || ctx.hasCollaboration,
    render: () => null, // Rendered by HomeCommandSidebar during migration
  },

  theme: {
    id: 'werewolf-wood',
    classes: {
      panel: 'werewolf-wood-panel border-l-stone-700/60',
      header: 'border-stone-700/60 bg-black/5',
      section: 'werewolf-wood-frame',
      card: 'werewolf-parchment',
      badge: 'werewolf-copper-badge',
      button: 'werewolf-gold-button',
      ghostButton: 'werewolf-ghost-button',
    },
    activeWhen: (ctx) => ctx.werewolfMode,
  },

  stateMachine: {
    initialPhase: 'setup',
    phases: [
      { id: 'setup', label: '配置', transitions: ['night'] },
      { id: 'night', label: '黑夜', transitions: ['day', 'last-words', 'ended'] },
      { id: 'day', label: '白天', transitions: ['voting', 'last-words'] },
      { id: 'voting', label: '投票', transitions: ['night', 'last-words', 'ended'] },
      { id: 'last-words', label: '遗言', transitions: ['night', 'day', 'ended'] },
      { id: 'ended', label: '结束', transitions: ['setup'] },
    ],
  },

  breakpoint: {
    handlers: ['night', 'sheriff-election', 'day-speech', 'last-words', 'vote'],
  },

  intents: [
    { id: 'supervisor-chat', targetTab: 'commander', initialStage: 'running', description: '进入狼人杀 Supervisor 模式' },
  ],
});
