'use client';

import UniversalCard, { CardSchema } from './cards/UniversalCard';

interface ResultRendererProps {
  type: string;
  result: any;
  onAction?: (prompt: string) => void;
  onReloadResult?: () => void;
}

export default function ResultRenderer({ type, result, onAction, onReloadResult }: ResultRendererProps) {
  if (!result) return null;

  // Truncated results from persistence
  if (result._truncated) {
    return (
      <div className="mt-2 p-2 rounded border bg-muted/50 text-xs text-muted-foreground flex items-center gap-2">
        <span className="material-symbols-outlined text-sm">history</span>
        <span>结果已截断</span>
        {onReloadResult ? (
          <button className="text-primary hover:underline ml-1" onClick={onReloadResult}>
            点击重新加载
          </button>
        ) : onAction && (
          <button className="text-primary hover:underline ml-1" onClick={() => onAction('重新查询')}>
            点击重新加载
          </button>
        )}
      </div>
    );
  }

  // Convert result to UniversalCard schema based on type
  const card = resultToCard(type, result);
  if (card) {
    return <UniversalCard card={card} onAction={onAction} />;
  }

  // Success message for mutations
  if (result.success !== undefined) {
    return (
      <div className="mt-2">
        <div className="text-xs text-green-600 flex items-center gap-1">
          <span className="material-symbols-outlined text-sm">check</span>
          {result.message || '操作成功'}
        </div>
      </div>
    );
  }

  // Default: JSON preview
  return (
    <pre className="mt-2 p-2 rounded border bg-background text-xs overflow-x-auto max-h-60 overflow-y-auto">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

function toLineList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[\n,，、;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function truncateText(value: unknown, max = 320): string {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max).trimEnd()}...` : text;
}

// --- Result to CardSchema converters ---

function resultToCard(type: string, result: any): CardSchema | null {
  // config.list
  if (type === 'config.list' && result.configs) {
    return {
      header: { icon: 'description', title: '工作流配置列表', gradient: 'from-blue-500 to-cyan-500', badges: [{ text: `${result.configs.length} 个`, color: 'blue' }] },
      blocks: result.configs.length > 0
        ? [{
            type: 'table' as const,
            maxHeight: 360,
            columns: [
              { key: 'name', label: '名称', width: 'minmax(220px,1.8fr)' },
              { key: 'mode', label: '模式', width: '120px' },
              { key: 'steps', label: '步骤', width: '88px', align: 'right' as const },
              { key: 'agents', label: 'Agent', width: '88px', align: 'right' as const },
            ],
            rows: result.configs.map((c: any) => ({
              id: String(c.filename || c.name || Math.random()),
              cells: {
                name: c.name || c.filename || '未命名配置',
                mode: c.mode || 'phase-based',
                steps: c.stepCount !== undefined ? String(c.stepCount) : '—',
                agents: c.agentCount !== undefined ? String(c.agentCount) : '—',
              },
              badges: [
                ...(c.mode ? [{ text: c.mode, color: 'blue' }] : []),
                ...(c.filename ? [{ text: c.filename, color: 'gray' }] : []),
              ],
              detailTitle: c.name || c.filename || '工作流配置详情',
              detailBlocks: [
                ...(c.description ? [{ type: 'text' as const, content: c.description }] : []),
                {
                  type: 'info' as const,
                  rows: [
                    ...(c.filename ? [{ label: '文件', value: c.filename, icon: 'description' }] : []),
                    ...(c.mode ? [{ label: '模式', value: c.mode, icon: 'account_tree' }] : []),
                    ...(c.stepCount !== undefined ? [{ label: '步骤数', value: String(c.stepCount), icon: 'checklist' }] : []),
                    ...(c.agentCount !== undefined ? [{ label: 'Agent 数', value: String(c.agentCount), icon: 'smart_toy' }] : []),
                  ],
                },
                { type: 'actions' as const, items: [
                  { label: '打开', prompt: `查看工作流配置 ${c.filename} 的详细内容`, icon: 'open_in_new' },
                  { label: '启动', prompt: `启动工作流 ${c.filename}`, icon: 'play_arrow' },
                ]},
              ],
            })),
          }]
        : [{ type: 'text' as const, content: '暂无配置' }],
      actions: [
        { label: '创建新工作流', prompt: '帮我创建一个新的工作流', icon: 'add' },
        { label: '介绍这些工作流', prompt: '帮我介绍一下当前所有工作流的用途', icon: 'info' },
      ],
    };
  }

  // agent.list
  if (type === 'agent.list' && result.agents) {
    const teamColor = (t: string) => t === 'blue' ? 'blue' : t === 'red' ? 'red' : t === 'judge' ? 'yellow' : t === 'black-gold' ? 'orange' : 'gray';
    const teamLabel = (t: string) => t === 'blue' ? '蓝队' : t === 'red' ? '红队' : t === 'judge' ? '裁判' : t === 'black-gold' ? '常驻' : '其他';
    return {
      header: { icon: 'smart_toy', title: 'Agent 列表', gradient: 'from-purple-500 to-pink-500', badges: [{ text: `${result.agents.length} 个`, color: 'purple' }] },
      blocks: result.agents.length > 0
        ? [{
            type: 'table' as const,
            maxHeight: 360,
            columns: [
              { key: 'name', label: '名称', width: 'minmax(220px,1.8fr)' },
              { key: 'team', label: '阵营', width: '96px' },
              { key: 'model', label: '模型', width: '160px' },
              { key: 'capabilities', label: '能力', width: '88px', align: 'right' as const },
            ],
            rows: result.agents
              .slice()
              .sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')))
              .map((a: any) => {
                const capabilities = toLineList(a.capabilities || a.specialties);
                const promptPreview = truncateText(a.systemPrompt);
                return {
                  id: String(a._file || a.name || Math.random()),
                  cells: {
                    name: a.name || '未命名 Agent',
                    team: teamLabel(a.team || 'other'),
                    model: a.model || 'default',
                    capabilities: String(capabilities.length || 0),
                  },
                  badges: [
                    ...(a.team ? [{ text: teamLabel(a.team), color: teamColor(a.team) }] : []),
                    { text: a.model || 'default', color: 'purple' },
                    ...(a.roleType ? [{ text: a.roleType, color: 'gray' }] : []),
                  ],
                  detailTitle: a.name || 'Agent 详情',
                  detailBlocks: [
                    ...(a.description || a.role || a.mission
                      ? [{ type: 'text' as const, content: String(a.description || a.role || a.mission || '').trim() }]
                      : []),
                    {
                      type: 'info' as const,
                      rows: [
                        ...(a._file ? [{ label: '文件', value: a._file, icon: 'description' }] : []),
                        ...(a.team ? [{ label: '阵营', value: teamLabel(a.team), icon: 'groups' }] : []),
                        ...(a.model ? [{ label: '模型', value: a.model, icon: 'model_training' }] : []),
                        ...(a.workingDirectory ? [{ label: '工作目录', value: a.workingDirectory, icon: 'folder' }] : []),
                      ],
                    },
                    ...(capabilities.length > 0
                      ? [{
                          type: 'list' as const,
                          items: capabilities.slice(0, 8).map((item) => ({ icon: 'bolt', text: item })),
                        }]
                      : []),
                    ...(promptPreview
                      ? [{ type: 'code' as const, code: promptPreview, lang: 'text', copyable: true }]
                      : []),
                    { type: 'actions' as const, items: [
                      { label: '优化提示词', prompt: `帮我优化 Agent ${a.name} 的提示词`, icon: 'auto_fix_high' },
                    ]},
                  ],
                };
              }),
          }]
        : [{ type: 'text' as const, content: '暂无 Agent' }],
      actions: [
        { label: '创建新 Agent', prompt: '帮我创建一个新的 Agent', icon: 'add' },
        { label: '批量设置模型策略', prompt: '帮我批量设置 Agent 的模型策略', icon: 'swap_horiz' },
      ],
    };
  }

  // model.list
  if (type === 'model.list' && result.models) {
    return {
      header: { icon: 'model_training', title: '可用模型', gradient: 'from-cyan-500 to-teal-500' },
      blocks: result.models.length > 0
        ? [{
            type: 'table' as const,
            maxHeight: 320,
            columns: [
              { key: 'label', label: '名称', width: 'minmax(220px,1.5fr)' },
              { key: 'value', label: 'ID', width: 'minmax(240px,2fr)' },
              { key: 'cost', label: '成本', width: '88px', align: 'right' as const },
            ],
            rows: result.models.map((m: any) => ({
              id: String(m.value || m.label || Math.random()),
              cells: {
                label: m.label || '未命名模型',
                value: m.value || '—',
                cost: m.costMultiplier !== undefined ? `${m.costMultiplier}x` : '—',
              },
              detailTitle: m.label || '模型详情',
              detailBlocks: [{
                type: 'info' as const,
                rows: [
                  { label: '名称', value: m.label || '—', icon: 'model_training' },
                  { label: 'ID', value: m.value || '—' },
                  ...(m.costMultiplier !== undefined ? [{ label: '成本', value: `${m.costMultiplier}x` }] : []),
                ],
              }],
            })),
          }]
        : [{ type: 'text' as const, content: '暂无模型' }],
    };
  }

  // runs.list
  if (type === 'runs.list' && result.runs) {
    const statusColor = (s: string) => s === 'running' ? 'blue' : s === 'completed' ? 'green' : s === 'failed' ? 'red' : 'gray';
    return {
      header: { icon: 'history', title: '运行记录', gradient: 'from-green-500 to-emerald-500', badges: [{ text: `${result.runs.length} 条`, color: 'green' }] },
      blocks: result.runs.length > 0
        ? [{
            type: 'table' as const,
            maxHeight: 360,
            columns: [
              { key: 'name', label: '工作流', width: 'minmax(220px,1.8fr)' },
              { key: 'status', label: '状态', width: '110px' },
              { key: 'phase', label: '阶段', width: '140px' },
              { key: 'time', label: '开始时间', width: '180px' },
            ],
            rows: result.runs.map((r: any) => ({
              id: String(r.id || Math.random()),
              cells: {
                name: r.configName || r.configFile || r.id || '未命名运行',
                status: r.status || 'unknown',
                phase: r.currentPhase || '—',
                time: r.startTime ? new Date(r.startTime).toLocaleString() : '—',
              },
              badges: [{ text: r.status || 'unknown', color: statusColor(r.status || '') }],
              detailTitle: r.configName || r.configFile || r.id || '运行详情',
              detailBlocks: [
                {
                  type: 'status' as const,
                  state: r.status,
                  color: statusColor(r.status),
                  animated: r.status === 'running',
                  rows: [
                    ...(r.id ? [{ label: '运行 ID', value: r.id }] : []),
                    ...(r.currentPhase ? [{ label: '阶段', value: r.currentPhase }] : []),
                    ...(r.currentStep ? [{ label: '步骤', value: r.currentStep }] : []),
                    ...(r.startTime ? [{ label: '时间', value: new Date(r.startTime).toLocaleString() }] : []),
                  ],
                },
                ...(r.totalSteps ? [{ type: 'progress' as const, value: r.completedSteps || 0, max: r.totalSteps, label: `${r.completedSteps || 0}/${r.totalSteps} 步骤` }] : []),
                { type: 'actions' as const, items: [
                  { label: '查看详情', prompt: `查看运行 ${r.id} 的详细信息`, icon: 'info' },
                ]},
              ],
            })),
          }]
        : [{ type: 'text' as const, content: '暂无运行记录' }],
      actions: [
        { label: '启动新运行', prompt: '帮我启动一个工作流', icon: 'play_arrow' },
        { label: '查看运行状态', prompt: '查看当前工作流运行状态', icon: 'monitoring' },
      ],
    };
  }

  // workflow.status
  if (type === 'workflow.status') {
    const s = result;
    const isRunning = s.status === 'running';
    const statusColor = isRunning ? 'blue' : s.status === 'completed' ? 'green' : s.status === 'failed' ? 'red' : 'gray';
    return {
      header: { icon: 'play_circle', title: '工作流状态', gradient: isRunning ? 'from-blue-500 to-cyan-500' : 'from-gray-500 to-gray-600', badges: [{ text: s.status, color: statusColor }] },
      blocks: [
        { type: 'status', state: s.status, color: statusColor, animated: isRunning, rows: [
          ...(s.currentConfigFile ? [{ label: '配置', value: s.currentConfigFile }] : []),
          ...(s.currentPhase ? [{ label: '阶段', value: s.currentPhase }] : []),
          ...(s.currentStep ? [{ label: '步骤', value: s.currentStep }] : []),
        ]},
      ],
      actions: [
        ...(isRunning ? [{ label: '停止工作流', prompt: '停止当前工作流', icon: 'stop' }] : []),
        ...(s.status === 'pending_approval' ? [{ label: '批准', prompt: '批准当前检查点', icon: 'check' }] : []),
        ...(s.status === 'idle' ? [{ label: '启动工作流', prompt: '帮我启动一个工作流', icon: 'play_arrow' }] : []),
        { label: '查看配置列表', prompt: '列出所有工作流配置', icon: 'list' },
      ],
    };
  }

  // skill.list
  if (type === 'skill.list' && result.skills) {
    return {
      header: { icon: 'extension', title: 'Skills 列表', gradient: 'from-pink-500 to-rose-500' },
      blocks: result.skills.length > 0
        ? result.skills.map((s: any) => ({
            type: 'collapse' as const,
            title: s.name,
            subtitle: s.version ? `v${s.version}` : undefined,
            blocks: [
              ...(s.description ? [{ type: 'text' as const, content: s.description }] : []),
              ...(s.tags?.length ? [{ type: 'badges' as const, items: s.tags.map((t: string) => ({ text: t, color: 'pink' })) }] : []),
            ],
          }))
        : [{ type: 'text' as const, content: '暂无 Skills' }],
    };
  }

  // prompt.analyze / prompt.optimize
  if ((type === 'prompt.analyze' || type === 'prompt.optimize') && result.analysis) {
    const a = result.analysis;
    return {
      header: { icon: 'analytics', title: `提示词分析${result.agentName ? ` · ${result.agentName}` : ''}`, gradient: 'from-amber-500 to-orange-500' },
      blocks: [
        { type: 'progress', value: a.score, max: 100, label: `评分: ${a.score}/100` },
        ...(a.strengths?.length ? [{ type: 'list' as const, items: a.strengths.map((s: string) => ({ icon: 'check_circle', color: 'text-green-400', text: s })) }] : []),
        ...(a.weaknesses?.length ? [{ type: 'list' as const, items: a.weaknesses.map((w: string) => ({ icon: 'warning', color: 'text-red-400', text: w })) }] : []),
        ...(a.suggestions?.length ? [{ type: 'list' as const, items: a.suggestions.map((s: string) => ({ icon: 'lightbulb', color: 'text-blue-400', text: s })) }] : []),
        ...(a.optimizedPrompt ? [{ type: 'collapse' as const, title: '优化后的提示词', icon: 'auto_fix_high', blocks: [{ type: 'code' as const, code: a.optimizedPrompt, copyable: true }] }] : []),
      ],
      actions: [
        ...(a.optimizedPrompt && result.agentName ? [{ label: '应用此优化版本', prompt: `请将优化后的提示词应用到 Agent ${result.agentName} 的配置中`, icon: 'check' }] : []),
        { label: '继续优化', prompt: '继续优化这个提示词，方向是更精确更简洁', icon: 'auto_fix_high' },
      ],
    };
  }

  // wizard.*
  if (type.startsWith('wizard.') && result.wizardType) {
    const colors: Record<string, string> = { workflow: 'from-blue-500 to-cyan-500', agent: 'from-purple-500 to-pink-500', skill: 'from-orange-500 to-amber-500' };
    const icons: Record<string, string> = { workflow: 'account_tree', agent: 'smart_toy', skill: 'extension' };
    const labels: Record<string, string> = { workflow: '工作流创建向导', agent: 'Agent 创建向导', skill: 'Skill 创建向导' };
    const hints = result.data?.hints || [];
    return {
      header: { icon: icons[result.wizardType] || 'magic_button', title: labels[result.wizardType] || '创建向导', gradient: colors[result.wizardType] || 'from-blue-500 to-cyan-500', badges: [{ text: `${result.step}/${result.totalSteps}`, color: 'blue' }] },
      blocks: [
        { type: 'steps', current: result.step, total: result.totalSteps },
        { type: 'text', content: result.data?.title || `步骤 ${result.step}` },
      ],
      actions: hints.map((h: string) => ({ label: h, prompt: h })),
    };
  }

  // config.get
  if (type === 'config.get' && result.config) {
    const cfg = result.config;
    const wf = cfg.workflow || {};
    const mode = wf.mode || 'phase-based';
    const phases = wf.phases || [];
    const states = wf.states || [];
    const items = mode === 'state-machine' ? states : phases;
    return {
      header: { icon: 'description', title: wf.name || '工作流配置', subtitle: wf.description, gradient: 'from-blue-500 to-cyan-500', badges: [{ text: mode, color: 'blue' }] },
      blocks: [
        { type: 'tabs', tabs: [
          { key: 'visual', label: '可视化', blocks: items.map((p: any) => ({
            type: 'collapse' as const, title: p.name, subtitle: `${(p.steps || []).length} 步骤`, defaultOpen: false,
            blocks: (p.steps || []).map((s: any) => ({
              type: 'info' as const, rows: [
                { label: '步骤', value: s.name, icon: s.role === 'attacker' ? 'swords' : s.role === 'judge' ? 'gavel' : 'shield' },
                { label: 'Agent', value: s.agent },
              ],
            })),
          }))},
          { key: 'source', label: '源码', blocks: [
            { type: 'code' as const, code: typeof result.raw === 'string' ? result.raw : JSON.stringify(cfg, null, 2), lang: 'yaml', copyable: true },
          ]},
        ]},
      ],
      actions: [
        { label: '分析此工作流', prompt: `帮我分析这个工作流的设计`, icon: 'analytics' },
        { label: '启动运行', prompt: `启动工作流`, icon: 'play_arrow' },
      ],
    };
  }

  // agent.get
  if (type === 'agent.get' && result.agent) {
    const a = result.agent;
    const teamColor = a.team === 'blue' ? 'blue' : a.team === 'red' ? 'red' : a.team === 'judge' ? 'yellow' : 'gray';
    const sysPrompt = a.system_prompt || a.systemPrompt || '';
    return {
      header: { icon: 'smart_toy', title: a.name || '未命名 Agent', subtitle: a.role, gradient: 'from-purple-500 to-pink-500', badges: [
        ...(a.team ? [{ text: a.team, color: teamColor }] : []),
        { text: a.model || 'default', color: 'purple' },
      ]},
      blocks: [
        { type: 'tabs', tabs: [
          { key: 'info', label: '信息', blocks: [
            { type: 'info', rows: [
              { label: '名称', value: a.name || '', icon: 'badge' },
              { label: '角色', value: a.role || '', icon: 'work' },
              { label: '团队', value: a.team || '', icon: 'group' },
              { label: '模型', value: a.model || 'default', icon: 'model_training' },
            ]},
          ]},
          { key: 'prompts', label: '提示词', blocks: [
            ...(sysPrompt ? [{ type: 'collapse' as const, title: '系统提示词', subtitle: `${sysPrompt.length} 字`, blocks: [
              { type: 'code' as const, code: sysPrompt, copyable: true },
              { type: 'actions' as const, items: [
                { label: '优化此提示词', prompt: `优化 Agent ${a.name} 的系统提示词`, icon: 'auto_fix_high' },
                { label: '分析', prompt: `分析 Agent ${a.name} 的系统提示词的优缺点`, icon: 'analytics' },
              ]},
            ]}] : []),
          ]},
          { key: 'source', label: '源码', blocks: [
            { type: 'code' as const, code: typeof result.raw === 'string' ? result.raw : JSON.stringify(a, null, 2), lang: 'yaml', copyable: true },
          ]},
        ]},
      ],
      actions: [
        { label: '优化提示词', prompt: `帮我优化 Agent ${a.name} 的提示词`, icon: 'auto_fix_high' },
      ],
    };
  }

  // Generic fallback for other action types - show a basic card with "View Details" action
  if (type && result && typeof result === 'object' && !result.success) {
    const actionName = type.split('.').pop() || type;
    const hasData = Object.keys(result).length > 0;
    
    if (hasData) {
      return {
        header: { 
          icon: 'info', 
          title: `${actionName} 结果`, 
          gradient: 'from-gray-500 to-slate-500' 
        },
        blocks: [
          {
            type: 'collapse' as const,
            title: '查看详情',
            subtitle: '点击展开查看完整结果',
            blocks: [
              {
                type: 'code' as const,
                code: JSON.stringify(result, null, 2),
                lang: 'json',
                copyable: true
              }
            ]
          }
        ],
        actions: [
          { label: '查看详情', prompt: `查看 ${type} 的详细信息`, icon: 'info' }
        ]
      };
    }
  }

  return null;
}
