import { definePlugin } from '@/lib/sidebar-plugins';

/**
 * 工作流协作插件
 *
 * 提供工作流运行监控、人工问题处理和协作视图。
 */
export default definePlugin({
  id: 'supervisor',
  name: '工作流协作',
  version: '1.0.0',
  enabled: true,
  capabilities: ['agent-calling', 'result-extraction', 'persistence', 'streaming-display', 'animations'],

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
    { id: 'supervisor-chat', targetTab: 'commander', initialStage: 'running', description: '进入工作流协作模式' },
    { id: 'workflow-run', targetTab: 'commander', initialStage: 'running', description: '启动工作流运行' },
  ],
});
