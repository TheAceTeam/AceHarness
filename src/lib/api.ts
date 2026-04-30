/**
 * API 客户端 - 与后端服务器通信
 */

import type { RunRecord } from '@/lib/run-store';
import type { DeltaMergeState, HumanQuestion, HumanQuestionAnswer } from '@/lib/run-state-persistence';

const API_BASE = '/api';

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = { ...getAuthHeaders(), ...(init?.headers || {}) };
  return fetch(url, { ...init, headers }).then(res => {
    if (res.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('auth-token');
      // Dispatch a custom event so AuthGuard / page can react
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    return res;
  });
}

interface ConfigListResponse {
  files: string[];
  configs: {
    filename: string;
    name: string;
    description: string;
    phaseCount: number;
    stepCount: number;
    agentCount: number;
  }[];
}

interface ConfigResponse {
  config: any;
  raw: string;
  agents: any[];
}

interface WorkflowCreationRecommendationsResponse {
  recommendations: {
    experiences: Array<{
      runId: string;
      workflowName?: string;
      configFile: string;
      summary: string;
      experience: string[];
      nextFocus: string[];
    }>;
    referenceWorkflow: null | {
      filename: string;
      name?: string;
      description?: string;
      mode: 'phase-based' | 'state-machine';
      agents: string[];
      supervisorAgent?: string;
      source?: 'manual' | 'recommended-experience';
      autoApply?: boolean;
    };
    recommendedAgents: string[];
    recommendedSupervisorAgent?: string;
    relationshipHints: Array<{
      agent: string;
      counterpart: string;
      synergyScore: number;
      strengths: string[];
      lastConfigFile?: string;
    }>;
  };
}

interface ApiResponse {
  success: boolean;
  message: string;
  interrupted?: boolean;
}

