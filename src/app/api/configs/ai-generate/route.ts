import { NextRequest, NextResponse } from 'next/server';
import {
  buildWorkflowExperiencePromptBlock,
  findRelevantWorkflowExperiences,
} from '@/lib/workflow-experience-store';
import {
  buildMemoryPromptBlock,
  listMemoryEntries,
} from '@/lib/workflow-memory-store';

interface PhaseTemplate {
  name: string;
  steps: Array<{ name: string; agent: string; task: string }>;
}

interface StateMachineStateTemplate {
  name: string;
  description: string;
  isInitial: boolean;
  isFinal: boolean;
  position: { x: number; y: number };
  maxSelfTransitions?: number;
  steps: Array<{ name: string; agent: string; task: string }>;
  transitions: Array<{ to: string; condition: { verdict?: string }; priority: number; label: string }>;
}

function createDefaultWorkflowGovernance() {
  return {
    supervisor: {
      enabled: true,
      agent: 'default-supervisor',
      stageReviewEnabled: true,
      checkpointAdviceEnabled: true,
      scoringEnabled: true,
      experienceEnabled: true,
    },
  };
}

/**
 * 判断需求是否更适合状态机模式
 */
function shouldUseStateMachine(requirements: string): boolean {
  const req = requirements.toLowerCase();
  const smKeywords = [
    '状态机', 'state-machine', 'state machine',
    '回退', '回滚', 'rollback',
    '循环', '迭代', 'loop', 'iterate',
    '条件跳转', '动态路由', '问题驱动',
    '红蓝对抗', '攻防',
    'ICE', '修复流程', 'bug fix',
    '质量保证', 'qa',
  ];
  return smKeywords.some(kw => req.includes(kw));
}

/**
 * 生成阶段模式配置
 */
function generatePhaseBasedConfig(requirements: string, workflowName: string, workspaceMode: 'isolated-copy' | 'in-place' = 'in-place') {
  const req = requirements.toLowerCase();

  const isCodeReview = req.includes('审查') || req.includes('review') || req.includes('pr');
  const isTesting = req.includes('测试') || req.includes('test');
  const isDesign = req.includes('设计') || req.includes('design');
  const isSecurity = req.includes('安全') || req.includes('security');

  const phases: PhaseTemplate[] = [];

  if (isCodeReview) {
    phases.push({
      name: '代码审查',
      steps: [
        { name: '获取代码变更', agent: 'developer', task: '获取 PR 的代码变更内容' },
        { name: '执行代码审查', agent: 'code-hunter', task: '分析代码变更，进行安全性和质量审查' },
        { name: '生成审查报告', agent: 'code-judge', task: '汇总审查结果，生成审查报告' },
      ],
    });
  }

  if (isTesting) {
    phases.push({
      name: '测试验证',
      steps: [
        { name: '准备测试环境', agent: 'developer', task: '搭建测试环境' },
        { name: '执行测试', agent: 'tester', task: '运行测试用例' },
        { name: '分析测试结果', agent: 'code-judge', task: '分析测试结果，生成报告' },
      ],
    });
  }

  if (isDesign) {
    phases.push({
      name: '设计评审',
      steps: [
        { name: '需求分析', agent: 'architect', task: '分析需求文档' },
        { name: '方案设计', agent: 'architect', task: '设计技术方案' },
        { name: '评审确认', agent: 'design-judge', task: '评审并确认设计方案' },
      ],
    });
  }

  if (isSecurity) {
    phases.push({
      name: '安全检测',
      steps: [
        { name: '安全扫描', agent: 'code-hunter', task: '执行安全扫描' },
        { name: '漏洞分析', agent: 'code-auditor', task: '分析发现的漏洞' },
        { name: '修复建议', agent: 'developer', task: '提供漏洞修复建议' },
      ],
    });
  }

  // 如果没有匹配到关键词，生成通用工作流
  if (phases.length === 0) {
    phases.push(
      { name: '需求分析', steps: [{ name: '收集需求', agent: 'architect', task: requirements }] },
      { name: '方案设计', steps: [{ name: '设计解决方案', agent: 'architect', task: '根据需求设计解决方案' }] },
      { name: '实施执行', steps: [{ name: '执行任务', agent: 'developer', task: '实施方案' }] },
      { name: '验证确认', steps: [{ name: '验证结果', agent: 'tester', task: '验证实施结果' }] },
    );
  }

  return {
    workflow: {
      name: workflowName,
      description: requirements,
      ...createDefaultWorkflowGovernance(),
      phases,
    },
    context: {
      projectRoot: '',
      workspaceMode,
      requirements,
    },
  };
}

