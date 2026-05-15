'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { SingleCombobox } from '@/components/ui/combobox';
import type { HomeSidebarHint } from '@/lib/core/home-sidebar-state';
import { formatAgentDraftText, type AgentDraftState } from '@/lib/agent/draft';

export type { AgentDraftState };

export interface AgentDraftPreview {
  name?: unknown;
  team?: unknown;
  activeEngine?: unknown;
  description?: unknown;
  capabilities?: unknown[];
  systemPrompt?: unknown;
}

export interface AgentPanelProps {
  sidebarHint: HomeSidebarHint | null;
  agentDraft: AgentDraftState;
  setAgentDraft: Dispatch<SetStateAction<AgentDraftState>>;
  agentDraftPreview: AgentDraftPreview | null;
  agentDraftRaw: string;
  draftingAgent: boolean;
  creatingAgent: boolean;
  engine: string;
  workflows: Array<{ filename: string; name?: string }>;
  onOpenModal: () => void;
  onOpenAgentsPage: () => void;
  onGenerateDraft: () => void;
  onCreateAgent: () => void;
}

export function AgentPanel({
  sidebarHint,
  agentDraft,
  setAgentDraft,
  agentDraftPreview,
  agentDraftRaw,
  draftingAgent,
  creatingAgent,
  engine,
  workflows,
  onOpenModal,
  onOpenAgentsPage,
  onGenerateDraft,
  onCreateAgent,
}: AgentPanelProps) {
  const sidebarWorkingDirectory = formatAgentDraftText(sidebarHint?.agentDraft?.workingDirectory);
  const previewName = formatAgentDraftText(agentDraftPreview?.name);
  const previewTeam = formatAgentDraftText(agentDraftPreview?.team);
  const previewActiveEngine = formatAgentDraftText(agentDraftPreview?.activeEngine);
  const previewDescription = formatAgentDraftText(agentDraftPreview?.description);
  const previewSystemPrompt = formatAgentDraftText(agentDraftPreview?.systemPrompt);
  const previewCapabilities = (agentDraftPreview?.capabilities || [])
    .map((capability) => formatAgentDraftText(capability).trim())
    .filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-4">
        <h3 className="text-sm font-medium">AI 引导创建 Agent</h3>
        <p className="mt-2 text-xs text-muted-foreground leading-5">
          右侧触发正式引导弹框，而不是把创建过程塞进聊天气泡。
        </p>
        {sidebarWorkingDirectory ? (
          <div className="mt-4 rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
            <div className="font-medium text-foreground">当前识别到的工程上下文</div>
            <div className="whitespace-normal break-all">目录：{sidebarWorkingDirectory}</div>
          </div>
        ) : null}
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={onOpenModal}>打开 Agent 引导</Button>
          <Button size="sm" variant="outline" onClick={onOpenAgentsPage}>
            打开 Agent 页
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">当前 Agent 草案焦点</div>
          <Badge variant="outline">{agentDraft.displayName ? '已识别' : '待补全'}</Badge>
        </div>
        <div className="text-xs text-muted-foreground leading-5">
          {agentDraft.mission || '优先收敛名称、职责、工作目录和风格，剩余字段由 AI 草案补齐。'}
        </div>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">名称</label>
          <Input
            value={agentDraft.displayName}
            onChange={(e) => setAgentDraft((prev) => ({ ...prev, displayName: e.target.value }))}
            placeholder="例如：架构审查官"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">队伍</label>
          <SingleCombobox
            value={agentDraft.team}
            onValueChange={(value) => setAgentDraft((prev) => ({ ...prev, team: value as AgentDraftState['team'] }))}
            options={[
              { value: 'blue', label: '蓝队（攻击）' },
              { value: 'red', label: '红队（防守）' },
              { value: 'judge', label: '裁定席' },
            ]}
            searchable={false}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">职责</label>
          <Textarea
            value={agentDraft.mission}
            onChange={(e) => setAgentDraft((prev) => ({ ...prev, mission: e.target.value }))}
            placeholder="例如：负责需求拆解、架构评审和关键风险识别"
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">风格</label>
          <Input
            value={agentDraft.style}
            onChange={(e) => setAgentDraft((prev) => ({ ...prev, style: e.target.value }))}
            placeholder="例如：冷静、严谨、强势"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">擅长领域</label>
          <Textarea
            value={agentDraft.specialties}
            onChange={(e) => setAgentDraft((prev) => ({ ...prev, specialties: e.target.value }))}
            placeholder="例如：架构设计, 评审, 风险识别"
            rows={3}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">参考工作流</label>
          <SingleCombobox
            value={agentDraft.referenceWorkflow || ''}
            onValueChange={(value) => setAgentDraft((prev) => ({ ...prev, referenceWorkflow: value || '' }))}
            options={[
              { value: '', label: '不指定' },
              ...workflows.map((workflow) => ({
                value: workflow.filename,
                label: workflow.name ? `${workflow.name} (${workflow.filename})` : workflow.filename,
              })),
            ]}
            placeholder="可选：参考已有 workflow 角色分工"
            searchable
          />
        </div>
      </div>

      <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{previewName || agentDraft.displayName || 'Agent 角色预览'}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {(previewTeam || agentDraft.team)} · {(previewActiveEngine || engine || 'follow-global')}
            </div>
          </div>
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-600 text-white flex items-center justify-center shadow-lg">
            <span className="material-symbols-outlined">smart_toy</span>
          </div>
        </div>
        <div className="mt-3 text-xs text-muted-foreground leading-5 line-clamp-3">
          {previewDescription || agentDraft.mission || '填写职责后会在这里显示角色卡预览。'}
        </div>
        {previewCapabilities.length ? (
          <div className="mt-3 flex flex-wrap gap-1">
            {previewCapabilities.slice(0, 4).map((capability) => (
              <Badge key={capability} variant="outline">{capability}</Badge>
            ))}
          </div>
        ) : null}
      </div>

      {agentDraftPreview ? (
        <div className="rounded-2xl border p-4 space-y-2">
          <div className="text-sm font-medium">AI 草案预览</div>
          <div className="text-xs text-muted-foreground break-all">name: {previewName}</div>
          <div className="text-xs text-muted-foreground">team: {previewTeam}</div>
          <div className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">
            {previewSystemPrompt}
          </div>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button className="flex-1" variant="outline" onClick={onGenerateDraft} disabled={draftingAgent}>
          {draftingAgent ? '生成中...' : 'AI生成草案'}
        </Button>
        <Button className="flex-1" onClick={onCreateAgent} disabled={creatingAgent}>
          {creatingAgent ? '创建中...' : '保存 Agent 草案'}
        </Button>
      </div>

      {agentDraftRaw ? (
        <details className="rounded-2xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">查看原始草案输出</summary>
          <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">{agentDraftRaw}</pre>
        </details>
      ) : null}
    </div>
  );
}
