'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { TourProvider, useTour, type TooltipPosition, type TourStep } from 'modern-tour';

type Role = 'admin' | 'user';
type TourLaunchMode = 'resume' | 'current-route';

export type ModernOnboardingProgress = {
  done: boolean;
  phase: 'intro' | 'overview' | 'module' | 'member' | 'admin' | 'adminReport' | 'done';
  introIndex: number;
  selectedModule: string;
  moduleStepIndex: number;
  visitedModules: string[];
  memberChecks: {
    homeGuideDone: boolean;
    engineModelDone: boolean;
    notebookDone: boolean;
    personalDirConfirm: boolean;
  };
  adminChecks: {
    engineReady: boolean;
    defaultModel: boolean;
    agentGroup: boolean;
    personalDirReady: boolean;
  };
  maximized: boolean;
};

type ProductTourStep = {
  id: string;
  route: string;
  targetId: string;
  eyebrow: string;
  title: string;
  body: string;
  position: TooltipPosition;
  checklist?: string[];
  role?: Role | 'all';
};

const TOUR_STEPS: ProductTourStep[] = [
  {
    id: 'home-chat-main',
    route: '/',
    targetId: 'home-chat-main',
    eyebrow: '首页对话',
    title: '先从首页对话开始',
    body: '这里是日常入口。你可以直接描述需求、让 AI 帮你整理 workflow/Agent 草案，也可以继续追问、查看历史回复和结构化结果。',
    position: 'bottom-start',
    checklist: ['描述需求', '让 AI 整理上下文', '从对话进入创建流程'],
  },
  {
    id: 'home-chat-composer',
    route: '/',
    targetId: 'home-chat-composer',
    eyebrow: '首页对话',
    title: '在这里输入你的下一步',
    body: '输入框支持自然语言、粘贴 Markdown 和快捷命令。模型选择、调试开关和发送按钮都在同一个操作区，适合从一句话启动后续工作。',
    position: 'top',
  },
  {
    id: 'dashboard-overview',
    route: '/dashboard',
    targetId: 'dashboard-overview',
    eyebrow: '控制台',
    title: '先建立全局视角',
    body: '这里是运行健康度、工作流数量、Token 消耗和最近活动的总览。每天进来先看这里，就能判断系统是否在稳定产出。',
    position: 'bottom-start',
    checklist: ['确认当前版本', '观察活跃工作流', '检查近期运行趋势'],
  },
  {
    id: 'dashboard-actions',
    route: '/dashboard',
    targetId: 'dashboard-quick-actions',
    eyebrow: '常用入口',
    title: '把高频操作放在第一屏',
    body: '这里是日常起手式：创建工作流、管理 Agent、配置模型、进入知识库或系统设置。新用户不需要先理解全部菜单。',
    position: 'top',
  },
  {
    id: 'workflow-create',
    route: '/workflows',
    targetId: 'workflow-create-actions',
    eyebrow: '工作流',
    title: '从 AI 创建或手动创建开始',
    body: 'AI 创建适合把模糊需求梳理成可执行流程；手动创建适合你已经明确阶段、Agent 和任务边界的场景。',
    position: 'bottom-end',
    checklist: ['导入/导出用于迁移', 'AI 创建用于探索', '手动创建用于精确配置'],
  },
  {
    id: 'workflow-list',
    route: '/workflows',
    targetId: 'workflow-filter',
    eyebrow: '工作流',
    title: '筛选、查看和批量整理工作流',
    body: '搜索、模式筛选、表格/卡片视图和批量操作都在这里。工作流跑起来以后，也可以从列表进入运行台、历史或设计视图。',
    position: 'bottom',
  },
  {
    id: 'agent-hall',
    route: '/agents',
    targetId: 'agent-hall',
    eyebrow: 'Agent',
    title: 'Agent 是可调度的角色编队',
    body: '这里把 Agent 当成稳定角色来管理：头像、阵营、能力、系统提示词和常驻对话属性都会影响工作流协作质量。',
    position: 'bottom',
  },
  {
    id: 'agent-create',
    route: '/agents',
    targetId: 'agent-create',
    eyebrow: 'Agent',
    title: '先用 AI 草案，再做人工精修',
    body: 'AI 创建可以快速生成角色定位和提示词草案；手动建模则适合把已有专家角色沉淀成固定配置。',
    position: 'bottom-end',
  },
  {
    id: 'model-tabs',
    route: '/models',
    targetId: 'model-tabs',
    eyebrow: '模型',
    title: '模型中心不只是一个列表',
    body: '这里同时负责模型目录、探针监控和诊断评测。上线前先确认模型可用性，再让工作流使用它们。',
    position: 'bottom-start',
    checklist: ['模型管理', '探针监控', '诊断评测'],
  },
  {
    id: 'model-filter',
    route: '/models',
    targetId: 'model-filter',
    eyebrow: '模型',
    title: '按端点、引擎和状态快速定位',
    body: '团队模型变多后，筛选栏会比滚动列表更重要。推荐先把常用模型和失效模型整理清楚。',
    position: 'bottom',
  },
  {
    id: 'account-directory',
    route: '/account',
    targetId: 'account-directory',
    eyebrow: '账户',
    title: '个人目录决定工作流落地位置',
    body: '工作流执行时会依赖个人目录创建隔离工作区。这里配置清楚，后续 Notebook、运行记录和文件浏览都会更顺。',
    position: 'top',
  },
  {
    id: 'account-notebook',
    route: '/account',
    targetId: 'account-notebook',
    eyebrow: 'Notebook',
    title: '把可运行知识沉淀成 Notebook',
    body: 'Notebook 适合保存排查步骤、命令片段和经验文档。它和个人目录绑定，是团队知识复用的入口之一。',
    position: 'top',
  },
  {
    id: 'admin-users',
    route: '/users',
    targetId: 'admin-users',
    eyebrow: '管理员',
    title: '最后检查成员与注册审核',
    body: '管理员可以处理注册申请、重置成员信息，并确认每个人是否已经完成初始配置。',
    position: 'bottom-start',
    role: 'admin',
  },
];

