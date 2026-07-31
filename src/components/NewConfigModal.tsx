'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { newConfigFormSchema, type NewConfigForm } from '@/lib/core/schemas';
import { useToast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import WorkflowModeSelector, { type WorkflowCreationMode } from './WorkflowModeSelector';
import { ComboboxPortalProvider, MultiCombobox, SingleCombobox } from './ui/combobox';
import WorkspaceDirectoryPicker from './common/WorkspaceDirectoryPicker';
import { useChat } from '@/contexts/ChatContext';
import { apiRequest } from '@/client/query/api-client';
import { useCreateConfigMutation } from '@/client/query/workflow-mutations';
import { useAgentsQuery } from '@/client/query/agents';
import { useSkillsQuery } from '@/client/query/skills';
import {
  deriveLightweightTasklistDirectory,
  LIGHTWEIGHT_TASKLIST_SKILL,
} from '@/lib/workflow/lightweight';
import {
  DEFAULT_AI_WORKFLOW_DESCRIPTION,
  DEFAULT_AI_WORKFLOW_REQUIREMENTS,
} from '@/lib/chat/workflow-creator-entry';
import WorkflowTemplateBrowser from '@/components/workflow-templates/WorkflowTemplateBrowser';

const PERSIST_SPEC_MODE_STORAGE_KEY = 'aceharness.newConfig.persistMode';
const PERSIST_SPEC_ROOT_STORAGE_KEY = 'aceharness.newConfig.specRoot';
const SPEC_PLANNING_ENABLED_STORAGE_KEY = 'aceharness.newConfig.specPlanningEnabled';

type WorkflowCreationSource = 'custom' | 'template';

type LightweightFormValues = {
  agent: string;
  task: string;
  skills: string[];
};

type ReferenceWorkflowSummary = {
  filename: string;
  name: string;
  description?: string;
  mode?: 'state-machine';
  kind?: WorkflowCreationMode;
  profile?: 'lightweight';
};

type CreationSession = {
  id: string;
  mode?: WorkflowCreationMode;
  workflowName?: string;
  filename?: string;
  referenceWorkflow?: string;
  workingDirectory?: string;
  workspaceMode?: 'isolated-copy' | 'in-place';
  description?: string;
  requirements?: string;
  lightweight?: {
    agent?: string;
    task?: string;
    skills?: string[];
    tasklistDirectory?: string;
  };
  specCoding?: {
    persistMode?: 'none' | 'repository';
    specRoot?: string;
  };
  config?: {
    workflow?: {
      profile?: string;
      states?: Array<{
        steps?: Array<{
          agent?: string;
          task?: string;
          skills?: unknown;
        }>;
      }>;
    };
  };
};

interface NewConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (filename: string, result?: { creationSession?: any }) => void;
  homepageCompact?: boolean;
  resumeCreationSessionId?: string | null;
  initialMode?: WorkflowCreationMode;
  initialWorkflowName?: string;
  initialReferenceWorkflow?: string;
  initialRequirements?: string;
  initialDescription?: string;
  initialWorkingDirectory?: string;
  initialWorkspaceMode?: 'isolated-copy' | 'in-place';
  frontendSessionId?: string | null;
  aiGuidedEntry?: boolean;
  focusRequirementsOnOpen?: boolean;
}

function normalizeWorkflowCreationMode(mode?: unknown): WorkflowCreationMode {
  return mode === 'lightweight' ? 'lightweight' : 'state-machine';
}

function normalizePersistSpecValues(values: Pick<NewConfigForm, 'persistMode' | 'specRoot'>) {
  const persistMode = values.persistMode === 'repository' ? 'repository' : 'none';
  const specRoot = persistMode === 'repository'
    ? ((values.specRoot || '').trim() || '.spec')
    : undefined;
  return { persistMode, specRoot };
}

function generateDefaultFilename() {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  const time = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
  ].join('');
  return 'workflow-' + date + '-' + time + '-' + Math.random().toString(36).slice(2, 6) + '.yaml';
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getValidationIssues(error: any): Array<{ path?: PropertyKey[]; message?: string }> {
  const payload = error?.payload;
  if (Array.isArray(payload?.details)) return payload.details;
  if (Array.isArray(payload?.details?.issues)) return payload.details.issues;
  return [];
}

