'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getAllPlugins,
  getActionsGrouped,
  getPinnedActions,
  type HomePluginQuickAction,
} from '@/lib/sidebar-plugins';
import { Suggestions, Suggestion } from '@/components/ai-elements/suggestion';
import { CODESPEC_WORKFLOW_CREATOR_ACTION, isAiWorkflowCreatorAction } from '@/lib/chat/workflow-creator-entry';

type SlashCommandLike = {
  id: string;
  command: string;
  displayCommand?: string;
  title: string;
  subtext: string;
  icon: string;
  aliases: string[];
  prompt?: string;
  engineTag?: string;
};

interface QuickActionsProps {
  onAction: (text: string) => void;
  skillSettings?: Record<string, boolean>;
  slashCommands?: SlashCommandLike[];
}

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.95 },
  show: { opacity: 1, y: 0, scale: 1 },
};

function normalizeActionKey(value: string) {
  return String(value || '')
    .trim()
    .replace(/^__HOME_ACTION__:/i, '')
    .replace(/^\/+/, '')
    .toLowerCase();
}

function isCodespecSlashCommand(command: SlashCommandLike) {
  return [command.command, command.title, command.subtext, command.prompt || '', ...command.aliases]
    .some((value) => /codespec/i.test(String(value || '')));
}

function buildCodespecQuickActions(slashCommands?: SlashCommandLike[]): HomePluginQuickAction[] {
  const codespecEnabled = getAllPlugins({ includeDisabled: true }).some(
    (plugin) => plugin.id === 'codespec' && plugin.enabled !== false,
  );
  if (!codespecEnabled) return [];

  const actions: HomePluginQuickAction[] = [{
    id: 'codespec-create-workflow-from-docs',
    label: '根据 Codespec 创建工作流',
    icon: 'account_tree',
    color: 'from-indigo-600 to-sky-600',
    prompt: CODESPEC_WORKFLOW_CREATOR_ACTION,
    pinned: false,
    category: 'codespec',
    order: 30,
  }];
  const seen = new Set<string>(actions.map((action) => normalizeActionKey(action.prompt)).filter(Boolean));
  for (const [index, command] of (slashCommands || []).entries()) {
    if (!isCodespecSlashCommand(command)) continue;
    const prompt = command.prompt || command.command;
    const key = normalizeActionKey(prompt);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    actions.push({
      id: `codespec-slash-${command.id}`,
      label: command.title || command.command.replace(/^\//, ''),
      icon: command.icon || 'terminal',
      color: 'from-violet-600 to-cyan-600',
      prompt,
      sourceTag: command.engineTag,
      pinned: false,
      category: 'codespec',
      order: 35 + index,
    });
  }
  return actions;
}

function mergeGroupedActions(
  groups: ReturnType<typeof getActionsGrouped>,
  extraActions: HomePluginQuickAction[],
) {
  if (extraActions.length === 0) return groups;
  const nextGroups = groups.map((group) => ({
    category: group.category,
    actions: [...group.actions],
  }));
  const categoryIndex = new Map(nextGroups.map((group, index) => [group.category.id, index]));
  const seen = new Set<string>();

  for (const group of nextGroups) {
    for (const action of group.actions) {
      seen.add(normalizeActionKey(action.prompt));
    }
  }

  for (const action of [...extraActions].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))) {
    const index = categoryIndex.get(action.category);
    if (index === undefined) continue;
    const key = normalizeActionKey(action.prompt);
    if (key && seen.has(key)) continue;
    nextGroups[index].actions.push(action);
    if (key) seen.add(key);
  }

  for (const group of nextGroups) {
    group.actions.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  return nextGroups.filter((group) => group.actions.length > 0);
}

function getCollapsibleActionGroups(extraActions: HomePluginQuickAction[]) {
  const baseGroups = getActionsGrouped()
    .map((group) => ({
      category: group.category,
      actions: group.actions.filter((action) => !action.pinned),
    }))
    .filter((group) => group.actions.length > 0);
  return mergeGroupedActions(baseGroups, extraActions);
}

