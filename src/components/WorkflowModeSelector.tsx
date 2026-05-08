'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Workflow, GitBranch, Check, Info, ArrowRight, Sparkles } from 'lucide-react';

interface WorkflowModeSelectorProps {
  value: 'phase-based' | 'state-machine' | 'ai-guided';
  onChange: (mode: 'phase-based' | 'state-machine' | 'ai-guided') => void;
  showDetails?: boolean;
  hideAiGuided?: boolean;
}

export default function WorkflowModeSelector({
  value,
  onChange,
  showDetails = true,
  hideAiGuided = false,
}: WorkflowModeSelectorProps) {
  const [hoveredMode, setHoveredMode] = useState<string | null>(null);

  const modes = [
    {
      id: 'phase-based',
      name: '阶段模式',
      icon: Workflow,
      tagline: '适合传统流程',
      description: '按照固定顺序执行：设计 → 实施 → 测试 → 优化',
      features: [
        '线性推进，步骤清晰',
        '阶段内可以迭代优化',
        '人工检查点控制',
        '适合瀑布式开发',
      ],
      pros: ['简单易懂', '流程可控', '适合固定流程'],
      cons: ['不够灵活', '跨阶段回退困难'],
      useCases: [
        '流程固定的任务',
        '不需要频繁回退',
        '传统项目开发',
      ],
      color: 'blue',
    },
    {
      id: 'state-machine',
      name: '状态机模式',
      icon: GitBranch,
      tagline: '智能动态流程',
      description: '根据问题类型自动跳转到对应阶段，支持跨阶段回退',
      features: [
        '问题驱动，自动路由',
        '支持跨阶段回退',
        '灵活的流程控制',
        '适合敏捷开发',
      ],
      pros: ['高度灵活', '智能路由', '快速响应问题'],
      cons: ['配置稍复杂', '需要理解状态机'],
      useCases: [
        '复杂的质量保证流程',
        '需要频繁回退调整',
        '敏捷迭代开发',
      ],
      color: 'purple',
    },
    {
      id: 'ai-guided',
      name: 'AI 引导创建',
      icon: Sparkles,
      tagline: '描述需求，AI 选择最佳实践',
      description: '描述你的工作流需求，AI 自动选择最佳实践并生成阶段或状态机工作流',
      features: [
        '自然语言描述需求',
        'AI 自动选择最佳模式',
        '红蓝对抗最佳实践',
        '交互式确认后创建',
      ],
      pros: ['零基础友好', '快速启动', '智能适配'],
      cons: ['需要 AI 运行时间', '可能需要微调'],
      useCases: [
        '不确定用哪种模式',
        '希望快速原型',
        '需要参考模板',
      ],
      color: 'green',
    },
  ];

  const filteredModes = hideAiGuided ? modes.filter(m => m.id !== 'ai-guided') : modes;
  const selectedMode = filteredModes.find(m => m.id === value);
  const hoveredModeData = filteredModes.find(m => m.id === hoveredMode);

  return (
    <div className="space-y-6">
      {/* 模式选择卡片 */}
      <div className="grid grid-cols-2 gap-4">
        {filteredModes.map((mode) => {
          const Icon = mode.icon;
          const isSelected = value === mode.id;
          const isHovered = hoveredMode === mode.id;

          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => onChange(mode.id as any)}
              onMouseEnter={() => setHoveredMode(mode.id)}
              onMouseLeave={() => setHoveredMode(null)}
              className={`
                relative p-6 rounded-xl border-2 text-left transition-all duration-200
                ${isSelected
                  ? `border-${mode.color}-500 bg-${mode.color}-50 dark:bg-${mode.color}-950 shadow-lg scale-105`
                  : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-md'
                }
              `}
            >
              {/* 选中标记 */}
              {isSelected && (
                <div className="absolute -top-2 -right-2 w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center shadow-lg">
                  <Check className="w-5 h-5 text-white" />
                </div>
              )}

              {/* 图标和标题 */}
              <div className="flex items-start gap-3 mb-3">
                <div className={`
                  p-2 rounded-lg
                  ${isSelected ? 'bg-white dark:bg-gray-800' : 'bg-gray-100 dark:bg-gray-900'}
                `}>
                  <Icon className={`w-6 h-6 ${isSelected ? 'text-blue-500' : 'text-gray-600'}`} />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-1">{mode.name}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{mode.tagline}</p>
                </div>
              </div>

              {/* 描述 */}
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                {mode.description}
              </p>

              {/* 特性列表 */}
              <div className="space-y-2">
                {mode.features.slice(0, 3).map((feature, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-blue-500' : 'bg-gray-400'}`} />
                    <span className="text-gray-600 dark:text-gray-400">{feature}</span>
                  </div>
                ))}
              </div>

              {/* 推荐标签 */}
              {mode.id === 'state-machine' && (
                <Badge className="mt-4 bg-gradient-to-r from-purple-500 to-blue-500 text-white border-0">
                  推荐使用
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* 详细对比（可选） */}
      {showDetails && selectedMode && (
        <div className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-4">
            <Info className="w-5 h-5 text-blue-500" />
            <h4 className="font-semibold">关于 {selectedMode.name}</h4>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* 优势 */}
            <div>
              <h5 className="text-sm font-medium text-green-600 dark:text-green-400 mb-2">✓ 优势</h5>
              <ul className="space-y-1">
                {selectedMode.pros.map((pro, idx) => (
                  <li key={idx} className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <span className="text-green-500">•</span>
                    {pro}
                  </li>
                ))}
              </ul>
            </div>

            {/* 劣势 */}
            <div>
              <h5 className="text-sm font-medium text-orange-600 dark:text-orange-400 mb-2">⚠ 注意事项</h5>
              <ul className="space-y-1">
                {selectedMode.cons.map((con, idx) => (
                  <li key={idx} className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <span className="text-orange-500">•</span>
                    {con}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 适用场景 */}
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h5 className="text-sm font-medium text-blue-600 dark:text-blue-400 mb-2">💡 适用场景</h5>
            <div className="flex flex-wrap gap-2">
              {selectedMode.useCases.map((useCase, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {useCase}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 流程示意图 */}
      {showDetails && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
          <h4 className="font-semibold mb-4">流程示意</h4>

          {value === 'phase-based' ? (
            <div className="flex items-center justify-center gap-3 py-4">
              {['设计', '实施', '测试', '优化'].map((phase, idx) => (
                <div key={phase} className="flex items-center gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-20 h-20 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center border-2 border-blue-300 dark:border-blue-700">
                      <span className="text-sm font-medium text-blue-700 dark:text-blue-300">{phase}</span>
                    </div>
                    {idx < 3 && (
                      <div className="text-xs text-gray-500 mt-1">可迭代</div>
                    )}
                  </div>
                  {idx < 3 && (
                    <ArrowRight className="w-5 h-5 text-gray-400" />
                  )}
                </div>
              ))}
            </div>
          ) : value === 'ai-guided' ? (
            <div className="flex items-center justify-center gap-3 py-4">
              {[
                { label: '描述需求', color: 'green', sub: '人类输入' },
                { label: 'AI 分析', color: 'green', sub: '选择最佳实践' },
                { label: '阶段 / 状态机', color: 'green', sub: '自动生成' },
              ].map((step, idx) => (
                <div key={step.label} className="flex items-center gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-24 h-20 rounded-lg bg-green-100 dark:bg-green-900 flex flex-col items-center justify-center border-2 border-green-300 dark:border-green-700 px-2">
                      <span className="text-sm font-medium text-green-700 dark:text-green-300 text-center">{step.label}</span>
                      <span className="text-xs text-green-600 dark:text-green-400 mt-1">{step.sub}</span>
                    </div>
                  </div>
                  {idx < 2 && (
                    <ArrowRight className="w-5 h-5 text-gray-400" />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="relative py-8">
              {/* 状态节点 */}
              <div className="grid grid-cols-4 gap-4 mb-4">
                {['设计', '实施', '测试', '优化'].map((state) => (
                  <div key={state} className="flex flex-col items-center">
                    <div className="w-20 h-20 rounded-lg bg-purple-100 dark:bg-purple-900 flex items-center justify-center border-2 border-purple-300 dark:border-purple-700">
                      <span className="text-sm font-medium text-purple-700 dark:text-purple-300">{state}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* 连接线示意 */}
              <div className="text-center text-sm text-gray-500 space-y-1">
                <div className="flex items-center justify-center gap-2">
                  <GitBranch className="w-4 h-4" />
                  <span>任意状态间可以跳转</span>
                </div>
                <div className="text-xs text-gray-400">
                  例如：测试阶段发现设计问题 → 直接回到设计阶段
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