function isLightweightReference(workflow: ReferenceWorkflowSummary) {
  return workflow.kind === 'lightweight' || workflow.profile === 'lightweight';
}

export default function NewConfigModal({
  isOpen,
  onClose,
  onSuccess,
  homepageCompact = false,
  resumeCreationSessionId = null,
  initialMode,
  initialWorkflowName,
  initialReferenceWorkflow,
  initialRequirements,
  initialDescription,
  initialWorkingDirectory,
  initialWorkspaceMode,
  frontendSessionId,
  aiGuidedEntry = false,
  focusRequirementsOnOpen = false,
}: NewConfigModalProps) {
  const { toast } = useToast();
  const { createSession, updateSessionCreationBinding, appendVisibleSessionTag } = useChat();
  const createConfigMutation = useCreateConfigMutation();
  const agentsQuery = useAgentsQuery();
  const skillsQuery = useSkillsQuery({ enabled: isOpen });
  const [creationSource, setCreationSource] = useState<WorkflowCreationSource>('custom');
  const [workflowMode, setWorkflowMode] = useState<WorkflowCreationMode>(
    normalizeWorkflowCreationMode(initialMode),
  );
  const [specPlanningEnabled, setSpecPlanningEnabled] = useState(true);
  const [lightweightValues, setLightweightValues] = useState<LightweightFormValues>({
    agent: '',
    task: '',
    skills: [],
  });
  const [lightweightErrors, setLightweightErrors] = useState<Partial<Record<keyof LightweightFormValues, string>>>({});
  const [referenceWorkflows, setReferenceWorkflows] = useState<ReferenceWorkflowSummary[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [creationSessionId, setCreationSessionId] = useState<string | null>(null);
  const [resolvedFrontendSessionId, setResolvedFrontendSessionId] = useState<string | null>(frontendSessionId || null);
  const [restoringSession, setRestoringSession] = useState(false);
  const requirementsSectionRef = useRef<HTMLDivElement | null>(null);
  const requirementsInputRef = useRef<HTMLTextAreaElement | null>(null);
  const wasOpenRef = useRef(false);
  const skipPreferencePersistRef = useRef(false);

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    setValue,
    getValues,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<NewConfigForm>({
    defaultValues: {
      mode: 'state-machine',
      filename: '',
      workflowName: '',
      referenceWorkflow: '',
      workingDirectory: '',
      workspaceMode: 'in-place',
      description: '',
      requirements: '',
      persistMode: 'none',
      specRoot: '.spec',
    },
  });

  const creationMode = workflowMode;
  const isLightweight = creationMode === 'lightweight';
  const workingDirectoryValue = watch('workingDirectory') || '';
  const workspaceModeValue = watch('workspaceMode') || 'in-place';
  const filenameValue = watch('filename') || '';
  const referenceWorkflowValue = watch('referenceWorkflow') || '';
  const persistModeValue = watch('persistMode') || 'none';
  const specRootValue = watch('specRoot') || '.spec';
  const lightweightTasklistDirectory = useMemo(() => {
    try {
      return deriveLightweightTasklistDirectory(filenameValue);
    } catch {
      return '根据配置文件名自动生成';
    }
  }, [filenameValue]);

  const agents = agentsQuery.data?.agents || [];
  const skills = skillsQuery.data?.skills || [];
  const agentOptions = useMemo(() => agents.map((agent) => ({
    value: agent.name,
    label: agent.name,
    description: [agent.description, agent.team, agent.roleType].filter(Boolean).join(' · '),
  })), [agents]);
  const skillOptions = useMemo(() => skills
    .filter((skill) => skill.name !== LIGHTWEIGHT_TASKLIST_SKILL)
    .map((skill) => ({
      value: skill.name,
      label: skill.name,
      description: skill.description || '',
    })), [skills]);
  const stateMachineReferences = useMemo(
    () => referenceWorkflows.filter((workflow) => !isLightweightReference(workflow)),
    [referenceWorkflows],
  );

  const updateLightweightValues = useCallback((changes: Partial<LightweightFormValues>) => {
    setLightweightValues((current) => ({ ...current, ...changes }));
    setLightweightErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(changes) as Array<keyof LightweightFormValues>) {
        delete next[key];
      }
      return next;
    });
  }, []);

  const applyValidationIssues = useCallback((issues: Array<{ path?: PropertyKey[]; message?: string }>) => {
    const fields = new Set([
      'filename',
      'workflowName',
      'referenceWorkflow',
      'workingDirectory',
      'workspaceMode',
      'description',
      'requirements',
      'persistMode',
      'specRoot',
    ]);
    clearErrors();
    const messages = new Set<string>();
    for (const issue of issues) {
      const field = issue.path?.[0];
      const message = issue.message || '输入不合法';
      if (typeof field === 'string' && fields.has(field)) {
        setError(field as keyof NewConfigForm, { type: 'validate', message });
      }
      messages.add(message);
    }
    if (messages.size > 0) {
      toast('error', Array.from(messages).join('\n'));
    }
  }, [clearErrors, setError, toast]);

  const validateLightweightValues = useCallback(() => {
    const nextErrors: Partial<Record<keyof LightweightFormValues, string>> = {};
    const agent = lightweightValues.agent.trim() || agents[0]?.name || '';
    const task = lightweightValues.task.trim();
    if (!agent) nextErrors.agent = '请选择执行 Agent';
    if (!task) nextErrors.task = '请输入执行任务';
    setLightweightErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return null;

    return {
      agent,
      task,
      skills: Array.from(new Set([
        LIGHTWEIGHT_TASKLIST_SKILL,
        ...lightweightValues.skills.filter((skill) => skill && skill !== LIGHTWEIGHT_TASKLIST_SKILL),
      ])),
    };
  }, [agents, lightweightValues]);

  const handleWorkingDirectoryChange = useCallback((path: string) => {
    setValue('workingDirectory', path, { shouldDirty: true, shouldValidate: true });
  }, [setValue]);

  const resetForOpen = useCallback(() => {
    const mode = normalizeWorkflowCreationMode(initialMode);
    const persistedMode = typeof window === 'undefined'
      ? 'none'
      : window.localStorage.getItem(PERSIST_SPEC_MODE_STORAGE_KEY);
    const persistedRoot = typeof window === 'undefined'
      ? '.spec'
      : window.localStorage.getItem(PERSIST_SPEC_ROOT_STORAGE_KEY);
    const persistedPlanning = typeof window === 'undefined'
      ? null
      : window.localStorage.getItem(SPEC_PLANNING_ENABLED_STORAGE_KEY);

    setWorkflowMode(mode);
    setSpecPlanningEnabled(persistedPlanning !== '0');
    setCreationSource('custom');
    setCreationSessionId(null);
    setLightweightErrors({});
    setLightweightValues({
      agent: '',
      task: initialRequirements || '',
      skills: [],
    });
    skipPreferencePersistRef.current = true;
    reset({
      mode,
      filename: generateDefaultFilename(),
      workflowName: initialWorkflowName || '',
      referenceWorkflow: initialReferenceWorkflow || '',
      workingDirectory: initialWorkingDirectory || '',
      workspaceMode: initialWorkspaceMode || 'in-place',
      description: initialDescription || '',
      requirements: initialRequirements || '',
      persistMode: persistedMode === 'repository' ? 'repository' : 'none',
      specRoot: persistedRoot?.trim() || '.spec',
    });
  }, [
    initialDescription,
    initialMode,
    initialReferenceWorkflow,
    initialRequirements,
    initialWorkflowName,
    initialWorkingDirectory,
    initialWorkspaceMode,
    reset,
  ]);

  useEffect(() => {
    setResolvedFrontendSessionId(frontendSessionId || null);
  }, [frontendSessionId]);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      skipPreferencePersistRef.current = false;
      if (!frontendSessionId) setResolvedFrontendSessionId(null);
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    resetForOpen();
  }, [frontendSessionId, isOpen, resetForOpen]);

  useEffect(() => {
    if (!isOpen || !aiGuidedEntry || frontendSessionId || resolvedFrontendSessionId) return;
    const sessionId = createSession({ title: 'AI 引导创建工作流' });
    if (sessionId) setResolvedFrontendSessionId(sessionId);
  }, [aiGuidedEntry, createSession, frontendSessionId, isOpen, resolvedFrontendSessionId]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    if (skipPreferencePersistRef.current) {
      skipPreferencePersistRef.current = false;
      return;
    }
    window.localStorage.setItem(
      PERSIST_SPEC_MODE_STORAGE_KEY,
      persistModeValue === 'repository' ? 'repository' : 'none',
    );
    window.localStorage.setItem(
      PERSIST_SPEC_ROOT_STORAGE_KEY,
      specRootValue.trim() || '.spec',
    );
    window.localStorage.setItem(
      SPEC_PLANNING_ENABLED_STORAGE_KEY,
      specPlanningEnabled ? '1' : '0',
    );
  }, [isOpen, persistModeValue, specPlanningEnabled, specRootValue]);

  useEffect(() => {
    if (!isOpen || !isLightweight || lightweightValues.agent || !agents[0]?.name) return;
    updateLightweightValues({ agent: agents[0].name });
  }, [agents, isLightweight, isOpen, lightweightValues.agent, updateLightweightValues]);

  useEffect(() => {
    setValue('mode', creationMode, { shouldDirty: false, shouldValidate: false });
    if (creationMode === 'lightweight') {
      setValue('referenceWorkflow', '', { shouldDirty: false, shouldValidate: false });
    }
  }, [creationMode, setValue]);

  useEffect(() => {
    if (!isOpen || isLightweight) return;
    let cancelled = false;
    setReferenceLoading(true);
    apiRequest<{ configs?: ReferenceWorkflowSummary[] }>('/api/configs', { authRedirect: false })
      .then((response) => {
        if (!cancelled) setReferenceWorkflows(response.configs || []);
      })
      .catch(() => {
        if (!cancelled) setReferenceWorkflows([]);
      })
      .finally(() => {
        if (!cancelled) setReferenceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLightweight, isOpen]);

  useEffect(() => {
    if (!referenceWorkflowValue) return;
    const selected = referenceWorkflows.find((workflow) => workflow.filename === referenceWorkflowValue);
    if (selected && isLightweightReference(selected)) {
      setValue('referenceWorkflow', '', { shouldDirty: true, shouldValidate: true });
    }
  }, [referenceWorkflowValue, referenceWorkflows, setValue]);

  useEffect(() => {
    if (!isOpen || !resumeCreationSessionId) return;
    let cancelled = false;
    setRestoringSession(true);
    apiRequest<{ session?: CreationSession }>(
      '/api/spec-coding/sessions/' + encodeURIComponent(resumeCreationSessionId),
      { authRedirect: false },
    )
      .then((response) => {
        if (cancelled || !response.session) return;
        const session = response.session;
        const restoredMode = normalizeWorkflowCreationMode(
          session.mode || session.config?.workflow?.profile,
        );
        const restoredStep = session.config?.workflow?.states?.[0]?.steps?.[0];
        const savedSkills = Array.isArray(session.lightweight?.skills)
          ? session.lightweight.skills.filter(
            (skill): skill is string => typeof skill === 'string' && skill !== LIGHTWEIGHT_TASKLIST_SKILL,
          )
          : Array.isArray(restoredStep?.skills)
            ? restoredStep.skills.filter(
            (skill): skill is string => typeof skill === 'string' && skill !== LIGHTWEIGHT_TASKLIST_SKILL,
            )
            : [];
        const restoredAgent = session.lightweight?.agent || restoredStep?.agent || '';
        const restoredTask = session.lightweight?.task || restoredStep?.task || session.requirements || '';
        setWorkflowMode(restoredMode);
        setCreationSessionId(session.id);
        setLightweightErrors({});
        setLightweightValues({
          agent: restoredAgent,
          task: restoredTask,
          skills: savedSkills,
        });
        skipPreferencePersistRef.current = true;
        reset({
          mode: restoredMode,
          filename: session.filename || generateDefaultFilename(),
          workflowName: session.workflowName || '',
          referenceWorkflow: session.referenceWorkflow || '',
          workingDirectory: session.workingDirectory || '',
          workspaceMode: session.workspaceMode || 'in-place',
          description: session.description || '',
          requirements: session.requirements || restoredTask,
          persistMode: session.specCoding?.persistMode || 'none',
          specRoot: session.specCoding?.specRoot || '.spec',
        });
      })
      .catch((error) => {
        if (!cancelled) toast('error', getErrorMessage(error, '读取创建草稿失败'));
      })
      .finally(() => {
        if (!cancelled) setRestoringSession(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, reset, resumeCreationSessionId, toast]);

  useEffect(() => {
    if (!isOpen || !focusRequirementsOnOpen || isLightweight || resumeCreationSessionId) return;
    const timer = window.setTimeout(() => {
      requirementsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      requirementsInputRef.current?.focus({ preventScroll: true });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [focusRequirementsOnOpen, isLightweight, isOpen, resumeCreationSessionId]);

  const normalizeFilename = useCallback(() => {
    const filename = (getValues('filename') || '').trim();
    if (!filename) return;
    setValue('filename', filename.endsWith('.yaml') ? filename : filename + '.yaml', {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [getValues, setValue]);

  const handleTemplateInstantiated = useCallback((filename: string) => {
    onSuccess(filename);
    onClose();
  }, [onClose, onSuccess]);

  const submit = async (data: NewConfigForm) => {
    const lightweight = isLightweight ? validateLightweightValues() : undefined;
    if (isLightweight && !lightweight) return;

    const persisted = normalizePersistSpecValues(data);
    const values = {
      ...data,
      mode: creationMode,
      referenceWorkflow: isLightweight ? '' : data.referenceWorkflow || '',
      requirements: lightweight?.task || data.requirements || '',
      persistMode: isLightweight || !specPlanningEnabled ? 'none' : persisted.persistMode,
      specRoot: isLightweight || !specPlanningEnabled ? undefined : persisted.specRoot,
    };
    const validation = newConfigFormSchema.safeParse(values);
    if (!validation.success) {
      applyValidationIssues(validation.error.issues);
      return;
    }
    if (!isLightweight && !validation.data.requirements?.trim()) {
      setError('requirements', { type: 'validate', message: '需求描述不能为空' });
      toast('error', '请填写需求描述');
      return;
    }

    try {
      const requestBody = {
        ...validation.data,
        mode: creationMode,
        frontendSessionId: resolvedFrontendSessionId,
        creationSessionId: creationSessionId || undefined,
        skipSpecCoding: isLightweight || !specPlanningEnabled,
        ...(lightweight ? { lightweight } : {}),
      };
      const result = await createConfigMutation.mutateAsync(requestBody);
      const filename = typeof result?.filename === 'string' && result.filename
        ? result.filename
        : validation.data.filename;
      const session = result?.creationSession;
      if (session?.id) setCreationSessionId(session.id);
      if (resolvedFrontendSessionId && session) {
        const binding = {
          creationSessionId: session.id,
          filename,
          workflowName: validation.data.workflowName,
          status: session.status,
          specCodingId: session.specCoding?.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        };
        void updateSessionCreationBinding(resolvedFrontendSessionId, binding).catch(() => {});
        void appendVisibleSessionTag(
          resolvedFrontendSessionId,
          '创建工作流 · ' + validation.data.workflowName,
        ).catch(() => {});
      }
      toast('success', result?.message || '配置文件已创建');
      onSuccess(filename, { creationSession: session });
      onClose();
    } catch (error) {
      const issues = getValidationIssues(error);
      if (issues.length > 0) {
        applyValidationIssues(issues);
        return;
      }
      toast('error', '创建失败: ' + getErrorMessage(error, '未知错误'));
    }
  };

  const onInvalid = (formErrors: FieldErrors<NewConfigForm>) => {
    const messages = [
      formErrors.filename?.message,
      formErrors.workflowName?.message,
      formErrors.workingDirectory?.message,
      formErrors.workspaceMode?.message,
      formErrors.requirements?.message,
      formErrors.persistMode?.message,
      formErrors.specRoot?.message,
    ].filter((message): message is string => typeof message === 'string' && message.length > 0);
    toast('error', messages.length > 0 ? messages.join('\n') : '请先修正表单中的错误项');
  };

  const handleModeChange = (mode: WorkflowCreationMode) => {
    setWorkflowMode(mode);
    setLightweightErrors({});
  };

  const handleAiGuidedCreate = useCallback(() => {
    if (!resolvedFrontendSessionId && !frontendSessionId) {
      const sessionId = createSession({ title: 'AI 引导创建工作流' });
      if (sessionId) setResolvedFrontendSessionId(sessionId);
    }
    const requirements = initialRequirements?.trim() || DEFAULT_AI_WORKFLOW_REQUIREMENTS;
    setCreationSource('custom');
    setWorkflowMode('lightweight');
    updateLightweightValues({ task: requirements });
    setValue('mode', 'lightweight', { shouldDirty: false, shouldValidate: false });
    setValue('requirements', requirements, { shouldDirty: true, shouldValidate: false });
    setValue('workflowName', initialWorkflowName?.trim() || '轻量工作流', { shouldDirty: true, shouldValidate: false });
    setValue('description', initialDescription?.trim() || DEFAULT_AI_WORKFLOW_DESCRIPTION, { shouldDirty: true, shouldValidate: false });
    setValue('workspaceMode', initialWorkspaceMode || 'in-place', { shouldDirty: true, shouldValidate: false });
  }, [createSession, frontendSessionId, initialDescription, initialRequirements, initialWorkflowName, initialWorkspaceMode, resolvedFrontendSessionId, setValue, updateLightweightValues]);

  const dialogClassName = homepageCompact
    ? 'flex max-h-[90vh] w-[96vw] max-w-3xl flex-col p-0'
    : 'flex max-h-[92vh] w-[96vw] max-w-4xl flex-col p-0';
  const requirementsField = register('requirements');

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={dialogClassName}>
        <ComboboxPortalProvider>
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div>
              <DialogTitle>新建工作流配置</DialogTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                选择状态机编排，或创建由任务清单驱动的轻量工作流。
              </p>
            </div>
            {restoringSession ? <Badge variant="outline">正在恢复草稿</Badge> : null}
          </div>

          <Tabs
            value={creationSource}
            onValueChange={(value) => setCreationSource(value === 'template' ? 'template' : 'custom')}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="px-6 py-3">
              <TabsList className="grid w-full grid-cols-2 sm:w-[320px]">
                <TabsTrigger value="custom">自定义新建</TabsTrigger>
                <TabsTrigger value="template">模板库</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="custom" className="m-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
              <form
                id="new-config-form"
                onSubmit={handleSubmit(submit, onInvalid)}
                className="flex-1 space-y-6 overflow-auto px-6 pb-6"
              >
                <input type="hidden" {...register('mode')} />

                <section className="space-y-3">
                  <Label className="text-base font-semibold">
                    选择工作流模式 <span className="text-destructive">*</span>
                  </Label>
                  <WorkflowModeSelector
                    value={creationMode}
                    onChange={handleModeChange}
                    onAiGuidedCreate={handleAiGuidedCreate}
                    disabled={isSubmitting || createConfigMutation.isPending || restoringSession}
                  />
                </section>

                {isLightweight ? (
                  <section className="space-y-5 rounded-lg border bg-muted/20 p-4">
                    <h3 className="text-sm font-semibold">轻量工作流设置</h3>

                    <div className="space-y-2">
                      <Label htmlFor="lightweight-tasklist-directory">
                        任务清单目录（只读）
                      </Label>
                      <Input
                        id="lightweight-tasklist-directory"
                        value={lightweightTasklistDirectory}
                        readOnly
                        aria-readonly="true"
                        className="bg-muted/50"
                      />
                      <p className="text-xs leading-5 text-muted-foreground">
                        根据配置文件名自动派生。
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="lightweight-agent">
                        执行 Agent <span className="text-destructive">*</span>
                      </Label>
                      <SingleCombobox
                        value={lightweightValues.agent}
                        onValueChange={(agent) => updateLightweightValues({ agent })}
                        options={agentOptions}
                        placeholder={agentsQuery.isLoading ? '加载 Agent 中...' : '选择执行 Agent'}
                        emptyText="没有可用 Agent"
                        triggerClassName={lightweightErrors.agent ? 'border-destructive' : ''}
                        disabled={isSubmitting || createConfigMutation.isPending || restoringSession}
                      />
                      {lightweightErrors.agent ? (
                        <p className="text-sm text-destructive">{lightweightErrors.agent}</p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="lightweight-task">
                        执行任务 <span className="text-destructive">*</span>
                      </Label>
                      <Textarea
                        id="lightweight-task"
                        value={lightweightValues.task}
                        onChange={(event) => updateLightweightValues({ task: event.target.value })}
                        disabled={isSubmitting || createConfigMutation.isPending || restoringSession}
                        rows={5}
                        className={lightweightErrors.task ? 'border-destructive' : ''}
                        placeholder="描述要完成的任务、目标产物和验收条件..."
                      />
                      {lightweightErrors.task ? (
                        <p className="text-sm text-destructive">{lightweightErrors.task}</p>
                      ) : null}
                    </div>

                    <div className="space-y-3">
                      <Label>步骤 Skills</Label>
                      <MultiCombobox
                        value={lightweightValues.skills}
                        onValueChange={(skills) => updateLightweightValues({
                          skills: skills.filter((skill) => skill !== LIGHTWEIGHT_TASKLIST_SKILL),
                        })}
                        options={skillOptions}
                        placeholder={skillsQuery.isLoading ? '加载 Skills 中...' : '选择可选步骤 Skills'}
                        disabled={isSubmitting || createConfigMutation.isPending || restoringSession}
                      />
                      <p className="text-xs leading-5 text-muted-foreground">
                        可选 Skills 仅保存到这个步骤，不会修改所选 Agent 的全局 Skills。
                      </p>
                    </div>
                  </section>
                ) : (
                  <section className="space-y-5">
                    <div ref={requirementsSectionRef} className="space-y-2">
                      <Label htmlFor="requirements">
                        需求描述 <span className="text-destructive">*</span>
                      </Label>
                      <Textarea
                        {...requirementsField}
                        ref={(element) => {
                          requirementsField.ref(element);
                          requirementsInputRef.current = element;
                        }}
                        id="requirements"
                        placeholder="描述这个工作流要解决的问题、目标产物和验收标准..."
                        rows={5}
                        className={errors.requirements ? 'border-destructive' : ''}
                      />
                      {errors.requirements ? (
                        <p className="text-sm text-destructive">{errors.requirements.message}</p>
                      ) : null}
                    </div>

                    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <Label htmlFor="specPlanningEnabled">Spec 计划模式</Label>
                          <p className="text-xs leading-5 text-muted-foreground">
                            开启后创建 Spec 基线并保留后续修订会话；关闭后只创建状态机配置。
                          </p>
                        </div>
                        <Switch
                          id="specPlanningEnabled"
                          checked={specPlanningEnabled}
                          onCheckedChange={(checked: boolean) => setSpecPlanningEnabled(Boolean(checked))}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={specPlanningEnabled ? 'secondary' : 'outline'}>
                          {specPlanningEnabled ? '创建 Spec 基线' : '仅创建配置'}
                        </Badge>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="referenceWorkflow">参考已有工作流（可选）</Label>
                      <Select
                        value={referenceWorkflowValue || '__none__'}
                        onValueChange={(value) => {
                          setValue(
                            'referenceWorkflow',
                            value === '__none__' ? '' : value,
                            { shouldDirty: true, shouldValidate: true },
                          );
                        }}
                      >
                        <SelectTrigger id="referenceWorkflow">
                          <SelectValue placeholder={referenceLoading ? '加载参考工作流中...' : '选择状态机工作流'} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">不使用参考工作流</SelectItem>
                          {stateMachineReferences.map((workflow) => (
                            <SelectItem key={workflow.filename} value={workflow.filename}>
                              {workflow.name} ({workflow.filename})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs leading-5 text-muted-foreground">
                        只能引用普通状态机工作流；轻量工作流不能作为结构骨架。
                      </p>
                    </div>
                  </section>
                )}

                <section className="space-y-2">
                  <Label htmlFor="workflowName">
                    工作流名称 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="workflowName"
                    placeholder="我的工作流"
                    {...register('workflowName')}
                    className={errors.workflowName ? 'border-destructive' : ''}
                  />
                  {errors.workflowName ? (
                    <p className="text-sm text-destructive">{errors.workflowName.message}</p>
                  ) : null}
                </section>

                <section className="space-y-2">
                  <Label htmlFor="workingDirectory">
                    工作目录 <span className="text-destructive">*</span>
                  </Label>
                  <WorkspaceDirectoryPicker
                    workspaceRoot="/"
                    value={workingDirectoryValue}
                    onChange={handleWorkingDirectoryChange}
                    autoSelectRootWhenEmpty
                    className={errors.workingDirectory ? 'rounded-md border border-destructive p-1' : undefined}
                  />
                  {errors.workingDirectory ? (
                    <p className="text-sm text-destructive">{errors.workingDirectory.message}</p>
                  ) : null}
                </section>

                <section className="space-y-2">
                  <Label htmlFor="workspaceMode">
                    工作区模式 <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={workspaceModeValue}
                    onValueChange={(value: 'isolated-copy' | 'in-place') => {
                      setValue('workspaceMode', value, { shouldDirty: true, shouldValidate: true });
                    }}
                  >
                    <SelectTrigger id="workspaceMode">
                      <SelectValue placeholder="选择工作区模式" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in-place">直接在工作目录执行</SelectItem>
                      <SelectItem value="isolated-copy">先创建副本工程再执行</SelectItem>
                    </SelectContent>
                  </Select>
                </section>

                {!isLightweight && specPlanningEnabled ? (
                  <section className="space-y-4 rounded-lg border bg-muted/20 p-4">
                    <div className="space-y-1">
                      <Label htmlFor="persistMode">Spec 持久化</Label>
                      <p className="text-xs leading-5 text-muted-foreground">
                        可将正式计划制品同步保存到工作目录，系统会记住该选择。
                      </p>
                    </div>
                    <Select
                      value={persistModeValue}
                      onValueChange={(value: 'none' | 'repository') => {
                        setValue('persistMode', value, { shouldDirty: true, shouldValidate: true });
                      }}
                    >
                      <SelectTrigger id="persistMode">
                        <SelectValue placeholder="选择 Spec 持久化模式" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">不启用持久化 Spec</SelectItem>
                        <SelectItem value="repository">启用仓库持久化 Spec</SelectItem>
                      </SelectContent>
                    </Select>
                    {persistModeValue === 'repository' ? (
                      <div className="space-y-2">
                        <Label htmlFor="specRoot">Spec 名称 / 目录</Label>
                        <Input
                          id="specRoot"
                          placeholder=".spec"
                          {...register('specRoot')}
                          className={errors.specRoot ? 'border-destructive' : ''}
                        />
                        {errors.specRoot ? (
                          <p className="text-sm text-destructive">{errors.specRoot.message}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                <section className="space-y-2">
                  <Label htmlFor="filename">
                    文件名 <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="filename"
                    placeholder="my-workflow.yaml"
                    {...register('filename', { onBlur: normalizeFilename })}
                    className={errors.filename ? 'border-destructive' : ''}
                  />
                  {errors.filename ? (
                    <p className="text-sm text-destructive">{errors.filename.message}</p>
                  ) : null}
                  <p className="text-xs leading-5 text-muted-foreground">
                    文件名必须以 .yaml 结尾，只能包含字母、数字、下划线和连字符。
                  </p>
                </section>

                <section className="space-y-2">
                  <Label htmlFor="description">描述（可选）</Label>
                  <Textarea
                    id="description"
                    rows={3}
                    placeholder="描述这个工作流的用途..."
                    {...register('description')}
                  />
                </section>
              </form>

              <div className="flex justify-end gap-2 border-t px-6 py-4">
                <Button type="button" variant="outline" onClick={onClose}>
                  取消
                </Button>
                <Button
                  type="submit"
                  form="new-config-form"
                  disabled={isSubmitting || createConfigMutation.isPending || restoringSession}
                >
                  {isSubmitting || createConfigMutation.isPending ? '创建中...' : '创建'}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="template" className="m-0 min-h-0 flex-1 overflow-auto px-6 pb-6 data-[state=inactive]:hidden">
              <WorkflowTemplateBrowser variant="embedded" onInstantiated={handleTemplateInstantiated} />
            </TabsContent>
          </Tabs>
        </ComboboxPortalProvider>
      </DialogContent>
    </Dialog>
  );
}