const ACTION_GUIDES: Record<string, {
  title: string;
  description: string;
  samplePrompt: string;
  assistantSteps: string[];
}> = {
  '工作流列表': {
    title: '先说明你想怎么看工作流',
    description: '如果只是想看工作流列表，也建议先把查询意图填进输入框，再补充筛选条件。',
    samplePrompt: '请列出当前可用的工作流配置，如果可以的话按名称、模式和用途做一个简要整理。',
    assistantSteps: [
      '先读取当前可用工作流配置。',
      '按名称、模式、用途或状态做结构化整理。',
      '如果你继续追问，再围绕某个 workflow 展开。',
    ],
  },
  'Agent 列表': {
    title: '先说明你想看哪些 Agent',
    description: '查看 Agent 时，最好一开始就说明你关注的是全部、某个阵营，还是某类职责。',
    samplePrompt: '请列出当前可用的 Agent，并按阵营、职责和是否适合常驻对话做一个简要整理。',
    assistantSteps: [
      '先读取当前 Agent 列表。',
      '按阵营、职责、标签或可用性整理结果。',
      '如果需要，再继续展开某个 Agent 的细节。',
    ],
  },
  '模型列表': {
    title: '先说明你想看哪些模型',
    description: '模型列表通常会更有用，如果同时说明你关注的是可用性、引擎归属还是默认模型。',
    samplePrompt: '请列出当前可用模型，并说明它们分别归属哪个引擎、当前默认使用哪个。',
    assistantSteps: [
      '先读取当前模型配置。',
      '按引擎归属和默认状态整理可用模型。',
      '如果你继续追问，再给出推荐选择。',
    ],
  },
  'Skill 列表': {
    title: '先说明你想看哪些 Skill',
    description: 'Skill 很多时，先说明你想看全部还是某个方向，会更容易得到可用结果。',
    samplePrompt: '请列出当前可用 Skills，并按用途做一个简要分类，标出和 workflow / Agent 创建最相关的那些。',
    assistantSteps: [
      '先读取当前可用 Skills。',
      '按用途做分组和摘要。',
      '如果需要，再继续展开某个 Skill 的用法。',
    ],
  },
  '运行状态': {
    title: '先说明要看哪个运行状态',
    description: '运行状态最好明确到具体 workflow 名称或 yaml 文件名，这样 AI 才能更快定位目标。',
    samplePrompt: '请帮我查看【workflow-name】或【workflow-file.yaml】这个工作流当前的运行状态。',
    assistantSteps: [
      '先定位目标 workflow。',
      '读取当前运行状态、阶段和步骤信息。',
      '再根据结果继续给你总结或建议。',
    ],
  },
  '运行历史': {
    title: '先说明要看哪类运行历史',
    description: '运行历史建议至少说明是看最近记录，还是某个 workflow 的历史记录。',
    samplePrompt: '请列出最近的运行记录；如果可以的话，按 workflow 名称和运行状态做一个简要整理。',
    assistantSteps: [
      '先读取最近运行记录。',
      '按 workflow、状态、时间做结构化整理。',
      '如果你继续追问，再展开某条运行记录。',
    ],
  },
  '创建工作流': {
    title: '先描述目标，再创建工作流',
    description: '这类操作依赖当前对话上下文。先把目标、工作目录和约束告诉 AI，再让它生成右侧表单预填信息会更稳定。',
    samplePrompt: '我想围绕【目标】创建一个工作流，工作目录是【路径】，请先帮我梳理需求、阶段、候选 Agent 和任务拆分。',
    assistantSteps: [
      '先确认你的目标、输入、工作目录和约束。',
      '整理出阶段、候选 Agent、工作流结构和关键风险。',
      '把这些信息同步到右侧工作流表单，再进入创建。',
    ],
  },
  '创建 Agent': {
    title: '先定义职责，再创建 Agent',
    description: 'Agent 需要明确职责边界、风格和输入输出。先在对话里收敛这些内容，再填表单更合适。',
    samplePrompt: '我想创建一个负责【职责】的 Agent，服务于【场景】，请先帮我定义它的职责、风格、能力边界和输入输出。',
    assistantSteps: [
      '先澄清这个 Agent 服务的场景与上游下游。',
      '整理职责、风格、能力边界、工具需求和禁区。',
      '再把这些内容预填到右侧 Agent 表单中。',
    ],
  },
  '启动运行': {
    title: '先说明要运行什么',
    description: '启动运行前，至少要告诉 AI 具体是哪个 workflow，直接给 workflow 名称或 yaml 文件名都可以。',
    samplePrompt: '我想启动运行，请按【workflow-name】或【workflow-file.yaml】这个工作流继续帮我定位并启动。',
    assistantSteps: [
      '先确认你提供的是 workflow 名称，还是具体 yaml 文件名。',
      '根据名称或文件名定位对应配置，并补足当前运行上下文。',
      '确认目标工作流后再进入启动或继续运行。',
    ],
  },
  '优化提示词': {
    title: '先贴出当前提示词问题',
    description: '优化提示词需要原始提示词、目标效果和当前问题。先在对话里把这些信息给全。',
    samplePrompt: '请帮我优化这个 Agent 的提示词，目标是提升【效果】，当前问题是【问题】。这是当前提示词：【粘贴提示词】',
    assistantSteps: [
      '先拿到原始提示词、目标和当前表现问题。',
      '分析哪些约束、角色定义或输出结构不清晰。',
      '给出优化版本和修改理由。',
    ],
  },
  '分析运行': {
    title: '先告诉 AI 要分析哪次运行',
    description: '运行分析必须明确到具体 runId，否则 AI 无法可靠定位要分析的那次运行。',
    samplePrompt: '请帮我分析 runId=【run-id】 这次运行的结果，重点看失败原因、风险、提示词问题和下一步建议。',
    assistantSteps: [
      '先根据你提供的 runId 定位那次运行和相关上下文。',
      '归纳失败点、风险、卡住环节和提示词问题。',
      '输出下一步处理建议。',
    ],
  },
};

