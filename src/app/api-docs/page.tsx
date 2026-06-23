'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SchemaDisplay, type SchemaDisplayField, type SchemaDisplaySchema } from '@/components/ai-elements/schema-display';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { copyText } from '@/lib/core/clipboard';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';

interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  description: string;
  requestBody?: string;
  response?: string;
  exampleBody?: string;
  exampleResponse?: string;
  notes?: string[];
}

interface ApiCategory {
  name: string;
  icon: string;
  endpoints: ApiEndpoint[];
}

interface DebugState {
  url: string;
  body: string;
  headers: string;
}

interface DebugResult {
  status: number | null;
  statusText: string;
  contentType: string;
  body: string;
  error?: string;
  loading?: boolean;
}

type ParsedSchemaField = SchemaDisplayField;

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  POST: 'bg-green-500/15 text-green-500 border-green-500/30',
  PATCH: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30',
  PUT: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
  DELETE: 'bg-red-500/15 text-red-500 border-red-500/30',
};

const API_DATA: ApiCategory[] = [
  {
    name: 'Workflow', icon: 'play_circle',
    endpoints: [
      { method: 'POST', path: '/api/workflow/start', description: '启动工作流执行', requestBody: '{ configFile: string }', response: '{ success, message }' },
      { method: 'POST', path: '/api/workflow/stop', description: '停止运行中的工作流', response: '{ success, message }' },
      { method: 'GET', path: '/api/workflow/status?configFile=file', description: '获取当前工作流状态（可按 configFile 指定）', response: '{ status, runId, currentPhase, currentStep, agents, ... }' },
      { method: 'POST', path: '/api/workflow/resume', description: '恢复暂停的工作流', requestBody: '{ runId, action?: "iterate"|"approve", feedback? }', response: '{ success, message }' },
      { method: 'GET', path: '/api/workflow/events', description: 'SSE 事件流，实时推送工作流进度', response: 'text/event-stream: status, phase, step, result, checkpoint ...', notes: ['SSE 调试会只读取前几秒的输出片段。'] },
      { method: 'POST', path: '/api/workflow/force-transition', description: '强制状态机跳转到目标状态', requestBody: '{ targetState, instruction?, configFile? }', response: '{ success, message }' },
      { method: 'POST', path: '/api/workflow/force-complete', description: '强制完成当前执行中的步骤', response: '{ success, step, outputLength }' },
      { method: 'POST', path: '/api/workflow/inject-feedback', description: '注入实时反馈或中断当前执行', requestBody: '{ message, interrupt?: boolean }', response: '{ success, interrupted? }' },
      { method: 'POST', path: '/api/workflow/recall-feedback', description: '撤回已注入的反馈', requestBody: '{ message }', response: '{ success }' },
      { method: 'POST', path: '/api/workflow/rerun-from-step', description: '从指定步骤重新执行', requestBody: '{ runId, stepName }', response: '{ success }' },
      { method: 'GET', path: '/api/workflow/context?runId=id|configFile=file', description: '获取工作流上下文（全局和阶段）', response: '{ globalContext, phaseContexts }' },
      { method: 'POST', path: '/api/workflow/context', description: '设置工作流上下文', requestBody: '{ scope: "global"|"phase", phase?, context, runId?, configFile? }', response: '{ success, message }' },
      { method: 'POST', path: '/api/workflow/approve', description: '批准检查点，继续执行', response: '{ success }' },
      { method: 'POST', path: '/api/workflow/iterate', description: '请求当前阶段迭代重试', requestBody: '{ feedback }', response: '{ success }' },
    ],
  },
  {
    name: 'Configs', icon: 'settings',
    endpoints: [
      { method: 'GET', path: '/api/configs', description: '列出所有工作流配置文件', response: '{ files, configs: ConfigMetadata[] }' },
      { method: 'POST', path: '/api/configs/create', description: '创建新工作流配置', requestBody: '{ filename, workflowName, description? }', response: '{ success, filename }' },
      { method: 'GET', path: '/api/configs/:filename', description: '读取指定配置文件及关联 Agent', response: '{ config, raw, agents }' },
      { method: 'POST', path: '/api/configs/:filename', description: '保存/更新配置文件', requestBody: '{ config: object }', response: '{ success }' },
      { method: 'DELETE', path: '/api/configs/:filename', description: '删除配置文件', response: '{ success }' },
      { method: 'POST', path: '/api/configs/:filename/copy', description: '复制配置文件', requestBody: '{ newFilename, workflowName? }', response: '{ success, filename }' },
      { method: 'POST', path: '/api/configs/ai-generate', description: 'AI 生成工作流配置草稿', requestBody: '{ requirement, constraints?, style? }', response: '{ success, config, raw? }' },
    ],
  },
  {
    name: 'Runs', icon: 'history',
    endpoints: [
      { method: 'GET', path: '/api/runs', description: '列出所有运行记录', response: '{ runs: RunRecord[] }' },
      { method: 'POST', path: '/api/runs', description: '创建运行记录', requestBody: '{ configFile, configName?, totalSteps? }', response: '{ success, id }' },
      { method: 'GET', path: '/api/runs/:id', description: '获取运行记录', response: '{ RunRecord }' },
      { method: 'PATCH', path: '/api/runs/:id', description: '更新运行记录', requestBody: '{ [key]: any }', response: '{ success }' },
      { method: 'GET', path: '/api/runs/:id/detail', description: '获取运行详情（含步骤日志、上下文）', response: '{ RunState }' },
      { method: 'GET', path: '/api/runs/:id/stream?step=name&live=true', description: '获取步骤内容（live=true 为 SSE，否则返回 JSON）', response: 'JSON: { step, content } | SSE: delta/thinking/done', notes: ['live=true 时调试器只截取流式输出片段。'] },
      { method: 'GET', path: '/api/runs/:id/outputs?step=name', description: '列出运行产出文件（可按 step 获取单步内容）', response: '{ files: OutputFile[] } | { stepName, content }' },
      { method: 'GET', path: '/api/runs/:id/documents?file=filename', description: '列出运行文档（可按 file 获取单文件内容）', response: '{ files: DocumentFile[], aceDir } | { file, content }' },
      { method: 'PATCH', path: '/api/runs/:id/documents', description: '重命名文档', requestBody: '{ file, newName }', response: '{ ok, newFilename }' },
      { method: 'DELETE', path: '/api/runs/:id/documents', description: '删除文档', requestBody: '{ files: string[] }', response: '{ ok, deleted }' },
      { method: 'DELETE', path: '/api/runs/:id/delete?cleanWorkDir=true', description: '删除整个运行目录（可选清理工作目录）', response: '{ success, message }' },
      { method: 'GET', path: '/api/runs/by-config/:config', description: '按配置文件列出运行记录', response: '{ runs }' },
      { method: 'POST', path: '/api/runs/batch', description: '批量删除运行', requestBody: '{ action: "delete", runIds }', response: '{ success, deletedCount }' },
    ],
  },
  {
    name: 'Agents', icon: 'smart_toy',
    endpoints: [
      { method: 'GET', path: '/api/agents', description: '列出所有 Agent 配置', response: '{ agents: Agent[] }' },
      { method: 'GET', path: '/api/agents/:name', description: '读取指定 Agent 配置', response: '{ agent, raw }' },
      { method: 'POST', path: '/api/agents/:name', description: '保存/更新 Agent 配置', requestBody: '{ agent: object }', response: '{ success }' },
      { method: 'DELETE', path: '/api/agents/:name', description: '删除 Agent 配置', response: '{ success }' },
      { method: 'POST', path: '/api/agents/batch', description: '批量设置 Agent 模型策略', requestBody: '{ action: "set-model-policy", sourceType, sourceEngine?, sourceModel?, targetEngine, targetModel }', response: '{ success, updatedCount }' },
    ],
  },
  {
    name: 'Processes', icon: 'terminal',
    endpoints: [
      { method: 'GET', path: '/api/processes', description: '列出所有运行中进程', response: '{ processes, stats }' },
      { method: 'DELETE', path: '/api/processes', description: '终止所有进程', response: '{ success, killedSystemPids }' },
      { method: 'GET', path: '/api/processes/:id', description: '获取指定进程信息', response: '{ Process }' },
      { method: 'DELETE', path: '/api/processes/:id', description: '终止指定进程', response: '{ success }' },
    ],
  },
  {
    name: 'Models', icon: 'psychology',
    endpoints: [
      { method: 'GET', path: '/api/models', description: '获取可用模型列表', response: '{ models: ModelOption[] }' },
      { method: 'POST', path: '/api/models', description: '保存模型配置', requestBody: '{ models: ModelOption[] }', response: '{ success }' },
    ],
  },
  {
    name: 'Model Monitor', icon: 'monitoring',
    endpoints: [
      {
        method: 'GET',
        path: '/api/models/probes/query?provider=anthropic&status=operational&historyLimit=60',
        description: '对外只读的模型探针查询接口，用于获取当前监控快照、分组信息与历史结果',
        response: '{ probes: ModelProbeSummary[], summary: ModelProbeListSummary, filters }',
        exampleResponse: JSON.stringify({
          probes: [
            {
              id: 'probe-1',
              groupId: 'group-1',
              groupName: 'Anthropic Production',
              name: 'Claude Sonnet Production',
              engine: 'claude-code',
              driver: 'sdk',
              model: 'claude-sonnet-4-20250514',
              endpoints: ['anthropic'],
              status: 'operational',
              intervalMinutes: 5,
              latestRun: {
                finishedAt: '2026-05-16T23:04:57.000Z',
                responseLatencyMs: 4337,
                availabilityCheckMs: 340,
                success: true,
              },
            },
          ],
          summary: {
            total: 1,
            enabled: 1,
            operational: 1,
            degraded: 0,
            down: 0,
            paused: 0,
            unknown: 0,
            running: 0,
            minIntervalMinutes: 5,
          },
          filters: {
            provider: 'anthropic',
            status: 'operational',
            historyLimit: 60,
          },
        }, null, 2),
        notes: [
          '这是对外唯一开放的模型探针 API。',
          '创建、批量添加、触发探测、拆分/合并分组等管理能力只在内部页面使用，不对外暴露到文档。',
        ],
      },
    ],
  },
  {
    name: 'Engine', icon: 'memory',
    endpoints: [
      { method: 'GET', path: '/api/engine', description: '获取当前执行引擎', response: '{ engine, defaultModel }' },
      { method: 'POST', path: '/api/engine', description: '设置执行引擎', requestBody: '{ engine, defaultModel? }', response: '{ success, engine, defaultModel }' },
      { method: 'GET', path: '/api/engine/availability?engine=type', description: '检查引擎是否可用', response: '{ engine, available }' },
      { method: 'GET', path: '/api/engine/models?engine=opencode', description: '获取指定引擎支持的模型列表', response: '{ engine, models }' },
    ],
  },
  {
    name: 'Skills', icon: 'extension',
    endpoints: [
      { method: 'GET', path: '/api/skills', description: '列出所有可用 Skills', response: '{ skills: Skill[], isCloned }' },
      { method: 'POST', path: '/api/skills', description: '拉取/更新 Skills 仓库', response: '{ success }' },
      { method: 'PUT', path: '/api/skills', description: '从官方仓库更新 Skills', response: '{ success, updated }' },
    ],
  },
  {
    name: 'Schedules', icon: 'schedule',
    endpoints: [
      { method: 'GET', path: '/api/schedules', description: '列出所有定时任务', response: '{ jobs: ScheduleJob[] }' },
      { method: 'POST', path: '/api/schedules', description: '创建定时任务', requestBody: '{ name, configFile, mode, interval?, cronExpression?, ... }', response: '{ job }' },
      { method: 'GET', path: '/api/schedules/:id', description: '获取指定定时任务', response: '{ job }' },
      { method: 'PATCH', path: '/api/schedules/:id', description: '更新定时任务', requestBody: '{ [key]: any }', response: '{ job }' },
      { method: 'DELETE', path: '/api/schedules/:id', description: '删除定时任务', response: '{ success }' },
      { method: 'POST', path: '/api/schedules/:id/toggle', description: '切换定时任务启用/禁用', response: '{ job }' },
      { method: 'POST', path: '/api/schedules/:id/trigger', description: '手动触发定时任务', response: '{ success }' },
    ],
  },
  {
    name: 'Chat', icon: 'chat',
    endpoints: [
      {
        method: 'POST',
        path: '/api/chat',
        description: '发送消息并获取回复（阻塞）',
        requestBody: '{ message, model?, engine?, sessionId?, frontendSessionId?, mode?, workingDirectory?, extraSystemPrompt?, skills?: string[] | Record<string, boolean> }',
        response: '{ result, sessionId, engine, costUsd?, isError }',
        exampleBody: JSON.stringify({
          message: '请列出当前可用技能并说明用途',
          mode: 'dashboard',
          workingDirectory: '/path/to/workspace',
          skills: ['aceharness-chat-card'],
        }, null, 2),
      },
      {
        method: 'POST',
        path: '/api/chat/stream',
        description: '启动流式对话',
        requestBody: '{ message, model?, engine?, sessionId?, frontendSessionId?, mode?, workingDirectory?, extraSystemPrompt?, skills?: string[] | Record<string, boolean> }',
        response: '{ chatId }',
        exampleBody: JSON.stringify({
          message: '帮我检查当前 workflow 运行状态',
          mode: 'dashboard',
          frontendSessionId: 'session-demo',
          skills: {
            'aceharness-chat-card': true,
            'aceharness-workflow-creator': true,
          },
        }, null, 2),
      },
      { method: 'GET', path: '/api/chat/stream?id=chatId', description: 'SSE 流式对话响应', response: 'text/event-stream: delta, done, error', notes: ['调试器会显示前几秒收到的事件文本。'] },
      { method: 'GET', path: '/api/chat/stream?checkActive=frontendSessionId', description: '检查会话是否有活跃流式任务', response: '{ active, chatId?, streamContent?, status?, engine? }' },
      { method: 'DELETE', path: '/api/chat/stream?id=chatId', description: '终止流式对话', response: '{ killed }' },
      { method: 'GET', path: '/api/chat/stream/active?frontendSessionId=id', description: '检查指定前端会话是否存在活跃流式任务', response: '{ active, chatId?, status?, streamContent? }' },
      { method: 'GET', path: '/api/chat/stream/recover?sessionId=id', description: '按后端 sessionId 恢复已累计内容（非 SSE）', response: '{ content, status, startNew? }' },
      { method: 'GET', path: '/api/chat/sessions', description: '列出所有对话会话', response: '{ sessions }' },
      { method: 'POST', path: '/api/chat/sessions', description: '创建对话会话', requestBody: '{ id?, title?, model?, engine? }', response: '{ session }' },
      { method: 'GET', path: '/api/chat/sessions/:id', description: '获取指定会话', response: '{ session }' },
      { method: 'PUT', path: '/api/chat/sessions/:id', description: '更新会话', requestBody: '{ [key]: any }', response: '{ ok }' },
      { method: 'DELETE', path: '/api/chat/sessions/:id', description: '删除会话', response: '{ ok }' },
      { method: 'POST', path: '/api/chat/sessions/batch-delete', description: '批量删除会话', requestBody: '{ ids: string[] }', response: '{ ok, deleted, deletedCount, missing, forbidden }' },
      { method: 'GET', path: '/api/chat/settings', description: '获取对话设置', response: '{ skills, discoveredSkills }' },
      {
        method: 'PUT',
        path: '/api/chat/settings',
        description: '更新对话设置',
        requestBody: '{ skills: Record<string, boolean>, workingDirectory? }',
        response: '{ success }',
        exampleBody: JSON.stringify({
          skills: {
            'aceharness-chat-card': true,
          },
          workingDirectory: '/path/to/workspace',
        }, null, 2),
      },
      { method: 'GET', path: '/api/chat/debug-prompt', description: '获取对话调试 Prompt 信息', response: '{ success, debug }' },
    ],
  },
  {
    name: 'Channels', icon: 'hub',
    endpoints: [
      { method: 'GET', path: '/api/channels/providers', description: '列出支持的一键接入 provider 模板', response: '{ providers }' },
      { method: 'POST', path: '/api/channels/setup', description: '按 provider 模板一键创建渠道集成', requestBody: '{ provider, name?, defaultBinding?, providerConfig? }', response: '{ integration, onboarding }' },
      { method: 'GET', path: '/api/channels/integrations', description: '列出当前用户创建的渠道集成', response: '{ integrations }' },
      { method: 'PUT', path: '/api/channels/integrations/:id', description: '更新渠道集成配置', requestBody: '{ enabled?, bindingStrategy?, defaultBinding?, providerConfig? }', response: '{ integration }' },
      { method: 'DELETE', path: '/api/channels/integrations/:id', description: '删除渠道集成及其 binding', response: '{ success }' },
      { method: 'GET', path: '/api/channels/integrations/:id/bootstrap', description: '读取该接入点的桥接协议、示例 payload 和当前 bindings', response: '{ integration, protocol, bindings }' },
      { method: 'GET', path: '/api/channels/bindings?integrationId=id', description: '列出渠道会话绑定', response: '{ bindings }' },
      { method: 'POST', path: '/api/channels/bindings', description: '创建或更新渠道 binding', requestBody: '{ integrationId, bindingType, externalConversationId, configFile?/runId?/agentName? }', response: '{ binding }' },
      { method: 'POST', path: '/api/channels/inbound/:integrationId', description: '外部平台 webhook 入口', requestBody: '{ secret, message: { conversationId, userId, text } }', response: '{ ok, replies, replyMessages, binding? }' },
    ],
  },
  {
    name: 'Auth', icon: 'lock',
    endpoints: [
      { method: 'GET', path: '/api/auth/setup', description: '获取认证初始化状态', response: '{ isSetup }' },
      { method: 'POST', path: '/api/auth/setup', description: '初始化认证配置', requestBody: '{ username, email, password, question, answer, personalDir?, avatar? }', response: '{ success }' },
      { method: 'POST', path: '/api/auth/login', description: '用户登录', requestBody: '{ email, password }', response: '{ success, user, token? }' },
      { method: 'GET', path: '/api/auth/me', description: '获取当前登录用户信息', response: '{ user }' },
      { method: 'DELETE', path: '/api/auth/me', description: '当前用户退出登录', response: '{ success }' },
      { method: 'PUT', path: '/api/auth/profile', description: '更新当前用户资料', requestBody: '{ name?, avatar?, ... }', response: '{ success, user }' },
      { method: 'PUT', path: '/api/auth/password', description: '修改当前用户密码', requestBody: '{ currentPassword, newPassword }', response: '{ success }' },
      { method: 'PUT', path: '/api/auth/email', description: '修改当前用户邮箱', requestBody: '{ newEmail }', response: '{ success }' },
      { method: 'POST', path: '/api/auth/reset-password', description: '重置用户密码（安全问题两阶段）', requestBody: '{ step: "question", email } | { email, answer, newPassword }', response: '{ question } | { success }' },
    ],
  },
  {
    name: 'Users', icon: 'group',
    endpoints: [
      { method: 'GET', path: '/api/users', description: '列出系统用户', response: '{ users }' },
      { method: 'POST', path: '/api/users', description: '创建用户', requestBody: '{ username, email, password, question, answer, role?, personalDir?, avatar? }', response: '{ user }' },
      { method: 'GET', path: '/api/users/:id', description: '获取指定用户', response: '{ user }' },
      { method: 'PUT', path: '/api/users/:id', description: '更新指定用户', requestBody: '{ username?, email?, role?, personalDir?, avatar?, resetPassword? }', response: '{ user } | { success, message }' },
      { method: 'DELETE', path: '/api/users/:id', description: '删除指定用户', response: '{ success }' },
    ],
  },
  {
    name: 'System', icon: 'monitor_heart',
    endpoints: [
      { method: 'GET', path: '/api/dashboard', description: '获取仪表盘聚合数据', response: '{ stats, charts, recentRuns, ... }' },
      { method: 'GET', path: '/api/env?scope=system|user|merged', description: '获取环境变量配置（脱敏）', response: '{ vars, scope }' },
      { method: 'PUT', path: '/api/env', description: '更新环境变量配置', requestBody: '{ vars: [{ key, value }], scope?: "system"|"user" }', response: '{ success, scope }' },
      { method: 'GET', path: '/api/system-settings', description: '获取系统设置', response: '{ settings }' },
      { method: 'PUT', path: '/api/system-settings', description: '更新系统设置', requestBody: '{ settings: object }', response: '{ success }' },
    ],
  },
  {
    name: 'Workspace', icon: 'folder_open',
    endpoints: [
      { method: 'GET', path: '/api/workspace/tree?path=.&depth=2&sub=dir', description: '获取工作区目录树', response: '{ tree, rootPath }' },
      { method: 'POST', path: '/api/workspace/manage', description: '工作区文件管理（新建/删除/移动）', requestBody: '{ workspace, action, ...params }', response: '{ success }' },
      { method: 'GET', path: '/api/workspace/file?workspace=/abs/path&file=rel/path&mode=blob', description: '读取工作区文件内容', response: '{ content, size, path } | binary/blob' },
      { method: 'PUT', path: '/api/workspace/file', description: '写入工作区文件内容', requestBody: '{ workspace, file, content }', response: '{ success }' },
      { method: 'GET', path: '/api/notebook/tree?scope=personal|global&depth=2&sub=dir&shareToken=token', description: '获取 Notebook 目录树', response: '{ tree, rootPath, scope }' },
      { method: 'POST', path: '/api/notebook/manage', description: 'Notebook 文件管理（新建/删除/移动）', requestBody: '{ action, scope?, shareToken?, ...params }', response: '{ success, scope? }' },
      { method: 'GET', path: '/api/notebook/file?file=rel/path&scope=personal|global&mode=blob&shareToken=token', description: '读取 Notebook 文件', response: '{ content, size, path, scope } | binary/blob' },
      { method: 'PUT', path: '/api/notebook/file', description: '写入 Notebook 文件', requestBody: '{ file, content, scope?, shareToken? }', response: '{ success, scope }' },
      { method: 'GET', path: '/api/notebook/share?token=...', description: '获取共享 Notebook 信息', response: '{ scope, path, permission, createdAt }' },
      { method: 'POST', path: '/api/notebook/share', description: '创建 Notebook 分享', requestBody: '{ filePath, scope: "global", permission?: "read"|"write" }', response: '{ token, scope, path, permission }' },
    ],
  },
  {
    name: 'Cangjie', icon: 'deployed_code',
    endpoints: [
      { method: 'GET', path: '/api/cangjie/sdk', description: '获取仓颉 SDK 当前状态', response: '{ installed, activeVersion, versions }' },
      { method: 'POST', path: '/api/cangjie/sdk/install', description: '安装仓颉 SDK 版本', requestBody: '{ version }', response: '{ success }' },
      { method: 'POST', path: '/api/cangjie/sdk/activate', description: '激活仓颉 SDK 版本', requestBody: '{ version }', response: '{ success }' },
      { method: 'DELETE', path: '/api/cangjie/sdk/remove', description: '移除仓颉 SDK 版本', requestBody: '{ version }', response: '{ success }' },
      { method: 'POST', path: '/api/cangjie/run', description: '执行仓颉代码或任务', requestBody: '{ code | command, args?, timeout? }', response: '{ success, output, error? }' },
    ],
  },
  {
    name: 'Other', icon: 'more_horiz',
    endpoints: [
      { method: 'POST', path: '/api/prompt-analysis', description: '分析单个 Prompt 效果', requestBody: '{ prompt, output?, context?, agentName? }', response: '{ success, analysis }' },
      { method: 'GET', path: '/api/prompt-analysis?runId=id', description: '分析运行中所有 Prompt', response: '{ steps, summary: { totalSteps, avgScore } }' },
    ],
  },
];

