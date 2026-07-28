'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { roleConfigSchema } from '@/lib/core/schemas';
import type { RoleConfig } from '@/lib/core/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { EngineSelect } from '@/components/EngineSelect';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import { resolveAgentSelection } from '@/lib/agent/engine-selection';
import { getEngineMeta } from '@/lib/core/engine-metadata';
import { useRuntimeEngineSelectionQuery } from '@/client/query/engines';

interface AgentConfigPanelProps {
  agents: RoleConfig[];
  onSaveAgent: (agent: RoleConfig) => void;
  onDeleteAgent: (name: string) => void;
}

const teamBorderClass: Record<string, string> = {
  blue: 'border-l-blue-500',
  red: 'border-l-red-500',
  judge: 'border-l-yellow-500',
};

const teamBadgeClass: Record<string, string> = {
  blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  red: 'bg-red-500/20 text-red-400 border-red-500/30',
  judge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};

export default function AgentConfigPanel({ agents, onSaveAgent, onDeleteAgent }: AgentConfigPanelProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const runtimeSelectionQuery = useRuntimeEngineSelectionQuery();
  const globalEngine = runtimeSelectionQuery.data?.engine || '';
  const globalDefaultModel = runtimeSelectionQuery.data?.defaultModel || '';
  const { confirm, dialogProps } = useConfirmDialog();

  const handleSave = (data: RoleConfig) => {
    onSaveAgent(data);
    setEditingIndex(null);
    setIsAdding(false);
  };

  const handleDelete = async (index: number) => {
    const ok = await confirm({
      title: '确认删除',
      description: `确定删除 Agent "${agents[index].name}"？`,
      confirmLabel: '删除',
      variant: 'destructive',
    });
    if (!ok) return;
    onDeleteAgent(agents[index].name);
    setEditingIndex(null);
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3>Agent 配置</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setIsAdding(true); setEditingIndex(null); }}
        >
          <span className="material-symbols-outlined text-sm">add</span>
          新增 Agent
        </Button>
      </div>

      <div className="space-y-3">
        {agents.map((role, index) => (
          <div
            key={role.name}
            className={`border-l-4 rounded-md border p-3 cursor-pointer hover:bg-accent/50 transition-colors ${
              teamBorderClass[role.team] || 'border-l-border'
            } ${editingIndex === index ? 'bg-accent/30' : ''}`}
          >
            {editingIndex === index ? (
              <RoleEditForm
                role={role}
                onSave={handleSave}
                onCancel={() => setEditingIndex(null)}
                onDelete={() => handleDelete(index)}
              />
            ) : (
              <div onClick={() => setEditingIndex(index)}>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{role.name}</span>
                  <Badge className={teamBadgeClass[role.team]}>{role.team}</Badge>
                </div>
                <div className="flex gap-2 mt-1">
                  {(() => {
                    const resolved = resolveAgentSelection(role, {
                      engine: globalEngine,
                      defaultModel: globalDefaultModel,
                    });
                    return (
                      <>
                        <Badge variant="secondary" className="text-xs">{getEngineMeta(resolved.effectiveEngine)?.name || resolved.effectiveEngine || '未配置引擎'}</Badge>
                        <Badge variant="secondary" className="text-xs">{resolved.effectiveModel || '未配置模型'}</Badge>
                      </>
                    );
                  })()}
                  {role.temperature !== undefined && (
                    <Badge variant="secondary" className="text-xs">temp: {role.temperature}</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {role.capabilities.map((cap) => (
                    <Badge key={cap} variant="outline" className="text-xs">{cap}</Badge>
                  ))}
                </div>
                {role.constraints && role.constraints.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {role.constraints.map((c, i) => (
                      <Badge key={i} variant="outline" className="text-xs opacity-70">{c}</Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {isAdding && (
        <div className="border-l-4 rounded-md border p-3 cursor-pointer hover:bg-accent/50 transition-colors border-l-blue-500">
          <RoleEditForm
            role={null}
            onSave={handleSave}
            onCancel={() => setIsAdding(false)}
          />
        </div>
      )}
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  );
}

function RoleEditForm({
  role,
  onSave,
  onCancel,
  onDelete,
}: {
  role: RoleConfig | null;
  onSave: (data: RoleConfig) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const { register, handleSubmit, formState: { errors }, setValue, watch } = useForm<RoleConfig>({
    resolver: zodResolver(roleConfigSchema),
    defaultValues: role || {
      name: '',
      team: 'red',
      engineModels: {},
      activeEngine: '',
      capabilities: [],
      systemPrompt: '',
      keywords: [],
      description: '',
    },
  });

  const [capInput, setCapInput] = useState(role?.capabilities.join(', ') || '');
  const [constraintsInput, setConstraintsInput] = useState(role?.constraints?.join('\n') || '');
  const [keywordsInput, setKeywordsInput] = useState(role?.keywords?.join(', ') || '');
  const activeEngine = watch('activeEngine') || '';

  const onSubmit = (data: any) => {
    data.capabilities = capInput.split(',').map((s: string) => s.trim()).filter(Boolean);
    const constraints = constraintsInput.split('\n').map((s: string) => s.trim()).filter(Boolean);
    if (constraints.length > 0) data.constraints = constraints;
    const keywords = keywordsInput.split(',').map((s: string) => s.trim()).filter(Boolean);
    if (keywords.length > 0) data.keywords = keywords;
    onSave(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <div className="space-y-1">
        <Label>名称</Label>
        <Input {...register('name')} className={errors.name ? 'border-destructive' : ''} />
      </div>
      <div className="space-y-1">
        <Label>团队</Label>
        <div className="flex gap-3">
          {(['blue', 'red', 'judge'] as const).map((t) => (
            <label key={t} className="flex items-center gap-1 cursor-pointer">
              <input type="radio" value={t} {...register('team')} className="h-4 w-4 accent-primary" />
              <Badge className={teamBadgeClass[t]}>{t}</Badge>
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <Label>引擎</Label>
        <EngineSelect
          value={activeEngine}
          onChange={(value) => setValue('activeEngine', value, { shouldDirty: true, shouldValidate: true })}
          allowGlobal
        />
      </div>
      <div className="space-y-1">
        <Label>Temperature</Label>
        <Input type="number" step="0.1" min="0" max="2" {...register('temperature', { valueAsNumber: true })} placeholder="0.7" />
      </div>
      <div className="space-y-1">
        <Label>能力（逗号分隔）</Label>
        <Input value={capInput} onChange={(e) => setCapInput(e.target.value)} placeholder="代码审查, 漏洞发现" />
      </div>
      <div className="space-y-1">
        <Label>系统提示</Label>
        <Textarea
          {...register('systemPrompt')}
          rows={6}
          className={`font-mono text-xs ${errors.systemPrompt ? 'border-destructive' : ''}`}
        />
      </div>
      <div className="space-y-1">
        <Label>约束条件（每行一条）</Label>
        <Textarea
          value={constraintsInput}
          onChange={(e) => setConstraintsInput(e.target.value)}
          rows={3}
          className="font-mono text-xs"
          placeholder={"例如：\n必须提供至少两个备选方案\n每个方案需包含优劣分析"}
        />
      </div>
      <div className="space-y-1">
        <Label>路由关键词（逗号分隔，Supervisor-Lite 架构用）</Label>
        <Input 
          value={keywordsInput} 
          onChange={(e) => setKeywordsInput(e.target.value)} 
          placeholder="如：架构, 接口, 模块, API" 
        />
      </div>
      <div className="space-y-1">
        <Label>Agent 描述（Supervisor-Lite 架构用，不注入 prompt）</Label>
        <Input {...register('description')} placeholder="如：负责系统架构设计" />
      </div>
      <div className="flex items-center gap-2 pt-2">
        {onDelete && (
          <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
            <span className="material-symbols-outlined text-sm">delete</span>
            删除
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>取消</Button>
          <Button type="submit" size="sm">保存</Button>
        </div>
      </div>
    </form>
  );
}
