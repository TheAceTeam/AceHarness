import type { SpecCodingArtifacts } from '@/lib/core/schemas';
import { validateTasksMarkdownFormat, type TasksMarkdownFormatValidation } from '@/lib/spec/coding-store';

export type SpecArtifactQualityLevel = 'error' | 'warning';
export type SpecArtifactQualityArtifact = keyof SpecCodingArtifacts | 'all';

export interface SpecArtifactQualityIssue {
  level: SpecArtifactQualityLevel;
  artifact: SpecArtifactQualityArtifact;
  code: string;
  message: string;
  suggestion?: string;
}

export interface SpecArtifactQualityReport {
  ok: boolean;
  issues: SpecArtifactQualityIssue[];
  errors: SpecArtifactQualityIssue[];
  warnings: SpecArtifactQualityIssue[];
  taskValidation: TasksMarkdownFormatValidation;
}

const PLACEHOLDER_PATTERNS = [
  /<(?:功能名称|需求名称|组件名|术语\s*[A-Z]|\s*TODO\s*|\s*TBD\s*)>/i,
  /\bTBD\b/i,
  /\bTODO\b/i,
  /待补充|占位|这里填写|示例[ A-Z0-9：:]/,
];

function nonEmptyLines(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasPlaceholder(markdown: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(markdown));
}

function countMatches(markdown: string, pattern: RegExp): number {
  return [...markdown.matchAll(pattern)].length;
}

