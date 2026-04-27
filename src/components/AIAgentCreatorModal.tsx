'use client';

import { useEffect, useMemo, useState } from 'react';
import { agentApi, configApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { SingleCombobox } from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AgentHeroCard } from '@/components/agent/AgentHeroCard';
import { useToast } from '@/components/ui/toast';
import {
  buildAgentDraftPreview,
  createInitialAgentDraft,
  extractAgentDraftCapabilities,
  normalizeAgentDraft,
  type AgentDraftState,
} from '@/lib/agent-draft';

type AgentConfig = {
  name: string;
  team: 'blue' | 'red' | 'judge' | 'yellow' | 'black-gold';
  roleType?: 'normal' | 'supervisor';
  avatar?: any;
  category?: string;
  tags?: string[];
  engineModels: Record<string, string>;
  activeEngine: string;
  temperature?: number;
  systemPrompt?: string;
  iterationPrompt?: string;
  capabilities?: string[];
  constraints?: string[];
  keywords?: string[];
  description?: string;
};

type WorkflowSummary = {
  filename: string;
  name: string;
  description?: string;
  mode?: 'phase-based' | 'state-machine';
};

type AgentDraftRecommendations = {
  experiences: Array<{
    runId: string;
    workflowName?: string;
    configFile: string;
    summary: string;
  }>;
  referenceWorkflow: null | {
    filename: string;
    name?: string;
    description?: string;
    projectRoot?: string;
    agents: string[];
    phases: string[];
    states: string[];
  };
  relationshipHints: Array<{
    agent: string;
    counterpart: string;
    synergyScore: number;
    strengths: string[];
  }>;
};

type DraftValidation = {
  ok: boolean;
  issues: Array<{
    path: string[];
    message: string;
    severity: 'error' | 'warning';
    code?: string;
  }>;
};

interface AIAgentCreatorModalProps {
  open: boolean;
  engine: string;
  model: string;
  initialDraft?: Partial<AgentDraftState> | null;
  onClose: () => void;
  onCreate: (agent: AgentConfig) => Promise<boolean> | boolean;
  onContinueEdit: (agent: AgentConfig) => void;
}

