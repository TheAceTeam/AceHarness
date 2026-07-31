import { definePlugin } from '@/lib/sidebar-plugins';
import { AI_WORKFLOW_CREATOR_ACTION } from '@/lib/chat/workflow-creator-entry';

/**
 * 首页 AI 引导工作流创建动作。
 *
 * 这里只提供入口协议，实际表单由当前首页接入轻量工作流创建流程。
 * 不声明旧的 workflow tab、phase 状态机或独立执行器。
 */
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
          title: '先描述目标，再创建轻量工作流',
          description: '先把目标、工作目录和约束告诉 AI，再打开轻量工作流表单确认执行 Agent 与任务。',
          samplePrompt: '我想围绕【目标】创建一个轻量工作流，工作目录是【路径】，请先帮我梳理任务目标、执行 Agent 和验收条件。',
          assistantSteps: [
            '确认目标、工作目录、输入和验收条件。',
            '整理成一个可执行的任务清单驱动步骤。',
            '把需求带入轻量工作流表单，确认后创建配置。',
          ],
        },
      },
    ],
  },
});
