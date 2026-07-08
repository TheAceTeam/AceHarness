'use client';

import { useMemo, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ObjectEditDrawer } from '@/components/ui/object-edit-drawer';
import SpriteAvatar from '@/components/SpriteAvatar';
import { ModelSelect } from '@/components/ModelSelect';
import { EngineSelect } from '@/components/EngineSelect';
import { getEngineMeta } from '@/lib/core/engine-metadata';
import { MultiCombobox, SingleCombobox } from '@/components/ui/combobox';
import {
  createDeterministicAvatarConfig,
  normalizeAgentAvatar,
  resolveAgentAvatarSrc,
  type AgentAvatarConfig,
} from '@/lib/agent/personas';
import { useToast } from '@/components/ui/toast';
import {
  useAgentMemoryQuery,
  useAgentsQuery,
  useClearAgentMemoryMutation,
  useGenerateAgentAvatarMutation,
  useSaveAgentMemoryMutation,
} from '@/client/query/agents';
import { useEngineConfigQuery } from '@/client/query/engines';
import { useSkillsQuery } from '@/client/query/skills';
import { useRagKnowledgeBasesQuery } from '@/client/query/rag';

interface SubAgent {
  description: string;
  prompt: string;
  tools: string[];
  model: string;
}

interface ReviewPanel {
  enabled: boolean;
  description?: string;
  subAgents: Record<string, SubAgent>;
}

interface AgentWorkspaceProfile {
  displayName?: string;
  nickname?: string;
  officeRole?: string;
  residency?: {
    office?: boolean;
    meetingRoom?: boolean;
    defaultDirectRoom?: boolean;
  };
  roomPresence?: {
    recommendForMeetingRoom?: boolean;
    autoShowInOffice?: boolean;
  };
  visual?: {
    accent?: string;
    deskVariant?: string;
    desk?: string;
    order?: number;
  };
  memory?: {
    baseBudget?: number;
    deepSearchEnabled?: boolean;
  };
}

interface AgentConfig {
  name: string;
  team: 'blue' | 'red' | 'judge' | 'black-gold';
  roleType?: 'normal' | 'supervisor';
  avatar?: AgentAvatarConfig | string;
  category?: string;
  tags?: string[];
  engineModels: Record<string, string>;
  activeEngine: string;
  temperature?: number;
  systemPrompt?: string;
  iterationPrompt?: string;
  capabilities?: string[];
  constraints?: string[];
  skills?: string[];
  mcpServers?: string[];
  ragKnowledgeBases?: string[];
  reviewPanel?: ReviewPanel;
  keywords?: string[];
  description?: string;
  alwaysAvailableForChat?: boolean;
  workspaceProfile?: AgentWorkspaceProfile;
}

interface AgentEditModalProps {
  agent: AgentConfig;
  isNew: boolean;
  onSave: (agent: AgentConfig) => void;
  onClose: () => void;
}

const CATEGORIES = ['测试', '编码', '设计', '压力测试', '审查', '文档', '其他'];

type ListField = 'capabilities' | 'constraints' | 'keywords';

const BASE_AGENT_SUGGESTIONS = {
  capabilities: ['问题定位', '代码实现', '测试设计', '代码审查', '架构设计', '文档整理'],
  constraints: ['保持最小改动', '先读代码再修改', '输出可执行步骤', '说明验证结果', '不引入无关重构', '遇到不确定先标注风险'],
  keywords: ['需求', '架构', '接口', '模块', 'API', '测试', '构建', '性能', '安全', '文档'],
};

const TEAM_AGENT_SUGGESTIONS: Record<AgentConfig['team'], Partial<Record<ListField, string[]>>> = {
  blue: {
    capabilities: ['挑战假设', '边界测试', '缺陷挖掘', '压力验证'],
    keywords: ['攻击', '边界', '异常', '复现', '风险'],
  },
  red: {
    capabilities: ['修复实施', '回归验证', '风险收敛', '兼容性处理'],
    keywords: ['修复', '实现', '回归', '兼容', '交付'],
  },
  judge: {
    capabilities: ['结果裁定', '证据归档', '质量评估', '验收判定'],
    keywords: ['裁定', '验证', '证据', '结论', '验收'],
  },
  'black-gold': {
    capabilities: ['任务分解', '路由决策', '进度协调', '风险调度'],
    keywords: ['调度', '路由', '协调', '计划', '分配'],
  },
};

const SUPERVISOR_AGENT_SUGGESTIONS: Partial<Record<ListField, string[]>> = {
  capabilities: ['任务拆解', 'Agent 编排', '状态跟踪', '冲突协调'],
  keywords: ['指挥', '协同', '编排', '状态', '下一步'],
};