function requirementIds(markdown: string): Set<string> {
  const result = new Set<string>();
  for (const match of markdown.matchAll(/^###\s+(?:需求|Requirement)\s*([A-Za-z]*\d+(?:\.\d+)*)?[：:\s-]+(.+)$/gim)) {
    const explicit = match[1]?.trim();
    const title = match[2]?.trim();
    if (explicit) result.add(explicit.toUpperCase().startsWith('R') ? explicit.toUpperCase() : `R${explicit}`);
    const fromTitle = title?.match(/\bR\d+(?:\.\d+)*\b/i)?.[0];
    if (fromTitle) result.add(fromTitle.toUpperCase());
  }
  for (const match of markdown.matchAll(/\bR\d+(?:\.\d+)*\b/gi)) {
    result.add(match[0].toUpperCase());
  }
  return result;
}

function referencedRequirementIds(markdown: string): Set<string> {
  const result = new Set<string>();
  for (const match of markdown.matchAll(/\bR\d+(?:\.\d+)*\b/gi)) {
    result.add(match[0].toUpperCase());
  }
  return result;
}

function pushIssue(
  issues: SpecArtifactQualityIssue[],
  issue: SpecArtifactQualityIssue,
): void {
  issues.push(issue);
}

export function validateSpecArtifactsQuality(artifacts: Partial<SpecCodingArtifacts>): SpecArtifactQualityReport {
  const requirements = artifacts.requirements || '';
  const design = artifacts.design || '';
  const tasks = artifacts.tasks || '';
  const issues: SpecArtifactQualityIssue[] = [];

  const requirementsLines = nonEmptyLines(requirements);
  const designLines = nonEmptyLines(design);

  if (requirementsLines.length < 12) {
    pushIssue(issues, {
      level: 'error',
      artifact: 'requirements',
      code: 'requirements_too_short',
      message: 'requirements.md 内容过短，无法支撑后续实现。',
      suggestion: '补充背景、术语、能力拆分、需求块、验收场景、非目标和待确认项。',
    });
  }
  if (!/^#\s+/.test(requirements.trim())) {
    pushIssue(issues, {
      level: 'error',
      artifact: 'requirements',
      code: 'requirements_missing_title',
      message: 'requirements.md 缺少一级标题。',
    });
  }
  if (!/##\s*(?:术语表|Glossary)/i.test(requirements)) {
    pushIssue(issues, {
      level: 'warning',
      artifact: 'requirements',
      code: 'requirements_missing_glossary',
      message: 'requirements.md 缺少术语表，后续 AI 容易混用业务对象和边界概念。',
    });
  }
  if (!/##\s*(?:能力拆分|Capabilities|需求|Requirements)/i.test(requirements)) {
    pushIssue(issues, {
      level: 'error',
      artifact: 'requirements',
      code: 'requirements_missing_capabilities_or_requirements',
      message: 'requirements.md 缺少能力拆分或需求章节。',
    });
  }

  const requirementBlockCount = countMatches(requirements, /^###\s+(?:需求|Requirement)\b/gim);
  if (requirementBlockCount < 2) {
    pushIssue(issues, {
      level: 'warning',
      artifact: 'requirements',
      code: 'requirements_low_decomposition',
      message: 'requirements.md 需求块少于 2 个，可能没有按能力、流程或风险充分拆解。',
      suggestion: '至少拆出核心能力、边界/异常、验证/兼容中的两类需求。',
    });
  }
  if (!/(用户故事|User Story|作为.+我希望|As a .+ I want)/i.test(requirements)) {
    pushIssue(issues, {
      level: 'error',
      artifact: 'requirements',
      code: 'requirements_missing_user_story',
      message: 'requirements.md 缺少用户故事或角色-目标-价值表达。',
    });
  }
  if (!/\bWHEN\b[\s\S]*\bTHEN\b/i.test(requirements)) {
    pushIssue(issues, {
      level: 'error',
      artifact: 'requirements',
      code: 'requirements_missing_scenarios',
      message: 'requirements.md 缺少可验证的 WHEN/THEN 场景。',
    });
  }
  if (hasPlaceholder(requirements)) {
    pushIssue(issues, {
      level: 'error',
      artifact: 'requirements',
      code: 'requirements_placeholder',
      message: 'requirements.md 仍包含占位符或 TODO。',
    });
  }

  if (designLines.length < 14) {
    pushIssue(issues, {
      level: 'error',
      artifact: 'design',
      code: 'design_too_short',
      message: 'design.md 内容过短，无法指导实现。',
      suggestion: '补充架构/数据流、组件接口、数据模型、关键决策、风险、兼容和测试方案。',
    });
  }
  if (!/```mermaid[\s\S]*?```/i.test(design)) {
    pushIssue(issues, {
      level: 'warning',
      artifact: 'design',
      code: 'design_missing_mermaid',
      message: 'design.md 缺少 Mermaid 图，依赖关系和流程不够可审查。',
    });
  }
  for (const [code, label, pattern] of [
    ['design_missing_components', '组件与接口', /##\s*(?:组件与接口|Components|Interfaces)/i],
    ['design_missing_data_model', '数据模型', /##\s*(?:数据模型|Data Model|Data Models)/i],
    ['design_missing_decisions', '关键决策', /##\s*(?:关键决策|Decisions|Decision Log)/i],
    ['design_missing_test_plan', '测试方案', /##\s*(?:测试方案|Test Plan|Verification)/i],
  ] as const) {
    if (!pattern.test(design)) {
      pushIssue(issues, {
        level: code === 'design_missing_decisions' ? 'error' : 'warning',
        artifact: 'design',
        code,
        message: `design.md 缺少${label}章节。`,
      });
    }
  }
  if (hasPlaceholder(design)) {
    pushIssue(issues, {
      level: 'error',
      artifact: 'design',
      code: 'design_placeholder',
      message: 'design.md 仍包含占位符或 TODO。',
    });
  }

  const taskValidation = validateTasksMarkdownFormat(tasks);
  for (const error of taskValidation.errors) {
    pushIssue(issues, {
      level: 'error',
      artifact: 'tasks',
      code: 'tasks_format',
      message: error,
    });
  }
  if (!/需求追踪[：:]|\bR\d+(?:\.\d+)*\b/i.test(tasks)) {
    pushIssue(issues, {
      level: 'error',
      artifact: 'tasks',
      code: 'tasks_missing_requirement_trace',
      message: 'tasks.md 缺少需求追踪，无法确认任务覆盖哪些需求。',
    });
  }
  if (!/设计追踪[：:]|\bD\d+(?:\.\d+)*\b/i.test(tasks)) {
    pushIssue(issues, {
      level: 'warning',
      artifact: 'tasks',
      code: 'tasks_missing_design_trace',
      message: 'tasks.md 缺少设计追踪，任务和设计决策之间的关系不清晰。',
    });
  }
  if (!/验证[：:]|validation|test|check/i.test(tasks)) {
    pushIssue(issues, {
      level: 'error',
      artifact: 'tasks',
      code: 'tasks_missing_validation',
      message: 'tasks.md 缺少验证方式。',
    });
  }
  if (hasPlaceholder(tasks)) {
    pushIssue(issues, {
      level: 'error',
      artifact: 'tasks',
      code: 'tasks_placeholder',
      message: 'tasks.md 仍包含占位符或 TODO。',
    });
  }

  const reqIds = requirementIds(requirements);
  const taskReqIds = referencedRequirementIds(tasks);
  if (reqIds.size > 0 && taskReqIds.size > 0) {
    const uncovered = [...reqIds].filter((id) => !taskReqIds.has(id));
    if (uncovered.length > 0) {
      pushIssue(issues, {
        level: 'warning',
        artifact: 'all',
        code: 'requirements_not_referenced_by_tasks',
        message: `以下需求没有被 tasks.md 引用：${uncovered.join(', ')}。`,
      });
    }
  }

  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  return {
    ok: errors.length === 0,
    issues,
    errors,
    warnings,
    taskValidation,
  };
}