const PLACEHOLDER_BY_KEY: Record<string, unknown> = {
  id: 'example-id',
  runId: 'run-demo',
  sessionId: 'session-demo',
  frontendSessionId: 'frontend-session-demo',
  chatId: 'chat-demo',
  message: 'hello',
  title: '示例标题',
  name: 'demo',
  workflowName: 'demo-workflow',
  filename: 'demo.yaml',
  configFile: 'demo.yaml',
  stepName: 'design',
  step: 'design',
  file: 'README.md',
  newName: 'README-new.md',
  newFilename: 'demo-copy.yaml',
  engine: 'codex',
  model: 'gpt-5.5',
  version: '1.0.0',
  email: 'demo@example.com',
  password: 'password123',
  currentPassword: 'old-password',
  newPassword: 'new-password',
  question: '你的城市？',
  answer: '深圳',
  username: 'demo-user',
  role: 'admin',
  targetState: 'review',
  instruction: '切换到 review',
  feedback: '请继续迭代',
  scope: 'global',
  phase: 'implementation',
  action: 'delete',
  path: '.',
  depth: 2,
  sub: 'dir',
  workspace: '/path/to/workspace',
  workingDirectory: '/path/to/workspace',
  prompt: '请分析这个 prompt',
  requirement: '创建一个修复代码问题的工作流',
  constraints: '保持兼容现有配置',
  style: 'concise',
  provider: 'wechat-official',
  integrationId: 'integration-demo',
  externalConversationId: 'conv-demo',
  bindingType: 'workflow',
  token: 'share-token-demo',
};

