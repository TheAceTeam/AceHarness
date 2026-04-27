'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AgentHeroCard } from '@/components/agent/AgentHeroCard';

interface AgentConfig {
  name: string;
  team: 'blue' | 'red' | 'judge' | 'yellow' | 'black-gold';
  roleType?: 'normal' | 'supervisor';
  avatar?: any;
  category?: string;
  tags?: string[];
  model: string;
  temperature?: number;
  systemPrompt?: string;
  iterationPrompt?: string;
  capabilities?: string[];
  constraints?: string[];
}

interface AgentSelectorModalProps {
  agents: AgentConfig[];
  onSelect: (agentName: string) => void;
  onClose: () => void;
}

const CATEGORIES = ['测试', '编码', '设计', '压力测试', '审查', '文档', '其他'];

export default function AgentSelectorModal({ agents, onSelect, onClose }: AgentSelectorModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Get all unique tags
  const allTags = Array.from(new Set(agents.flatMap(a => a.tags || [])));

  // Filter agents
  const filteredAgents = agents.filter(agent => {
    if (searchQuery && !agent.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (selectedTeam !== 'all' && agent.team !== selectedTeam) {
      return false;
    }
    if (selectedCategory !== 'all' && agent.category !== selectedCategory) {
      return false;
    }
    if (selectedTags.length > 0 && !selectedTags.some(tag => agent.tags?.includes(tag))) {
      return false;
    }
    return true;
  });

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card rounded-lg border w-full max-w-5xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b flex-shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">选择 Agent</h2>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <span className="material-symbols-outlined">close</span>
            </Button>
          </div>

          {/* Search */}
          <Input
            placeholder="搜索 Agent..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="mb-4"
          />

          {/* Filters */}
          <div className="space-y-3">
            <div className="flex gap-2 items-center flex-wrap">
              <span className="text-sm text-muted-foreground">团队:</span>
              <Button
                size="sm"
                variant={selectedTeam === 'all' ? 'default' : 'outline'}
                onClick={() => setSelectedTeam('all')}
              >
                全部
              </Button>
              <Button
                size="sm"
                variant={selectedTeam === 'blue' ? 'default' : 'outline'}
                onClick={() => setSelectedTeam('blue')}
              >
                蓝队
              </Button>
              <Button
                size="sm"
                variant={selectedTeam === 'red' ? 'default' : 'outline'}
                onClick={() => setSelectedTeam('red')}
              >
                红队
              </Button>
              <Button
                size="sm"
                variant={selectedTeam === 'judge' ? 'default' : 'outline'}
                onClick={() => setSelectedTeam('judge')}
              >
                裁判
              </Button>
              <Button
                size="sm"
                variant={selectedTeam === 'yellow' ? 'default' : 'outline'}
                onClick={() => setSelectedTeam('yellow')}
              >
                黄队
              </Button>
              <Button
                size="sm"
                variant={selectedTeam === 'black-gold' ? 'default' : 'outline'}
                onClick={() => setSelectedTeam('black-gold')}
              >
                指挥官
              </Button>
            </div>

            <div className="flex gap-2 items-center flex-wrap">
              <span className="text-sm text-muted-foreground">分类:</span>
              <Button
                size="sm"
                variant={selectedCategory === 'all' ? 'default' : 'outline'}
                onClick={() => setSelectedCategory('all')}
              >
                全部
              </Button>
              {CATEGORIES.map(cat => (
                <Button
                  key={cat}
                  size="sm"
                  variant={selectedCategory === cat ? 'default' : 'outline'}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </Button>
              ))}
            </div>

            {allTags.length > 0 && (
              <div className="flex gap-2 items-center flex-wrap">
                <span className="text-sm text-muted-foreground">标签:</span>
                {allTags.map(tag => (
                  <Badge
                    key={tag}
                    variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Agent List */}
        <div className="flex-1 overflow-auto p-6">
          {filteredAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <span className="material-symbols-outlined text-5xl mb-4">smart_toy</span>
              <p>没有找到匹配的 Agent</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredAgents.map(agent => (
                <AgentHeroCard
                  key={agent.name}
                  compact
                  onClick={() => onSelect(agent.name)}
                  agent={agent as any}
                />
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="p-6 border-t flex justify-end flex-shrink-0">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