const DEFAULT_MEMBER_CHECKS = {
  homeGuideDone: false,
  engineModelDone: false,
  notebookDone: false,
  personalDirConfirm: false,
};

const DEFAULT_ADMIN_CHECKS = {
  engineReady: false,
  defaultModel: false,
  agentGroup: false,
  personalDirReady: false,
};

interface ModernOnboardingTourProps {
  open: boolean;
  role: Role;
  launchMode?: TourLaunchMode;
  initialProgress?: ModernOnboardingProgress | null;
  loadingProgress?: boolean;
  onPersist?: (progress: ModernOnboardingProgress, options?: { markCompleted?: boolean }) => Promise<void> | void;
  onClose: (completed?: boolean) => void;
}

interface TourControllerProps {
  open: boolean;
  startIndex: number;
  steps: ProductTourStep[];
  onStartStep: (index: number) => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function selectorForStep(step: ProductTourStep) {
  return `[data-tour-step-id="${step.targetId}"]`;
}

function pathMatches(pathname: string | null, route: string) {
  if (!pathname) return false;
  return pathname === route || pathname.startsWith(`${route}/`);
}

function TourController({ open, startIndex, steps, onStartStep }: TourControllerProps) {
  const { isOpen, start, stop } = useTour();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      if (isOpen) stop();
      return;
    }

    if (startedRef.current || steps.length === 0) return;
    startedRef.current = true;
    start(startIndex);
    onStartStep(startIndex);
  }, [isOpen, onStartStep, open, start, startIndex, steps.length, stop]);

  return null;
}

