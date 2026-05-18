'use client';

import { useState } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  Lightbulb,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Sparkles,
} from 'lucide-react';
import type { StateMachineState } from '@/lib/core/schemas';

interface StateMachineWizardProps {
  onComplete: (states: StateMachineState[]) => void;
  onSkip: () => void;
}

export default function StateMachineWizard({ onComplete, onSkip }: StateMachineWizardProps) {
  const [step, setStep] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const templates = [
    {
      id: 'quality-assurance',
      name: '质量保证流程',
      description: '适合需要严格质量控制的项目',
      icon: '🛡️',
      states: ['设计', '实施', '测试', '修复', '优化'],
      features: [
        '支持测试阶段发现设计问题时回退',
        '独立的修复阶段处理问题',
        '性能优化与功能开发分离',
      ],
      difficulty: '中等',
    },
    {
      id: 'agile-development',
      name: '敏捷开发流程',
      description: '快速迭代，灵活调整',
      icon: '⚡',
      states: ['需求分析', '快速开发', '持续测试', '快速修复'],
      features: [
        '快速响应需求变化',
        '持续测试和反馈',
        '最小化状态数量',
      ],
      difficulty: '简单',
    },
    {
      id: 'security-audit',
      name: '安全审计流程',
      description: '专注于安全漏洞发现和修复',
      icon: '🔒',
      states: ['代码审计', '漏洞扫描', '渗透测试', '安全修复', '复测验证'],
      features: [
        '多层次安全检查',
        '发现严重漏洞立即回退',
        '完整的修复验证流程',
      ],
      difficulty: '复杂',
    },
    {
      id: 'custom',
      name: '自定义流程',
      description: '从零开始设计你的工作流',
      icon: '✨',
      states: [],
      features: [
        '完全自定义状态和转移',
        '适合特殊需求',
        '需要理解状态机概念',
      ],
      difficulty: '高级',
    },
  ];

  const steps = [
    {
      title: '欢迎使用状态机工作流',
      description: '让我们通过几个简单的步骤，帮你创建一个智能的工作流',
    },
    {
      title: '选择模板',
      description: '选择一个最接近你需求的模板，后续可以自由修改',
    },
    {
      title: '了解核心概念',
      description: '快速了解状态机的工作原理',
    },
  ];

  const currentStep = steps[step];
  const selectedTemplateData = templates.find(t => t.id === selectedTemplate);

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      // 完成向导，生成初始状态
      if (selectedTemplateData) {
        const initialStates = generateStatesFromTemplate(selectedTemplateData);
        onComplete(initialStates);
      }
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  return (
    <div className="min-h-[600px] flex flex-col">
      {/* 进度指示器 */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          {steps.map((s, idx) => (
            <div key={idx} className="flex items-center flex-1">
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm
                ${idx <= step
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                }
              `}>
                {idx < step ? <CheckCircle2 className="w-5 h-5" /> : idx + 1}
              </div>
              {idx < steps.length - 1 && (
                <div className={`
                  flex-1 h-1 mx-2
                  ${idx < step ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700'}
                `} />
              )}
            </div>
          ))}
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          步骤 {step + 1} / {steps.length}
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1">
        {/* 步骤 0: 欢迎 */}
        {step === 0 && (
          <div className="text-center space-y-6 py-8">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-500 rounded-2xl mx-auto flex items-center justify-center">
              <Sparkles className="w-10 h-10 text-white" />
            </div>

            <div>
              <h2 className="text-2xl font-bold mb-2">{currentStep.title}</h2>
              <p className="text-gray-600 dark:text-gray-400">{currentStep.description}</p>
            </div>

            <div className="bg-blue-50 dark:bg-blue-950 rounded-xl p-6 text-left max-w-2xl mx-auto">
              <div className="flex items-start gap-3 mb-4">
                <Lightbulb className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold mb-2">什么是状态机工作流？</h3>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    状态机工作流可以根据问题类型自动跳转到对应的阶段。例如：
                  </p>
                </div>
              </div>

              <div className="space-y-3 ml-8">
                <div className="flex items-start gap-2 text-sm">
                  <span className="text-green-500">✓</span>
                  <span>测试阶段发现<strong>设计问题</strong> → 自动回到设计阶段重新设计</span>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <span className="text-green-500">✓</span>
                  <span>优化阶段发现<strong>性能回归</strong> → 自动回到实施阶段修复</span>
                </div>
                <div className="flex items-start gap-2 text-sm">
                  <span className="text-green-500">✓</span>
                  <span>任何阶段发现<strong>严重问题</strong> → 智能路由到对应阶段</span>
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4 max-w-3xl mx-auto">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <div className="text-3xl mb-2">🎯</div>
                <h4 className="font-semibold text-sm mb-1">智能路由</h4>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  根据问题类型自动决定下一步
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <div className="text-3xl mb-2">🔄</div>
                <h4 className="font-semibold text-sm mb-1">灵活回退</h4>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  支持跨阶段回退，不受限制
                </p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <div className="text-3xl mb-2">⚡</div>
                <h4 className="font-semibold text-sm mb-1">快速响应</h4>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  发现问题立即处理，不等待
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 步骤 1: 选择模板 */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold mb-2">{currentStep.title}</h2>
              <p className="text-gray-600 dark:text-gray-400">{currentStep.description}</p>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedTemplate(template.id)}
                  className={`
                    p-6 rounded-xl border-2 text-left transition-all
                    ${selectedTemplate === template.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 shadow-lg'
                      : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 hover:shadow-md'
                    }
                  `}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="text-3xl">{template.icon}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold">{template.name}</h3>
                        <Badge variant="outline" className="text-xs">
                          {template.difficulty}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {template.description}
                      </p>
                    </div>
                  </div>

                  {template.states.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs text-gray-500 mb-2">包含状态：</div>
                      <div className="flex flex-wrap gap-1">
                        {template.states.map((state) => (
                          <Badge key={state} variant="secondary" className="text-xs">
                            {state}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    {template.features.map((feature, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400">
                        <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 步骤 2: 核心概念 */}
        {step === 2 && selectedTemplateData && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold mb-2">{currentStep.title}</h2>
              <p className="text-gray-600 dark:text-gray-400">{currentStep.description}</p>
            </div>

            <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950 rounded-xl p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <span className="text-2xl">{selectedTemplateData.icon}</span>
                你选择了：{selectedTemplateData.name}
              </h3>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <HelpCircle className="w-5 h-5 text-blue-500" />
                    <h4 className="font-semibold">状态 (State)</h4>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    工作流的每个阶段，包含要执行的步骤
                  </p>
                  <div className="space-y-1">
                    {selectedTemplateData.states.slice(0, 3).map((state) => (
                      <div key={state} className="flex items-center gap-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                        <span>{state}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <ArrowRight className="w-5 h-5 text-purple-500" />
                    <h4 className="font-semibold">转移 (Transition)</h4>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    定义何时从一个状态跳转到另一个状态
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                      <span>通过 → 进入下一状态</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                      <span>发现问题 → 回退到对应状态</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-yellow-50 dark:bg-yellow-950 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
              <div className="flex items-start gap-3">
                <Lightbulb className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-yellow-900 dark:text-yellow-100 mb-1">
                    提示：创建后可以随时调整
                  </p>
                  <p className="text-yellow-800 dark:text-yellow-200">
                    不用担心现在的选择，你可以在设计界面中添加、删除或修改任何状态和转移规则。
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 底部按钮 */}
      <div className="flex items-center justify-between pt-6 border-t border-gray-200 dark:border-gray-700 mt-6">
        <Button
          type="button"
          variant="ghost"
          onClick={onSkip}
        >
          跳过向导
        </Button>

        <div className="flex gap-2">
          {step > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
            >
              上一步
            </Button>
          )}
          <Button
            type="button"
            onClick={handleNext}
            disabled={step === 1 && !selectedTemplate}
          >
            {step === steps.length - 1 ? '完成' : '下一步'}
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function generateStatesFromTemplate(template: any): StateMachineState[] {
  // 简化版本，实际应该根据模板生成完整的状态配置
  return template.states.map((stateName: string, index: number) => ({
    name: stateName,
    description: '',
    steps: [],
    transitions: [],
    isInitial: index === 0,
    isFinal: index === template.states.length - 1,
    position: {
      x: (index % 3) * 300 + 100,
      y: Math.floor(index / 3) * 200 + 100,
    },
  }));
}
