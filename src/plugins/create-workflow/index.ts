import { definePlugin } from '@/lib/sidebar-plugins';

/**
 * 创建工作流插件
 *
 * 提供工作流创建向导、规格生成、运行启动等功能。
 */
export default definePlugin({
  id: 'create-workflow',
  name: '创建工作流',
  version: '1.0.0',
  enabled: true,
  capabilities: ['persistence', 'result-extraction', 'breakpoint-resume', 'modals'],

  actions: {
    categories: [
      { id: 'create', title: '创建', icon: 'add_circle', order: 20 },
    ],
    items: [
      {
        id: 'create-workflow',
        label: '创建工作流',
        icon: 'add_circle',
        color: 'from-orange-500 to-orange-600',
        prompt: '__HOME_ACTION__:create_workflow',
        pinned: true,
        category: 'create',
        order: 10,
        guide: {
          title: '先描述目标，再创建工作流',
          description: '这类操作依赖当前对话上下文。先把目标、工作目录和约束告诉 AI，再让它生成右侧表单预填信息会更稳定。',
          samplePrompt: '我想围绕【目标】创建一个工作流，工作目录是【路径】，请先帮我梳理需求、阶段、候选 Agent 和任务拆分。',
          assistantSteps: [
            '先确认你的目标、输入、工作目录和约束。',
            '整理出阶段、候选 Agent、工作流结构和关键风险。',
            '把这些信息同步到右侧工作流表单，再进入创建。',
          ],
        },
      },
      {
        id: 'start-run',
        label: '启动运行',
        icon: 'play_arrow',
        color: 'from-emerald-500 to-emerald-600',
        prompt: '我想启动一个工作流运行',
        category: 'create',
        order: 30,
        guide: {
          title: '先说明要运行什么',
          description: '启动运行前，至少要告诉 AI 具体是哪个 workflow，直接给 workflow 名称或 yaml 文件名都可以。',
          samplePrompt: '我想启动运行，请按【workflow-name】或【workflow-file.yaml】这个工作流继续帮我定位并启动。',
          assistantSteps: [
            '先确认你提供的是 workflow 名称，还是具体 yaml 文件名。',
            '根据名称或文件名定位对应配置，并补足当前运行上下文。',
            '确认目标工作流后再进入启动或继续运行。',
          ],
        },
      },
    ],
  },

  tab: {
    id: 'workflow',
    label: '工作流',
    order: 20,
    render: () => null, // Rendered by HomeCommandSidebar during migration
  },

  stateMachine: {
    initialPhase: 'idle',
    phases: [
      { id: 'idle', label: '空闲', transitions: ['clarifying'] },
      { id: 'clarifying', label: '需求澄清', transitions: ['spec-draft'] },
      { id: 'spec-draft', label: '规格草稿', transitions: ['spec-review'] },
      { id: 'spec-review', label: '规格审查', transitions: ['workflow-draft', 'clarifying'] },
      { id: 'workflow-draft', label: '工作流生成', transitions: ['idle'] },
    ],
  },

  breakpoint: {
    handlers: ['creation'],
  },

  intents: [
    { id: 'create-workflow', targetTab: 'workflow', initialStage: 'clarifying', opensModal: true, description: '打开工作流创建向导' },
    { id: 'workflow-run', targetTab: 'commander', initialStage: 'running', description: '启动工作流运行' },
    { id: 'workflow-review', targetTab: 'workflow', initialStage: 'review', description: '审查工作流运行结果' },
  ],
});