/**
 * 生成状态机模式配置（每个状态包含蓝队/红队/裁判三个步骤）
 */
function generateStateMachineConfig(requirements: string, workflowName: string, workspaceMode: 'isolated-copy' | 'in-place' = 'in-place') {
  const req = requirements.toLowerCase();

  const isSecurityAudit = req.includes('安全') || req.includes('security') || req.includes('攻防') || req.includes('红蓝');
  const isBugFix = req.includes('修复') || req.includes('fix') || req.includes('bug') || req.includes('ice');

  let states: StateMachineStateTemplate[];

  if (isSecurityAudit) {
    states = [
      {
        name: '安全扫描', description: '蓝队扫描、红队渗透、裁判评估', isInitial: true, isFinal: false,
        position: { x: 100, y: 200 }, maxSelfTransitions: 2,
        steps: [
          { name: '自动化扫描', agent: 'code-hunter', task: '执行安全扫描，发现潜在漏洞' },
          { name: '渗透测试', agent: 'stress-tester', task: '模拟攻击，验证安全防护' },
          { name: '扫描评估', agent: 'code-judge', task: '评估扫描和渗透结果，给出 verdict' },
        ],
        transitions: [
          { to: '漏洞分析', condition: { verdict: 'pass' }, priority: 1, label: '发现问题' },
          { to: '完成', condition: { verdict: 'fail' }, priority: 2, label: '无问题' },
        ],
      },
      {
        name: '漏洞分析', description: '蓝队分析、红队验证、裁判判定', isInitial: false, isFinal: false,
        position: { x: 400, y: 200 }, maxSelfTransitions: 3,
        steps: [
          { name: '漏洞分析', agent: 'code-auditor', task: '深入分析安全漏洞，评估影响范围' },
          { name: '漏洞验证', agent: 'code-hunter', task: '验证漏洞可利用性，评估实际风险' },
          { name: '分析评审', agent: 'code-judge', task: '综合分析结果，给出 verdict' },
        ],
        transitions: [
          { to: '修复验证', condition: { verdict: 'pass' }, priority: 1, label: '分析完成' },
          { to: '安全扫描', condition: { verdict: 'fail' }, priority: 2, label: '需要更多数据' },
        ],
      },
      {
        name: '修复验证', description: '蓝队修复、红队回测、裁判验收', isInitial: false, isFinal: false,
        position: { x: 700, y: 200 }, maxSelfTransitions: 3,
        steps: [
          { name: '实施修复', agent: 'developer', task: '实施安全修复方案' },
          { name: '修复回测', agent: 'stress-tester', task: '对修复后的代码进行安全回测' },
          { name: '修复评审', agent: 'code-judge', task: '验证修复效果，给出 verdict' },
        ],
        transitions: [
          { to: '完成', condition: { verdict: 'pass' }, priority: 1, label: '修复验证通过' },
          { to: '漏洞分析', condition: { verdict: 'fail' }, priority: 2, label: '修复无效' },
        ],
      },
      {
        name: '完成', description: '安全审计完成', isInitial: false, isFinal: true,
        position: { x: 1000, y: 200 },
        steps: [
          { name: '生成报告', agent: 'developer', task: '生成安全审计总结报告' },
          { name: '报告审查', agent: 'code-auditor', task: '审查报告完整性' },
          { name: '最终确认', agent: 'code-judge', task: '确认报告质量' },
        ],
        transitions: [],
      },
    ];
  } else if (isBugFix) {
    states = [
      {
        name: '复现确认', description: '蓝队复现、红队验证、裁判确认', isInitial: true, isFinal: false,
        position: { x: 100, y: 200 }, maxSelfTransitions: 3,
        steps: [
          { name: '构造复现用例', agent: 'developer', task: '构造最小可复现用例，确认问题可稳定触发' },
          { name: '复现验证', agent: 'code-hunter', task: '独立验证复现用例，确认问题存在' },
          { name: '复现评审', agent: 'code-judge', task: '确认复现结果，给出 verdict' },
        ],
        transitions: [
          { to: '根因分析', condition: { verdict: 'pass' }, priority: 1, label: '已复现' },
          { to: '复现确认', condition: { verdict: 'fail' }, priority: 2, label: '未能复现' },
        ],
      },
      {
        name: '根因分析', description: '蓝队定位、红队挑战、裁判判定', isInitial: false, isFinal: false,
        position: { x: 400, y: 200 }, maxSelfTransitions: 3,
        steps: [
          { name: '根因定位', agent: 'architect', task: '分析问题根本原因，定位关键代码' },
          { name: '分析挑战', agent: 'design-breaker', task: '挑战根因分析结论，寻找遗漏' },
          { name: '分析评审', agent: 'design-judge', task: '综合分析结果，给出 verdict' },
        ],
        transitions: [
          { to: '修复实施', condition: { verdict: 'pass' }, priority: 1, label: '根因已定位' },
          { to: '复现确认', condition: { verdict: 'fail' }, priority: 2, label: '需要更多信息' },
        ],
      },
      {
        name: '修复实施', description: '蓝队修复、红队审查、裁判验收', isInitial: false, isFinal: false,
        position: { x: 700, y: 200 }, maxSelfTransitions: 3,
        steps: [
          { name: '编写修复', agent: 'developer', task: '实施修复方案' },
          { name: '修复审查', agent: 'code-hunter', task: '审查修复代码质量和正确性' },
          { name: '修复评审', agent: 'code-judge', task: '综合修复结果，给出 verdict' },
        ],
        transitions: [
          { to: '回归验证', condition: { verdict: 'pass' }, priority: 1, label: '修复完成' },
          { to: '根因分析', condition: { verdict: 'fail' }, priority: 2, label: '方案不可行' },
        ],
      },
      {
        name: '回归验证', description: '蓝队测试、红队压测、裁判判定', isInitial: false, isFinal: false,
        position: { x: 1000, y: 200 }, maxSelfTransitions: 3,
        steps: [
          { name: '回归测试', agent: 'tester', task: '验证修复效果并进行回归测试' },
          { name: '压力回测', agent: 'stress-tester', task: '对修复进行压力和边界测试' },
          { name: '验证评审', agent: 'code-judge', task: '综合验证结果，给出 verdict' },
        ],
        transitions: [
          { to: '完成', condition: { verdict: 'pass' }, priority: 1, label: '验证通过' },
          { to: '修复实施', condition: { verdict: 'fail' }, priority: 2, label: '验证未通过' },
        ],
      },
      {
        name: '完成', description: '修复流程结束', isInitial: false, isFinal: true,
        position: { x: 1300, y: 200 },
        steps: [
          { name: '总结报告', agent: 'developer', task: '生成修复总结报告' },
          { name: '报告审查', agent: 'code-auditor', task: '审查报告完整性和准确性' },
          { name: '最终确认', agent: 'code-judge', task: '确认报告质量' },
        ],
        transitions: [],
      },
    ];
  } else {
    // 通用状态机：设计 → 实施 → 测试 → 完成
    states = [
      {
        name: '设计', description: '蓝队设计、红队挑战、裁判评审', isInitial: true, isFinal: false,
        position: { x: 100, y: 200 }, maxSelfTransitions: 3,
        steps: [
          { name: '方案设计', agent: 'architect', task: requirements || '根据需求设计技术方案' },
          { name: '方案挑战', agent: 'design-breaker', task: '审查设计方案，寻找潜在缺陷' },
          { name: '设计评审', agent: 'design-judge', task: '综合评审，给出 verdict' },
        ],
        transitions: [
          { to: '实施', condition: { verdict: 'pass' }, priority: 1, label: '设计通过' },
          { to: '设计', condition: { verdict: 'fail' }, priority: 2, label: '需要修改' },
        ],
      },
      {
        name: '实施', description: '蓝队编码、红队审查、裁判验收', isInitial: false, isFinal: false,
        position: { x: 400, y: 200 }, maxSelfTransitions: 3,
        steps: [
          { name: '编码实施', agent: 'developer', task: '根据设计方案进行编码实施' },
          { name: '代码审查', agent: 'code-hunter', task: '审查代码质量和安全性' },
          { name: '实施评审', agent: 'code-judge', task: '综合评审，给出 verdict' },
        ],
        transitions: [
          { to: '测试', condition: { verdict: 'pass' }, priority: 1, label: '实施完成' },
          { to: '设计', condition: { verdict: 'fail' }, priority: 2, label: '设计有问题' },
        ],
      },
      {
        name: '测试', description: '蓝队测试、红队攻击、裁判判定', isInitial: false, isFinal: false,
        position: { x: 700, y: 200 }, maxSelfTransitions: 3,
        steps: [
          { name: '功能测试', agent: 'tester', task: '编写并执行测试用例' },
          { name: '压力测试', agent: 'stress-tester', task: '进行边界和压力测试' },
          { name: '测试评审', agent: 'code-judge', task: '综合测试结果，给出 verdict' },
        ],
        transitions: [
          { to: '完成', condition: { verdict: 'pass' }, priority: 1, label: '测试通过' },
          { to: '实施', condition: { verdict: 'fail' }, priority: 2, label: '测试失败' },
        ],
      },
      {
        name: '完成', description: '工作流结束', isInitial: false, isFinal: true,
        position: { x: 1000, y: 200 },
        steps: [
          { name: '生成报告', agent: 'developer', task: '生成最终总结报告' },
          { name: '报告审查', agent: 'code-auditor', task: '审查报告完整性' },
          { name: '最终确认', agent: 'code-judge', task: '确认报告质量' },
        ],
        transitions: [],
      },
    ];
  }


  return {
    workflow: {
      name: workflowName,
      description: requirements,
      mode: 'state-machine' as const,
      maxTransitions: 30,
      ...createDefaultWorkflowGovernance(),
      states,
    },
    context: {
      projectRoot: '',
      workspaceMode,
      requirements,
    },
  };
}