interface WorkflowStatusResponse {
  status: string;
  statusReason?: string;
  runId: string | null;
  currentConfigFile: string | null;
  logs: any[];
  agents: any[];
  currentPhase: string | null;
  currentStep: string | null;
  completedSteps: string[];
  failedSteps: string[];
  stepLogs?: { stepName: string; agent: string; status: string; output: string; error: string; costUsd: number; durationMs: number; timestamp: string }[];
  iterationStates: Record<string, any>;
  globalContext?: string;
  phaseContexts?: Record<string, string>;
  workingDirectory?: string | null;
  persistMode?: 'none' | 'repository';
  deltaSpecMerged?: boolean;
  deltaMergeState?: DeltaMergeState;
  masterSpecPath?: string;
  // State machine specific fields
  stateHistory?: any[];
  issueTracker?: any[];
  transitionCount?: number;
  startTime?: string | null;
  endTime?: string | null;
  supervisorFlow?: Array<{
    type: string;
    from: string;
    to: string;
    question?: string;
    method?: string;
    round: number;
    timestamp: string;
    stateName?: string;
  }>;
  agentFlow?: Array<{
    id: string;
    type: string;
    fromAgent: string;
    toAgent: string;
    message?: string;
    stateName: string;
    stepName: string;
    round: number;
    timestamp: string;
  }>;
  creationSession?: {
    id: string;
    workflowName: string;
    filename: string;
    status: string;
    updatedAt: number;
  };
  specCodingSummary?: {
    id: string;
    version: number;
    status: string;
    source?: 'run' | 'creation';
    summary?: string;
    phaseCount: number;
    taskCount?: number;
    assignmentCount: number;
    checkpointCount: number;
    revisionCount: number;
    progress?: {
      overallStatus?: string;
      completedPhaseIds?: string[];
      activePhaseId?: string;
      summary?: string;
    };
    latestRevision?: {
      id: string;
      version: number;
      summary: string;
      createdAt: string;
      createdBy?: string;
    } | null;
  };
  specCodingDetails?: {
    phases: Array<{
      id: string;
      title: string;
      objective?: string;
      ownerAgents: string[];
      status: string;
    }>;
    tasks?: Array<{
      id: string;
      title: string;
      detail?: string;
      status: string;
      phaseId?: string;
      ownerAgents: string[];
      updatedAt?: string;
      updatedBy?: string;
      validation?: string;
    }>;
    assignments: Array<{
      agent: string;
      responsibility: string;
      phaseIds: string[];
    }>;
    checkpoints: Array<{
      id: string;
      title: string;
      phaseId?: string;
      status: string;
    }>;
    revisions: Array<{
      id: string;
      version: number;
      summary: string;
      createdAt: string;
      createdBy?: string;
    }>;
    artifacts?: {
      requirements?: string;
      design?: string;
      tasks?: string;
    };
  };
  sourceOfTruth?: {
    mode: 'phase-based' | 'state-machine' | 'unknown';
    yamlSourceOfTruth: string[];
    derivedIntoSpecCoding: string[];
    runtimeSpecCodingSourceOfTruth: string[];
    counts: {
      yamlPhases: number;
      yamlStates: number;
      yamlSteps: number;
      yamlCheckpoints: number;
      specCodingPhases: number;
      specCodingTasks?: number;
      specCodingAssignments: number;
      specCodingCheckpoints: number;
    };
  } | null;
  latestSupervisorReview?: {
    type: 'state-review' | 'checkpoint-advice' | 'chat-revision' | 'human-question';
    stateName: string;
    content: string;
    timestamp: string;
    affectedArtifacts?: string[];
    impact?: string[];
  } | null;
  humanQuestions?: HumanQuestion[];
  pendingHumanQuestionId?: string | null;
  pendingHumanQuestion?: HumanQuestion | null;
  humanAnswersContext?: Array<{
    questionId: string;
    title: string;
    question: string;
    answer: string;
    instruction?: string;
    answeredAt: string;
  }>;
  rehearsal?: {
    enabled: boolean;
    summary: string;
    recommendedNextSteps: string[];
  } | null;
  qualityChecks?: Array<{
    id: string;
    stateName: string;
    stepName: string;
    agent: string;
    category: 'lint' | 'compile' | 'test' | 'custom';
    status: 'passed' | 'failed' | 'warning';
    summary: string;
    createdAt: string;
    commands: Array<{
      command: string;
      exitCode: number | null;
      status: 'passed' | 'failed' | 'warning';
      stdout?: string;
      stderr?: string;
      errorText?: string | null;
    }>;
  }>;
  finalReview?: {
    runId: string;
    configFile: string;
    supervisorAgent: string;
    status: 'completed' | 'failed' | 'stopped';
    summary: string;
    nextFocus: string[];
    experience: string[];
    scoreCards: Array<{
      agent: string;
      score: number;
      strengths: string[];
      weaknesses: string[];
    }>;
    generatedAt: string;
  } | null;
  memoryLayers?: {
    schema?: {
      scopes: string[];
      rules: string[];
    };
    runtime: {
      specCodingSummary?: {
        id: string;
        version: number;
        summary?: string;
        progressSummary?: string;
      } | null;
      qualityChecks: Array<{
        id: string;
        stateName: string;
        stepName: string;
        agent: string;
        category: 'lint' | 'compile' | 'test' | 'custom';
        status: 'passed' | 'failed' | 'warning';
        summary: string;
        createdAt: string;
      }>;
    };
    review: {
      summary: string;
      nextFocus: string[];
      experience: string[];
      generatedAt: string;
    } | null;
    history: Array<{
      runId: string;
      status: 'completed' | 'failed' | 'stopped';
      summary: string;
      nextFocus: string[];
      experience: string[];
      generatedAt: string;
    }>;
    role?: {
      agent: string;
      memories: Array<{
        id: string;
        title: string;
        kind: string;
        content: string;
        source: string;
        createdAt: string;
        tags: string[];
      }>;
    };
    project?: {
      key: string;
      memories: Array<{
        id: string;
        title: string;
        kind: string;
        content: string;
        source: string;
        createdAt: string;
        tags: string[];
      }>;
    };
    workflow?: {
      key: string;
      memories: Array<{
        id: string;
        title: string;
        kind: string;
        content: string;
        source: string;
        createdAt: string;
        tags: string[];
      }>;
    };
    chat?: {
      sessionId: string | null;
      memories: Array<{
        id: string;
        title: string;
        kind: string;
        content: string;
        source: string;
        createdAt: string;
        tags: string[];
      }>;
    };
    recalledExperiences?: Array<{
      runId: string;
      status: 'completed' | 'failed' | 'stopped';
      summary: string;
      nextFocus: string[];
      experience: string[];
      generatedAt: string;
    }>;
  } | null;
}

interface RunCangjieResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  exitCode: number | null;
  commandSummary?: string;
  env?: {
    cangjieHome: string;
    platform: string;
    usedEnvsetup: boolean;
  };
  error?: string;
}

export type SdkChannel = 'nightly' | 'sts' | 'lts';
export type HostOs = 'darwin' | 'linux' | 'win32';
export type HostArch = 'x64' | 'arm64';

export interface SdkPackage {
  os: HostOs;
  arch: HostArch;
  url: string;
  archiveType: 'tar.gz' | 'zip';
  name: string;
  sha256Url?: string;
}

export interface SdkCatalogEntry {
  version: string;
  releaseName: string;
  tagName: string;
  channel: SdkChannel;
  createdAt?: string;
  packages: SdkPackage[];
}

export interface InstalledSdk {
  version: string;
  channel: SdkChannel;
  os: HostOs;
  arch: HostArch;
  installDir: string;
  status: 'ready' | 'failed';
  installedAt?: string;
  lastError?: string;
}

export interface EffectiveSdkInfo {
  source: 'managed' | 'none';
  cangjieHome: string | null;
  version?: string;
  channel?: SdkChannel;
  diagnostics: string[];
}

export interface SdkOverviewResponse {
  host: { os: HostOs; arch: HostArch };
  gitcodeTokenConfigured: boolean;
  catalog: SdkCatalogEntry[];
  installs: InstalledSdk[];
  active: InstalledSdk | null;
  effective: EffectiveSdkInfo;
}

