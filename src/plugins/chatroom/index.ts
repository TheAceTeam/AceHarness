import { definePlugin } from '@/lib/sidebar-plugins';
import { registerIntentHandler } from '@/lib/sidebar-plugins/intent-handlers';
import { createInitialChatroomState } from './types';

const CHATROOM_HOST_NAME = 'AI 百灵鸟';

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
    title: 'Agent 剧场',
    sessionWorkbenchState: {
      homeSidebar: {
        type: 'home_sidebar',
        mode: 'active',
        activeTab: 'chatroom',
        tabs: ['chatroom'],
        intent: 'supervisor-chat',
        stage: 'running',
        reason: '启动 Agent 剧场，让多个 Agent 围绕同一议题进行结构化讨论。',
        summary: 'Agent 剧场已创建。先配置成员、议题和协作模式，再通过主输入框发起讨论。',
        recommendedNextAction: '先配置参与成员和议题，然后用主输入框发送 AI 百灵鸟的第一轮消息。',
      },
      collaborationRoom: {
        topic: 'Agent 剧场',
        selectedAgents: [],
        mode: 'roundtable',
        messages: [],
        rounds: [],
        agentSessions: {},
        chatroom: createInitialChatroomState({
          topic: 'Agent 剧场',
        }),
      },
    },
    messages: [
      { role: 'user', content: '创建 Agent 剧场', timestamp: now },
      {
        role: 'assistant',
        content: `已创建 Agent 剧场。先配置参与成员和讨论议题。\n\n@用户，请直接回复你的开场要求，我会代你控场并驱动多 Agent 讨论。\n\n支持的操作：\n- @全员 让所有成员回复\n- @成员名 指定特定成员回复\n- 切换议题、发起投票、自动收束总结`,
        timestamp: now + 1,
        cards: [{
          type: 'collaboration_speech',
          speakerName: CHATROOM_HOST_NAME,
          speakerType: 'supervisor',
          actionLabel: '开场',
        }],
      },
    ],
  });
  ctx.setActiveSessionId(sessionId);
  if (ctx.setHomeSidebarTab) ctx.setHomeSidebarTab('chatroom');
  if (ctx.setHomeSidebarMode) ctx.setHomeSidebarMode('active');
  ctx.toast('success', '已创建 Agent 剧场');
});
export default definePlugin({
  id: 'chatroom',
  name: 'Agent 剧场',
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
        label: 'Agent 剧场',
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
    label: '剧场',
    order: 15,
    availableWhen: (ctx) => ctx.hasCollaboration,
    render: () => null, // Will be rendered by PluginHost for external plugins
  },

  intents: [
    { id: 'chatroom', targetTab: 'chatroom', initialStage: 'running', description: '创建 Agent 剧场' },
  ],
});
