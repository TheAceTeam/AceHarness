import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'yaml';
import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';
import { getWorkspaceRunsDir } from '@/lib/app-paths';

interface TokenUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

interface StepLogLike {
  stepName?: string;
  agent?: string;
  status?: string;
  output?: string;
  error?: string;
  tokenUsage?: TokenUsageLike;
  sessionId?: string | null;
  engineName?: string;
  durationMs?: number;
  timestamp?: string;
}

interface PromptAnalysisResult {
  score: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  optimizedPrompt: string;
  summary: string;
}

interface RuntimeStepMetrics {
  status: string;
  engineName: string;
  attemptIndex: number;
  totalAttempts: number;
  retried: boolean;
  sessionId: string | null;
  reusedSession: boolean;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  incrementalInputTokens: number;
  incrementalOutputTokens: number;
  cumulativeTotalTokens: number;
  incrementalTotalTokens: number;
  outputChars: number;
  durationMs: number;
  timestamp: string;
}

interface RunAnalysisStep {
  agentName: string;
  stepName: string;
  analysis: PromptAnalysisResult;
  metrics: RuntimeStepMetrics;
}

interface RunAnalysisSummary {
  totalSteps: number;
  avgScore: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  failedSteps: number;
  retriedSteps: number;
  distinctRepeatedSteps: number;
  sessionCount: number;
  engineNames: string[];
  topTokenSteps: Array<{ stepName: string; tokens: number; agentName: string }>;
  findings: string[];
}

function n(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeTokenUsage(usage?: TokenUsageLike) {
  const inputTokens = n(usage?.inputTokens);
  const outputTokens = n(usage?.outputTokens);
  const cacheCreationInputTokens = n(usage?.cacheCreationInputTokens);
  const cacheReadInputTokens = n(usage?.cacheReadInputTokens);
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
  };
}

function sanitizeStepName(stepName: string): string {
  return stepName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
}

function summarizeOutputText(output: string, error?: string): string {
  if (output?.trim()) return output;
  if (error?.trim()) return `执行失败\n\n${error}`;
  return '';
}