export const configApi = {
  async listConfigs(): Promise<ConfigListResponse> {
    const response = await authFetch(`${API_BASE}/configs`);
    if (!response.ok) throw new Error('获取配置列表失败');
    return response.json();
  },

  async getConfig(filename: string): Promise<ConfigResponse> {
    const response = await authFetch(`${API_BASE}/configs/${encodeURIComponent(filename)}`);
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const available = data?.availableConfigs;
      let msg = data?.message || `读取配置失败: ${filename} 不存在或无法读取`;
      if (available?.length) {
        msg += `。可用的配置文件: ${available.join(', ')}`;
      }
      throw new Error(msg);
    }
    return response.json();
  },

  async validateConfig(input: { config?: any; filename?: string }): Promise<{ validation: any }> {
    const response = await authFetch(`${API_BASE}/configs/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.message || data?.error || '校验配置失败');
    }
    return data;
  },

  async getCreationRecommendations(input: {
    workflowName?: string;
    requirements?: string;
    workingDirectory?: string;
    referenceWorkflow?: string;
  }): Promise<WorkflowCreationRecommendationsResponse> {
    const response = await authFetch(`${API_BASE}/configs/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || '获取工作流编排推荐失败');
    }
    return data;
  },

  async saveConfig(filename: string, config: any): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/configs/${encodeURIComponent(filename)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const details = data?.details?.map((d: any) => `${d.path?.join('.')}: ${d.message}`).join('; ');
      throw new Error(data?.error ? `${data.error}${details ? ` (${details})` : ''}` : '保存配置失败');
    }
    return response.json();
  },

  async copyConfig(filename: string, newFilename: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/configs/${encodeURIComponent(filename)}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newFilename }),
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || '复制配置失败');
    }
    return response.json();
  },

  async deleteConfig(filename: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/configs/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('删除配置失败');
    return response.json();
  },

  async batchDeleteConfigs(filenames: string[]): Promise<ApiResponse & { deletedCount: number; errors?: string[] }> {
    const response = await authFetch(`${API_BASE}/configs/batch-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames }),
    });
    if (!response.ok) throw new Error('批量删除失败');
    return response.json();
  },
};

export const agentApi = {
  async listAgents(): Promise<{ agents: any[]; runtimeAgentsDir?: string }> {
    const response = await authFetch(`${API_BASE}/agents`);
    if (!response.ok) throw new Error('获取 Agent 列表失败');
    return response.json();
  },

  async getAgent(name: string): Promise<{ agent: any; raw: string }> {
    const response = await authFetch(`${API_BASE}/agents/${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error('读取 Agent 配置失败');
    return response.json();
  },

  async saveAgent(name: string, agent: any): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/agents/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const issues = Array.isArray(data?.details) ? data.details : data?.details?.issues;
      const details = issues?.map((d: any) => `${d.path?.join('.')}: ${d.message}`).join('; ');
      throw new Error(data?.error ? `${data.error}${details ? ` (${details})` : ''}` : '保存 Agent 配置失败');
    }
    return response.json();
  },

  async deleteAgent(name: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/agents/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('删除 Agent 配置失败');
    return response.json();
  },

  async batchReplaceModel(engine: string | undefined, fromModel: string, toModel: string): Promise<ApiResponse & { updatedCount: number }> {
    const response = await authFetch(`${API_BASE}/agents/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'replace-model', engine, fromModel, toModel }),
    });
    if (!response.ok) throw new Error('批量替换模型失败');
    return response.json();
  },

  async draftAgent(input: {
    displayName: string;
    team?: string;
    mission: string;
    style?: string;
    specialties?: string;
    workingDirectory?: string;
    referenceWorkflow?: string;
    engine?: string;
    model?: string;
  }): Promise<{
    draft: any;
    raw: string;
    validation?: {
      ok: boolean;
      issues: Array<{
        path: string[];
        message: string;
        severity: 'error' | 'warning';
        code?: string;
      }>;
    };
    experienceHints?: any[];
    recommendations?: {
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
  }> {
    const response = await authFetch(`${API_BASE}/agents/ai-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || '生成 Agent 草案失败');
    }
    return response.json();
  },

  async generateAvatar(input: {
    displayName: string;
    team?: string;
    mission?: string;
    style?: string;
    variant?: string;
  }): Promise<{ avatar: any; previewUrl: string }> {
    const response = await authFetch(`${API_BASE}/agents/generate-avatar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || '生成 Agent 头像失败');
    }
    return response.json();
  },

  async chat(name: string, input: {
    message: string;
    mode?: 'standalone-chat' | 'workflow-chat';
    sessionId?: string | null;
    workingDirectory?: string;
    workflowContext?: Record<string, any>;
  }): Promise<{
    ok: boolean;
    output: string;
    sessionId?: string | null;
    mode: 'standalone-chat' | 'workflow-chat';
    agent: string;
    engine?: string;
    model?: string;
    isError?: boolean;
    error?: string | null;
    specCodingRevision?: {
      applied: boolean;
      summary: string;
      affectedArtifacts: string[];
      impact: string[];
      target: 'creation' | 'run' | 'both';
    } | null;
  }> {
    const response = await authFetch(`${API_BASE}/agents/${encodeURIComponent(name)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error || 'Agent 对话失败');
    }
    return data;
  },
};

