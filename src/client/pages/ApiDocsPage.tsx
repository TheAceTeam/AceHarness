'use client';

import { useMemo, useState } from 'react';
import Link from '@/lib/navigation/client';
import { Button } from '@/components/ui/button';
import {
  DataCard,
  DataCardActions,
  DataCardDescription,
  DataCardHeader,
  DataCardMeta,
  DataCardTitle,
} from '@/components/ui/data-card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import {
  DetailDrawer,
  DetailDrawerBody,
  DetailDrawerContent,
  DetailDrawerDescription,
  DetailDrawerFooter,
  DetailDrawerHeader,
  DetailDrawerTitle,
} from '@/components/ui/detail-drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { StatusPill } from '@/components/ui/status-pill';
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
type EndpointRow = {
  key: string;
  category: ApiCategory;
  endpoint: ApiEndpoint;
};

type MethodFilter = 'ALL' | ApiEndpoint['method'];

const METHOD_FILTERS: MethodFilter[] = ['ALL', 'GET', 'POST', 'PATCH', 'PUT', 'DELETE'];

const METHOD_TONES: Record<ApiEndpoint['method'], 'info' | 'success' | 'warning' | 'accent' | 'danger'> = {
  GET: 'info',
  POST: 'success',
  PATCH: 'warning',
  PUT: 'accent',
  DELETE: 'danger',
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
    name: 'Runtime', icon: 'memory',
    endpoints: [
      {
        method: 'GET',
        path: '/api/agents',
        description: '列出可用 Runtime Agent 和运行状态',
        response: '{ agents: RuntimeAgent[] }',
      },
      {
        method: 'GET',
        path: '/api/models',
        description: '列出模型路由与默认 Runtime 选择',
        response: '{ models: ModelOption[] }',
      },
      {
        method: 'POST',
        path: '/api/models',
        description: '保存模型路由配置',
        requestBody: '{ models: ModelOption[] }',
        response: '{ models: ModelOption[] }',
      },
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
  const [methodFilter, setMethodFilter] = useState<MethodFilter>('ALL');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [debugStates, setDebugStates] = useState<Record<string, DebugState>>({});
  const [debugResults, setDebugResults] = useState<Record<string, DebugResult>>({});
  const [responseDrawerKey, setResponseDrawerKey] = useState<string | null>(null);
  const [selectedEndpointKey, setSelectedEndpointKey] = useState<string>(() => {
    const firstCategory = API_DATA[0];
    const firstEndpoint = firstCategory?.endpoints[0];
    return firstCategory && firstEndpoint ? endpointKey(firstCategory.name, firstEndpoint) : '';
  });

  useDocumentTitle('API 文档');

  const filteredData = useMemo(() => {
    const needle = search.toLowerCase();
    return API_DATA.map((category) => ({
      ...category,
      endpoints: category.endpoints.filter((endpoint) => {
        const matchesMethod = methodFilter === 'ALL' || endpoint.method === methodFilter;
        const matchesSearch = !needle.trim() ||
          endpoint.path.toLowerCase().includes(needle) ||
          endpoint.description.toLowerCase().includes(needle) ||
          endpoint.method.toLowerCase().includes(needle) ||
          category.name.toLowerCase().includes(needle);
        return matchesMethod && matchesSearch;
      }),
    })).filter((category) => category.endpoints.length > 0);
  }, [methodFilter, search]);

  const totalEndpoints = API_DATA.reduce((sum, category) => sum + category.endpoints.length, 0);
  const visibleEndpoints = filteredData.reduce((sum, category) => sum + category.endpoints.length, 0);
  const methodCounts = useMemo(() => {
    return API_DATA.flatMap((category) => category.endpoints).reduce<Record<MethodFilter, number>>((acc, endpoint) => {
      acc.ALL += 1;
      acc[endpoint.method] += 1;
      return acc;
    }, { ALL: 0, GET: 0, POST: 0, PATCH: 0, PUT: 0, DELETE: 0 });
  }, []);
  const { isDashboardShell } = useDashboardShellHeader({
    title: 'API Documentation',
    subtitle: `${totalEndpoints} endpoints across ${API_DATA.length} categories`,
  }, [totalEndpoints]);
  const allFilteredEndpoints: EndpointRow[] = filteredData.flatMap((category) =>
    category.endpoints.map((endpoint) => ({
      category,
      endpoint,
      key: endpointKey(category.name, endpoint),
    }))
  );

  const activeEndpointEntry = allFilteredEndpoints.find((item) => item.key === selectedEndpointKey) || allFilteredEndpoints[0] || null;
  const responseDrawerEntry = responseDrawerKey
    ? API_DATA.flatMap((category) =>
        category.endpoints.map((endpoint) => ({
          category,
          endpoint,
          key: endpointKey(category.name, endpoint),
        }))
      ).find((item) => item.key === responseDrawerKey) || null
    : null;
  const responseDrawerResult = responseDrawerKey ? debugResults[responseDrawerKey] : undefined;

  const endpointColumns = useMemo<DataTableColumn<EndpointRow>[]>(() => [
    {
      id: 'endpoint',
      header: 'Endpoint',
      render: (row) => (
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <StatusPill tone={METHOD_TONES[row.endpoint.method]} className="h-5 px-1.5 py-0 font-mono text-[10px]">
              {row.endpoint.method}
            </StatusPill>
            <span className="min-w-0 truncate font-mono text-[11px]">{row.endpoint.path}</span>
          </div>
          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{row.endpoint.description}</div>
        </div>
      ),
    },
    {
      id: 'category',
      header: 'Category',
      width: 110,
      hideBelow: 'xl',
      render: (row) => (
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="material-symbols-outlined text-sm">{row.category.icon}</span>
          <span className="truncate">{row.category.name}</span>
        </div>
      ),
    },
  ], []);

  const copyToClipboard = async (text: string) => {
    const ok = await copyText(text);
    if (!ok) return;
    setCopiedPath(text);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  const exportCollection = () => {
    const collection = {
      name: 'CSIHarness API',
      exportedAt: new Date().toISOString(),
      endpoints: API_DATA.flatMap((category) =>
        category.endpoints.map((endpoint) => ({
          category: category.name,
          method: endpoint.method,
          path: endpoint.path,
          url: materializeExamplePath(endpoint.path),
          description: endpoint.description,
          requestBody: endpoint.requestBody,
          response: endpoint.response,
          exampleBody: endpoint.exampleBody || schemaToExample(endpoint.requestBody),
          exampleResponse: endpoint.exampleResponse || schemaToExample(endpoint.response),
          notes: endpoint.notes || [],
        }))
      ),
    };
    copyToClipboard(JSON.stringify(collection, null, 2));
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
        <PageHeader
          title="API Documentation"
          subtitle={`${totalEndpoints} endpoints across ${API_DATA.length} categories`}
          status={<StatusPill tone="accent">{visibleEndpoints} visible</StatusPill>}
          leading={(
            <Link href="/dashboard" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-muted" aria-label="Back to dashboard">
              <span className="material-symbols-outlined text-xl">arrow_back</span>
            </Link>
          )}
          secondaryActions={(
            <>
              <LanguageToggle />
              <ThemeToggle />
            </>
          )}
          primaryAction={(
            <Button variant="outline" onClick={exportCollection}>
              <span className="material-symbols-outlined mr-2 text-base">content_copy</span>
              Export collection
            </Button>
          )}
        />
      ) : null}

      <PageToolbar
        search={(
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-lg text-muted-foreground">search</span>
            <Input
              placeholder="Search endpoints, methods, descriptions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        )}
        filters={(
          <div className="flex flex-wrap items-center gap-1.5">
            {METHOD_FILTERS.map((method) => (
              <Button
                key={method}
                type="button"
                size="sm"
                variant={methodFilter === method ? 'secondary' : 'outline'}
                onClick={() => setMethodFilter(method)}
                className="h-8"
              >
                {method}
                <span className="ml-1 text-[11px] text-muted-foreground">{methodCounts[method]}</span>
              </Button>
            ))}
          </div>
        )}
        actions={isDashboardShell ? (
          <Button variant="outline" size="sm" onClick={exportCollection}>
            <span className="material-symbols-outlined mr-2 text-base">content_copy</span>
            Export collection
          </Button>
        ) : null}
        activeFilters={search || methodFilter !== 'ALL' ? (
          <>
            {search ? <StatusPill tone="neutral" dot={false}>Search: {search}</StatusPill> : null}
            {methodFilter !== 'ALL' ? <StatusPill tone="accent">{methodFilter}</StatusPill> : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch('');
                setMethodFilter('ALL');
              }}
              className="h-7 px-2 text-xs"
            >
              Clear
            </Button>
          </>
        ) : null}
      />

      <div className="px-4 py-4 sm:px-6">
        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
          <aside className="xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)] xl:overflow-auto">
            <DataCard className="p-0">
              <DataCardHeader className="border-b border-border px-4 py-3">
                <div>
                  <DataCardTitle>Endpoint directory</DataCardTitle>
                  <DataCardDescription>{visibleEndpoints} matching endpoints</DataCardDescription>
                </div>
              </DataCardHeader>
              <div className="max-h-[520px] overflow-auto p-3 xl:max-h-none">
                <DataTable
                  columns={endpointColumns}
                  rows={allFilteredEndpoints}
                  rowKey="key"
                  density="compact"
                  stickyHeader
                  onRowClick={(row) => setSelectedEndpointKey(row.key)}
                  emptyState={{
                    title: 'No endpoints found',
                    description: `No endpoint matches "${search || methodFilter}".`,
                    className: 'min-h-[260px]',
                  }}
                  className="text-xs"
                  tableClassName="[&_tr[data-state=selected]]:bg-accent"
                  aria-label="Endpoint directory"
                />
              </div>
            </DataCard>
          </aside>

          {activeEndpointEntry ? (() => {
            const { category, endpoint, key } = activeEndpointEntry;
            const debugState = ensureDebugState(key, endpoint);
            const debugResult = debugResults[key];
            const requestExample = normalizeCodeBlock(endpoint.exampleBody || schemaToExample(endpoint.requestBody));
            const responseExample = normalizeCodeBlock(endpoint.exampleResponse || schemaToExample(endpoint.response));
            const requestSchema = schemaToDisplayModel(endpoint.requestBody);
            const responseSchema = schemaToDisplayModel(endpoint.response);
            const examplePath = materializeExamplePath(endpoint.path);
            const responseTone = debugResult?.loading
              ? 'info'
              : debugResult?.error
                ? 'danger'
                : debugResult?.status && debugResult.status >= 200 && debugResult.status < 300
                  ? 'success'
                  : debugResult?.status
                    ? 'warning'
                    : 'neutral';

            return (
              <>
                <main className="min-w-0 space-y-4">
                  <DataCard id={`endpoint-${encodeURIComponent(key)}`} className="p-0">
                    <DataCardHeader className="border-b border-border px-5 py-4">
                      <div className="min-w-0 space-y-2">
                        <DataCardMeta className="mt-0">
                          <StatusPill tone="neutral" dot={false}>{category.name}</StatusPill>
                          <StatusPill tone={METHOD_TONES[endpoint.method]} className="font-mono">{endpoint.method}</StatusPill>
                        </DataCardMeta>
                        <DataCardTitle className="whitespace-normal break-all font-mono text-base">{endpoint.path}</DataCardTitle>
                        <DataCardDescription>{endpoint.description}</DataCardDescription>
                        {endpoint.notes?.length ? (
                          <div className="space-y-1 text-xs text-amber-700">
                            {endpoint.notes.map((note) => <div key={note}>{note}</div>)}
                          </div>
                        ) : null}
                      </div>
                      <DataCardActions className="mt-0 shrink-0">
                        <Button variant="outline" size="sm" onClick={() => copyToClipboard(endpoint.path)}>
                          <span className="material-symbols-outlined mr-2 text-base">content_copy</span>
                          {copiedPath === endpoint.path ? 'Copied' : 'Copy URL'}
                        </Button>
                      </DataCardActions>
                    </DataCardHeader>

                    <section className="border-b border-border px-5 py-5">
                      <h2 className="mb-4 text-sm font-semibold text-foreground">API format</h2>
                      <div className="space-y-4">
                        <div className="grid gap-3 lg:grid-cols-[120px_minmax(0,1fr)]">
                          <div className="text-xs font-medium text-muted-foreground">Method</div>
                          <StatusPill tone={METHOD_TONES[endpoint.method]} className="w-fit font-mono">{endpoint.method}</StatusPill>
                        </div>
                        <div className="grid gap-3 lg:grid-cols-[120px_minmax(0,1fr)]">
                          <div className="text-xs font-medium text-muted-foreground">Path</div>
                          <code className="block break-all rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">{endpoint.path}</code>
                        </div>
                        {endpoint.requestBody && requestSchema ? (
                          <div className="grid gap-3 lg:grid-cols-[120px_minmax(0,1fr)]">
                            <div className="pt-2 text-xs font-medium text-muted-foreground">Request</div>
                            <SchemaDisplay title="Request Schema" schema={requestSchema} />
                          </div>
                        ) : null}
                        {endpoint.response && responseSchema ? (
                          <div className="grid gap-3 lg:grid-cols-[120px_minmax(0,1fr)]">
                            <div className="pt-2 text-xs font-medium text-muted-foreground">Response</div>
                            <SchemaDisplay title="Response Schema" schema={responseSchema} />
                          </div>
                        ) : null}
                      </div>
                    </section>

                    <section className="px-5 py-5">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold text-foreground">Examples</h2>
                        <Button variant="outline" size="sm" onClick={() => copyToClipboard(buildCurlExample(endpoint, debugState))}>
                          <span className="material-symbols-outlined mr-2 text-base">content_copy</span>
                          {copiedPath === buildCurlExample(endpoint, debugState) ? 'Copied' : 'Copy cURL'}
                        </Button>
                      </div>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="space-y-3">
                          <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">Example URL</div>
                            <code className="block break-all rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">{examplePath}</code>
                          </div>
                          {endpoint.requestBody ? (
                            <div>
                              <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                                <span>Request Example</span>
                                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => copyToClipboard(requestExample || endpoint.requestBody || '')}>Copy</Button>
                              </div>
                              <pre className="max-h-[320px] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">{requestExample || endpoint.requestBody}</pre>
                            </div>
                          ) : null}
                        </div>
                        <div className="space-y-3">
                          {endpoint.response ? (
                            <div>
                              <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                                <span>Response Example</span>
                                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => copyToClipboard(responseExample || endpoint.response || '')}>Copy</Button>
                              </div>
                              <pre className="max-h-[320px] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">{responseExample || endpoint.response}</pre>
                            </div>
                          ) : null}
                          <div>
                            <div className="mb-1 text-xs font-medium text-muted-foreground">cURL</div>
                            <pre className="max-h-[320px] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs">{buildCurlExample(endpoint, debugState)}</pre>
                          </div>
                        </div>
                      </div>
                    </section>
                  </DataCard>
                </main>

                <aside className="xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)] xl:overflow-auto">
                  <DataCard className="p-0">
                    <DataCardHeader className="border-b border-border px-4 py-3">
                      <div>
                        <DataCardTitle>Test request</DataCardTitle>
                        <DataCardDescription>Edits apply only to the selected endpoint.</DataCardDescription>
                      </div>
                      {debugResult ? (
                        <StatusPill tone={responseTone}>
                          {debugResult.loading ? 'Sending' : debugResult.status !== null ? debugResult.status : 'Error'}
                        </StatusPill>
                      ) : null}
                    </DataCardHeader>
                    <div className="space-y-4 p-4">
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Requests run against the current app session. Mutating endpoints can change real data.
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground" htmlFor="api-debug-url">URL</label>
                        <Input
                          id="api-debug-url"
                          value={debugState.url}
                          onChange={(e) => updateDebugState(key, { url: e.target.value }, endpoint)}
                          className="font-mono text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground" htmlFor="api-debug-headers">Auth headers</label>
                        <Textarea
                          id="api-debug-headers"
                          value={debugState.headers}
                          onChange={(e) => updateDebugState(key, { headers: e.target.value }, endpoint)}
                          className="min-h-[108px] font-mono text-xs"
                        />
                      </div>
                      {endpoint.method !== 'GET' ? (
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground" htmlFor="api-debug-body">Request body</label>
                          <Textarea
                            id="api-debug-body"
                            value={debugState.body}
                            onChange={(e) => updateDebugState(key, { body: e.target.value }, endpoint)}
                            className="min-h-[180px] font-mono text-xs"
                          />
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={() => runRequest(key, endpoint)} disabled={debugResult?.loading}>
                          <span className="material-symbols-outlined mr-2 text-base">send</span>
                          {debugResult?.loading ? 'Sending...' : 'Send'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDebugStates((prev) => ({ ...prev, [key]: createInitialDebugState(endpoint) }))}
                        >
                          <span className="material-symbols-outlined mr-2 text-base">restart_alt</span>
                          Reset
                        </Button>
                      </div>
                    </div>
                  </DataCard>

                  <DataCard className="mt-4 p-0">
                    <DataCardHeader className="border-b border-border px-4 py-3">
                      <div>
                        <DataCardTitle>Response preview</DataCardTitle>
                        <DataCardDescription>{debugResult?.contentType || 'Run a request to inspect the response.'}</DataCardDescription>
                      </div>
                    </DataCardHeader>
                    <div className="p-4">
                      {debugResult ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusPill tone={responseTone}>
                              {debugResult.status !== null ? `${debugResult.status} ${debugResult.statusText}` : 'Request Error'}
                            </StatusPill>
                            {debugResult.contentType ? <span className="text-xs text-muted-foreground">{debugResult.contentType}</span> : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="ml-auto h-7 px-2 text-xs"
                              onClick={() => setResponseDrawerKey(key)}
                            >
                              Open detail
                            </Button>
                          </div>
                          <pre className={`max-h-[360px] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs ${debugResult.error ? 'text-red-700' : ''}`}>
                            {debugResult.error || debugResult.body || '(empty response body)'}
                          </pre>
                        </div>
                      ) : (
                        <EmptyState
                          title="No response yet"
                          description="Send the selected endpoint from the test panel."
                          className="min-h-[180px] px-4 py-6"
                        />
                      )}
                    </div>
                  </DataCard>
                </aside>
              </>
            );
          })() : (
            <main className="xl:col-span-2">
              <EmptyState
                title="No endpoints found"
                description="Adjust the search text or method filter to restore the endpoint list."
                primaryAction={<Button variant="outline" onClick={() => { setSearch(''); setMethodFilter('ALL'); }}>Clear filters</Button>}
              />
            </main>
          )}
        </div>
      </div>

      <DetailDrawer open={Boolean(responseDrawerKey)} onOpenChange={(open) => { if (!open) setResponseDrawerKey(null); }}>
        <DetailDrawerContent widthClassName="w-[min(640px,calc(100vw-1rem))]">
          <DetailDrawerHeader>
            <DetailDrawerTitle>Response detail</DetailDrawerTitle>
            <DetailDrawerDescription>
              {responseDrawerEntry ? `${responseDrawerEntry.endpoint.method} ${responseDrawerEntry.endpoint.path}` : 'No endpoint selected'}
            </DetailDrawerDescription>
          </DetailDrawerHeader>
          <DetailDrawerBody className="space-y-4">
            {responseDrawerResult ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill
                    tone={
                      responseDrawerResult.error
                        ? 'danger'
                        : responseDrawerResult.status && responseDrawerResult.status >= 200 && responseDrawerResult.status < 300
                          ? 'success'
                          : responseDrawerResult.status
                            ? 'warning'
                            : 'neutral'
                    }
                  >
                    {responseDrawerResult.status !== null
                      ? `${responseDrawerResult.status} ${responseDrawerResult.statusText}`
                      : 'Request Error'}
                  </StatusPill>
                  {responseDrawerResult.contentType ? (
                    <span className="text-xs text-muted-foreground">{responseDrawerResult.contentType}</span>
                  ) : null}
                </div>
                <pre className={`max-h-[calc(100vh-220px)] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs ${responseDrawerResult.error ? 'text-red-700' : ''}`}>
                  {responseDrawerResult.error || responseDrawerResult.body || '(empty response body)'}
                </pre>
              </>
            ) : (
              <EmptyState title="No response selected" description="Run a request and open its detail from the response preview." />
            )}
          </DetailDrawerBody>
          <DetailDrawerFooter>
            <Button variant="outline" onClick={() => setResponseDrawerKey(null)}>Close</Button>
          </DetailDrawerFooter>
        </DetailDrawerContent>
      </DetailDrawer>
    </div>
  );
}