function endpointKey(category: string, endpoint: ApiEndpoint): string {
  return `${category}:${endpoint.method}:${endpoint.path}`;
}

function materializeExamplePath(path: string): string {
  return path
    .replace(/:filename\b/g, 'demo.yaml')
    .replace(/:integrationId\b/g, 'integration-demo')
    .replace(/:config\b/g, 'demo-config')
    .replace(/:name\b/g, 'demo-agent')
    .replace(/:id\b/g, 'example-id');
}

function sampleValueForKey(key: string): unknown {
  return key in PLACEHOLDER_BY_KEY ? PLACEHOLDER_BY_KEY[key] : `${key}-value`;
}

function inferTypedValue(typeExpr: string, key: string): unknown {
  const normalized = typeExpr.trim();
  const unionLiteral = normalized.match(/"([^"]+)"/);
  if (unionLiteral) return unionLiteral[1];
  if (normalized.includes('string[]') || normalized.endsWith('[]')) return [];
  if (normalized.includes('boolean')) return false;
  if (normalized.includes('number')) return 0;
  if (normalized.includes('Record<string, boolean>')) return {};
  if (normalized.includes('object')) return {};
  if (normalized.includes('any')) return {};
  return sampleValueForKey(key);
}

function splitTopLevelSchemaParts(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      current += char;
      if (char === quote && input[i - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === '}' || char === ']' || char === ')') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (char === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitSchemaKeyAndType(part: string): { key: string; typeExpr: string } | null {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < part.length; i += 1) {
    const char = part[i];
    if (quote) {
      if (char === quote && part[i - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
      continue;
    }
    if (char === '}' || char === ']' || char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === ':' && depth === 0) {
      return {
        key: part.slice(0, i).trim(),
        typeExpr: part.slice(i + 1).trim(),
      };
    }
  }
  return null;
}

function parseSchemaFields(schema: string): ParsedSchemaField[] {
  const trimmed = schema.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return [];
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];

  return splitTopLevelSchemaParts(inner).reduce<ParsedSchemaField[]>((fields, part) => {
      if (!part || part === '...' || part.startsWith('[')) return fields;
      const entry = splitSchemaKeyAndType(part);
      if (!entry) return fields;
      const rawKey = entry.key.trim();
      const required = !rawKey.endsWith('?');
      const name = rawKey.replace(/\?$/, '').trim();
      if (!name) return fields;
      const typeExpr = entry.typeExpr.trim();
      const normalizedType = typeExpr || 'unknown';
      const objectChildren = normalizedType.startsWith('{') && normalizedType.endsWith('}')
        ? parseSchemaFields(normalizedType)
        : undefined;

      fields.push({
        name,
        type: objectChildren?.length ? 'object' : normalizedType,
        required,
        children: objectChildren?.length ? objectChildren : undefined,
      } satisfies ParsedSchemaField);
      return fields;
    }, []);
}

function schemaToDisplayModel(schema?: string): SchemaDisplaySchema | null {
  if (!schema) return null;
  const trimmed = schema.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return { type: 'scalar', raw: trimmed };
  }
  const fields = parseSchemaFields(trimmed);
  if (!fields.length) {
    return { type: 'scalar', raw: trimmed };
  }
  return { type: 'object', fields };
}

function schemaToExample(schema?: string): string {
  if (!schema) return '';
  const trimmed = schema.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return trimmed;

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return '{}';

  const result: Record<string, unknown> = {};
  for (const rawPart of splitTopLevelSchemaParts(inner)) {
    const part = rawPart.trim();
    if (!part || part === '...') continue;
    if (part.startsWith('[')) continue;

    const entry = splitSchemaKeyAndType(part);
    if (entry) {
      const rawKey = entry.key.trim().replace(/\?$/, '');
      const typeExpr = entry.typeExpr.trim();
      if (!rawKey) continue;
      result[rawKey] = inferTypedValue(typeExpr, rawKey);
      continue;
    }

    const key = part.replace(/\?$/, '').trim();
    if (!key) continue;
    result[key] = sampleValueForKey(key);
  }

  return JSON.stringify(result, null, 2);
}

function normalizeCodeBlock(value?: string): string {
  return value?.trim() || '';
}

function buildCurlExample(endpoint: ApiEndpoint, debug: DebugState): string {
  const method = endpoint.method;
  const parts = [`curl -X ${method} "${debug.url}"`];
  const headers = safeJsonParse(debug.headers);
  if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      parts.push(`-H "${key}: ${String(value)}"`);
    }
  }
  if (debug.body.trim() && method !== 'GET') {
    parts.push(`-d '${debug.body.replace(/'/g, "'\"'\"'")}'`);
  }
  return parts.join(' \\\n  ');
}