export const runsApi = {
  async listAll(): Promise<{ runs: RunRecord[] }> {
    const response = await authFetch(`${API_BASE}/runs`);
    if (!response.ok) throw new Error('获取运行记录失败');
    return response.json();
  },

  async listByConfig(configFile: string): Promise<{ runs: RunRecord[] }> {
    const response = await authFetch(`${API_BASE}/runs/by-config/${encodeURIComponent(configFile)}`);
    if (!response.ok) throw new Error('获取运行记录失败');
    return response.json();
  },

  async getRunDetail(id: string): Promise<any> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/detail`);
    if (!response.ok) throw new Error('获取运行详情失败');
    return response.json();
  },

  async deleteRun(id: string, _cleanWorkDir = false): Promise< ApiResponse> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/delete`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '删除运行记录失败');
    }
    return response.json();
  },

  async listOutputFiles(id: string): Promise<{ files: { stepName: string; filename: string; size: number; agent: string; phaseName: string; role: string; iteration: number | null; maxIterations: number | null; timestamp: string; status: string }[] }> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/outputs`);
    if (!response.ok) throw new Error('获取输出文件列表失败');
    return response.json();
  },

  async getStepOutput(id: string, stepName: string): Promise<{ stepName: string; content: string }> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/outputs?step=${encodeURIComponent(stepName)}`);
    if (!response.ok) throw new Error('获取步骤输出失败');
    return response.json();
  },

  async listDocuments(id: string): Promise<{ files: { filename: string; stepName: string; baseName: string; iteration: number | null; agent: string; phaseName: string; role: string; size: number; modifiedTime: string }[]; documentDirectory?: string | null }> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/documents`);
    if (!response.ok) return { files: [], documentDirectory: null };
    return response.json();
  },

  async getDocumentContent(id: string, filename: string): Promise<{ file: string; content: string }> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/documents?file=${encodeURIComponent(filename)}`);
    if (!response.ok) throw new Error('获取文档内容失败');
    return response.json();
  },

  async renameDocument(id: string, file: string, newName: string): Promise<{ ok: boolean; newFilename: string }> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/documents`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, newName }),
    });
    if (!response.ok) throw new Error('重命名失败');
    return response.json();
  },

  async deleteDocuments(id: string, files: string[]): Promise<{ ok: boolean; deleted: string[] }> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(id)}/documents`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    });
    if (!response.ok) throw new Error('删除失败');
    return response.json();
  },

  async createRun(data: { configFile: string; totalSteps: number }): Promise<{ id: string }> {
    const response = await authFetch(`${API_BASE}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('创建运行记录失败');
    return response.json();
  },

  async updateRun(id: string, patch: Partial<RunRecord>): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/runs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error('更新运行记录失败');
    return response.json();
  },

  async batchDeleteRuns(runIds: string[], _cleanWorkDir = false): Promise<ApiResponse & { deletedCount: number; errors?: string[] }> {
    const response = await authFetch(`${API_BASE}/runs/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', runIds }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || '批量删除运行记录失败');
    }
    return response.json();
  },
};

