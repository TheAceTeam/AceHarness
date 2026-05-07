'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useTranslations } from '@/hooks/useTranslations';
import { copyText } from '@/lib/clipboard';

interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  description: string;
  requestBody?: string;
  response?: string;
}

interface ApiCategory {
  name: string;
  icon: string;
  endpoints: ApiEndpoint[];
}

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
      { method: 'GET', path: '/api/workflow/events', description: 'SSE 事件流，实时推送工作流进度', response: 'text/event-stream: status, phase, step, result, checkpoint ...' },
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
      { method: 'GET', path: '/api/runs/:id/stream?step=name&live=true', description: '获取步骤内容（live=true 为 SSE，否则返回 JSON）', response: 'JSON: { step, content } | SSE: delta/thinking/done' },
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
      { method: 'POST', path: '/api/agents/batch', description: '批量替换 Agent 模型', requestBody: '{ action: "replace-model", fromModel, toModel }', response: '{ success, updatedCount }' },
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
      { method: 'POST', path: '/api/chat', description: '发送消息并获取回复（阻塞）', requestBody: '{ message, model?, engine?, sessionId?, mode? }', response: '{ result, sessionId, engine, costUsd?, isError }' },
      { method: 'POST', path: '/api/chat/stream', description: '启动流式对话', requestBody: '{ message, model?, engine?, sessionId?, frontendSessionId?, mode? }', response: '{ chatId }' },
      { method: 'GET', path: '/api/chat/stream?id=chatId', description: 'SSE 流式对话响应', response: 'text/event-stream: delta, done, error' },
      { method: 'GET', path: '/api/chat/stream?checkActive=frontendSessionId', description: '检查会话是否有活跃流式任务', response: '{ active, chatId?, streamContent?, status?, engine? }' },
      { method: 'DELETE', path: '/api/chat/stream?id=chatId', description: '终止流式对话', response: '{ killed }' },
      { method: 'GET', path: '/api/chat/stream/active?frontendSessionId=id', description: '检查指定前端会话是否存在活跃流式任务', response: '{ active, chatId?, status?, streamContent? }' },
      { method: 'GET', path: '/api/chat/stream/recover?sessionId=id', description: '按后端 sessionId 恢复已累计内容（非 SSE）', response: '{ content, status, startNew? }' },
      { method: 'GET', path: '/api/chat/sessions', description: '列出所有对话会话', response: '{ sessions }' },
      { method: 'POST', path: '/api/chat/sessions', description: '创建对话会话', requestBody: '{ id?, title?, model?, engine? }', response: '{ session }' },
      { method: 'GET', path: '/api/chat/sessions/:id', description: '获取指定会话', response: '{ session }' },
      { method: 'PUT', path: '/api/chat/sessions/:id', description: '更新会话', requestBody: '{ [key]: any }', response: '{ ok }' },
      { method: 'DELETE', path: '/api/chat/sessions/:id', description: '删除会话', response: '{ ok }' },
      { method: 'GET', path: '/api/chat/settings', description: '获取对话设置', response: '{ skills, discoveredSkills }' },
      { method: 'PUT', path: '/api/chat/settings', description: '更新对话设置', requestBody: '{ skills: Record<string, boolean> }', response: '{ success }' },
      { method: 'GET', path: '/api/chat/debug-prompt', description: '获取对话调试 Prompt 信息', response: '{ success, debug }' },
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

// PLACEHOLDER_COMPONENT
export default function ApiDocsPage() {
  const [search, setSearch] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(API_DATA[0]?.name || null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const { t } = useTranslations();

  useDocumentTitle('API 文档');

  const filteredData = search.trim()
    ? API_DATA.map(cat => ({
        ...cat,
        endpoints: cat.endpoints.filter(ep =>
          ep.path.toLowerCase().includes(search.toLowerCase()) ||
          ep.description.toLowerCase().includes(search.toLowerCase()) ||
          ep.method.toLowerCase().includes(search.toLowerCase())
        ),
      })).filter(cat => cat.endpoints.length > 0)
    : API_DATA;

  const totalEndpoints = API_DATA.reduce((sum, cat) => sum + cat.endpoints.length, 0);

  const copyToClipboard = async (text: string) => {
    const ok = await copyText(text);
    if (!ok) return;
    setCopiedPath(text);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="p-2 rounded-lg hover:bg-muted transition-colors">
                <span className="material-symbols-outlined text-xl">arrow_back</span>
              </Link>
              <div>
                <h1 className="text-2xl font-bold">API Documentation</h1>
                <p className="text-xs text-muted-foreground">{totalEndpoints} endpoints across {API_DATA.length} categories</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-6">
        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-lg">search</span>
            <Input
              placeholder="Search endpoints..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Category list */}
        <div className="space-y-4">
          {filteredData.map(category => {
            const isExpanded = expandedCategory === category.name || search.trim().length > 0;
            return (
              <div key={category.name} className="border border-border/50 rounded-xl overflow-hidden bg-card/50 backdrop-blur-sm">
                {/* Category header */}
                <button
                  onClick={() => setExpandedCategory(isExpanded && !search.trim() ? null : category.name)}
                  className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-primary">{category.icon}</span>
                    <span className="text-lg font-semibold">{category.name}</span>
                    <Badge variant="secondary" className="text-xs">{category.endpoints.length}</Badge>
                  </div>
                  <span className={`material-symbols-outlined text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    expand_more
                  </span>
                </button>

                {/* Endpoints */}
                {isExpanded && (
                  <div className="border-t border-border/30">
                    <div className="divide-y divide-border/20">
                      {category.endpoints.map((ep, i) => (
                        <div key={i} className="px-6 py-4 hover:bg-muted/30 transition-colors">
                          <div className="flex items-start gap-3">
                            {/* Method badge */}
                            <Badge variant="outline" className={`${METHOD_COLORS[ep.method]} font-mono text-xs shrink-0 min-w-[60px] justify-center`}>
                              {ep.method}
                            </Badge>

                            <div className="flex-1 min-w-0 space-y-2">
                              {/* Path */}
                              <div className="flex items-center gap-2">
                                <code
                                  className="text-sm font-mono cursor-pointer hover:text-primary transition-colors"
                                  onClick={() => copyToClipboard(ep.path)}
                                  title="Click to copy"
                                >
                                  {ep.path}
                                </code>
                                {copiedPath === ep.path && (
                                  <span className="text-xs text-green-500">Copied!</span>
                                )}
                              </div>

                              {/* Description */}
                              <p className="text-sm text-muted-foreground">{ep.description}</p>

                              {/* Request / Response */}
                              <div className="flex flex-wrap gap-4 text-xs">
                                {ep.requestBody && (
                                  <div className="space-y-1">
                                    <span className="text-muted-foreground font-medium">Request Body:</span>
                                    <code className="block bg-muted/50 rounded px-2 py-1 font-mono text-foreground/80">{ep.requestBody}</code>
                                  </div>
                                )}
                                {ep.response && (
                                  <div className="space-y-1">
                                    <span className="text-muted-foreground font-medium">Response:</span>
                                    <code className="block bg-muted/50 rounded px-2 py-1 font-mono text-foreground/80">{ep.response}</code>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filteredData.length === 0 && (
            <div className="text-center text-muted-foreground py-16">
              No endpoints match &quot;{search}&quot;
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