/**
 * 使用 AI 生成工作流配置
 * 根据需求描述自动选择合适的工作流模式，并生成符合 schema 的配置
 */
function generateWorkflowFromRequirements(requirements: string, workflowName: string, workspaceMode: 'isolated-copy' | 'in-place' = 'in-place') {
  if (shouldUseStateMachine(requirements)) {
    return generateStateMachineConfig(requirements, workflowName, workspaceMode);
  }
  return generatePhaseBasedConfig(requirements, workflowName, workspaceMode);
}

function applyExperienceHintsToConfig(config: any, hints: string[]) {
  if (!Array.isArray(hints) || hints.length === 0) return config;
  const note = `参考历史经验：${hints.slice(0, 2).join('；')}`;

  if (Array.isArray(config?.workflow?.phases)) {
    const firstStep = config.workflow.phases[0]?.steps?.[0];
    if (firstStep?.task && !String(firstStep.task).includes('参考历史经验')) {
      firstStep.task = `${firstStep.task}\n${note}`;
    }
  }

  if (Array.isArray(config?.workflow?.states)) {
    const firstStep = config.workflow.states[0]?.steps?.[0];
    if (firstStep?.task && !String(firstStep.task).includes('参考历史经验')) {
      firstStep.task = `${firstStep.task}\n${note}`;
    }
  }

  return config;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { requirements, workflowName, workspaceMode, workingDirectory } = body;
    const normalizedWorkspaceMode = workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place';

    if (!requirements || requirements.trim().length < 10) {
      return NextResponse.json(
        { error: '需求描述太短', message: '请提供更详细的需求描述（至少10个字符）' },
        { status: 400 }
      );
    }

    const relatedExperiences = await findRelevantWorkflowExperiences({
      workflowName: String(workflowName || ''),
      requirements: String(requirements || ''),
      projectRoot: typeof workingDirectory === 'string' ? workingDirectory : undefined,
      limit: 3,
    }).catch(() => []);
    const projectMemories = typeof workingDirectory === 'string' && workingDirectory.trim()
      ? await listMemoryEntries({
          scope: 'project',
          key: workingDirectory.trim(),
          limit: 3,
        }).catch(() => [])
      : [];

    // 生成工作流配置
    const config = applyExperienceHintsToConfig(
      generateWorkflowFromRequirements(requirements, workflowName || 'AI生成工作流', normalizedWorkspaceMode),
      relatedExperiences.flatMap((item) => [...item.experience.slice(0, 1), ...item.nextFocus.slice(0, 1)]).filter(Boolean)
    );
    const mode = 'mode' in config.workflow ? config.workflow.mode : 'phase-based';

    return NextResponse.json({
      success: true,
      config,
      mode,
      experienceHints: relatedExperiences,
      experienceSummary: [
        buildWorkflowExperiencePromptBlock(relatedExperiences, '相关历史经验'),
        buildMemoryPromptBlock('项目级共享记忆', projectMemories, { maxItems: 3 }),
      ].filter(Boolean).join('\n\n'),
      message: mode === 'state-machine'
        ? '根据需求描述，已生成状态机工作流模板。你可以在设计页面进一步调整状态和转移。'
        : '已根据需求描述生成阶段工作流模板。你可以在设计页面进一步调整阶段和步骤。',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '生成失败', message: error.message },
      { status: 500 }
    );
  }
}