function buildPromptSource(stepLog: StepLogLike, streamContent: string | null, outputContent: string | null): string {
  const sections: string[] = [];

  if (streamContent?.trim()) sections.push(streamContent.trim().slice(0, 12000));
  if (stepLog.output?.trim()) sections.push(stepLog.output.trim());
  if (outputContent?.trim()) sections.push(outputContent.trim().slice(0, 8000));
  if (sections.length === 0 && stepLog.error?.trim()) sections.push(stepLog.error.trim());

  return sections.filter(Boolean).join('\n\n---\n\n');
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function buildOptimizedPrompt(prompt: string): string {
  return `# 任务目标\n${prompt}\n\n## 执行约束\n- 明确目标、输入、输出与验收标准\n- 避免重复读取和重复验证\n- 结论必须可直接交给下一步继续执行\n\n## 输出要求\n1. 先给结论\n2. 再列证据和修改点\n3. 最后列剩余风险与下一步建议`;
}

function analyzePrompt(
  prompt: string,
  output: string,
  context: {
    status?: string;
    attemptIndex?: number;
    totalAttempts?: number;
    incrementalTokens?: number;
    outputChars?: number;
    reusedSession?: boolean;
    engineName?: string;
  } = {},
): PromptAnalysisResult {
  let score = 85;
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const suggestions: string[] = [];

  if (prompt.length < 120) {
    weaknesses.push('步骤输入过短，难以判断目标、边界和验收标准是否被完整表达');
    suggestions.push('把任务目标、约束、交付物和验证方式拆成独立小节');
    score -= 12;
  } else if (prompt.length > 9000) {
    weaknesses.push('单步上下文过长，模型更容易受历史噪声影响');
    suggestions.push('在进入下一步前先压缩前序结论，避免把整段历史反复带入');
    score -= 10;
  } else {
    strengths.push('步骤上下文长度处于可消费范围');
  }

  const hasStructure = /#{1,3}\s|\d+\.|\- |\* |\[/.test(prompt);
  if (hasStructure) {
    strengths.push('步骤内容具备结构化分段');
  } else {
    weaknesses.push('步骤文本结构较弱，关键信息不易被模型稳定复用');
    suggestions.push('用标题和列表拆出目标、动作、证据、风险');
    score -= 8;
  }

  const hasConstraints = /必须|禁止|不要|只能|验收|输出要求|结论/.test(prompt);
  if (hasConstraints) {
    strengths.push('步骤中包含约束或输出要求');
  } else {
    weaknesses.push('缺少明确约束或验收语言');
    suggestions.push('补充禁止项、完成条件和交付格式');
    score -= 8;
  }

  if (output.trim()) {
    strengths.push('步骤留下了可供复盘的输出');
  } else {
    weaknesses.push('步骤没有留下有效输出');
    suggestions.push('确保每一步至少沉淀结论、证据和下一步动作');
    score -= 20;
  }

  if (context.status === 'failed') {
    weaknesses.push('该步骤以失败结束，需要单独复盘失败原因与恢复策略');
    suggestions.push('将失败归因拆成配额/环境/提示词/实现问题四类记录');
    score -= 18;
  }

  if ((context.totalAttempts || 1) > 1) {
    weaknesses.push(`该步骤共执行 ${context.totalAttempts} 次，存在重复尝试或回退`);
    suggestions.push('把重试触发条件、上次失败原因和本次修正点显式写进上下文');
    score -= Math.min(10, ((context.totalAttempts || 1) - 1) * 4);
  }

  if ((context.incrementalTokens || 0) > 300000) {
    weaknesses.push('该步骤增量 token 消耗偏高，说明上下文压缩不足或任务边界过宽');
    suggestions.push('减少无关历史注入，优先传递结构化步骤结论而不是全文');
    score -= 10;
  } else if ((context.incrementalTokens || 0) > 0) {
    strengths.push('本步可估算出独立 token 消耗');
  }

  if ((context.outputChars || 0) > 0 && (context.incrementalTokens || 0) > 0) {
    const density = (context.incrementalTokens || 0) / Math.max(1, context.outputChars || 0);
    if (density > 180) {
      weaknesses.push('token 投入和最终有效输出比例偏低');
      suggestions.push('拆小步骤目标，减少一次性探索范围');
      score -= 8;
    }
  }

  if (context.reusedSession) {
    weaknesses.push('该步骤复用了已有会话，历史上下文可能持续膨胀');
    suggestions.push('跨阶段时考虑重建会话，或先做上下文摘要再继续');
    score -= 6;
  }

  if (context.engineName) {
    strengths.push(`运行引擎为 ${context.engineName}`);
  }

  score = Math.max(0, Math.min(100, score));
  const summary = weaknesses.length === 0
    ? '该步骤执行较稳定，结构、约束和输出都比较完整。'
    : `该步骤主要问题集中在${weaknesses.slice(0, 2).join('；')}。`;

  return {
    score,
    strengths,
    weaknesses,
    suggestions,
    optimizedPrompt: weaknesses.length > 0 ? buildOptimizedPrompt(prompt.slice(0, 6000)) : '',
    summary,
  };
}

function toStepMetrics(stepLog: StepLogLike, derived: {
  attemptIndex: number;
  totalAttempts: number;
  retried: boolean;
  reusedSession: boolean;
  incrementalInputTokens: number;
  incrementalOutputTokens: number;
  incrementalTotalTokens: number;
}): RuntimeStepMetrics {
  const usage = normalizeTokenUsage(stepLog.tokenUsage);
  return {
    status: stepLog.status || 'unknown',
    engineName: stepLog.engineName || '',
    attemptIndex: derived.attemptIndex,
    totalAttempts: derived.totalAttempts,
    retried: derived.retried,
    sessionId: stepLog.sessionId || null,
    reusedSession: derived.reusedSession,
    cumulativeInputTokens: usage.inputTokens,
    cumulativeOutputTokens: usage.outputTokens,
    incrementalInputTokens: derived.incrementalInputTokens,
    incrementalOutputTokens: derived.incrementalOutputTokens,
    cumulativeTotalTokens: usage.totalTokens,
    incrementalTotalTokens: derived.incrementalTotalTokens,
    outputChars: (stepLog.output || '').length,
    durationMs: n(stepLog.durationMs),
    timestamp: stepLog.timestamp || '',
  };
}

async function analyzeFromStepLogs(runDir: string, state: any): Promise<RunAnalysisStep[]> {
  const stepLogs = Array.isArray(state?.stepLogs) ? state.stepLogs as StepLogLike[] : [];
  const results: RunAnalysisStep[] = [];
  const stepAttempts = new Map<string, number>();
  const totalAttemptsMap = new Map<string, number>();
  const lastUsageBySession = new Map<string, ReturnType<typeof normalizeTokenUsage>>();

  for (const stepLog of stepLogs) {
    const stepName = typeof stepLog.stepName === 'string' ? stepLog.stepName.trim() : '';
    if (!stepName) continue;
    totalAttemptsMap.set(stepName, (totalAttemptsMap.get(stepName) || 0) + 1);
  }

  for (const stepLog of stepLogs) {
    const stepName = typeof stepLog.stepName === 'string' ? stepLog.stepName.trim() : '';
    const agentName = typeof stepLog.agent === 'string' ? stepLog.agent.trim() : '';
    if (!stepName || !agentName) continue;

    const safeName = sanitizeStepName(stepName);
    const [streamContent, outputContent] = await Promise.all([
      readOptionalFile(path.join(runDir, 'streams', `${safeName}.stream.md`)),
      readOptionalFile(path.join(runDir, 'outputs', `${safeName}.md`)),
    ]);

    const promptSource = buildPromptSource(stepLog, streamContent, outputContent);
    const outputText = summarizeOutputText(outputContent || stepLog.output || '', stepLog.error);
    if (!promptSource.trim() && !outputText.trim()) continue;

    const usage = normalizeTokenUsage(stepLog.tokenUsage);
    const attemptIndex = (stepAttempts.get(stepName) || 0) + 1;
    stepAttempts.set(stepName, attemptIndex);
    const totalAttempts = totalAttemptsMap.get(stepName) || attemptIndex;

    let incrementalInputTokens = usage.inputTokens;
    let incrementalOutputTokens = usage.outputTokens;
    let incrementalTotalTokens = usage.totalTokens;
    let reusedSession = false;

    if (stepLog.sessionId) {
      const previous = lastUsageBySession.get(stepLog.sessionId);
      if (previous) {
        reusedSession = true;
        incrementalInputTokens = Math.max(0, usage.inputTokens - previous.inputTokens);
        incrementalOutputTokens = Math.max(0, usage.outputTokens - previous.outputTokens);
        incrementalTotalTokens = Math.max(0, usage.totalTokens - previous.totalTokens);
      }
      lastUsageBySession.set(stepLog.sessionId, usage);
    }

    const metrics = toStepMetrics(stepLog, {
      attemptIndex,
      totalAttempts,
      retried: totalAttempts > 1,
      reusedSession,
      incrementalInputTokens,
      incrementalOutputTokens,
      incrementalTotalTokens,
    });

    results.push({
      agentName,
      stepName,
      metrics,
      analysis: analyzePrompt(
        promptSource.slice(0, 16000),
        outputText.slice(0, 6000),
        {
          status: metrics.status,
          attemptIndex,
          totalAttempts,
          incrementalTokens: metrics.incrementalTotalTokens,
          outputChars: metrics.outputChars,
          reusedSession,
          engineName: metrics.engineName,
        },
      ),
    });
  }

  return results;
}

async function analyzeFromLegacyLogs(runDir: string): Promise<RunAnalysisStep[]> {
  const results: RunAnalysisStep[] = [];
  const logsDir = path.join(runDir, 'logs');

  try {
    const logFiles = await readdir(logsDir);

    for (const logFile of logFiles) {
      if (!logFile.endsWith('.log')) continue;

      const logPath = path.join(logsDir, logFile);
      const logContent = await readFile(logPath, 'utf-8');
      const match = logFile.match(/^(.+?)-(.+?)(?:-迭代\d+)?\.log$/);
      if (!match) continue;

      const [, agentName, stepName] = match;
      const outputStart = logContent.indexOf('## ');
      const outputText = outputStart > 0 ? logContent.substring(outputStart, outputStart + 2000) : logContent;
      const analysis = analyzePrompt(logContent.substring(0, 6000), outputText);

      results.push({
        agentName,
        stepName,
        analysis,
        metrics: {
          status: 'unknown',
          engineName: '',
          attemptIndex: 1,
          totalAttempts: 1,
          retried: false,
          sessionId: null,
          reusedSession: false,
          cumulativeInputTokens: 0,
          cumulativeOutputTokens: 0,
          incrementalInputTokens: 0,
          incrementalOutputTokens: 0,
          cumulativeTotalTokens: 0,
          incrementalTotalTokens: 0,
          outputChars: outputText.length,
          durationMs: 0,
          timestamp: '',
        },
      });
    }
  } catch {
    return [];
  }

  return results;
}

function buildRunSummary(results: RunAnalysisStep[]): RunAnalysisSummary {
  const totalSteps = results.length;
  const avgScore = totalSteps > 0
    ? Math.round(results.reduce((sum, item) => sum + item.analysis.score, 0) / totalSteps)
    : 0;
  const totalInputTokens = results.reduce((sum, item) => sum + item.metrics.incrementalInputTokens, 0);
  const totalOutputTokens = results.reduce((sum, item) => sum + item.metrics.incrementalOutputTokens, 0);
  const totalTokens = results.reduce((sum, item) => sum + item.metrics.incrementalTotalTokens, 0);
  const failedSteps = results.filter((item) => item.metrics.status === 'failed').length;
  const retriedSteps = results.filter((item) => item.metrics.retried).length;
  const distinctRepeatedSteps = new Set(results.filter((item) => item.metrics.totalAttempts > 1).map((item) => item.stepName)).size;
  const sessionCount = new Set(results.map((item) => item.metrics.sessionId).filter(Boolean)).size;
  const engineNames = Array.from(new Set(results.map((item) => item.metrics.engineName).filter(Boolean)));
  const topTokenSteps = [...results]
    .sort((a, b) => b.metrics.incrementalTotalTokens - a.metrics.incrementalTotalTokens)
    .slice(0, 3)
    .map((item) => ({
      stepName: item.stepName,
      tokens: item.metrics.incrementalTotalTokens,
      agentName: item.agentName,
    }));

  const findings: string[] = [];
  if (distinctRepeatedSteps > 0) findings.push(`有 ${distinctRepeatedSteps} 个步骤发生重复执行，说明流程存在回退或重试。`);
  if (failedSteps > 0) findings.push(`有 ${failedSteps} 个步骤以失败结束，建议单独复盘失败触发点。`);
  if (sessionCount > 0 && totalTokens > 0) findings.push(`本次运行共复用了 ${sessionCount} 个会话，累计增量 token 约 ${totalTokens.toLocaleString()}。`);
  const highTokenStep = topTokenSteps[0];
  if (highTokenStep && highTokenStep.tokens > 0) {
    findings.push(`最高消耗步骤是「${highTokenStep.stepName}」，增量 token 约 ${highTokenStep.tokens.toLocaleString()}。`);
  }
  if (results.some((item) => item.metrics.reusedSession && item.metrics.incrementalInputTokens > 200000)) {
    findings.push('多个步骤在复用长会话时输入 token 持续上升，存在上下文膨胀风险。');
  }

  return {
    totalSteps,
    avgScore,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    failedSteps,
    retriedSteps,
    distinctRepeatedSteps,
    sessionCount,
    engineNames,
    topTokenSteps,
    findings,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { prompt, output, context, agentName } = await request.json();

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const result = analyzePrompt(prompt, output, { status: context });

    return NextResponse.json({
      success: true,
      agentName,
      analysis: result,
    });
  } catch (error) {
    console.error('Failed to analyze prompt:', error);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');

    if (!runId) {
      return NextResponse.json({ error: 'Run ID is required' }, { status: 400 });
    }

    const runsDir = getWorkspaceRunsDir();
    const runDir = path.join(runsDir, runId);

    try {
      await stat(runDir);
    } catch {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const statePath = path.join(runDir, 'state.yaml');
    const stateContent = await readFile(statePath, 'utf-8');
    const state = parse(stateContent);

    let results = await analyzeFromStepLogs(runDir, state);
    if (results.length === 0) {
      results = await analyzeFromLegacyLogs(runDir);
    }

    return NextResponse.json({
      success: true,
      runId,
      steps: results,
      summary: buildRunSummary(results),
    });
  } catch (error) {
    console.error('Failed to analyze run:', error);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}