export default function QuickActions({ onAction, skillSettings, slashCommands }: QuickActionsProps) {
  const [guideAction, setGuideAction] = useState<HomePluginQuickAction | null>(null);
  const guide = guideAction ? ACTION_GUIDES[guideAction.label] || guideAction.guide || null : null;
  const actionsGrouped = mergeGroupedActions(getActionsGrouped(), buildCodespecQuickActions(slashCommands));

  const handleActionClick = (action: HomePluginQuickAction) => {
    if (ACTION_GUIDES[action.label] || action.guide) {
      setGuideAction(action);
      return;
    }
    if (action.prompt.startsWith('__HOME_ACTION__:')) {
      onAction(action.prompt);
      return;
    }
    onAction(action.prompt);
  };

  const handleInsertGuidePrompt = () => {
    if (!guide) return;
    onAction(`${guide.samplePrompt}\n`);
    setGuideAction(null);
  };

  const handleOpenWorkflowCreator = () => {
    const action = guideAction;
    if (!action || !isAiWorkflowCreatorAction(action.prompt)) return;
    onAction(action.prompt);
    setGuideAction(null);
  };

  return (
    <>
      <motion.div
        className="w-full max-w-2xl space-y-5"
        variants={containerVariants}
        initial="hidden"
        animate="show"
      >
        {actionsGrouped.map(({ category, actions }) => (
          <div key={category.id}>
            <div className="flex items-center gap-1.5 mb-2 px-1">
              <span className="material-symbols-outlined text-sm text-muted-foreground">{category.icon}</span>
              <span className="text-xs font-medium text-muted-foreground">{category.title}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {actions.map(a => (
                <motion.button
                  type="button"
                  key={a.id}
                  variants={itemVariants}
                  whileHover={{ scale: 1.04, y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleActionClick(a)}
                  className={`relative bg-gradient-to-br ${a.color} p-3.5 rounded-xl border border-white/10 overflow-hidden group text-left`}
                >
                  <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="absolute -right-4 -bottom-4 w-16 h-16 bg-white/10 rounded-full blur-xl" />
                  <div className="relative z-10 flex flex-col gap-1.5">
                    <span className="material-symbols-outlined text-white/90 text-lg">{a.icon}</span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-white">{a.label}</span>
                      {a.sourceTag ? (
                        <span className="shrink-0 rounded-full bg-white/18 px-1.5 py-0.5 text-[9px] leading-none text-white/85 ring-1 ring-white/20">
                          {a.sourceTag}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        ))}
      </motion.div>

      <Dialog open={Boolean(guideAction)} onOpenChange={(open) => !open && setGuideAction(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{guide?.title || guideAction?.label}</DialogTitle>
            <DialogDescription>{guide?.description}</DialogDescription>
          </DialogHeader>

          {guide && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-xs font-medium text-muted-foreground">建议先发送这样一条消息</div>
                  <div className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-1 text-[11px] text-muted-foreground">
                    <span className="material-symbols-outlined text-xs">smart_toy</span>
                    虚拟对话演示
                  </div>
                </div>

                <div className="space-y-3">
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm text-primary-foreground shadow-sm"
                  >
                    {guide.samplePrompt}
                  </motion.div>

                  {guide.assistantSteps.map((step, index) => (
                    <motion.div
                      key={`${guideAction?.label}-${index}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.12 * (index + 1) }}
                      className="max-w-[88%] rounded-2xl rounded-bl-md border border-border/60 bg-background px-4 py-3 text-sm text-foreground shadow-sm"
                    >
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="material-symbols-outlined text-xs">auto_awesome</span>
                        AI 将这样推进
                      </div>
                      <div>{step}</div>
                    </motion.div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-dashed border-border/70 bg-background/70 p-3 text-xs leading-6 text-muted-foreground">
                点击下面按钮后，这条示例消息会直接放入输入框，不会自动发送。你可以先补充细节，再手动发出。
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setGuideAction(null)}>
              稍后再说
            </Button>
            {isAiWorkflowCreatorAction(guideAction?.prompt) ? (
              <Button variant="secondary" onClick={handleOpenWorkflowCreator}>
                打开轻量创建
              </Button>
            ) : null}
            <Button onClick={handleInsertGuidePrompt}>
              把示例消息放入输入框
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Compact horizontal bar version — shown above input when messages exist */
export function QuickActionsBar({ onAction, skillSettings, slashCommands }: QuickActionsProps) {
  const [expanded, setExpanded] = useState(false);
  const pinnedActions = getPinnedActions();
  const collapsibleGroups = getCollapsibleActionGroups(buildCodespecQuickActions(slashCommands));

  return (
    <div className="w-full py-1">
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mb-1 overflow-hidden"
          >
            <div className="space-y-2 pb-0.5">
              {collapsibleGroups.map(({ category, actions }) => (
                <div key={category.id}>
                  <div className="mb-1 flex items-center gap-1 px-0.5 text-[11px] font-medium text-muted-foreground">
                    <span className="material-symbols-outlined text-xs">{category.icon}</span>
                    {category.title}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {actions.map(a => (
                      <motion.button
                        type="button"
                        key={a.id}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => { onAction(a.prompt); setExpanded(false); }}
                        className={`inline-flex items-center gap-1 bg-gradient-to-r ${a.color} rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-medium text-white`}
                      >
                        <span className="material-symbols-outlined text-xs">{a.icon}</span>
                        <span>{a.label}</span>
                        {a.sourceTag ? (
                          <span className="rounded-full bg-white/18 px-1.5 py-0.5 text-[9px] leading-none text-white/85 ring-1 ring-white/20">
                            {a.sourceTag}
                          </span>
                        ) : null}
                      </motion.button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Suggestions className="mb-1 gap-2">
        {pinnedActions.map((action) => (
          <Suggestion
            key={action.id}
            suggestion={action.prompt}
            onClick={() => onAction(action.prompt)}
            className={`h-10 rounded-full bg-gradient-to-r ${action.color} border-white/10 px-5 text-sm font-semibold text-white shadow-sm hover:opacity-90`}
            size="sm"
          >
            <span className="material-symbols-outlined text-xs">{action.icon}</span>
            {action.label}
          </Suggestion>
        ))}
      </Suggestions>
      <div className="mb-0.5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="material-symbols-outlined text-sm">{expanded ? 'expand_more' : 'expand_less'}</span>
          {expanded ? '收起快捷操作' : '快捷操作'}
        </button>
      </div>
    </div>
  );
}
