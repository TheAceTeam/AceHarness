import { definePlugin } from '@/lib/sidebar-plugins';
import { AI_WORKFLOW_CREATOR_ACTION } from '@/lib/chat/workflow-creator-entry';

export default definePlugin({
  id: 'ai-workflow-creator',
  name: 'AI 引导创建工作流',
  version: '1.0.0',
  enabled: true,
  capabilities: ['modals'],

  actions: {
    categories: [
      { id: 'create', title: '创建', icon: 'add_circle', order: 20 },
    ],
    items: [
      {
        id: 'ai-workflow-creator',
        label: 'AI 引导创建工作流',
        icon: 'account_tree',
        color: 'from-orange-500 to-orange-600',
        prompt: AI_WORKFLOW_CREATOR_ACTION,
        pinned: true,
        category: 'create',
        order: 10,
        guide: {
          title: '先描述目标，再生成工作流草案',
          description: '先把目标、工作目录和约束告诉 AI，再确认生成的轻量或状态机工作流草案。',
          samplePrompt: '我想围绕【目标】创建一个工作流，工作目录是【路径】，请先帮我梳理任务目标、执行角色和验收条件。',
          assistantSteps: [
            '确认目标、工作目录、输入和验收条件。',
            '选择合适的轻量任务清单或状态机编排，并整理执行结构。',
            '把需求带入工作流草案，确认后创建配置。',
          ],
        },
      },
    ],
  },
});
