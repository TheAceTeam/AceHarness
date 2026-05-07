'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ModelSelect } from '@/components/ModelSelect';
import { SingleCombobox } from '@/components/ui/combobox';
import { EngineSelect } from '@/components/EngineSelect';
import { getEngineMeta } from '@/lib/engine-metadata';

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

interface AgentConfig {
  name: string;
  team: 'blue' | 'red' | 'judge';
  category?: string;
  tags?: string[];
  engineModels: Record<string, string>;
  activeEngine: string;
  temperature?: number;
  systemPrompt?: string;
  iterationPrompt?: string;
  capabilities?: string[];
  constraints?: string[];
  reviewPanel?: ReviewPanel;
  // Supervisor-Lite 新增
  keywords?: string[];
  description?: string;
}

interface AgentEditModalProps {
  agent: AgentConfig;
  isNew: boolean;
  onSave: (agent: AgentConfig) => void;
  onClose: () => void;
}

const CATEGORIES = ['测试', '编码', '设计', '压力测试', '审查', '文档', '其他'];

export default function AgentEditModal({ agent, isNew, onSave, onClose }: AgentEditModalProps) {
  // Normalize: ensure engineModels exists and strip legacy global-model entry
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
  };
  const [formData, setFormData] = useState<AgentConfig>(normalizedAgent);
  const [newTag, setNewTag] = useState('');
  const [newCapability, setNewCapability] = useState('');
  const [newConstraint, setNewConstraint] = useState('');
  const [globalEngine, setGlobalEngine] = useState('');
  const [globalDefaultModel, setGlobalDefaultModel] = useState('');
  const [editingSubAgent, setEditingSubAgent] = useState<{ name: string; config: SubAgent } | null>(null);
  const [newSubAgentName, setNewSubAgentName] = useState('');

  useEffect(() => {
    fetch('/api/engine')
      .then((res) => res.json())
      .then((data) => {
        setGlobalEngine(data.engine || '');
        setGlobalDefaultModel(data.defaultModel || '');
      })
      .catch(() => {});
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      alert('请输入 Agent 名称');
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
    if (formData.activeEngine && !formData.engineModels[formData.activeEngine]) {
      alert('当前启用的引擎必须选择模型');
      return;
    }

    const dataToSave = { ...formData };
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
      setFormData({
        ...formData,
        tags: [...(formData.tags || []), newTag.trim()]
      });
      setNewTag('');
    }
  };

  const removeTag = (tag: string) => {
    setFormData({
      ...formData,
      tags: formData.tags?.filter(t => t !== tag)
    });
  };

  const addCapability = () => {
    if (newCapability.trim() && !formData.capabilities?.includes(newCapability.trim())) {
      setFormData({
        ...formData,
        capabilities: [...(formData.capabilities || []), newCapability.trim()]
      });
      setNewCapability('');
    }
  };

  const removeCapability = (cap: string) => {
    setFormData({
      ...formData,
      capabilities: formData.capabilities?.filter(c => c !== cap)
    });
  };

  const addConstraint = () => {
    if (newConstraint.trim() && !formData.constraints?.includes(newConstraint.trim())) {
      setFormData({
        ...formData,
        constraints: [...(formData.constraints || []), newConstraint.trim()]
      });
      setNewConstraint('');
    }
  };

  const removeConstraint = (con: string) => {
    setFormData({
      ...formData,
      constraints: formData.constraints?.filter(c => c !== con)
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form
        className="bg-card rounded-lg border w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="p-6 border-b flex items-center justify-between flex-shrink-0">
          <h2 className="text-xl font-semibold">
            {isNew ? '新建 Agent' : `编辑 Agent - ${agent.name}`}
          </h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>名称 *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="agent-name"
                disabled={!isNew}
              />
            </div>

            <div>
              <Label>团队 *</Label>
              <SingleCombobox
                value={formData.team}
                onValueChange={(v) => setFormData({ ...formData, team: v as any })}
                options={[
                  { value: 'blue', label: '蓝队（防守）' },
                  { value: 'red', label: '红队（攻击）' },
                  { value: 'judge', label: '裁判' },
                ]}
                placeholder="选择团队"
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
              <Input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={formData.temperature ?? ''}
                onChange={(e) => setFormData({ ...formData, temperature: e.target.value ? parseFloat(e.target.value) : undefined })}
                placeholder="0.7"
              />
            </div>
          </div>

          {/* 模型配置 */}
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
                      <ModelSelect
                        value={mod}
                        onChange={(v) => setFormData({ ...formData, engineModels: { ...formData.engineModels, [eng]: v } })}
                        engine={eng}
                      />
                    ) : (
                      <div className="text-sm text-muted-foreground">跟随系统时不支持单独设置模型</div>
                    )}
                  </div>
                  {Object.keys(formData.engineModels).length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const updated = { ...formData.engineModels };
                        delete updated[eng];
                        const newActive = formData.activeEngine === eng ? Object.keys(updated)[0] : formData.activeEngine;
                        setFormData({ ...formData, engineModels: updated, activeEngine: newActive });
                      }}
                    >
                      <span className="material-symbols-outlined text-sm text-destructive">delete</span>
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
                  const allEngines = ['claude-code', 'kiro-cli', 'opencode', 'nga', 'codegenie', 'codex', 'cursor', 'cangjie-magic', 'trae-cli'];
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

          {/* Tags */}
          <div>
            <Label>标签</Label>
            <div className="flex gap-2 mb-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="添加标签..."
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
              />
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

          {/* System Prompt */}
          <div>
            <Label>系统提示词</Label>
            <Textarea
              value={formData.systemPrompt || ''}
              onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
              rows={6}
              placeholder="定义 Agent 的角色和行为..."
            />
          </div>

          {/* Iteration Prompt */}
          <div>
            <Label>
              迭代提示词
              <span className="text-xs text-muted-foreground ml-2">
                （在迭代阶段使用此提示词替代系统提示词）
              </span>
            </Label>
            <Textarea
              value={formData.iterationPrompt || ''}
              onChange={(e) => setFormData({ ...formData, iterationPrompt: e.target.value })}
              rows={6}
              placeholder="例如：你是一个修复问题的专家，专注于根据反馈修复代码中的问题..."
            />
          </div>

          {/* Capabilities */}
          <div>
            <Label>能力</Label>
            <div className="flex gap-2 mb-2">
              <Input
                value={newCapability}
                onChange={(e) => setNewCapability(e.target.value)}
                placeholder="添加能力..."
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCapability())}
              />
              <Button type="button" onClick={addCapability}>添加</Button>
            </div>
            <div className="flex flex-wrap gap-1">
              {formData.capabilities?.map(cap => (
                <Badge key={cap} variant="outline" className="cursor-pointer" onClick={() => removeCapability(cap)}>
                  {cap} <span className="ml-1">×</span>
                </Badge>
              ))}
            </div>
          </div>

          {/* Constraints */}
          <div>
            <Label>约束</Label>
            <div className="flex gap-2 mb-2">
              <Input
                value={newConstraint}
                onChange={(e) => setNewConstraint(e.target.value)}
                placeholder="添加约束..."
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addConstraint())}
              />
              <Button type="button" onClick={addConstraint}>添加</Button>
            </div>
            <div className="flex flex-wrap gap-1">
              {formData.constraints?.map(con => (
                <Badge key={con} variant="outline" className="cursor-pointer" onClick={() => removeConstraint(con)}>
                  {con} <span className="ml-1">×</span>
                </Badge>
              ))}
            </div>
          </div>

          {/* Keywords (Supervisor-Lite) */}
          <div>
            <Label>
              路由关键词
              <span className="text-xs text-muted-foreground ml-2">
                （Supervisor-Lite 架构用，逗号分隔）
              </span>
            </Label>
            <Input
              value={formData.keywords?.join(', ') || ''}
              onChange={(e) => setFormData({ 
                ...formData, 
                keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) 
              })}
              placeholder="如：架构, 接口, 模块, API"
            />
          </div>

          {/* Description (Supervisor-Lite) */}
          <div>
            <Label>
              Agent 描述
              <span className="text-xs text-muted-foreground ml-2">
                （Supervisor-Lite 架构用，不注入 prompt）
              </span>
            </Label>
            <Input
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="如：负责系统架构设计"
            />
          </div>

          {/* Expert Panel Configuration */}
          <div className="border-t pt-6">
            <div className="mb-4">
              <Label className="text-base">专家配置</Label>
              <p className="text-xs text-muted-foreground mt-1">
                配置多个专家子 Agent，在节点启用专家模式时从不同角度进行分析
              </p>
            </div>

            <div className="space-y-4 pl-4 border-l-2">
              <div>
                <Label>专家模式描述</Label>
                <Input
                  value={formData.reviewPanel?.description || ''}
                  onChange={(e) => {
                    if (!formData.reviewPanel) {
                      setFormData({
                        ...formData,
                        reviewPanel: {
                          enabled: true,
                          description: e.target.value,
                          subAgents: {},
                        },
                      });
                    } else {
                      setFormData({
                        ...formData,
                        reviewPanel: {
                          ...formData.reviewPanel,
                          description: e.target.value,
                        },
                      });
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
                        setFormData({
                          ...formData,
                          reviewPanel: {
                            enabled: true,
                            description: '',
                            subAgents: {},
                          },
                        });
                      }
                      setNewSubAgentName('');
                      setEditingSubAgent({
                        name: '',
                        config: {
                          description: '',
                          prompt: '',
                          tools: ['Read', 'Glob', 'Grep'],
                          model: 'claude-sonnet-4-6',
                        },
                      });
                    }}
                  >
                    添加专家
                  </Button>
                </div>

                <div className="space-y-2">
                  {Object.entries(formData.reviewPanel?.subAgents || {}).map(([name, config]) => (
                    <div
                      key={name}
                      className="p-3 border rounded-lg hover:border-primary/50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-medium">{name}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {config.description}
                          </div>
                          <div className="flex gap-1 mt-2">
                            <Badge variant="outline" className="text-xs">
                              {config.model}
                            </Badge>
                            {config.tools.map(tool => (
                              <Badge key={tool} variant="secondary" className="text-xs">
                                {tool}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setNewSubAgentName(name);
                              setEditingSubAgent({ name, config });
                            }}
                          >
                            编辑
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const newSubAgents = { ...formData.reviewPanel!.subAgents };
                              delete newSubAgents[name];
                              setFormData({
                                ...formData,
                                reviewPanel: {
                                  ...formData.reviewPanel!,
                                  subAgents: newSubAgents,
                                },
                              });
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
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end p-6 border-t flex-shrink-0">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="submit">
            保存
          </Button>
        </div>
      </form>

      {/* Sub-Agent Edit Modal */}
      {editingSubAgent && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60]" onClick={() => setEditingSubAgent(null)}>
          <div
            className="bg-card rounded-lg border w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
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
                  <Input
                    value={newSubAgentName}
                    onChange={(e) => setNewSubAgentName(e.target.value)}
                    placeholder="例如：correctness-reviewer"
                  />
                </div>
              )}

              <div>
                <Label>描述 *</Label>
                <Input
                  value={editingSubAgent.config.description}
                  onChange={(e) => setEditingSubAgent({
                    ...editingSubAgent,
                    config: { ...editingSubAgent.config, description: e.target.value },
                  })}
                  placeholder="例如：编译器正确性审查专家"
                />
              </div>

              <div>
                <Label>提示词 *</Label>
                <Textarea
                  value={editingSubAgent.config.prompt}
                  onChange={(e) => setEditingSubAgent({
                    ...editingSubAgent,
                    config: { ...editingSubAgent.config, prompt: e.target.value },
                  })}
                  rows={8}
                  placeholder="定义专家的职责和输出格式..."
                />
              </div>

              <div>
                <Label>模型</Label>
                <ModelSelect
                  value={editingSubAgent.config.model}
                  onChange={(value) => setEditingSubAgent({
                    ...editingSubAgent,
                    config: { ...editingSubAgent.config, model: value },
                  })}
                />
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
                        setEditingSubAgent({
                          ...editingSubAgent,
                          config: { ...editingSubAgent.config, tools },
                        });
                      }}
                    >
                      {tool}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 justify-end p-4 border-t flex-shrink-0">
              <Button type="button" variant="outline" onClick={() => setEditingSubAgent(null)}>
                取消
              </Button>
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
    </div>
  );
}
