import { definePlugin } from '@/lib/sidebar-plugins';

/**
 * 创建 Agent 插件
 *
 * 提供 Agent 创建向导功能，包括 AI 辅助生成 Agent 配置。
 */
export default definePlugin({
  id: 'create-agent',
  name: '创建 Agent',
  version: '1.0.0',
  enabled: true,
  capabilities: ['persistence', 'result-extraction', 'modals'],

  actions: {
    items: [
      {
        id: 'create-agent',
        label: '创建 Agent',
        icon: 'person_add',
        color: 'from-indigo-500 to-indigo-600',
        prompt: '__HOME_ACTION__:create_agent',
        pinned: true,
        category: 'create',
        order: 20,
        guide: {
          title: '先定义职责，再创建 Agent',
          description: 'Agent 需要明确职责边界、风格和输入输出。先在对话里收敛这些内容，再填表单更合适。',
          samplePrompt: '我想创建一个负责【职责】的 Agent，服务于【场景】，请先帮我定义它的职责、风格、能力边界和输入输出。',
          assistantSteps: [
            '先澄清这个 Agent 服务的场景与上游下游。',
            '整理职责、风格、能力边界、工具需求和禁区。',
            '再把这些内容预填到右侧 Agent 表单中。',
          ],
        },
      },
    ],
  },

  tab: {
    id: 'agent',
    label: '创建Agent',
    order: 30,
    render: () => null, // Rendered by HomeCommandSidebar during migration
  },

  stateMachine: {
    initialPhase: 'idle',
    phases: [
      { id: 'idle', label: '空闲', transitions: ['clarifying'] },
      { id: 'clarifying', label: '需求澄清', transitions: ['agent-draft'] },
      { id: 'agent-draft', label: 'Agent 生成', transitions: ['idle'] },
    ],
  },

  intents: [
    { id: 'create-agent', targetTab: 'agent', initialStage: 'clarifying', opensModal: true, description: '打开 Agent 创建向导' },
  ],
});