function TourIntentTracker({
  open,
  stepsLength,
  onCompleteIntent,
  onDismissIntent,
}: {
  open: boolean;
  stepsLength: number;
  onCompleteIntent: () => void;
  onDismissIntent: () => void;
}) {
  const { currentStep, isOpen } = useTour();

  useEffect(() => {
    if (!open || !isOpen) return;

    const handlePointer = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('.framer-tour-close')) {
        onDismissIntent();
        return;
      }
      if (event.target.closest('.framer-tour-btn-primary') && currentStep >= stepsLength - 1) {
        onCompleteIntent();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismissIntent();
        return;
      }
      if ((event.key === 'Enter' || event.key === 'ArrowRight') && currentStep >= stepsLength - 1) {
        onCompleteIntent();
      }
    };

    document.addEventListener('click', handlePointer, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('click', handlePointer, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [currentStep, isOpen, onCompleteIntent, onDismissIntent, open, stepsLength]);

  return null;
}

export function ModernOnboardingTour({
  open,
  role,
  launchMode = 'resume',
  initialProgress,
  loadingProgress = false,
  onPersist,
  onClose,
}: ModernOnboardingTourProps) {
  const router = useRouter();
  const pathname = usePathname();
  const completedIntentRef = useRef(false);

  const steps = useMemo(
    () => TOUR_STEPS.filter((step) => !step.role || step.role === 'all' || step.role === role),
    [role],
  );

  const resumeStartIndex = useMemo(() => {
    const storedIndex = Number(initialProgress?.introIndex);
    return clamp(Number.isFinite(storedIndex) ? storedIndex : 0, 0, Math.max(0, steps.length - 1));
  }, [initialProgress?.introIndex, steps.length]);

  const currentRouteStartIndex = useMemo(() => {
    const matchedIndex = steps.findIndex((step) => pathMatches(pathname, step.route));
    return matchedIndex >= 0 ? matchedIndex : 0;
  }, [pathname, steps]);

  const startIndex = launchMode === 'current-route' ? currentRouteStartIndex : resumeStartIndex;

  const buildProgress = useCallback(
    (index: number, done = false): ModernOnboardingProgress => {
      const safeIndex = clamp(index, 0, Math.max(0, steps.length - 1));
      const completionIndex = done ? Math.max(0, steps.length - 1) : safeIndex;
      const step = steps[completionIndex] || steps[safeIndex] || steps[0];
      const visited = steps.slice(0, completionIndex + 1).map((item) => item.id);
      const persistedDone = done || Boolean(initialProgress?.done);

      return {
        ...(initialProgress || {}),
        done: persistedDone,
        phase: persistedDone ? 'done' : 'module',
        introIndex: completionIndex,
        selectedModule: step?.id || 'dashboard-overview',
        moduleStepIndex: completionIndex,
        visitedModules: Array.from(new Set([...(initialProgress?.visitedModules || []), ...visited])),
        memberChecks: {
          ...DEFAULT_MEMBER_CHECKS,
          ...(initialProgress?.memberChecks || {}),
          homeGuideDone: completionIndex >= 1,
          engineModelDone: completionIndex >= 7,
          notebookDone: completionIndex >= 9,
          personalDirConfirm: completionIndex >= 8,
        },
        adminChecks: {
          ...DEFAULT_ADMIN_CHECKS,
          ...(initialProgress?.adminChecks || {}),
          engineReady: completionIndex >= 6,
          defaultModel: completionIndex >= 6,
          agentGroup: completionIndex >= 5,
          personalDirReady: completionIndex >= 8,
        },
        maximized: false,
      };
    },
    [initialProgress, steps],
  );

  const persistIndex = useCallback(
    (index: number, done = false) => {
      void onPersist?.(buildProgress(index, done), { markCompleted: done });
    },
    [buildProgress, onPersist],
  );

  const completeTour = useCallback(
    (index: number) => {
      completedIntentRef.current = true;
      persistIndex(index, true);
    },
    [persistIndex],
  );

  const dismissTour = useCallback(() => {
    completedIntentRef.current = false;
  }, []);

  const goToStepRoute = useCallback(
    (index: number) => {
      const step = steps[index];
      if (!step || pathMatches(pathname, step.route)) return;
      router.push(step.route);
    },
    [pathname, router, steps],
  );

  const options = useMemo(
    () => ({
      steps: steps.map<TourStep>((step) => ({
        id: step.id,
        target: selectorForStep(step),
        title: (
          <>
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {step.eyebrow}
            </span>
            <span className="block text-base font-semibold leading-5 text-foreground">
              {step.title}
            </span>
          </>
        ),
        content: (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-muted-foreground">{step.body}</p>
            {step.checklist?.length ? (
              <ul className="space-y-1.5 pl-4 text-[13px] leading-5 text-muted-foreground">
                {step.checklist.map((item) => (
                  <li key={item} className="list-disc">
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
            {loadingProgress ? (
              <p className="text-xs leading-5 text-muted-foreground">正在同步导览进度...</p>
            ) : null}
          </div>
        ),
        position: step.position,
        route: step.route,
        spotlightPadding: 10,
      })),
      animation: 'smooth' as const,
      keyboardNavigation: true,
      closeOnOverlayClick: false,
      closeOnEscape: true,
      showCloseButton: true,
      showNavigation: true,
      showProgress: true,
      spotlightPadding: 10,
      scrollBehavior: 'smooth' as const,
      scrollMargin: 112,
      waitForTargetTimeout: 10000,
      labels: {
        next: '下一步',
        prev: '上一步',
        finish: '完成',
        close: '关闭',
      },
      onStart: () => {
        completedIntentRef.current = false;
        goToStepRoute(startIndex);
      },
      onEnd: () => {
        const completed = completedIntentRef.current;
        completedIntentRef.current = false;
        onClose(completed);
      },
      onStepChange: (index: number) => {
        completedIntentRef.current = false;
        goToStepRoute(index);
        persistIndex(index, false);
      },
    }),
    [goToStepRoute, loadingProgress, onClose, persistIndex, startIndex, steps],
  );

  if (steps.length === 0) return null;

  return (
    <TourProvider options={options}>
      <TourController open={open} startIndex={startIndex} steps={steps} onStartStep={(index) => persistIndex(index, false)} />
      <TourIntentTracker
        open={open}
        stepsLength={steps.length}
        onCompleteIntent={() => completeTour(Math.max(0, steps.length - 1))}
        onDismissIntent={dismissTour}
      />
    </TourProvider>
  );
}