function safeJsonParse(value: string): unknown {
  try {
    return value.trim() ? JSON.parse(value) : {};
  } catch {
    return undefined;
  }
}

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatResponseBody(contentType: string, text: string): string {
  if (!text) return '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

function createInitialDebugState(endpoint: ApiEndpoint): DebugState {
  return {
    url: materializeExamplePath(endpoint.path),
    body: normalizeCodeBlock(endpoint.exampleBody || schemaToExample(endpoint.requestBody)),
    headers: '{\n  "Content-Type": "application/json"\n}',
  };
}

async function readSsePreview(response: Response): Promise<string> {
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let collected = '';
  let chunks = 0;
  const timeoutAt = Date.now() + 3000;

  while (Date.now() < timeoutAt && chunks < 12 && collected.length < 4000) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    collected += decoder.decode(value, { stream: true });
    chunks += 1;
  }

  try {
    await reader.cancel();
  } catch {}

  return collected ? `${collected}\n\n[stream preview truncated]` : '';
}

export default function ApiDocsPage() {
  const [search, setSearch] = useState('');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [debugStates, setDebugStates] = useState<Record<string, DebugState>>({});
  const [debugResults, setDebugResults] = useState<Record<string, DebugResult>>({});
  const [selectedEndpointKey, setSelectedEndpointKey] = useState<string>(() => {
    const firstCategory = API_DATA[0];
    const firstEndpoint = firstCategory?.endpoints[0];
    return firstCategory && firstEndpoint ? endpointKey(firstCategory.name, firstEndpoint) : '';
  });

  useDocumentTitle('API 文档');

  const filteredData = useMemo(() => {
    if (!search.trim()) return API_DATA;
    const needle = search.toLowerCase();
    return API_DATA.map((category) => ({
      ...category,
      endpoints: category.endpoints.filter((endpoint) =>
        endpoint.path.toLowerCase().includes(needle) ||
        endpoint.description.toLowerCase().includes(needle) ||
        endpoint.method.toLowerCase().includes(needle)
      ),
    })).filter((category) => category.endpoints.length > 0);
  }, [search]);

  const totalEndpoints = API_DATA.reduce((sum, category) => sum + category.endpoints.length, 0);
  const { isDashboardShell } = useDashboardShellHeader({
    title: 'API Documentation',
    subtitle: `${totalEndpoints} endpoints across ${API_DATA.length} categories`,
  }, [totalEndpoints]);
  const allFilteredEndpoints = filteredData.flatMap((category) =>
    category.endpoints.map((endpoint) => ({
      category,
      endpoint,
      key: endpointKey(category.name, endpoint),
    }))
  );

  const activeEndpointEntry = allFilteredEndpoints.find((item) => item.key === selectedEndpointKey) || allFilteredEndpoints[0] || null;

  const copyToClipboard = async (text: string) => {
    const ok = await copyText(text);
    if (!ok) return;
    setCopiedPath(text);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  const ensureDebugState = (key: string, endpoint: ApiEndpoint): DebugState => {
    return debugStates[key] || createInitialDebugState(endpoint);
  };

  const updateDebugState = (key: string, patch: Partial<DebugState>, endpoint: ApiEndpoint) => {
    setDebugStates((prev) => ({
      ...prev,
      [key]: {
        ...ensureDebugState(key, endpoint),
        ...patch,
      },
    }));
  };

  const runRequest = async (key: string, endpoint: ApiEndpoint) => {
    const current = ensureDebugState(key, endpoint);
    const headersValue = safeJsonParse(current.headers);
    if (headersValue === undefined) {
      setDebugResults((prev) => ({
        ...prev,
        [key]: {
          status: null,
          statusText: '',
          contentType: '',
          body: '',
          error: 'Headers 不是合法 JSON',
        },
      }));
      return;
    }

    setDebugResults((prev) => ({
      ...prev,
      [key]: {
        status: null,
        statusText: '',
        contentType: '',
        body: '',
        loading: true,
      },
    }));

    try {
      const mergedHeaders = {
        ...getAuthHeaders(),
        ...(headersValue as Record<string, string>),
      };

      const requestInit: RequestInit = {
        method: endpoint.method,
        headers: mergedHeaders as HeadersInit,
        credentials: 'same-origin',
      };

      if (endpoint.method !== 'GET' && current.body.trim()) {
        requestInit.body = current.body;
      }

      const response = await fetch(current.url, requestInit);
      if (response.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
      const contentType = response.headers.get('content-type') || '';
      const body = contentType.includes('text/event-stream')
        ? await readSsePreview(response)
        : formatResponseBody(contentType, await response.text());

      setDebugResults((prev) => ({
        ...prev,
        [key]: {
          status: response.status,
          statusText: response.statusText,
          contentType,
          body,
        },
      }));
    } catch (error: any) {
      setDebugResults((prev) => ({
        ...prev,
        [key]: {
          status: null,
          statusText: '',
          contentType: '',
          body: '',
          error: error?.message || '请求失败',
        },
      }));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {!isDashboardShell ? (
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/90 backdrop-blur">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="rounded-lg p-2 transition-colors hover:bg-muted">
                <span className="material-symbols-outlined text-xl">arrow_back</span>
              </Link>
              <div>
                <h1 className="text-2xl font-semibold">API Documentation</h1>
                <p className="text-xs text-muted-foreground">
                  {totalEndpoints} endpoints across {API_DATA.length} categories
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>
      ) : null}

      <div className="container mx-auto px-6 py-6">
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-xl flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-lg text-muted-foreground">search</span>
            <Input
              placeholder="Search endpoints, methods, descriptions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            每个接口都可以直接查看示例、编辑 URL / Body / Headers 并在线调试。
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)] lg:overflow-auto">
            <div className="rounded-xl border border-border/50 bg-card/40 p-4">
              <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">目录</div>
              <div className="space-y-4">
                {filteredData.map((category) => (
                  <div key={category.name} className="space-y-2">
                    <a href={`#category-${category.name}`} className="flex items-center gap-2 text-sm font-semibold hover:text-primary">
                      <span className="material-symbols-outlined text-base text-primary">{category.icon}</span>
                      <span>{category.name}</span>
                      <Badge variant="secondary" className="ml-auto text-[10px]">{category.endpoints.length}</Badge>
                    </a>
                    <div className="space-y-1 pl-6">
                      {category.endpoints.map((endpoint, index) => {
                        const key = endpointKey(category.name, endpoint);
                        const isActive = key === activeEndpointEntry?.key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setSelectedEndpointKey(key)}
                            className={`block w-full rounded px-2 py-2 text-left transition-colors ${
                              isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                            }`}
                          >
                            <div className="flex items-center gap-2 text-[11px]">
                              <span className="font-mono">{endpoint.method}</span>
                              <span className="truncate">{endpoint.path}</span>
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs">
                              {endpoint.description}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <main className="space-y-8">
            {activeEndpointEntry ? (() => {
              const { category, endpoint, key } = activeEndpointEntry;
              const debugState = ensureDebugState(key, endpoint);
              const debugResult = debugResults[key];
              const requestExample = normalizeCodeBlock(endpoint.exampleBody || schemaToExample(endpoint.requestBody));
              const responseExample = normalizeCodeBlock(endpoint.exampleResponse || schemaToExample(endpoint.response));
              const requestSchema = schemaToDisplayModel(endpoint.requestBody);
              const responseSchema = schemaToDisplayModel(endpoint.response);
              const examplePath = materializeExamplePath(endpoint.path);

              return (
                <>
                  <section id={`category-${category.name}`} className="rounded-xl border border-border/50 bg-card/40 px-6 py-5">
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-primary">{category.icon}</span>
                      <h2 className="text-xl font-semibold">{category.name}</h2>
                      <Badge variant="secondary" className="text-xs">当前查看</Badge>
                    </div>
                  </section>

                  <article
                    id={`endpoint-${encodeURIComponent(key)}`}
                    className="overflow-hidden rounded-xl border border-border/50 bg-card/40"
                  >
                    <div className="border-b border-border/30 px-6 py-5">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className={`${METHOD_COLORS[endpoint.method]} min-w-[64px] justify-center font-mono text-xs`}>
                              {endpoint.method}
                            </Badge>
                            <code
                              className="cursor-pointer break-all text-sm font-mono transition-colors hover:text-primary"
                              onClick={() => copyToClipboard(endpoint.path)}
                              title="Click to copy"
                            >
                              {endpoint.path}
                            </code>
                            {copiedPath === endpoint.path && <span className="text-xs text-green-500">Copied</span>}
                          </div>
                          <p className="text-sm text-muted-foreground">{endpoint.description}</p>
                          {endpoint.notes?.length ? (
                            <div className="space-y-1 text-xs text-amber-600 dark:text-amber-400">
                              {endpoint.notes.map((note) => (
                                <div key={note}>{note}</div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-0">
                      <section className="border-b border-border/20 px-6 py-5">
                        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">API 格式</h3>
                        <div className="space-y-4">
                          <div className="grid gap-4 lg:grid-cols-[120px_minmax(0,1fr)]">
                            <div className="text-xs font-medium text-muted-foreground">Method</div>
                            <Badge variant="outline" className={`${METHOD_COLORS[endpoint.method]} w-fit min-w-[64px] justify-center font-mono text-xs`}>
                              {endpoint.method}
                            </Badge>
                          </div>
                          <div className="grid gap-4 lg:grid-cols-[120px_minmax(0,1fr)]">
                            <div className="text-xs font-medium text-muted-foreground">Path</div>
                            <code className="block break-all rounded bg-muted/50 px-3 py-2 text-xs">{endpoint.path}</code>
                          </div>
                          {endpoint.requestBody && requestSchema ? (
                            <div className="grid gap-4 lg:grid-cols-[120px_minmax(0,1fr)]">
                              <div className="pt-2 text-xs font-medium text-muted-foreground">Request</div>
                              <SchemaDisplay title="Request Schema" schema={requestSchema} />
                            </div>
                          ) : null}
                          {endpoint.response && responseSchema ? (
                            <div className="grid gap-4 lg:grid-cols-[120px_minmax(0,1fr)]">
                              <div className="pt-2 text-xs font-medium text-muted-foreground">Response</div>
                              <SchemaDisplay title="Response Schema" schema={responseSchema} />
                            </div>
                          ) : null}
                        </div>
                      </section>

                      <section className="border-b border-border/20 px-6 py-5">
                        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Example</h3>
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="space-y-3">
                            <div>
                              <div className="mb-1 text-xs font-medium text-muted-foreground">Example URL</div>
                              <code className="block rounded bg-muted/50 px-3 py-2 text-xs">{examplePath}</code>
                            </div>
                            {endpoint.requestBody && (
                              <div>
                                <div className="mb-1 text-xs font-medium text-muted-foreground">Request Example</div>
                                <pre className="overflow-x-auto rounded bg-muted/50 p-3 text-xs">{requestExample || endpoint.requestBody}</pre>
                              </div>
                            )}
                          </div>
                          <div className="space-y-3">
                            {endpoint.response && (
                              <div>
                                <div className="mb-1 text-xs font-medium text-muted-foreground">Response Example</div>
                                <pre className="overflow-x-auto rounded bg-muted/50 p-3 text-xs">{responseExample || endpoint.response}</pre>
                              </div>
                            )}
                            <div>
                              <div className="mb-1 text-xs font-medium text-muted-foreground">cURL</div>
                              <pre className="overflow-x-auto rounded bg-muted/50 p-3 text-xs">{buildCurlExample(endpoint, debugState)}</pre>
                            </div>
                          </div>
                        </div>
                      </section>

                      <section className="px-6 py-5">
                        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">调试功能</h3>
                        <div className="space-y-4">
                          <div className="text-xs text-muted-foreground">危险或有副作用的接口会直接执行真实请求。</div>

                          <div className="grid gap-4 lg:grid-cols-[120px_minmax(0,1fr)] lg:items-start">
                            <div className="pt-2 text-xs font-medium text-muted-foreground">URL</div>
                            <Input
                              value={debugState.url}
                              onChange={(e) => updateDebugState(key, { url: e.target.value }, endpoint)}
                            />
                          </div>

                          <div className="grid gap-4 lg:grid-cols-[120px_minmax(0,1fr)] lg:items-start">
                            <div className="pt-2 text-xs font-medium text-muted-foreground">Headers</div>
                            <Textarea
                              value={debugState.headers}
                              onChange={(e) => updateDebugState(key, { headers: e.target.value }, endpoint)}
                              className="min-h-[96px] font-mono text-xs"
                            />
                          </div>

                          {endpoint.method !== 'GET' && (
                            <div className="grid gap-4 lg:grid-cols-[120px_minmax(0,1fr)] lg:items-start">
                              <div className="pt-2 text-xs font-medium text-muted-foreground">Body</div>
                              <Textarea
                                value={debugState.body}
                                onChange={(e) => updateDebugState(key, { body: e.target.value }, endpoint)}
                                className="min-h-[180px] font-mono text-xs"
                              />
                            </div>
                          )}

                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => runRequest(key, endpoint)}>
                              {debugResult?.loading ? '请求中...' : '发送请求'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setDebugStates((prev) => ({ ...prev, [key]: createInitialDebugState(endpoint) }))}
                            >
                              重置示例
                            </Button>
                          </div>

                          {debugResult && (
                            <div className="space-y-3 rounded-lg border border-border/40 bg-muted/20 p-4">
                              <div className="flex flex-wrap items-center gap-3 text-xs">
                                <span className="font-medium text-foreground">Status</span>
                                <Badge variant="secondary">
                                  {debugResult.status !== null ? `${debugResult.status} ${debugResult.statusText}` : 'Request Error'}
                                </Badge>
                                {debugResult.contentType ? (
                                  <span className="text-muted-foreground">{debugResult.contentType}</span>
                                ) : null}
                              </div>
                              {debugResult.error ? (
                                <pre className="overflow-x-auto rounded bg-background/80 p-3 text-xs text-red-500">{debugResult.error}</pre>
                              ) : (
                                <pre className="overflow-x-auto rounded bg-background/80 p-3 text-xs">
                                  {debugResult.body || '(empty response body)'}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      </section>
                    </div>
                  </article>
                </>
              );
            })() : (
              <div className="py-16 text-center text-muted-foreground">
                No endpoints match &quot;{search}&quot;
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