function uniqueList(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function getAgentSuggestions(agent: Pick<AgentConfig, 'team' | 'roleType'>) {
  const teamSuggestions = TEAM_AGENT_SUGGESTIONS[agent.team] || {};
  const roleSuggestions = agent.roleType === 'supervisor' ? SUPERVISOR_AGENT_SUGGESTIONS : {};
  return {
    capabilities: uniqueList([
      ...(teamSuggestions.capabilities || []),
      ...(roleSuggestions.capabilities || []),
      ...BASE_AGENT_SUGGESTIONS.capabilities,
    ]),
    constraints: uniqueList([
      ...(teamSuggestions.constraints || []),
      ...(roleSuggestions.constraints || []),
      ...BASE_AGENT_SUGGESTIONS.constraints,
    ]),
    keywords: uniqueList([
      ...(teamSuggestions.keywords || []),
      ...(roleSuggestions.keywords || []),
      ...BASE_AGENT_SUGGESTIONS.keywords,
    ]),
  };
}

export default function AgentEditModal({ agent, isNew, onSave, onClose }: AgentEditModalProps) {
  const { toast } = useToast();
  const normalizedEngineModels = { ...(agent.engineModels || {}) };
  if ((agent as any).model && !(agent.activeEngine || '').trim()) {
    delete normalizedEngineModels[''];
  }
  if (normalizedEngineModels['']) {
    delete normalizedEngineModels[''];
  }
  const normalizedAgent = {
    ...agent,
    engineModels: normalizedEngineModels,
    activeEngine: agent.activeEngine ?? '',
    roleType: agent.roleType ?? 'normal',
    avatar: normalizeAgentAvatar(agent.avatar, agent.name || 'agent', {
      team: agent.team || 'red',
      roleType: agent.roleType || 'normal',
    }),
    alwaysAvailableForChat: agent.alwaysAvailableForChat ?? false,
    skills: agent.skills || [],
    mcpServers: (agent.mcpServers || []).map((server: any) => typeof server === 'string' ? server : server?.name).filter(Boolean),
    ragKnowledgeBases: agent.ragKnowledgeBases || [],
    workspaceProfile: agent.workspaceProfile || {},
  };
  const [formData, setFormData] = useState<AgentConfig>(normalizedAgent);
  const [initialFormSnapshot] = useState(() => JSON.stringify(normalizedAgent));
  const [newTag, setNewTag] = useState('');
  const [newCapability, setNewCapability] = useState('');
  const [newConstraint, setNewConstraint] = useState('');
  const [editingSubAgent, setEditingSubAgent] = useState<{ name: string; config: SubAgent } | null>(null);
  const [newSubAgentName, setNewSubAgentName] = useState('');
  const [refreshingAvatar, setRefreshingAvatar] = useState(false);
  const [globalEngine, setGlobalEngine] = useState('');
  const [globalDefaultModel, setGlobalDefaultModel] = useState('');
  const [availableSkills, setAvailableSkills] = useState<Array<{ name: string; description?: string }>>([]);
  const [availableMcpServers, setAvailableMcpServers] = useState<Array<{ name: string; command?: string }>>([]);
  const [availableKnowledgeBases, setAvailableKnowledgeBases] = useState<Array<{ id: string; name: string; description?: string; chunkCount?: number }>>([]);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const memoryMaxChars = Math.max(0, Math.min(50000, Number(formData.workspaceProfile?.memory?.baseBudget || 5000)));
  const engineConfigQuery = useEngineConfigQuery();
  const agentsQuery = useAgentsQuery();
  const skillsQuery = useSkillsQuery();
  const ragKnowledgeBasesQuery = useRagKnowledgeBasesQuery();
  const agentMemoryQuery = useAgentMemoryQuery(agent.name, memoryMaxChars, { enabled: !isNew && Boolean(agent.name) });
  const saveAgentMemoryMutation = useSaveAgentMemoryMutation(agent.name);
  const clearAgentMemoryMutation = useClearAgentMemoryMutation(agent.name);
  const generateAgentAvatarMutation = useGenerateAgentAvatarMutation();
  const existingAgentNames = useMemo(
    () => new Set((agentsQuery.data?.agents || []).map((item) => item.name).filter(Boolean)),
    [agentsQuery.data?.agents],
  );

  useEffect(() => {
    fetch('/api/mcp')
      .then((res) => res.json())
      .then((data) => {
        setAvailableMcpServers(Array.isArray(data.servers)
          ? data.servers.map((server: any) => ({ name: server.name, command: server.command || '' }))
          : []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const data = engineConfigQuery.data;
    if (!data) return;
    setGlobalEngine(data.engine || '');
    setGlobalDefaultModel(data.defaultModel || String(data.model || ''));
  }, [engineConfigQuery.data]);

  useEffect(() => {
    setAvailableSkills(Array.isArray(skillsQuery.data?.skills)
      ? skillsQuery.data.skills.map((skill: any) => ({ name: skill.name, description: skill.description || '' }))
      : []);
  }, [skillsQuery.data?.skills]);

  useEffect(() => {
    setAvailableKnowledgeBases(Array.isArray(ragKnowledgeBasesQuery.data?.knowledgeBases)
      ? ragKnowledgeBasesQuery.data.knowledgeBases.map((kb: any) => ({ id: kb.id, name: kb.name || kb.id, description: kb.description || '', chunkCount: kb.chunkCount || 0 }))
      : []);
  }, [ragKnowledgeBasesQuery.data?.knowledgeBases]);

  useEffect(() => {
    if (isNew || !agent.name) return;
    if (agentMemoryQuery.data) {
      setMemoryDraft(agentMemoryQuery.data.baseMemory || '');
      setMemoryError(null);
      return;
    }
    if (agentMemoryQuery.error) {
      setMemoryError(agentMemoryQuery.error instanceof Error ? agentMemoryQuery.error.message : '读取 Agent 记忆失败');
    }
  }, [agent.name, agentMemoryQuery.data, agentMemoryQuery.error, isNew]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!formData.name.trim()) {
      alert('请输入 Agent 名称');
      return;
    }
    if (isNew && existingAgentNames.has(formData.name.trim())) {
      alert('Agent 名称已存在');
      return;
    }
    if (!formData.systemPrompt?.trim()) {
      alert('系统提示词不能为空');
      return;
    }
    if (!formData.capabilities?.length) {
      alert('至少需要添加一个能力');
      return;
    }
    const dataToSave = { ...formData };
    if (!dataToSave.avatar) {
      dataToSave.avatar = createDeterministicAvatarConfig(dataToSave.name, {
        team: dataToSave.team,
        roleType: dataToSave.roleType || 'normal',
      });
    }
    if (dataToSave.engineModels['']) {
      delete dataToSave.engineModels[''];
    }
    if (dataToSave.reviewPanel && Object.keys(dataToSave.reviewPanel.subAgents || {}).length > 0) {
      dataToSave.reviewPanel.enabled = true;
    }

    onSave(dataToSave);
  };

  const addTag = () => {
    if (newTag.trim() && !formData.tags?.includes(newTag.trim())) {
      setFormData({ ...formData, tags: [...(formData.tags || []), newTag.trim()] });
      setNewTag('');
    }
  };

  const removeTag = (tag: string) => {
    setFormData({ ...formData, tags: formData.tags?.filter(t => t !== tag) });
  };

  const addCapability = () => {
    if (newCapability.trim() && !formData.capabilities?.includes(newCapability.trim())) {
      setFormData({ ...formData, capabilities: [...(formData.capabilities || []), newCapability.trim()] });
      setNewCapability('');
    }
  };

  const removeCapability = (cap: string) => {
    setFormData({ ...formData, capabilities: formData.capabilities?.filter(c => c !== cap) });
  };

  const addConstraint = () => {
    if (newConstraint.trim() && !formData.constraints?.includes(newConstraint.trim())) {
      setFormData({ ...formData, constraints: [...(formData.constraints || []), newConstraint.trim()] });
      setNewConstraint('');
    }
  };

  const removeConstraint = (con: string) => {
    setFormData({ ...formData, constraints: formData.constraints?.filter(c => c !== con) });
  };

  const addSuggestedValue = (field: ListField, value: string) => {
    const nextValue = value.trim();
    if (!nextValue) return;
    setFormData((prev) => {
      const current = uniqueList(prev[field] || []);
      if (current.includes(nextValue)) return prev;
      return { ...prev, [field]: [...current, nextValue] };
    });
  };

  const updateWorkspaceProfile = (patch: Partial<AgentWorkspaceProfile>) => {
    setFormData((prev) => ({
      ...prev,
      workspaceProfile: {
        ...(prev.workspaceProfile || {}),
        ...patch,
      },
    }));
  };

  const updateWorkspaceResidency = (patch: NonNullable<AgentWorkspaceProfile['residency']>) => {
    setFormData((prev) => ({
      ...prev,
      workspaceProfile: {
        ...(prev.workspaceProfile || {}),
        residency: {
          ...(prev.workspaceProfile?.residency || {}),
          ...patch,
        },
      },
    }));
  };

  const updateWorkspacePresence = (patch: NonNullable<AgentWorkspaceProfile['roomPresence']>) => {
    setFormData((prev) => ({
      ...prev,
      workspaceProfile: {
        ...(prev.workspaceProfile || {}),
        roomPresence: {
          ...(prev.workspaceProfile?.roomPresence || {}),
          ...patch,
        },
      },
    }));
  };

  const updateWorkspaceVisual = (patch: NonNullable<AgentWorkspaceProfile['visual']>) => {
    setFormData((prev) => ({
      ...prev,
      workspaceProfile: {
        ...(prev.workspaceProfile || {}),
        visual: {
          ...(prev.workspaceProfile?.visual || {}),
          ...patch,
        },
      },
    }));
  };

  const updateWorkspaceMemory = (patch: NonNullable<AgentWorkspaceProfile['memory']>) => {
    setFormData((prev) => ({
      ...prev,
      workspaceProfile: {
        ...(prev.workspaceProfile || {}),
        memory: {
          ...(prev.workspaceProfile?.memory || {}),
          ...patch,
        },
      },
    }));
  };

  const renderSuggestions = (field: ListField, suggestions: string[]) => {
    const selected = new Set(formData[field] || []);
    const visibleSuggestions = suggestions.filter((suggestion) => !selected.has(suggestion));
    if (visibleSuggestions.length === 0) return null;
    return (
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="mr-1 text-muted-foreground">推荐</span>
        {visibleSuggestions.map((suggestion) => (
          <button
            key={`${field}-${suggestion}`}
            type="button"
            className="rounded-full border border-border bg-muted/30 px-2 py-1 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
            onClick={() => addSuggestedValue(field, suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    );
  };

  const avatarConfig = normalizeAgentAvatar(formData.avatar, formData.name || 'agent', {
    team: formData.team,
    roleType: formData.roleType || 'normal',
  });
  const avatarSrc = resolveAgentAvatarSrc(avatarConfig, formData.name || 'agent', {
    team: formData.team,
    roleType: formData.roleType || 'normal',
  });
  const agentSuggestions = getAgentSuggestions(formData);
  const memoryCharCount = memoryDraft.trim().length;
  const memoryOverLimit = memoryCharCount > memoryMaxChars;
  const memoryLoading = agentMemoryQuery.isFetching;
  const memorySaving = saveAgentMemoryMutation.isPending || clearAgentMemoryMutation.isPending;
  const updateAgentRagKnowledgeBases = (ragKnowledgeBases: string[]) => {
    const nextSkills = ragKnowledgeBases.length > 0
      ? Array.from(new Set([...(formData.skills || []), 'aceharness-rag']))
      : (formData.skills || []);
    setFormData({ ...formData, ragKnowledgeBases, skills: nextSkills });
  };

  const saveAgentMemory = async () => {
    if (isNew || !agent.name) return;
    if (memoryOverLimit) {
      setMemoryError(`基础记忆不能超过 ${memoryMaxChars} 个字符`);
      return;
    }
    setMemoryError(null);
    try {
      const data = await saveAgentMemoryMutation.mutateAsync({
        baseMemory: memoryDraft,
        maxChars: memoryMaxChars,
      });
      setMemoryDraft(data.baseMemory || '');
      toast('success', 'Agent 记忆已保存');
    } catch (error: any) {
      const message = error?.message || '保存 Agent 记忆失败';
      setMemoryError(message);
      toast('error', message);
    }
  };

  const clearAgentMemory = async () => {
    if (isNew || !agent.name) return;
    const confirmed = window.confirm('确认清空该 Agent 的永久记忆吗？');
    if (!confirmed) return;
    setMemoryError(null);
    try {
      await clearAgentMemoryMutation.mutateAsync(memoryMaxChars);
      setMemoryDraft('');
      toast('success', 'Agent 记忆已清空');
    } catch (error: any) {
      const message = error?.message || '清空 Agent 记忆失败';
      setMemoryError(message);
      toast('error', message);
    }
  };

  const refreshAvatar = async () => {
    try {
      setRefreshingAvatar(true);
      const result = await generateAgentAvatarMutation.mutateAsync({
        displayName: formData.name || 'agent',
        team: formData.team,
        mission: formData.description || formData.capabilities?.join('、') || '',
        style: formData.category || '',
        variant: Math.random().toString(36).slice(2, 10),
      });
      setFormData((prev) => ({ ...prev, avatar: result.avatar }));
      toast('success', '已刷新默认头像');
    } catch (error: any) {
      const nextSeed = `${formData.name || 'agent'}-${Math.random().toString(36).slice(2, 10)}`;
      setFormData((prev) => ({
        ...prev,
        avatar: createDeterministicAvatarConfig(nextSeed, {
          team: prev.team,
          roleType: prev.roleType || 'normal',
        }),
      }));
      toast('warning', error?.message || '头像刷新失败，已回退为默认头像');
    } finally {
      setRefreshingAvatar(false);
    }
  };

  const isDirty = JSON.stringify(formData) !== initialFormSnapshot;
  const confirmDiscard = () => {
    if (!isDirty) return true;
    return window.confirm('放弃当前 Agent 编辑内容吗？');
  };
  const handleRequestClose = () => {
    if (confirmDiscard()) onClose();
  };

  return (
    <>
      <ObjectEditDrawer
        open
        mode={isNew ? 'create' : 'edit'}
        title={isNew ? '新建 Agent' : `编辑 Agent - ${agent.name}`}
        subtitle={formData.description || formData.category || '配置 Agent 身份、模型、能力、记忆和专家子 Agent。'}
        status={{ label: formData.roleType === 'supervisor' ? 'Supervisor' : 'Agent', tone: formData.roleType === 'supervisor' ? 'warning' : 'neutral' }}
        dirty={isDirty}
        widthClassName="w-[min(900px,calc(100vw-1rem))]"
        bodyClassName="pb-8"
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        onRequestDiscard={confirmDiscard}
        cancelAction={{ label: '取消', onClick: handleRequestClose }}
        saveAction={{ label: '保存', onClick: () => handleSubmit() }}
      >
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-2xl border bg-muted/20 p-4">
            <div className="mb-4 text-sm font-medium">基础设定</div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label>名称 *</Label>
                <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="agent-name" />
              </div>

              <div>
                <Label>团队 *</Label>
                <SingleCombobox
                  value={formData.team}
                  onValueChange={(v) => setFormData({ ...formData, team: v as any })}
                  options={[
                    { value: 'blue', label: '蓝队（攻击）' },
                    { value: 'red', label: '红队（防守）' },
                    { value: 'judge', label: '裁定席' },
                    { value: 'black-gold', label: '黑金（指挥官）' },
                  ]}
                  placeholder="选择团队"
                  searchable={false}
                />
              </div>

              <div>
                <Label>角色类型</Label>
                <SingleCombobox
                  value={formData.roleType || 'normal'}
                  onValueChange={(v) => setFormData({ ...formData, roleType: v as any })}
                  options={[
                    { value: 'normal', label: '普通 Agent' },
                    { value: 'supervisor', label: 'Supervisor / 指挥官' },
                  ]}
                  placeholder="选择角色类型"
                  searchable={false}
                />
              </div>

              <div>
                <Label>分类</Label>
                <SingleCombobox
                  value={formData.category || ''}
                  onValueChange={(v) => setFormData({ ...formData, category: v || undefined })}
                  options={[
                    { value: '', label: '未分类' },
                    ...CATEGORIES.map(cat => ({ value: cat, label: cat })),
                  ]}
                  placeholder="选择分类"
                  searchable={false}
                />
              </div>

              <div>
                <Label>Temperature</Label>
                <Input type="number" step="0.1" min="0" max="2" value={formData.temperature ?? ''} onChange={(e) => setFormData({ ...formData, temperature: e.target.value ? parseFloat(e.target.value) : undefined })} placeholder="0.7" />
              </div>

              <div className="flex items-center justify-between rounded-xl border bg-muted/20 px-3 py-2">
                <div>
                  <div className="text-sm font-medium">首页常驻可聊</div>
                  <div className="text-xs text-muted-foreground">启用后可在首页直接作为常驻 Agent 参与对话</div>
                </div>
                <Switch checked={!!formData.alwaysAvailableForChat} onCheckedChange={(checked) => setFormData({ ...formData, alwaysAvailableForChat: checked })} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <Label>头像</Label>
              <div className="mt-2 rounded-2xl border bg-muted/20 p-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <SpriteAvatar
                    avatar={avatarSrc}
                    seed={formData.name || 'agent'}
                    category="agent-default"
                    alt={formData.name || 'agent avatar'}
                    fallback={(formData.name || 'AG').slice(0, 2).toUpperCase()}
                    className="h-20 w-20 shrink-0 ring-2 ring-primary/20"
                  />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                      <div>
                        <div className="text-xs font-medium text-muted-foreground">当前模式</div>
                        <div className="mt-1 text-sm">Sprite Avatar</div>
                      </div>
                      <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={refreshAvatar} disabled={refreshingAvatar}>
                        <span className="material-symbols-outlined mr-1 text-sm">refresh</span>
                        {refreshingAvatar ? '刷新中...' : '刷新头像'}
                      </Button>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">Seed</div>
                      <div className="mt-1 break-all rounded-xl bg-background/80 px-3 py-2 text-xs">
                        {avatarConfig.seed || formData.name || 'agent'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-muted/20 p-4">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">协作空间</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  控制该 Agent 在会议室和办公室中的常驻、昵称、工位和记忆预算。
                </p>
              </div>
              <Badge variant="outline" className="shrink-0">Agent YAML</Badge>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label>协作空间显示名</Label>
                <Input
                  value={formData.workspaceProfile?.displayName || ''}
                  onChange={(e) => updateWorkspaceProfile({ displayName: e.target.value || undefined })}
                  placeholder={formData.name || 'agent'}
                />
              </div>
              <div>
                <Label>昵称</Label>
                <Input
                  value={formData.workspaceProfile?.nickname || ''}
                  onChange={(e) => updateWorkspaceProfile({ nickname: e.target.value || undefined })}
                  placeholder="例如：老周"
                />
              </div>
              <div>
                <Label>办公室职责</Label>
                <SingleCombobox
                  value={formData.workspaceProfile?.officeRole || ''}
                  onValueChange={(v) => updateWorkspaceProfile({ officeRole: v || undefined })}
                  options={[
                    { value: '', label: '未设置' },
                    { value: 'ceo-founder', label: 'CEO / Founder' },
                    { value: 'product-lead', label: 'Product Lead' },
                    { value: 'design-lead', label: 'Design Lead' },
                    { value: 'engineering-lead', label: 'Engineering Lead' },
                    { value: 'growth-lead', label: 'Growth Lead' },
                    { value: 'operations-lead', label: 'Operations Lead' },
                    { value: 'generalist', label: 'Generalist' },
                  ]}
                  placeholder="选择办公室职责"
                  searchable={false}
                />
              </div>
              <div>
                <Label>角色色</Label>
                <SingleCombobox
                  value={formData.workspaceProfile?.visual?.accent || ''}
                  onValueChange={(v) => updateWorkspaceVisual({ accent: v || undefined })}
                  options={[
                    { value: '', label: '自动' },
                    { value: 'cyan', label: 'Cyan' },
                    { value: 'blue', label: 'Blue' },
                    { value: 'green', label: 'Green' },
                    { value: 'orange', label: 'Orange' },
                    { value: 'purple', label: 'Purple' },
                    { value: 'teal', label: 'Teal' },
                    { value: 'slate', label: 'Slate' },
                  ]}
                  placeholder="选择角色色"
                  searchable={false}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border bg-background/60 px-3 py-2">
                <div>
                  <div className="text-sm font-medium">办公室常驻</div>
                  <div className="text-xs text-muted-foreground">显示在一人公司办公室工位区</div>
                </div>
                <Switch
                  checked={!!formData.workspaceProfile?.residency?.office}
                  onCheckedChange={(checked) => {
                    updateWorkspaceResidency({ office: checked });
                    updateWorkspacePresence({ autoShowInOffice: checked });
                  }}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border bg-background/60 px-3 py-2">
                <div>
                  <div className="text-sm font-medium">会议室推荐</div>
                  <div className="text-xs text-muted-foreground">创建会议时优先出现在成员列表</div>
                </div>
                <Switch
                  checked={!!formData.workspaceProfile?.residency?.meetingRoom || !!formData.workspaceProfile?.roomPresence?.recommendForMeetingRoom}
                  onCheckedChange={(checked) => {
                    updateWorkspaceResidency({ meetingRoom: checked });
                    updateWorkspacePresence({ recommendForMeetingRoom: checked });
                  }}
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border bg-background/60 px-3 py-2">
                <div>
                  <div className="text-sm font-medium">允许直接私聊</div>
                  <div className="text-xs text-muted-foreground">成员卡可直接开启 direct room</div>
                </div>
                <Switch
                  checked={formData.workspaceProfile?.residency?.defaultDirectRoom !== false}
                  onCheckedChange={(checked) => updateWorkspaceResidency({ defaultDirectRoom: checked })}
                />
              </div>
              <div>
                <Label>默认工位</Label>
                <Input
                  value={formData.workspaceProfile?.visual?.desk || ''}
                  onChange={(e) => updateWorkspaceVisual({ desk: e.target.value || undefined })}
                  placeholder="desk-1"
                />
              </div>
              <div>
                <Label>排序</Label>
                <Input
                  type="number"
                  value={formData.workspaceProfile?.visual?.order ?? ''}
                  onChange={(e) => updateWorkspaceVisual({ order: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="10"
                />
              </div>
              <div>
                <Label>基础记忆预算</Label>
                <Input
                  type="number"
                  min="0"
                  max="50000"
                  value={formData.workspaceProfile?.memory?.baseBudget ?? ''}
                  onChange={(e) => updateWorkspaceMemory({ baseBudget: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="5000"
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border bg-background/60 px-3 py-2">
                <div>
                  <div className="text-sm font-medium">深层记忆按需查询</div>
                  <div className="text-xs text-muted-foreground">允许运行时查询该 Agent 的深层记忆</div>
                </div>
                <Switch
                  checked={formData.workspaceProfile?.memory?.deepSearchEnabled !== false}
                  onCheckedChange={(checked) => updateWorkspaceMemory({ deepSearchEnabled: checked })}
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-muted/20 p-4">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium">永久记忆</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  这份内容会保存为该 Agent 的长期角色记忆；是否参与推理由系统设置统一控制。
                </p>
              </div>
              <Badge variant={memoryOverLimit ? 'destructive' : 'outline'} className="shrink-0">
                {memoryCharCount} / {memoryMaxChars}
              </Badge>
            </div>
            {isNew ? (
              <div className="rounded-xl border bg-background/60 px-3 py-3 text-sm text-muted-foreground">
                新建 Agent 保存后即可编辑永久记忆。
              </div>
            ) : (
              <div className="space-y-3">
                <Textarea
                  value={memoryDraft}
                  onChange={(event) => {
                    setMemoryDraft(event.target.value);
                    if (memoryError) setMemoryError(null);
                  }}
                  rows={7}
                  disabled={memoryLoading || memorySaving}
                  placeholder="记录该 Agent 的长期身份、稳定偏好、协作原则和常用约束。"
                />
                {memoryError ? (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{memoryError}</div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground">
                    {memoryLoading ? '正在读取记忆...' : '保存后会写入 role scope，并被统一 memory resolver 读取。'}
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={clearAgentMemory} disabled={memoryLoading || memorySaving || !memoryDraft.trim()}>
                      清空记忆
                    </Button>
                    <Button type="button" size="sm" onClick={saveAgentMemory} disabled={memoryLoading || memorySaving || memoryOverLimit}>
                      {memorySaving ? '保存中...' : '保存记忆'}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <Label>模型配置 *</Label>
            <p className="text-xs text-muted-foreground mb-2">选择当前使用的引擎。若跟随系统，则模型也跟随全局默认模型。</p>
            <div className="space-y-2">
              <div className="flex gap-2 items-center">
                <button
                  type="button"
                  className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${formData.activeEngine === '' ? 'border-primary bg-primary' : 'border-muted-foreground/40'}`}
                  onClick={() => setFormData({ ...formData, activeEngine: '' })}
                  title="跟随系统"
                >
                  {formData.activeEngine === '' && <span className="w-2 h-2 rounded-full bg-white" />}
                </button>
                <div className="w-[130px] shrink-0 text-sm text-muted-foreground">跟随系统</div>
                <div className="flex-1 text-sm">
                  <span className="font-medium">{getEngineMeta(globalEngine)?.name || globalEngine || '未设置默认引擎'}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span className="font-mono">{globalDefaultModel || '未设置默认模型'}</span>
                </div>
              </div>
              {Object.entries(formData.engineModels).map(([eng, mod]) => (
                <div key={eng} className="flex gap-2 items-center">
                  <button
                    type="button"
                    className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${formData.activeEngine === eng ? 'border-primary bg-primary' : 'border-muted-foreground/40'}`}
                    onClick={() => setFormData({ ...formData, activeEngine: eng })}
                    title="设为启用"
                  >
                    {formData.activeEngine === eng && <span className="w-2 h-2 rounded-full bg-white" />}
                  </button>
                  <div className="w-[130px] shrink-0">
                    <EngineSelect
                      value={eng}
                      onChange={(newEng) => {
                        if (newEng === eng) return;
                        const updated = { ...formData.engineModels };
                        const model = updated[eng];
                        delete updated[eng];
                        updated[newEng] = model;
                        const newActive = formData.activeEngine === eng ? newEng : formData.activeEngine;
                        setFormData({ ...formData, engineModels: updated, activeEngine: newActive });
                      }}
                      allowGlobal
                    />
                  </div>
                  <div className="flex-1">
                    {eng ? (
                      <ModelSelect value={mod} onChange={(v) => setFormData({ ...formData, engineModels: { ...formData.engineModels, [eng]: v } })} engine={eng} />
                    ) : (
                      <div className="text-sm text-muted-foreground">跟随系统时不支持单独设置模型</div>
                    )}
                  </div>
                  {Object.keys(formData.engineModels).length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        const updated = { ...formData.engineModels };
                        delete updated[eng];
                        const newActive = formData.activeEngine === eng ? Object.keys(updated)[0] : formData.activeEngine;
                        setFormData({ ...formData, engineModels: updated, activeEngine: newActive });
                      }}
                      title="删除引擎模型配置"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const usedEngines = Object.keys(formData.engineModels);
                  const allEngines = ['claude-code', 'kiro-cli', 'opencode', 'nga', 'codegenie', 'codex', 'cursor', 'trae-cli', 'magic-cli'];
                  const available = allEngines.find(e => !usedEngines.includes(e));
                  if (available === undefined) return;
                  const defaultModel = Object.values(formData.engineModels)[0] || '';
                  setFormData({ ...formData, engineModels: { ...formData.engineModels, [available]: defaultModel } });
                }}
              >
                <span className="material-symbols-outlined text-sm mr-1">add</span>
                添加引擎
              </Button>
            </div>
          </div>

          <div>
            <Label>标签</Label>
            <div className="flex gap-2 mb-2">
              <Input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="添加标签..." onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())} />
              <Button type="button" onClick={addTag}>添加</Button>
            </div>
            <div className="flex flex-wrap gap-1">
              {formData.tags?.map(tag => (
                <Badge key={tag} variant="secondary" className="cursor-pointer" onClick={() => removeTag(tag)}>
                  {tag} <span className="ml-1">×</span>
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <Label>系统提示词</Label>
            <Textarea value={formData.systemPrompt || ''} onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })} rows={6} placeholder="定义 Agent 的角色和行为..." />
          </div>

          {availableSkills.length > 0 ? (
            <div>
              <Label>Agent Skills</Label>
              <p className="mb-2 text-xs text-muted-foreground">该 Agent 在工作流步骤中默认可用的 Skills。</p>
              <MultiCombobox
                value={formData.skills || []}
                onValueChange={(skills) => setFormData({ ...formData, skills })}
                options={availableSkills.map((skill) => ({
                  value: skill.name,
                  label: skill.name,
                  description: skill.description || '',
                }))}
                placeholder="选择 Agent Skills..."
              />
            </div>
          ) : null}

          <div>
            <Label>Agent MCP Servers</Label>
            <p className="mb-2 text-xs text-muted-foreground">该 Agent 在工作流步骤中默认可用的 MCP Servers。</p>
            <MultiCombobox
              value={formData.mcpServers || []}
              onValueChange={(mcpServers) => setFormData({ ...formData, mcpServers })}
              options={availableMcpServers.map((server) => ({
                value: server.name,
                label: server.name,
                description: server.command || '',
              }))}
              placeholder={availableMcpServers.length > 0 ? '选择 Agent MCP Servers...' : '当前没有可用 MCP Servers'}
            />
          </div>

          <div>
            <Label>Agent RAG 知识库</Label>
            <p className="mb-2 text-xs text-muted-foreground">该 Agent 在工作流步骤中默认关联的 RAG 知识库。</p>
            <MultiCombobox
              value={formData.ragKnowledgeBases || []}
              onValueChange={updateAgentRagKnowledgeBases}
              options={availableKnowledgeBases.map((kb) => ({
                value: kb.id,
                label: kb.name || kb.id,
                description: [kb.description, `Chunks ${kb.chunkCount ?? 0}`].filter(Boolean).join(' · '),
              }))}
              placeholder={availableKnowledgeBases.length > 0 ? '选择 Agent RAG 知识库...' : '当前没有可用 RAG 知识库'}
            />
          </div>

          <div>
            <Label>
              迭代提示词
              <span className="text-xs text-muted-foreground ml-2">（在迭代阶段使用此提示词替代系统提示词）</span>
            </Label>
            <Textarea value={formData.iterationPrompt || ''} onChange={(e) => setFormData({ ...formData, iterationPrompt: e.target.value })} rows={6} placeholder="例如：你是一个修复问题的专家，专注于根据反馈修复代码中的问题..." />
          </div>

          <div>
            <Label>能力</Label>
            <div className="flex gap-2 mb-2">
              <Input value={newCapability} onChange={(e) => setNewCapability(e.target.value)} placeholder="添加能力..." onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCapability())} />
              <Button type="button" onClick={addCapability}>添加</Button>
            </div>
            {renderSuggestions('capabilities', agentSuggestions.capabilities)}
            <div className="flex flex-wrap gap-1">
              {formData.capabilities?.map(cap => (
                <Badge key={cap} variant="outline" className="cursor-pointer" onClick={() => removeCapability(cap)}>
                  {cap} <span className="ml-1">×</span>
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <Label>约束</Label>
            <div className="flex gap-2 mb-2">
              <Input value={newConstraint} onChange={(e) => setNewConstraint(e.target.value)} placeholder="添加约束..." onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addConstraint())} />
              <Button type="button" onClick={addConstraint}>添加</Button>
            </div>
            {renderSuggestions('constraints', agentSuggestions.constraints)}
            <div className="flex flex-wrap gap-1">
              {formData.constraints?.map(con => (
                <Badge key={con} variant="outline" className="cursor-pointer" onClick={() => removeConstraint(con)}>
                  {con} <span className="ml-1">×</span>
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <Label>
              路由关键词
              <span className="text-xs text-muted-foreground ml-2">（Supervisor-Lite 架构用，逗号分隔）</span>
            </Label>
            <Input value={formData.keywords?.join(', ') || ''} onChange={(e) => setFormData({ ...formData, keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="如：架构, 接口, 模块, API" />
            <div className="mt-2">
              {renderSuggestions('keywords', agentSuggestions.keywords)}
            </div>
          </div>

          <div className="border-t pt-6">
            <div className="mb-4">
              <Label className="text-base">专家配置</Label>
              <p className="text-xs text-muted-foreground mt-1">配置多个专家子 Agent，在节点启用专家模式时从不同角度进行分析</p>
            </div>

            <div className="space-y-4 pl-4 border-l-2">
              <div>
                <Label>专家模式描述</Label>
                <Input
                  value={formData.reviewPanel?.description || ''}
                  onChange={(e) => {
                    if (!formData.reviewPanel) {
                      setFormData({ ...formData, reviewPanel: { enabled: true, description: e.target.value, subAgents: {} } });
                    } else {
                      setFormData({ ...formData, reviewPanel: { ...formData.reviewPanel, description: e.target.value } });
                    }
                  }}
                  placeholder="例如：多角度代码质量会审"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>专家子 Agent</Label>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      if (!formData.reviewPanel) {
                        setFormData({ ...formData, reviewPanel: { enabled: true, description: '', subAgents: {} } });
                      }
                      setNewSubAgentName('');
                      setEditingSubAgent({
                        name: '',
                        config: { description: '', prompt: '', tools: ['Read', 'Glob', 'Grep'], model: 'claude-sonnet-4-6' },
                      });
                    }}
                  >
                    添加专家
                  </Button>
                </div>

                <div className="space-y-2">
                  {Object.entries(formData.reviewPanel?.subAgents || {}).map(([name, config]) => (
                    <div key={name} className="p-3 border rounded-lg hover:border-primary/50 transition-colors">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-medium">{name}</div>
                          <div className="text-xs text-muted-foreground mt-1">{config.description}</div>
                          <div className="flex gap-1 mt-2">
                            <Badge variant="outline" className="text-xs">{config.model}</Badge>
                            {config.tools.map(tool => (
                              <Badge key={tool} variant="secondary" className="text-xs">{tool}</Badge>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button type="button" size="sm" variant="ghost" onClick={() => { setNewSubAgentName(name); setEditingSubAgent({ name, config }); }}>
                            编辑
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => {
                              const newSubAgents = { ...formData.reviewPanel!.subAgents };
                              delete newSubAgents[name];
                              setFormData({ ...formData, reviewPanel: { ...formData.reviewPanel!, subAgents: newSubAgents } });
                            }}
                          >
                            删除
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </form>
      </ObjectEditDrawer>

      {editingSubAgent && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60]" onClick={() => setEditingSubAgent(null)}>
          <div className="bg-card rounded-lg border w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-semibold">
                {editingSubAgent.name ? `编辑专家 - ${editingSubAgent.name}` : '新建专家'}
              </h3>
              <Button type="button" variant="ghost" size="icon" onClick={() => setEditingSubAgent(null)}>
                <span className="material-symbols-outlined">close</span>
              </Button>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-4">
              {!editingSubAgent.name && (
                <div>
                  <Label>专家名称 *</Label>
                  <Input value={newSubAgentName} onChange={(e) => setNewSubAgentName(e.target.value)} placeholder="例如：correctness-reviewer" />
                </div>
              )}

              <div>
                <Label>描述 *</Label>
                <Input
                  value={editingSubAgent.config.description}
                  onChange={(e) => setEditingSubAgent({ ...editingSubAgent, config: { ...editingSubAgent.config, description: e.target.value } })}
                  placeholder="例如：编译器正确性审查专家"
                />
              </div>

              <div>
                <Label>提示词 *</Label>
                <Textarea
                  value={editingSubAgent.config.prompt}
                  onChange={(e) => setEditingSubAgent({ ...editingSubAgent, config: { ...editingSubAgent.config, prompt: e.target.value } })}
                  rows={8}
                  placeholder="定义专家的职责和输出格式..."
                />
              </div>

              <div>
                <Label>模型</Label>
                <ModelSelect value={editingSubAgent.config.model} onChange={(value) => setEditingSubAgent({ ...editingSubAgent, config: { ...editingSubAgent.config, model: value } })} />
              </div>

              <div>
                <Label>工具</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'].map(tool => (
                    <Badge
                      key={tool}
                      variant={editingSubAgent.config.tools.includes(tool) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => {
                        const tools = editingSubAgent.config.tools.includes(tool)
                          ? editingSubAgent.config.tools.filter(t => t !== tool)
                          : [...editingSubAgent.config.tools, tool];
                        setEditingSubAgent({ ...editingSubAgent, config: { ...editingSubAgent.config, tools } });
                      }}
                    >
                      {tool}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 justify-end p-4 border-t flex-shrink-0">
              <Button type="button" variant="outline" onClick={() => setEditingSubAgent(null)}>取消</Button>
              <Button
                type="button"
                onClick={() => {
                  const name = editingSubAgent.name || newSubAgentName.trim();
                  if (!name) {
                    alert('请输入专家名称');
                    return;
                  }
                  if (!editingSubAgent.config.description || !editingSubAgent.config.prompt) {
                    alert('请填写描述和提示词');
                    return;
                  }

                  const currentReviewPanel = formData.reviewPanel || {
                    enabled: true,
                    description: '',
                    subAgents: {},
                  };

                  setFormData({
                    ...formData,
                    reviewPanel: {
                      ...currentReviewPanel,
                      enabled: true,
                      subAgents: {
                        ...currentReviewPanel.subAgents,
                        [name]: editingSubAgent.config,
                      },
                    },
                  });
                  setEditingSubAgent(null);
                }}
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