export const workflowApi = {
  async preflight(configFile: string): Promise<{
    ok: boolean;
    cwd: string;
    checks: Array<{
      id: string;
      stateName: string;
      stepName: string;
      agent: string;
      category: 'lint' | 'compile' | 'test' | 'custom';
      status: 'passed' | 'failed' | 'warning';
      origin?: 'workflow' | 'inferred';
      summary: string;
      createdAt: string;
      commands: Array<{
        command: string;
        exitCode: number | null;
        status: 'passed' | 'failed' | 'warning';
        stdout?: string;
        stderr?: string;
        errorText?: string | null;
      }>;
    }>;
    failedCount: number;
    warningCount: number;
    policy: {
      blockOnFailure: boolean;
      allowOnWarning: boolean;
      inferredCommandCount: number;
    };
  }> {
    const response = await authFetch(`${API_BASE}/workflow/preflight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configFile }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || '执行启动前检查失败');
    }
    return data;
  },

  async start(configFile: string, frontendSessionId?: string, options?: {
    creationSessionId?: string;
    skipPreflight?: boolean;
    rehearsal?: boolean;
    preflightChecks?: Array<{
      id: string;
      stateName: string;
      stepName: string;
      agent: string;
      category: 'lint' | 'compile' | 'test' | 'custom';
      status: 'passed' | 'failed' | 'warning';
      origin?: 'workflow' | 'inferred';
      summary: string;
      createdAt: string;
      commands: Array<{
        command: string;
        exitCode: number | null;
        status: 'passed' | 'failed' | 'warning';
        stdout?: string;
        stderr?: string;
        errorText?: string | null;
      }>;
    }>;
  }): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configFile,
        frontendSessionId,
        creationSessionId: options?.creationSessionId,
        skipPreflight: options?.skipPreflight || false,
        rehearsal: options?.rehearsal || false,
        preflightChecks: options?.preflightChecks,
      }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '启动工作流失败');
    }
    return response.json();
  },

  async stop(configFile?: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configFile }),
    });
    if (!response.ok) throw new Error('停止工作流失败');
    return response.json();
  },

  async resume(runId: string, action?: 'approve' | 'iterate' | 'force-transition', feedback?: string, targetState?: string, instruction?: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, action, feedback, targetState, instruction }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '恢复工作流失败');
    }
    return response.json();
  },

  async approve(configFile?: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configFile }),
    });
    if (!response.ok) throw new Error('批准检查点失败');
    return response.json();
  },

  async iterate(feedback: string, configFile?: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/iterate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback, configFile }),
    });
    if (!response.ok) throw new Error('请求继续迭代失败');
    return response.json();
  },

  async injectFeedback(message: string, interrupt?: boolean, configFile?: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/inject-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, interrupt, configFile }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '注入反馈失败');
    }
    return response.json();
  },

  async recallFeedback(message: string, configFile?: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/recall-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, configFile }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '撤回反馈失败');
    }
    return response.json();
  },

  async forceCompleteStep(configFile?: string): Promise<any> {
    const response = await authFetch(`${API_BASE}/workflow/force-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configFile }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '强制完成失败');
    }
    return response.json();
  },

  async forceTransition(targetState: string, instruction?: string, configFile?: string, runId?: string): Promise<any> {
    const response = await authFetch(`${API_BASE}/workflow/force-transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetState, instruction, configFile, runId }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '强制跳转失败');
    }
    return response.json();
  },

  async getStatus(configFile?: string, runId?: string): Promise<WorkflowStatusResponse> {
    const search = new URLSearchParams();
    if (configFile) search.set('configFile', configFile);
    if (runId) search.set('runId', runId);
    const params = search.toString() ? `?${search.toString()}` : '';
    const response = await authFetch(`${API_BASE}/workflow/status${params}`);
    if (!response.ok) throw new Error('获取状态失败');
    return response.json();
  },

  async listHumanQuestions(filters?: {
    status?: 'unanswered' | 'answered' | 'dismissed';
    runId?: string;
    configFile?: string;
    limit?: number;
  }): Promise<{ questions: HumanQuestion[] }> {
    const search = new URLSearchParams();
    if (filters?.status) search.set('status', filters.status);
    if (filters?.runId) search.set('runId', filters.runId);
    if (filters?.configFile) search.set('configFile', filters.configFile);
    if (filters?.limit) search.set('limit', String(filters.limit));
    const params = search.toString() ? `?${search.toString()}` : '';
    const response = await authFetch(`${API_BASE}/workflow/human-questions${params}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '获取 Supervisor 消息失败');
    }
    return response.json();
  },

  async createHumanQuestion(input: {
    configFile?: string;
    runId?: string;
    kind?: HumanQuestion['kind'];
    title: string;
    message: string;
    supervisorAdvice?: string;
    suggestedNextState?: string;
    availableStates?: string[];
    requiresWorkflowPause?: boolean;
    answerSchema?: HumanQuestion['answerSchema'];
    source?: HumanQuestion['source'];
  }): Promise<{ question: HumanQuestion }> {
    const response = await authFetch(`${API_BASE}/workflow/human-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '创建 Supervisor 消息失败');
    }
    return response.json();
  },

  async answerHumanQuestion(input: {
    questionId: string;
    runId?: string;
    configFile?: string;
    answer: HumanQuestionAnswer;
  }): Promise<{ question: HumanQuestion }> {
    const response = await authFetch(`${API_BASE}/workflow/human-questions/${encodeURIComponent(input.questionId)}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: input.runId, configFile: input.configFile, answer: input.answer }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '回答 Supervisor 消息失败');
    }
    return response.json();
  },

  async setContext(scope: 'global' | 'phase', context: string, phase?: string, runId?: string, configFile?: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, phase, context, runId, configFile }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '设置上下文失败');
    }
    return response.json();
  },

  async getContexts(runId?: string, configFile?: string): Promise<{ globalContext: string; phaseContexts: Record<string, string> }> {
    const params = new URLSearchParams();
    if (runId) params.set('runId', runId);
    if (configFile) params.set('configFile', configFile);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const response = await authFetch(`${API_BASE}/workflow/context${qs}`);
    if (!response.ok) throw new Error('获取上下文失败');
    return response.json();
  },

  async rerunFromStep(runId: string, stepName: string): Promise<ApiResponse> {
    const response = await authFetch(`${API_BASE}/workflow/rerun-from-step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, stepName }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '重新运行失败');
    }
    return response.json();
  },

  async previewSpecMerge(input: { runId: string; configFile: string }): Promise<{
    masterBefore: string;
    mergedContent: string;
    diff: string;
    aiSummary: string;
    mergeState: DeltaMergeState;
  }> {
    const response = await authFetch(`${API_BASE}/workflow/spec-merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'preview', ...input }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || data.error || '生成 Spec 合入预览失败');
    }
    return data;
  },

  async applySpecMerge(input: { runId: string; configFile: string; mergedHash: string }): Promise<{
    success: boolean;
    mergeState: DeltaMergeState;
  }> {
    const response = await authFetch(`${API_BASE}/workflow/spec-merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'apply', ...input }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || data.error || '确认合入 Spec 失败');
    }
    return data;
  },

  connectEventStream(onMessage: (data: any) => void): EventSource {
    const eventSource = new EventSource(`${API_BASE}/workflow/events`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onMessage(data);
    };

    eventSource.onerror = (error) => {
      console.error('EventSource 错误:', error);
    };

    return eventSource;
  },
};

export const processApi = {
  async list(): Promise<{ processes: any[]; stats: any }> {
    const response = await authFetch(`${API_BASE}/processes`);
    if (!response.ok) throw new Error('获取进程列表失败');
    return response.json();
  },

  async get(id: string): Promise<any> {
    const response = await authFetch(`${API_BASE}/processes/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('获取进程信息失败');
    return response.json();
  },
};

