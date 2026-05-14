import { definePlugin } from '@/lib/sidebar-plugins';
import { registerIntentHandler } from '@/lib/sidebar-plugins/intent-handlers';

/**
 * 聊天室插件
 *
 * 多 Agent 自由讨论模式。用户选择多个 Agent 创建聊天室，
 * 发起话题进行多轮对话，支持切换话题、发起投票、@指定 Agent。
 */

// Register intent handler at module load time
registerIntentHandler('chatroom', (ctx) => {
  const now = Date.now();
  const sessionId = ctx.createSession({
    title: '多Agent聊天室',
    sessionWorkbenchState: {
      homeSidebar: {
        type: 'home_sidebar',
        mode: 'active',
        activeTab: 'chatroom',
        tabs: ['chatroom'],
        intent: 'supervisor-chat',
        stage: 'running',
        reason: '启动多Agent聊天室，多个 Agent 围绕话题自由讨论。',
        summary: '多Agent聊天室已创建。在右侧选择参与 Agent 和话题后开始讨论。',
        recommendedNextAction: '在右侧聊天室面板选择 Agent 并输入话题。',
      },
      collaborationRoom: {
        topic: '多Agent聊天室',
        selectedAgents: [],
        mode: 'roundtable',
        messages: [],
        rounds: [],
        agentSessions: {},
      },
    },
    messages: [
      { role: 'user', content: '启动多Agent聊天室', timestamp: now },
      { role: 'assistant', content: '已创建多Agent聊天室。在右侧面板选择参与的 Agent，输入讨论话题后开始。\n\n支持的操作：\n- @全体 让所有 Agent 回复\n- @Agent名 指定特定 Agent 回复\n- 侧边栏可切换话题和发起投票', timestamp: now + 1 },
    ],
  });
  ctx.setActiveSessionId(sessionId);
  if (ctx.setHomeSidebarTab) ctx.setHomeSidebarTab('chatroom');
  if (ctx.setHomeSidebarMode) ctx.setHomeSidebarMode('active');
  ctx.toast('success', '已创建多Agent聊天室');
});
export default definePlugin({
  id: 'chatroom',
  name: '多Agent聊天室',
  version: '1.0.0',
  enabled: true,
  capabilities: ['agent-calling', 'result-extraction', 'persistence', 'streaming-display'],

  actions: {
    categories: [
      { id: 'lab', title: '多Agent能力实验室', icon: 'groups', order: 40 },
    ],
    items: [
      {
        id: 'chatroom',
        label: 'Agent 聊天室',
        icon: 'forum',
        color: 'from-sky-600 via-indigo-600 to-violet-600',
        prompt: '__HOME_ACTION__:chatroom',
        category: 'lab',
        order: 20,
      },
    ],
  },

  tab: {
    id: 'chatroom',
    label: '聊天室',
    order: 15,
    availableWhen: (ctx) => ctx.hasCollaboration,
    render: () => null, // Will be rendered by PluginHost for external plugins
  },

  intents: [
    { id: 'chatroom', targetTab: 'commander', initialStage: 'running', description: '创建多 Agent 聊天室' },
  ],
});
