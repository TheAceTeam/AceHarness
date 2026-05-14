import { definePlugin } from '@/lib/sidebar-plugins';

/**
 * 工作流 Supervisor 插件
 *
 * 提供多 Agent 圆桌协作、@mention 驱动对话、工作流运行监控。
 */
export default definePlugin({
  id: 'supervisor',
  name: '工作流 Supervisor',
  version: '1.0.0',
  enabled: true,
  capabilities: ['agent-calling', 'result-extraction', 'roundtable', 'persistence', 'streaming-display', 'animations'],

  tab: {
    id: 'commander',
    label: '指挥官',
    order: 10,
    availableWhen: (ctx) => ctx.hasWorkflow || ctx.hasCollaboration,
    render: () => null, // Rendered by HomeCommandSidebar during migration
  },

  stateMachine: {
    initialPhase: 'idle',
    phases: [
      { id: 'idle', label: '空闲', transitions: ['running'] },
      { id: 'running', label: '运行中', transitions: ['idle'] },
    ],
  },

  intents: [
    { id: 'supervisor-chat', targetTab: 'commander', initialStage: 'running', description: '进入 Supervisor 多 Agent 协作模式' },
    { id: 'workflow-run', targetTab: 'commander', initialStage: 'running', description: '启动工作流运行' },
  ],
});