export const streamApi = {
  async getStreamContent(runId: string, stepName: string): Promise<string> {
    const response = await authFetch(`${API_BASE}/runs/${encodeURIComponent(runId)}/stream?step=${encodeURIComponent(stepName)}`);
    if (!response.ok) return '';
    const data = await response.json();
    return data.content || '';
  },

  /**
   * Connect to live SSE stream for a running step.
   * Returns EventSource; caller is responsible for closing it.
   */
  connectLiveStream(
    runId: string,
    stepName: string,
    onDelta: (content: string) => void,
    onDone?: (status: string) => void,
  ): EventSource {
    const url = `${API_BASE}/runs/${encodeURIComponent(runId)}/stream?step=${encodeURIComponent(stepName)}&live=1`;
    const es = new EventSource(url);
    es.addEventListener('delta', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.content) onDelta(data.content);
      } catch {}
    });
    es.addEventListener('done', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        onDone?.(data.status || 'completed');
      } catch {}
      es.close();
    });
    es.onerror = () => {
      // Auto-reconnect is handled by EventSource; close on fatal
    };
    return es;
  },
};

export const scheduleApi = {
  async list(): Promise<{ jobs: any[] }> {
    const res = await authFetch(`${API_BASE}/schedules`);
    if (!res.ok) throw new Error('获取定时任务列表失败');
    return res.json();
  },
  async get(id: string): Promise<{ job: any }> {
    const res = await authFetch(`${API_BASE}/schedules/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('获取定时任务失败');
    return res.json();
  },
  async create(job: any): Promise<{ job: any }> {
    const res = await authFetch(`${API_BASE}/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    });
    if (!res.ok) throw new Error('创建定时任务失败');
    return res.json();
  },
  async update(id: string, patch: any): Promise<{ job: any }> {
    const res = await authFetch(`${API_BASE}/schedules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('更新定时任务失败');
    return res.json();
  },
  async delete(id: string): Promise<void> {
    const res = await authFetch(`${API_BASE}/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('删除定时任务失败');
  },
  async trigger(id: string): Promise<any> {
    const res = await authFetch(`${API_BASE}/schedules/${encodeURIComponent(id)}/trigger`, { method: 'POST' });
    if (!res.ok) throw new Error('触发定时任务失败');
    return res.json();
  },
  async toggle(id: string): Promise<{ job: any }> {
    const res = await authFetch(`${API_BASE}/schedules/${encodeURIComponent(id)}/toggle`, { method: 'POST' });
    if (!res.ok) throw new Error('切换定时任务状态失败');
    return res.json();
  },
};

export const envApi = {
  async get(scope: 'system' | 'user'): Promise<{ vars: Array<{ key: string; value: string; enabled: boolean }> }> {
    const response = await authFetch(`${API_BASE}/env?scope=${scope}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || '获取环境变量失败');
    }
    return data;
  },

  async save(scope: 'system' | 'user', vars: Array<{ key: string; value: string; enabled: boolean }>): Promise<{ success: boolean }> {
    const response = await authFetch(`${API_BASE}/env`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, vars }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || '保存环境变量失败');
    }
    return data;
  },
};

export const systemSettingsApi = {
  async get(): Promise<{ gitcodeTokenConfigured: boolean }> {
    const response = await authFetch(`${API_BASE}/system-settings`);
    if (!response.ok) throw new Error('获取系统设置失败');
    return response.json();
  },

  async save(data: { gitcodeToken?: string }): Promise<{ success: boolean }> {
    const response = await authFetch(`${API_BASE}/system-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || '保存系统设置失败');
    }
    return response.json();
  },
};

export const cangjieSdkApi = {
  async getOverview(): Promise<SdkOverviewResponse> {
    const response = await authFetch(`${API_BASE}/cangjie/sdk`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '获取 SDK 列表失败');
    return data;
  },

  async install(
    version: string,
    channel: SdkChannel,
    onProgress?: (event: { phase: string; downloaded?: number; total?: number }) => void,
  ): Promise<{ success: boolean; install: InstalledSdk }> {
    const headers = { 'Content-Type': 'application/json', ...getAuthHeaders() };
    const response = await fetch(`${API_BASE}/cangjie/sdk/install`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ version, channel }),
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as any).error || '安装 SDK 失败');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.phase === 'error') throw new Error(event.error || '安装 SDK 失败');
          if (event.phase === 'done') return { success: true, install: event.install };
          onProgress?.(event);
        } catch (error) {
          if (error instanceof SyntaxError) continue;
          throw error;
        }
      }
    }
    throw new Error('安装 SDK 失败：连接意外断开');
  },

  async activate(version: string, channel: SdkChannel): Promise<{ success: boolean }> {
    const response = await authFetch(`${API_BASE}/cangjie/sdk/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, channel }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '激活 SDK 失败');
    return data;
  },

  async deactivate(): Promise<{ success: boolean }> {
    const response = await authFetch(`${API_BASE}/cangjie/sdk/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deactivate: true }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '取消激活失败');
    return data;
  },

  async remove(version: string, channel: SdkChannel): Promise<{ success: boolean }> {
    const response = await authFetch(`${API_BASE}/cangjie/sdk/remove`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, channel }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '删除 SDK 失败');
    return data;
  },
};