export default function AIAgentCreatorModal({
  open,
  engine,
  model,
  initialDraft,
  onClose,
  onCreate,
  onContinueEdit,
}: AIAgentCreatorModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [draftInput, setDraftInput] = useState<AgentDraftState>(createInitialAgentDraft(initialDraft || undefined));
  const [draftResult, setDraftResult] = useState<AgentConfig | null>(null);
  const [draftRaw, setDraftRaw] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [refreshingAvatar, setRefreshingAvatar] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [recommendations, setRecommendations] = useState<AgentDraftRecommendations | null>(null);
  const [validation, setValidation] = useState<DraftValidation | null>(null);

  useEffect(() => {
    if (open) {
      setDraftInput(normalizeAgentDraft(initialDraft || undefined));
      configApi.listConfigs()
        .then((result) => setWorkflows((result.configs || []) as WorkflowSummary[]))
        .catch(() => setWorkflows([]));
      return;
    }
    if (!open) {
      setStep(1);
      setDraftInput(createInitialAgentDraft(initialDraft || undefined));
      setDraftResult(null);
      setDraftRaw('');
      setRecommendations(null);
      setValidation(null);
      setDrafting(false);
      setCreating(false);
      setRefreshingAvatar(false);
    }
  }, [initialDraft, open]);

  const capabilities = useMemo(
    () => extractAgentDraftCapabilities(draftInput.specialties),
    [draftInput.specialties]
  );

  const previewAgent = useMemo<AgentConfig | null>(() => {
    return buildAgentDraftPreview({
      engine,
      model,
      draft: draftInput,
      existingDraft: draftResult,
    }) as AgentConfig | null;
  }, [draftInput, draftResult, engine, model]);

  const canDraft = draftInput.displayName.trim() && draftInput.mission.trim();

  const handleGenerateDraft = async () => {
    if (!canDraft) {
      toast('warning', '请至少填写 Agent 名称和职责');
      return;
    }
    try {
      setDrafting(true);
      const result = await agentApi.draftAgent({
        displayName: draftInput.displayName.trim(),
        team: draftInput.canSupervise === 'yes' ? 'black-gold' : draftInput.team,
        mission: draftInput.mission.trim(),
        style: draftInput.style.trim(),
        specialties: draftInput.specialties.trim(),
        workingDirectory: draftInput.workingDirectory?.trim(),
        referenceWorkflow: draftInput.referenceWorkflow?.trim(),
        engine,
        model,
      });
      const agent = {
        ...(result.draft as AgentConfig),
        category: (result.draft as AgentConfig).category || 'AI创建',
        tags: Array.from(new Set(['AI创建', ...(((result.draft as AgentConfig).tags || []) as string[])])),
      };
      setDraftResult(agent);
      setDraftRaw(result.raw || '');
      setRecommendations(result.recommendations || null);
      setValidation(result.validation || null);
      setStep(3);
      toast('success', '已生成 Agent 草案');
    } catch (error: any) {
      toast('error', error?.message || '生成 Agent 草案失败');
    } finally {
      setDrafting(false);
    }
  };

  const handleRefreshAvatar = async () => {
    if (!previewAgent) return;
    try {
      setRefreshingAvatar(true);
      const result = await agentApi.generateAvatar({
        displayName: draftInput.displayName.trim() || previewAgent.name,
        team: previewAgent.team,
        mission: draftInput.mission.trim(),
        style: draftInput.style.trim(),
        variant: Math.random().toString(36).slice(2, 10),
      });
      const nextAgent = {
        ...(draftResult || previewAgent),
        avatar: result.avatar,
      };
      setDraftResult(nextAgent);
      toast('success', '已刷新角色头像');
    } catch (error: any) {
      toast('error', error?.message || '刷新头像失败');
    } finally {
      setRefreshingAvatar(false);
    }
  };

  const handleCreate = async () => {
    if (!draftResult) {
      toast('warning', '请先生成 Agent 草案');
      return;
    }
    try {
      setCreating(true);
      const created = await onCreate(draftResult);
      if (created !== false) {
        onClose();
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-5xl overflow-hidden border-border/70 p-0">
        <div className="grid min-h-[720px] grid-cols-1 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="border-r border-border/60 bg-[linear-gradient(180deg,rgba(10,14,26,0.98),rgba(17,24,39,0.94))] p-7 text-white">
            <DialogHeader className="space-y-3 text-left">
              <Badge className="w-fit border-white/10 bg-white/10 text-white">AI 引导创建 Agent</Badge>
              <DialogTitle className="text-2xl">先定义角色，再决定执行配置</DialogTitle>
              <DialogDescription className="text-white/65">
                这一步负责生成角色设定、头像和执行草案。确认后可以直接创建，也可以继续进入完整编辑。
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 grid grid-cols-3 gap-2">
              {[
                { step: 1, title: '角色定位', hint: '名称 / 职责 / 阵营' },
                { step: 2, title: '能力草案', hint: '技能 / 参考 workflow' },
                { step: 3, title: '配置确认', hint: '草案 / 推荐来源' },
              ].map((item) => (
                <Button
                  key={item.step}
                  type="button"
                  variant="ghost"
                  className={`h-auto min-h-16 rounded-2xl border px-3 py-3 text-left transition-colors ${
                    step === item.step
                      ? 'border-white bg-white text-slate-950'
                      : 'border-white/15 bg-white/5 text-white/70 hover:bg-white/10'
                  }`}
                  onClick={() => setStep(item.step as 1 | 2 | 3)}
                >
                  <div className="text-xs uppercase tracking-[0.2em]">{item.step}</div>
                  <div className="mt-1 text-sm font-semibold">{item.title}</div>
                  <div className="mt-1 text-[11px] opacity-80">{item.hint}</div>
                </Button>
              ))}
            </div>

            {step === 1 ? (
              <div className="mt-8 space-y-5">
                <div className="space-y-2">
                  <Label className="text-white">角色名称</Label>
                  <Input
                    value={draftInput.displayName}
                    onChange={(event) => setDraftInput((prev) => ({ ...prev, displayName: event.target.value }))}
                    placeholder="例如：代码修复助手"
                    className="border-white/10 bg-white/5 text-white placeholder:text-white/35"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-white">主要职责</Label>
                  <Textarea
                    rows={5}
                    value={draftInput.mission}
                    onChange={(event) => setDraftInput((prev) => ({ ...prev, mission: event.target.value }))}
                    placeholder="这个 Agent 负责什么工作、解决哪类问题、在团队里扮演什么角色。"
                    className="border-white/10 bg-white/5 text-white placeholder:text-white/35"
                  />
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-white">默认阵营</Label>
                    <SingleCombobox
                      value={draftInput.team}
                      onValueChange={(value) => setDraftInput((prev) => ({ ...prev, team: value as AgentConfig['team'] }))}
                      options={[
                        { value: 'blue', label: '蓝队' },
                        { value: 'red', label: '红队' },
                        { value: 'yellow', label: '黄队' },
                        { value: 'judge', label: '裁定席' },
                        { value: 'black-gold', label: '黑金指挥官' },
                      ]}
                      searchable={false}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white">风格关键词</Label>
                    <Input
                      value={draftInput.style}
                      onChange={(event) => setDraftInput((prev) => ({ ...prev, style: event.target.value }))}
                      placeholder="理性、锐利、稳健、强执行"
                      className="border-white/10 bg-white/5 text-white placeholder:text-white/35"
                    />
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-7 text-white/70">
                  先收敛角色身份和职责边界。能力标签、提示词和头像会在下一步和 AI 草案里自动补齐。
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="mt-8 space-y-5">
                <div className="space-y-2">
                  <Label className="text-white">擅长领域</Label>
                  <Textarea
                    rows={6}
                    value={draftInput.specialties}
                    onChange={(event) => setDraftInput((prev) => ({ ...prev, specialties: event.target.value }))}
                    placeholder="用逗号或换行分隔，例如：编译错误定位、补测试、重构、安全复核"
                    className="border-white/10 bg-white/5 text-white placeholder:text-white/35"
                  />
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-white">是否需要可写代码</Label>
                    <SingleCombobox
                      value={draftInput.canCode}
                      onValueChange={(value) => setDraftInput((prev) => ({ ...prev, canCode: value as 'yes' | 'no' }))}
                      options={[
                        { value: 'yes', label: '需要' },
                        { value: 'no', label: '不需要' },
                      ]}
                      searchable={false}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-white">是否担任指挥官</Label>
                    <SingleCombobox
                      value={draftInput.canSupervise}
                      onValueChange={(value) => setDraftInput((prev) => ({ ...prev, canSupervise: value as 'yes' | 'no' }))}
                      options={[
                        { value: 'no', label: '普通 Agent' },
                        { value: 'yes', label: '指挥官 / Supervisor' },
                      ]}
                      searchable={false}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-white">参考工作流</Label>
                  <SingleCombobox
                    value={draftInput.referenceWorkflow || '__none__'}
                    onValueChange={(value) => setDraftInput((prev) => ({ ...prev, referenceWorkflow: value === '__none__' ? '' : value }))}
                    options={[
                      { value: '__none__', label: '不指定' },
                      ...workflows.map((workflow) => ({
                        value: workflow.filename,
                        label: workflow.name ? `${workflow.name} · ${workflow.filename}` : workflow.filename,
                      })),
                    ]}
                    placeholder="选择一个已有 workflow 作为参考"
                  />
                </div>
                {draftInput.referenceWorkflow ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-7 text-white/70">
                    AI 会参考该 workflow 的角色粒度、阶段拆分和协作边界，避免创建出重复职责的角色。
                  </div>
                ) : null}
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-7 text-white/70">
                  AI 会基于这些输入生成角色草案、系统提示词、能力标签和可复现头像，并优先复用历史经验。
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="mt-8 space-y-4">
                {validation?.issues?.length ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-[0.24em] text-white/45">Validator</div>
                    <div className="mt-3 space-y-2 text-xs leading-6 text-white/78">
                      {validation.issues.map((issue, index) => (
                        <div key={`${issue.path.join('.')}-${index}`} className="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Badge variant={issue.severity === 'error' ? 'destructive' : 'secondary'}>
                              {issue.severity === 'error' ? '错误' : '警告'}
                            </Badge>
                            <span>{issue.path.join('.') || 'root'}</span>
                          </div>
                          <div className="mt-1 text-white/60">{issue.message}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {recommendations ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-[0.24em] text-white/45">Recommendation Chain</div>
                    <div className="mt-3 space-y-3 text-xs leading-6 text-white/78">
                      {recommendations.referenceWorkflow ? (
                        <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
                          <div className="font-medium text-white">参考工作流</div>
                          <div>{recommendations.referenceWorkflow.name || recommendations.referenceWorkflow.filename}</div>
                          {recommendations.referenceWorkflow.description ? (
                            <div className="text-white/60">{recommendations.referenceWorkflow.description}</div>
                          ) : null}
                          {recommendations.referenceWorkflow.agents.length ? (
                            <div>已有角色：{recommendations.referenceWorkflow.agents.join('、')}</div>
                          ) : null}
                        </div>
                      ) : null}
                      {recommendations.relationshipHints.length ? (
                        <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
                          <div className="font-medium text-white">协作关系提示</div>
                          <div className="mt-2 space-y-2">
                            {recommendations.relationshipHints.slice(0, 3).map((item) => (
                              <div key={`${item.agent}-${item.counterpart}`} className="rounded-xl border border-white/10 px-3 py-2">
                                <div>{item.agent} × {item.counterpart}</div>
                                <div className="text-white/60">协作倾向 {item.synergyScore >= 0 ? '+' : ''}{item.synergyScore}</div>
                                {item.strengths.length ? (
                                  <div className="text-white/60">强项：{item.strengths.join('、')}</div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {recommendations.experiences.length ? (
                        <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
                          <div className="font-medium text-white">历史经验</div>
                          <div className="mt-2 space-y-2">
                            {recommendations.experiences.map((item) => (
                              <div key={item.runId} className="rounded-xl border border-white/10 px-3 py-2">
                                <div>{item.workflowName || item.configFile}</div>
                                <div className="text-white/60">{item.summary}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.24em] text-white/45">Raw Draft</div>
                  <pre className="mt-3 max-h-[340px] overflow-auto whitespace-pre-wrap text-xs leading-6 text-white/78">
                    {draftRaw || '点击“生成角色草案”后，这里会显示 AI 返回的原始内容。'}
                  </pre>
                </div>
              </div>
            ) : null}

            <div className="mt-8 flex gap-2">
              {step > 1 ? (
                <Button type="button" variant="secondary" onClick={() => setStep((prev) => (prev - 1) as 1 | 2 | 3)}>
                  上一步
                </Button>
              ) : null}
              {step < 3 ? (
                <Button type="button" variant="secondary" onClick={() => setStep((prev) => (prev + 1) as 1 | 2 | 3)}>
                  下一步
                </Button>
              ) : null}
              <Button type="button" onClick={handleGenerateDraft} disabled={!canDraft || drafting}>
                {drafting ? '生成中...' : '生成角色草案'}
              </Button>
            </div>
          </div>

          <div className="flex flex-col bg-background p-7">
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">角色卡预览</div>
              <div className="rounded-[28px] border border-border/70 bg-card/70 p-4">
                {previewAgent ? (
                  <AgentHeroCard
                    agent={{
                      ...previewAgent,
                      description: previewAgent.description || draftInput.mission,
                      capabilities: previewAgent.capabilities,
                      category: previewAgent.category || 'AI创建',
                    }}
                  />
                ) : (
                  <div className="flex min-h-[220px] items-center justify-center rounded-3xl border border-dashed border-border text-sm text-muted-foreground">
                    先填写角色名称和职责，再生成角色卡
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 space-y-4 rounded-[28px] border border-border/70 bg-card/70 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">草案摘要</div>
                  <div className="mt-1 text-xs text-muted-foreground">确认后可直接创建，或继续打开完整编辑弹框。</div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={handleRefreshAvatar} disabled={!previewAgent || refreshingAvatar}>
                  {refreshingAvatar ? '刷新中...' : '刷新头像'}
                </Button>
              </div>

              <div className="grid gap-3 text-sm md:grid-cols-2">
                <div className="rounded-2xl bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">阵营</div>
                  <div className="mt-1 font-medium">{previewAgent?.team || '-'}</div>
                </div>
                <div className="rounded-2xl bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">角色类型</div>
                  <div className="mt-1 font-medium">{previewAgent?.roleType || 'normal'}</div>
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground">能力标签</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(previewAgent?.capabilities || []).slice(0, 8).map((item) => (
                    <Badge key={item} variant="outline">{item}</Badge>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground">系统提示词</div>
                <div className="mt-2 max-h-[180px] overflow-auto rounded-2xl bg-muted/50 p-3 text-xs leading-6 text-muted-foreground">
                  {previewAgent?.systemPrompt || '等待生成'}
                </div>
              </div>
            </div>

            <DialogFooter className="mt-auto gap-2 border-t border-border/70 pt-5">
              <Button variant="outline" onClick={onClose}>取消</Button>
              <Button
                variant="outline"
                onClick={() => previewAgent && onContinueEdit(previewAgent)}
                disabled={!previewAgent}
              >
                打开完整编辑
              </Button>
              <Button onClick={handleCreate} disabled={!draftResult || creating}>
                {creating ? '创建中...' : '一键创建'}
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