// ==================== Workspace API ====================

export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  modifiedTime?: number;
  children?: TreeNode[];
}

export type WorkspaceMode = 'default' | 'notebook';
export type NotebookScope = 'personal' | 'global';
export type NotebookSharePermission = 'read' | 'write';
export type NotebookSnapshotSource = 'manual' | 'auto' | 'system';

export interface NotebookSnapshotSummary {
  id: string;
  scope: NotebookScope;
  ownerId: string;
  file: string;
  contentSize: number;
  createdAt: number;
  createdBy: string;
  createdByName: string;
  source: NotebookSnapshotSource;
}

export interface NotebookSnapshotDetail extends NotebookSnapshotSummary {
  content: string;
}

export const workspaceApi = {
  async getNotebookTree(depth = 2, options?: { scope?: NotebookScope; shareToken?: string }): Promise<{ tree: TreeNode[]; rootPath: string }> {
    const params = new URLSearchParams();
    params.set('depth', String(depth));
    if (options?.scope) params.set('scope', options.scope);
    if (options?.shareToken) params.set('shareToken', options.shareToken);
    const res = await authFetch(`${API_BASE}/notebook/tree?${params.toString()}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '获取 Notebook 文件树失败');
    }
    return res.json();
  },
  async getNotebookSubTree(subPath: string, depth = 2, options?: { scope?: NotebookScope; shareToken?: string }): Promise<{ tree: TreeNode[]; rootPath: string }> {
    const params = new URLSearchParams();
    params.set('sub', subPath);
    params.set('depth', String(depth));
    if (options?.scope) params.set('scope', options.scope);
    if (options?.shareToken) params.set('shareToken', options.shareToken);
    const res = await authFetch(`${API_BASE}/notebook/tree?${params.toString()}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '获取 Notebook 子目录失败');
    }
    return res.json();
  },
  async getNotebookFile(file: string, options?: { scope?: NotebookScope; shareToken?: string }): Promise<{ content: string; size: number; path: string }> {
    const params = new URLSearchParams();
    params.set('file', file);
    if (options?.scope) params.set('scope', options.scope);
    if (options?.shareToken) params.set('shareToken', options.shareToken);
    const res = await authFetch(`${API_BASE}/notebook/file?${params.toString()}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.error || '读取 Notebook 文件失败') as Error & { size?: number };
      if (data.size != null) err.size = data.size;
      throw err;
    }
    return res.json();
  },
  async saveNotebookFile(file: string, content: string, options?: { scope?: NotebookScope; shareToken?: string }): Promise<{ success: boolean }> {
    const res = await authFetch(`${API_BASE}/notebook/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, content, scope: options?.scope, shareToken: options?.shareToken }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '保存 Notebook 文件失败');
    }
    return res.json();
  },
  async getNotebookFileBlob(file: string, options?: { scope?: NotebookScope; shareToken?: string }): Promise<Blob> {
    const params = new URLSearchParams();
    params.set('file', file);
    params.set('mode', 'blob');
    if (options?.scope) params.set('scope', options.scope);
    if (options?.shareToken) params.set('shareToken', options.shareToken);
    const res = await authFetch(`${API_BASE}/notebook/file?${params.toString()}`);
    if (!res.ok) {
      throw new Error('获取 Notebook 文件失败');
    }
    return res.blob();
  },
  async manageNotebook(action: string, params: Record<string, any>, options?: { scope?: NotebookScope; shareToken?: string }): Promise<{ success: boolean }> {
    const res = await authFetch(`${API_BASE}/notebook/manage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, scope: options?.scope, shareToken: options?.shareToken, ...params }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Notebook 操作失败');
    }
    return res.json();
  },
  async createNotebookShare(filePath: string, permission: NotebookSharePermission, scope: NotebookScope = 'global') {
    const res = await authFetch(`${API_BASE}/notebook/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, permission, scope }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '创建分享链接失败');
    }
    return res.json() as Promise<{ token: string; scope: NotebookScope; path: string; permission: NotebookSharePermission }>;
  },
  async resolveNotebookShare(token: string) {
    const res = await authFetch(`${API_BASE}/notebook/share?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '解析分享链接失败');
    }
    return res.json() as Promise<{ scope: NotebookScope; path: string; permission: NotebookSharePermission }>;
  },
  async listNotebookSnapshots(file: string, options?: { scope?: NotebookScope; shareToken?: string }) {
    const params = new URLSearchParams();
    params.set('file', file);
    if (options?.scope) params.set('scope', options.scope);
    if (options?.shareToken) params.set('shareToken', options.shareToken);
    const res = await authFetch(`${API_BASE}/notebook/snapshots?${params.toString()}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '获取快照列表失败');
    }
    return res.json() as Promise<{ rows: NotebookSnapshotSummary[] }>;
  },
  async createNotebookSnapshot(
    file: string,
    options?: { scope?: NotebookScope; shareToken?: string; source?: NotebookSnapshotSource; content?: string },
  ) {
    const res = await authFetch(`${API_BASE}/notebook/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file,
        scope: options?.scope,
        shareToken: options?.shareToken,
        source: options?.source || 'manual',
        content: options?.content,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '创建快照失败');
    }
    return res.json() as Promise<{ created: boolean; snapshot: NotebookSnapshotSummary }>;
  },
  async restoreNotebookSnapshot(file: string, snapshotId: string, options?: { scope?: NotebookScope; shareToken?: string }) {
    const res = await authFetch(`${API_BASE}/notebook/snapshots`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file,
        snapshotId,
        scope: options?.scope,
        shareToken: options?.shareToken,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '恢复快照失败');
    }
    return res.json() as Promise<{ success: boolean; restoredSnapshotId: string }>;
  },
  async getNotebookSnapshotDetail(file: string, snapshotId: string, options?: { scope?: NotebookScope; shareToken?: string }) {
    const params = new URLSearchParams();
    params.set('file', file);
    params.set('snapshotId', snapshotId);
    if (options?.scope) params.set('scope', options.scope);
    if (options?.shareToken) params.set('shareToken', options.shareToken);
    const res = await authFetch(`${API_BASE}/notebook/snapshots?${params.toString()}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '获取快照详情失败');
    }
    return res.json() as Promise<{ snapshot: NotebookSnapshotDetail }>;
  },
  async runCangjie(code: string, sourceName?: string, origin: 'markdown' | 'workspace' = 'workspace'): Promise<RunCangjieResponse> {
    const res = await authFetch(`${API_BASE}/cangjie/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, sourceName, origin }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || '运行仓颉代码失败');
    }
    return data;
  },
  async getTree(workspacePath: string, depth = 2): Promise<{ tree: TreeNode[] }> {
    const res = await authFetch(`${API_BASE}/workspace/tree?path=${encodeURIComponent(workspacePath)}&depth=${depth}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || data.error || '获取文件树失败');
    }
    return res.json();
  },
  async getSubTree(workspacePath: string, subPath: string, depth = 2): Promise<{ tree: TreeNode[] }> {
    const res = await authFetch(
      `${API_BASE}/workspace/tree?path=${encodeURIComponent(workspacePath)}&sub=${encodeURIComponent(subPath)}&depth=${depth}`
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || data.error || '获取子目录失败');
    }
    return res.json();
  },
  async getFile(workspace: string, file: string): Promise<{ content: string; size: number; path: string }> {
    const res = await authFetch(`${API_BASE}/workspace/file?workspace=${encodeURIComponent(workspace)}&file=${encodeURIComponent(file)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.message || data.error || '读取文件失败') as Error & { size?: number };
      if (data.size != null) err.size = data.size;
      throw err;
    }
    return res.json();
  },
  async saveFile(workspace: string, file: string, content: string): Promise<{ success: boolean }> {
    const res = await authFetch(`${API_BASE}/workspace/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, file, content }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || data.error || '保存文件失败');
    }
    return res.json();
  },
  async getFileBlob(workspace: string, file: string): Promise<Blob> {
    const res = await authFetch(`${API_BASE}/workspace/file?workspace=${encodeURIComponent(workspace)}&file=${encodeURIComponent(file)}&mode=blob`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || data.error || '获取文件失败');
    }
    return res.blob();
  },
  async upload(workspace: string, targetPath: string, files: File[], options?: { conflict?: 'rename' | 'error'; relativePaths?: string[] }): Promise<{ success: boolean; count: number; files: Array<{ name: string; path: string; size: number }> }> {
    const formData = new FormData();
    formData.append('workspace', workspace);
    formData.append('targetPath', targetPath || '');
    formData.append('conflict', options?.conflict || 'rename');
    const relativePaths = options?.relativePaths || files.map((file) => (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
    formData.append('relativePaths', JSON.stringify(relativePaths));
    files.forEach((file) => formData.append('files', file));

    const res = await authFetch(`${API_BASE}/workspace/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || data.error || '上传失败');
    }
    return res.json();
  },
  async download(workspace: string, targetPath: string): Promise<void> {
    const res = await authFetch(`${API_BASE}/workspace/download?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent(targetPath)}`);
    if (!res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || '下载失败');
      }
      const text = await res.text().catch(() => '');
      throw new Error(text || '下载失败');
    }

    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
    const filename = decodeURIComponent(match?.[1] || match?.[2] || targetPath.split('/').filter(Boolean).pop() || 'download');
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  },
  async manage(workspace: string, action: string, params: Record<string, any>): Promise<{ success: boolean }> {
    const res = await authFetch(`${API_BASE}/workspace/manage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, action, ...params }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || data.error || '操作失败');
    }
    return res.json();
  },
};
