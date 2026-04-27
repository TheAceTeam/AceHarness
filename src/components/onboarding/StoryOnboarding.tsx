'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type UserRole = 'admin' | 'user';
type ModuleKey =
  | 'home'
  | 'dashboard'
  | 'workflows'
  | 'engines'
  | 'agents'
  | 'models'
  | 'skills'
  | 'schedules'
  | 'notebook'
  | 'account'
  | 'systemSettings'
  | 'users'
  | 'apiDocs';

interface StoryOnboardingProps {
  open: boolean;
  role: UserRole;
  initialProgress?: OnboardingProgressPayload | null;
  loadingProgress?: boolean;
  onPersist?: (progress: OnboardingProgressPayload, options?: { markCompleted?: boolean }) => Promise<void> | void;
  onClose: (completed: boolean) => void;
}

interface MemberChecks {
  homeGuideDone: boolean;
  engineModelDone: boolean;
  notebookDone: boolean;
  personalDirConfirm: boolean;
}

interface AdminChecks {
  engineReady: boolean;
  defaultModel: boolean;
  agentGroup: boolean;
  personalDirReady: boolean;
}

interface OnboardingProgressPayload {
  done: boolean;
  phase: 'intro' | 'overview' | 'module' | 'member' | 'admin' | 'adminReport' | 'done';
  introIndex: number;
  selectedModule: ModuleKey;
  moduleStepIndex: number;
  visitedModules: ModuleKey[];
  memberChecks: MemberChecks;
  adminChecks: AdminChecks;
  maximized: boolean;
}

interface AdminProgressRow {
  userId: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  personalDir: string;
  done: boolean;
  startedAt?: number;
  completedAt?: number;
  updatedAt?: number;
  phase?: string;
  visitedModules?: string[];
}

interface ModuleStep {
  title: string;
  detail: string;
  cue: string;
}

interface ModuleSpec {
  key: ModuleKey;
  title: string;
  subtitle: string;
  icon: string;
  route?: string;
  adminOnly?: boolean;
  eta: string;
  bullets: string[];
  notes: string[];
  steps: ModuleStep[];
}

const INTRO_STEPS = [
  {
    title: '欢迎进入 ACE Harness',
    text: '我是值班机器人。看起来淡定，是因为我已经见过太多“直接上生产”的勇士。',
  },
  {
    title: '本次引导目标',
    text: '快速掌握全模块入口，再按需深入。教程默认短，详细关卡你自己选。',
  },
  {
    title: '体验规则',
    text: '这里是演示流程，不会触发真实 AI 创建，不会偷偷消耗额度，也不会记你迟到。',
  },
];

const MODULES: ModuleSpec[] = [
  {
    key: 'home',
    title: '首页对话',
    subtitle: '对话入口与引导式创建',
    icon: 'chat',
    route: '/',
    eta: '45s',
    bullets: [
      '首页是最高频入口：日常对话 + 引导式创建。',
      '建议先用简短目标描述跑一轮，避免一次给出巨大需求。',
      '本引导中的“AI 引导创建”是模拟，不触发真实创建。',
    ],
    notes: ['冷幽默提示：先让需求可读，再要求系统智能。'],
    steps: [
      { title: '定位主输入区', detail: '首页输入区是最高频入口，支持直接对话和引导式创建。', cue: '目标：先发一个最小需求' },
      { title: '理解上下文对话', detail: '消息会按会话沉淀，可继续追问与修订。', cue: '目标：先确认“当前目标 + 约束”' },
      { title: '体验引导式创建', detail: '引导模式用于结构化收集需求，不是“马上开跑”。', cue: '目标：让需求可执行，不求一步到位' },
      { title: '留意发送与停止', detail: '流式生成中可手动停止，避免无效输出继续增长。', cue: '目标：学会中断和重提要求' },
    ],
  },
  {
    key: 'dashboard',
    title: '控制台总览',
    subtitle: '全局统计与快捷入口',
    icon: 'dashboard',
    route: '/dashboard',
    eta: '45s',
    bullets: [
      '查看运行统计、最近任务和系统状态。',
      '从这里一键进入 workflows/agents/models/engines。',
      '建议先熟悉快捷入口，减少来回切页成本。',
    ],
    notes: ['越忙的时候，越该先看总览，不要先看情绪。'],
    steps: [
      { title: '先看四个核心指标', detail: '总运行数、成功率、平均时长、活跃进程是第一观察层。', cue: '目标：判断系统是否健康' },
      { title: '浏览最近运行', detail: '近期运行用于快速回放问题发生上下文。', cue: '目标：先看异常，再看美观图表' },
      { title: '使用快捷入口', detail: '控制台一键跳 workflows/agents/models/engines。', cue: '目标：减少切页认知成本' },
      { title: '确认当前身份', detail: '管理员和普通成员看到的可操作范围不同。', cue: '目标：带权限意识操作' },
    ],
  },
  {
    key: 'workflows',
    title: '工作流中心',
    subtitle: '阶段式 / 状态机 / AI引导（演示）',
    icon: 'account_tree',
    route: '/workflows',
    eta: '90s',
    bullets: [
      '理解三类工作流：阶段式、状态机式、AI 引导式。',
      '运行态重点看：文档面板、实时输出、人工审核节点。',
      '人工审核阶段可 approve/iterate，保证可控推进。',
    ],
    notes: ['假正经提醒：自动化的价值，不等于无条件自动通过。'],
    steps: [
      { title: '选工作流类型', detail: '阶段式适合线性流程，状态机适合复杂分支。', cue: '目标：模型匹配业务复杂度' },
      { title: '看运行面板布局', detail: '文档区、实时输出区、状态轨迹区各司其职。', cue: '目标：先定位信息来源' },
      { title: '识别人工审核节点', detail: '关键风险节点要人工 approve/iterate。', cue: '目标：把风险决策留给人' },
      { title: '学会回退与重跑', detail: '失败时优先重跑局部步骤，而不是全量重来。', cue: '目标：降低恢复成本' },
    ],
  },
  {
    key: 'engines',
    title: '引擎管理',
    subtitle: '先装工具，再切引擎',
    icon: 'memory',
    route: '/engines',
    eta: '75s',
    bullets: [
      '切换引擎前请先安装 CLI 工具。',
      '常用清单：claude-code / kiro-cli / opencode / cursor-cli / codex。',
      '引擎可用后再配模型，避免“模型可选但引擎不可用”。',
    ],
    notes: ['模型像大脑，引擎像腿。只长脑不长腿，走不远。'],
    steps: [
      { title: '检查 CLI 安装', detail: '先确认引擎工具已安装可执行。', cue: '目标：避免运行期才发现缺依赖' },
      { title: '切换默认引擎', detail: '设置系统默认引擎，便于统一行为。', cue: '目标：减少团队环境差异' },
      { title: '验证可用性', detail: '切换后做一次可用性检测和模型发现。', cue: '目标：先验证再宣传' },
      { title: '记录引擎策略', detail: '把“什么场景用什么引擎”沉淀为团队规则。', cue: '目标：稳定可复用' },
    ],
  },
  {
    key: 'agents',
    title: 'Agent 配置',
    subtitle: '角色分工与职责边界',
    icon: 'smart_toy',
    route: '/agents',
    eta: '90s',
    bullets: [
      'Agent 分工决定质量与协作效率。',
      '推荐从 Defender/Attacker/Judge 的小队开始。',
      '给角色清晰职责，比给角色更长名字有效。',
    ],
    notes: ['“全能 Agent”通常等于“没人负责”。'],
    steps: [
      { title: '建立角色边界', detail: '把实现、挑战、仲裁职责拆开。', cue: '目标：让每次输出可追责' },
      { title: '配置模型与引擎', detail: '按角色风险和成本设置默认模型。', cue: '目标：能力与预算平衡' },
      { title: '批量调整策略', detail: '支持批量替换模型，适合策略升级。', cue: '目标：降低运维摩擦' },
      { title: '观察协作效果', detail: '通过运行结果反推角色配置是否合理。', cue: '目标：配置不是一次性工作' },
    ],
  },
  {
    key: 'models',
    title: 'Model 配置',
    subtitle: '性能、成本与稳定性平衡',
    icon: 'neurology',
    route: '/models',
    eta: '75s',
    bullets: [
      '设置默认模型策略，再按任务细分。',
      '高风险任务优先稳定模型，日常问答可成本优先。',
      '注意模型与引擎兼容关系。',
    ],
    notes: ['预算管理不是抠门，是可持续。'],
    steps: [
      { title: '建立模型分层', detail: '区分默认模型、审查模型、经济模型。', cue: '目标：避免所有任务都“顶配”' },
      { title: '绑定引擎兼容', detail: '确保模型在当前引擎可用。', cue: '目标：减少运行失败' },
      { title: '维护模型清单', detail: '及时下线过期或低性价比模型。', cue: '目标：保持配置干净' },
      { title: '形成选型规则', detail: '把“何时选哪个模型”写进团队规范。', cue: '目标：让新人也能快速对齐' },
    ],
  },
  {
    key: 'skills',
    title: 'Skills 市场',
    subtitle: '能力扩展与开关管理',
    icon: 'extension',
    route: '/skills',
    eta: '60s',
    bullets: [
      'Skills 决定系统可调用的专项能力。',
      '支持直接导入从 skillsmp.com 下载的 Skills 压缩包（zip）。',
      '先启用高频技能，再逐步增加，避免配置膨胀。',
      '建议定期清理低使用率技能。',
    ],
    notes: [
      '技能包来源示例：https://skillsmp.com',
      '插件越多不等于越强，可能只是更热闹。',
    ],
    steps: [
      { title: '识别高频能力缺口', detail: '先找团队反复需要的能力，再导入技能。', cue: '目标：按需求扩展，不按热闹扩展' },
      { title: '导入 zip 技能包', detail: '可直接导入从 skillsmp.com 下载的压缩包。', cue: '目标：最快补齐短板能力' },
      { title: '启用与回归验证', detail: '导入后先在小任务验证，再放开使用。', cue: '目标：避免生产惊喜' },
      { title: '维护技能卫生', detail: '定期清理低使用率或冲突技能。', cue: '目标：减小上下文污染' },
    ],
  },
  {
    key: 'schedules',
    title: '定时任务',
    subtitle: '自动触发与周期执行',
    icon: 'schedule',
    route: '/schedules',
    eta: '60s',
    bullets: [
      '支持 interval/cron 触发。',
      '适合回归检查、日报生成等固定节奏任务。',
      '建议先用手动 trigger 验证，再开启自动执行。',
    ],
    notes: ['定时任务最大风险：你忘了它还在跑。'],
    steps: [
      { title: '先手动触发', detail: '创建后先手动 trigger 一次验证链路。', cue: '目标：先确保能跑通' },
      { title: '再设周期规则', detail: '选择 interval/cron 并标注用途。', cue: '目标：任务可理解可维护' },
      { title: '看启停状态', detail: '定时任务支持快速启停切换。', cue: '目标：异常时能立即止损' },
      { title: '建立复盘周期', detail: '定期清点失效或重复任务。', cue: '目标：防止僵尸任务堆积' },
    ],
  },
  {
    key: 'notebook',
    title: 'Notebook',
    subtitle: '文档化协作与可复用记录',
    icon: 'note_stack',
    route: '/notebook?notebook=1&notebookScope=global',
    eta: '90s',
    bullets: [
      '可把会话结果沉淀为 Notebook 文档。',
      '支持代码块、输出块和 AI 辅助编辑。',
      '团队/个人空间分离，便于权限管理。',
    ],
    notes: ['记录不是形式主义，是防止重复踩坑。'],
    steps: [
      { title: '沉淀会话成果', detail: '把关键对话和方案导出成 notebook。', cue: '目标：从聊天到资产化' },
      { title: '组织代码与输出块', detail: '代码块、输出块成对维护，便于回放。', cue: '目标：提高可复现性' },
      { title: '使用 AI 辅助编辑', detail: '支持选中代码块后解释/检视/加注释。', cue: '目标：提升文档质量' },
      { title: '管理共享权限', detail: '个人与团队空间隔离，分享带权限。', cue: '目标：协作与安全平衡' },
    ],
  },
  {
    key: 'account',
    title: '个人中心',
    subtitle: '账号资料与安全信息',
    icon: 'person',
    route: '/account',
    eta: '45s',
    bullets: [
      '维护个人资料、头像和账户信息。',
      '建议完善基础信息，便于协作识别。',
      '密码和邮箱变更入口也在这里。',
    ],
    notes: ['“默认头像 + 默认密码”通常是事故前兆。'],
    steps: [
      { title: '完善个人资料', detail: '确保用户名、头像、邮箱信息完整。', cue: '目标：团队可识别协作对象' },
      { title: '更新安全信息', detail: '按周期更新密码与恢复信息。', cue: '目标：账户安全可持续' },
      { title: '确认权限边界', detail: '普通成员注意可见与可改范围。', cue: '目标：避免越权操作' },
      { title: '同步个人偏好', detail: '整理常用视图和默认行为。', cue: '目标：减少重复操作' },
    ],
  },
  {
    key: 'systemSettings',
    title: '系统设置',
    subtitle: '全局配置与运行策略',
    icon: 'settings',
    route: '/account/system-settings',
    adminOnly: true,
    eta: '75s',
    bullets: [
      '管理员维护系统级默认策略。',
      '包括环境、引擎默认项与全局行为偏好。',
      '变更前建议保留配置快照。',
    ],
    notes: ['系统设置建议在清醒时改，别在周五晚上。'],
    steps: [
      { title: '确认全局策略', detail: '统一引擎/模型/环境变量默认规则。', cue: '目标：减少团队配置分裂' },
      { title: '变更前做快照', detail: '先备份关键配置，再执行修改。', cue: '目标：确保可回滚' },
      { title: '小范围验证', detail: '先在样例流程验证，再全局启用。', cue: '目标：降低变更风险' },
      { title: '记录变更原因', detail: '写明变更背景与影响范围。', cue: '目标：方便后续审计' },
    ],
  },
  {
    key: 'users',
    title: '用户管理',
    subtitle: '成员与权限控制',
    icon: 'group',
    route: '/users',
    adminOnly: true,
    eta: '60s',
    bullets: [
      '管理员可创建/更新/禁用用户。',
      '核心管理动作是为每个用户配置个人工作目录。',
      '用户目录建议独立，避免多人共享同一路径造成污染。',
    ],
    notes: ['目录不清晰，排障就会变成寻宝游戏。'],
    steps: [
      { title: '创建用户', detail: '录入 username/email/password 与基础信息。', cue: '目标：先有可登录账号' },
      { title: '配置个人工作目录', detail: '为每个用户设置 personalDir，避免目录冲突。', cue: '目标：隔离工作区，便于追踪' },
      { title: '核对目录可用性', detail: '确认个人目录已创建且可写。', cue: '目标：防止登录后才发现无法保存' },
      { title: '维护用户目录规范', detail: '统一命名规则，便于批量管理。', cue: '目标：规模化运维可持续' },
    ],
  },
  {
    key: 'apiDocs',
    title: 'API 文档',
    subtitle: '接口能力与参数速查',
    icon: 'api',
    route: '/api-docs',
    eta: '45s',
    bullets: [
      '快速检索接口路径、方法和请求示例。',
      '用于联调、自动化脚本和二次集成。',
      '建议按模块查阅，效率更高。',
    ],
    notes: ['文档是系统的“可恢复记忆”。'],
    steps: [
      { title: '先按模块定位', detail: '从 workflow/chat/engine 等模块切入。', cue: '目标：更快定位接口' },
      { title: '确认请求示例', detail: '核对 requestBody 与 query 参数。', cue: '目标：减少联调反复' },
      { title: '关注返回结构', detail: '提前处理 success/error 分支。', cue: '目标：前后端预期一致' },
      { title: '保持文档同步', detail: '路由变更后及时回写文档。', cue: '目标：文档可信' },
    ],
  },
];

function renderModulePanel(moduleKey: ModuleKey) {
  if (moduleKey === 'workflows') {
    return (
      <div className="rounded-xl border bg-card/60 p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Badge>阶段式</Badge>
          <Badge variant="secondary">状态机式</Badge>
          <Badge variant="outline">AI 引导式（演示）</Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="rounded-md border bg-background p-3 text-xs">文档区：方案与结论沉淀</div>
          <div className="rounded-md border bg-background p-3 text-xs">实时输出：流式日志与中间结果</div>
          <div className="rounded-md border bg-background p-3 text-xs">人工审核：Approve / Iterate 决策点</div>
        </div>
        <div className="rounded-lg border bg-black text-green-300 font-mono text-xs p-3 space-y-1 overflow-hidden">
          {[
            '[10:00:01] workflow: preparing context',
            '[10:00:03] blue-team: drafting fix proposal',
            '[10:00:06] red-team: generating challenge cases',
            '[10:00:09] judge: comparing verdict evidence',
            '[10:00:12] document panel: updating summary',
            '[10:00:15] checkpoint: waiting for human approval',
          ].map((line, idx) => (
            <motion.div
              key={line}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: [0.2, 1, 1], y: [6, 0, 0] }}
              transition={{ duration: 1.2, delay: idx * 0.12, repeat: Infinity, repeatDelay: 1.5 }}
              className="leading-5"
            >
              {line}
            </motion.div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <motion.div
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1.03, 1] }}
            transition={{ duration: 1.4, repeat: Infinity }}
            className="rounded-md border bg-emerald-500/10 p-2 text-xs text-center"
          >
            Approve（通过）
          </motion.div>
          <motion.div
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1.03, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, delay: 0.5 }}
            className="rounded-md border bg-amber-500/10 p-2 text-xs text-center"
          >
            Iterate（迭代）
          </motion.div>
        </div>
      </div>
    );
  }

  if (moduleKey === 'engines') {
    return (
      <div className="rounded-xl border bg-card/60 p-4 space-y-2">
        <Badge variant="secondary">引擎预装清单</Badge>
        {['claude-code', 'kiro-cli', 'opencode', 'cursor-cli', 'codex'].map((item) => (
          <div key={item} className="rounded-md border bg-background px-3 py-2 text-sm flex items-center justify-between">
            <span>{item}</span>
            <span className="text-xs text-muted-foreground">建议先安装</span>
          </div>
        ))}
      </div>
    );
  }

  if (moduleKey === 'home') {
    return (
      <div className="rounded-xl border bg-card/60 p-4 space-y-2">
        <Badge variant="secondary">首页模拟对话</Badge>
        <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">“帮我引导式创建一个修复流程”</div>
        <div className="rounded-lg border bg-primary/5 p-3 text-sm">机器人：收到。先模拟一遍流程，不真的干活。</div>
      </div>
    );
  }

  if (moduleKey === 'skills') {
    return (
      <div className="rounded-xl border bg-card/60 p-4 space-y-3">
        <Badge variant="secondary">Skills 导入说明</Badge>
        <div className="rounded-md border bg-background p-3 text-sm">
          可直接导入从 <a href="https://skillsmp.com" target="_blank" rel="noreferrer" className="underline underline-offset-2 text-primary">skillsmp.com</a> 下载的压缩包（zip）。
        </div>
        <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
          推荐流程：下载 zip → 在 Skills 页面执行导入 → 按需启用并验证。
        </div>
      </div>
    );
  }

  if (moduleKey === 'dashboard') {
    return (
      <div className="rounded-xl border bg-card/60 p-4 space-y-3">
        <Badge variant="secondary">控制台指标预览</Badge>
        <div className="grid grid-cols-2 gap-2">
          {['总运行', '成功率', '平均时长', '活跃进程'].map((k, i) => (
            <motion.div
              key={k}
              className="rounded-md border bg-background p-2 text-xs"
              animate={{ y: [0, -2, 0], opacity: [0.8, 1, 0.8] }}
              transition={{ duration: 1.6, delay: i * 0.15, repeat: Infinity }}
            >
              {k}
            </motion.div>
          ))}
        </div>
      </div>
    );
  }

  if (moduleKey === 'agents') {
    return (
      <div className="rounded-xl border bg-card/60 p-4 space-y-3">
        <Badge variant="secondary">Agent 协作节奏</Badge>
        <div className="space-y-2">
          {['Defender', 'Attacker', 'Judge'].map((role, idx) => (
            <motion.div
              key={role}
              className="rounded-md border bg-background px-3 py-2 text-sm"
              animate={{ x: [0, 6, 0] }}
              transition={{ duration: 1.8, delay: idx * 0.2, repeat: Infinity }}
            >
              {role}
            </motion.div>
          ))}
        </div>
      </div>
    );
  }

  if (moduleKey === 'models') {
    return (
      <div className="rounded-xl border bg-card/60 p-4 space-y-3">
        <Badge variant="secondary">模型策略热度</Badge>
        <div className="space-y-2">
          {[
            ['默认模型', '72%'],
            ['审查模型', '18%'],
            ['经济模型', '10%'],
          ].map(([name, percent], idx) => (
            <div key={name} className="space-y-1">
              <div className="flex items-center justify-between text-xs"><span>{name}</span><span>{percent}</span></div>
              <div className="h-2 rounded bg-muted overflow-hidden">
                <motion.div
                  className="h-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: percent }}
                  transition={{ duration: 1, delay: idx * 0.2, repeat: Infinity, repeatType: 'reverse', repeatDelay: 1.2 }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (moduleKey === 'schedules') {
    return (
      <div className="rounded-xl border bg-card/60 p-4 space-y-3">
        <Badge variant="secondary">定时任务脉冲</Badge>
        <div className="grid grid-cols-3 gap-2">
          {['日报', '巡检', '回归'].map((job, idx) => (
            <motion.div
              key={job}
              className="rounded-md border bg-background p-2 text-xs text-center"
              animate={{ scale: [1, 1.07, 1] }}
              transition={{ duration: 1.4, delay: idx * 0.2, repeat: Infinity }}
            >
              {job}
            </motion.div>
          ))}
        </div>
      </div>
    );
  }

  if (moduleKey === 'notebook') {
    return (
      <div className="rounded-xl border bg-card/60 p-4 space-y-3">
        <Badge variant="secondary">Notebook 块级演示</Badge>
        <motion.div
          className="rounded-md border bg-background p-3 text-xs"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.8, repeat: Infinity }}
        >
          # 分析结论
        </motion.div>
        <motion.div
          className="rounded-md border bg-black text-green-300 p-3 text-xs font-mono"
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 1.6, repeat: Infinity }}
        >
          println("cell output preview")
        </motion.div>
      </div>
    );
  }

  if (moduleKey === 'account') {
    return (
      <div className="rounded-xl border bg-card/60 p-4 space-y-3">
        <Badge variant="secondary">个人资料状态</Badge>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {['用户名', '邮箱', '头像', '密码'].map((f, idx) => (
            <motion.div
              key={f}
              className="rounded-md border bg-background p-2"
              animate={{ borderColor: ['hsl(var(--border))', 'hsl(var(--primary) / 0.4)', 'hsl(var(--border))'] }}
              transition={{ duration: 2, delay: idx * 0.15, repeat: Infinity }}
            >
              {f}
            </motion.div>
          ))}
        </div>
      </div>
    );
  }

  if (moduleKey === 'systemSettings') {
    return (
      <div className="rounded-xl border bg-card/60 p-4 space-y-3">
        <Badge variant="secondary">系统设置变更窗口</Badge>
        <div className="rounded-md border bg-background p-3 text-xs">
          <motion.div
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            变更前快照 ✓
          </motion.div>
          <motion.div
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, delay: 0.5, repeat: Infinity }}
          >
            小范围验证 ✓
          </motion.div>
        </div>
      </div>
    );
  }

  if (moduleKey === 'users') {
    return (
      <div className="rounded-xl border bg-card/60 p-4 space-y-3">
        <Badge variant="secondary">用户目录配置</Badge>
        <div className="space-y-2 text-xs">
          {['alice -> /workspace/alice', 'bob -> /workspace/bob', 'charlie -> /workspace/charlie'].map((line, idx) => (
            <motion.div
              key={line}
              className="rounded-md border bg-background p-2 font-mono"
              animate={{ x: [0, 4, 0] }}
              transition={{ duration: 1.4, delay: idx * 0.15, repeat: Infinity }}
            >
              {line}
            </motion.div>
          ))}
        </div>
      </div>
    );
  }

  if (moduleKey === 'apiDocs') {
    return (
      <div className="rounded-xl border bg-card/60 p-4 space-y-3">
        <Badge variant="secondary">API 检索演示</Badge>
        <div className="rounded-md border bg-background p-3 text-xs font-mono overflow-hidden">
          <motion.div animate={{ y: [0, -32, 0] }} transition={{ duration: 2.6, repeat: Infinity }}>
            GET /api/workflow/status{'\n'}
            POST /api/chat/stream{'\n'}
            GET /api/engine/models?engine=opencode
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card/60 p-4">
      <div className="text-sm text-muted-foreground">该模块为流程讲解模式，建议点击“前往页面”结合真实界面查看。</div>
    </div>
  );
}

export function StoryOnboarding({
  open,
  role,
  initialProgress,
  loadingProgress,
  onPersist,
  onClose,
}: StoryOnboardingProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<OnboardingProgressPayload['phase']>('intro');
  const [navDir, setNavDir] = useState<1 | -1>(1);
  const [introIndex, setIntroIndex] = useState(0);
  const [selectedModule, setSelectedModule] = useState<ModuleKey>('home');
  const [visited, setVisited] = useState<Set<ModuleKey>>(new Set());
  const [moduleStepIndex, setModuleStepIndex] = useState(0);
  const [maximized, setMaximized] = useState(false);
  const [memberChecks, setMemberChecks] = useState<MemberChecks>({
    homeGuideDone: false,
    engineModelDone: false,
    notebookDone: false,
    personalDirConfirm: false,
  });
  const [adminChecks, setAdminChecks] = useState<AdminChecks>({
    engineReady: false,
    defaultModel: false,
    agentGroup: false,
    personalDirReady: false,
  });
  const [adminRows, setAdminRows] = useState<AdminProgressRow[]>([]);
  const [adminReportLoading, setAdminReportLoading] = useState(false);
  const [adminReportError, setAdminReportError] = useState<string | null>(null);
  const [skipPopoverOpen, setSkipPopoverOpen] = useState(false);

  const visibleModules = useMemo(() => MODULES.filter((m) => !m.adminOnly || role === 'admin'), [role]);
  const safeSelectedModule = visibleModules.some((m) => m.key === selectedModule)
    ? selectedModule
    : visibleModules[0]?.key || 'home';
  const selected = visibleModules.find((m) => m.key === safeSelectedModule) || visibleModules[0];

  useEffect(() => {
    if (!open || !initialProgress) return;
    setPhase(initialProgress.phase || 'intro');
    setIntroIndex(Math.max(0, initialProgress.introIndex || 0));
    setSelectedModule(initialProgress.selectedModule || 'home');
    setModuleStepIndex(Math.max(0, initialProgress.moduleStepIndex || 0));
    setVisited(new Set((initialProgress.visitedModules || []) as ModuleKey[]));
    setMemberChecks({
      homeGuideDone: Boolean(initialProgress.memberChecks?.homeGuideDone),
      engineModelDone: Boolean(initialProgress.memberChecks?.engineModelDone),
      notebookDone: Boolean(initialProgress.memberChecks?.notebookDone),
      personalDirConfirm: Boolean(initialProgress.memberChecks?.personalDirConfirm),
    });
    setAdminChecks({
      engineReady: Boolean(initialProgress.adminChecks?.engineReady),
      defaultModel: Boolean(initialProgress.adminChecks?.defaultModel),
      agentGroup: Boolean(initialProgress.adminChecks?.agentGroup),
      personalDirReady: Boolean(initialProgress.adminChecks?.personalDirReady),
    });
    setMaximized(Boolean(initialProgress.maximized));
  }, [open, initialProgress]);

  const allAdminDone = adminChecks.engineReady && adminChecks.defaultModel && adminChecks.agentGroup && adminChecks.personalDirReady;
  const allMemberDone =
    memberChecks.homeGuideDone &&
    memberChecks.engineModelDone &&
    memberChecks.notebookDone &&
    memberChecks.personalDirConfirm;
  const allDoneForRole = allMemberDone && (role !== 'admin' || allAdminDone);

  const buildProgressPayload = useCallback(
    (done = false): OnboardingProgressPayload => ({
      done,
      phase: done ? 'done' : phase,
      introIndex,
      selectedModule: safeSelectedModule,
      moduleStepIndex,
      visitedModules: Array.from(visited),
      memberChecks,
      adminChecks,
      maximized,
    }),
    [phase, introIndex, safeSelectedModule, moduleStepIndex, visited, memberChecks, adminChecks, maximized],
  );

  useEffect(() => {
    if (!open || !onPersist) return;
    const timer = window.setTimeout(() => {
      void onPersist(buildProgressPayload(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, onPersist, buildProgressPayload]);

  const loadAdminReport = useCallback(async () => {
    if (role !== 'admin') return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
    if (!token) return;
    setAdminReportLoading(true);
    setAdminReportError(null);
    try {
      const res = await fetch('/api/onboarding/admin/progress', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || '加载失败');
      }
      const data = await res.json();
      setAdminRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (error: any) {
      setAdminReportError(error?.message || '加载失败');
    } finally {
      setAdminReportLoading(false);
    }
  }, [role]);

  const moveModule = (delta: -1 | 1) => {
    if (!selected) return;
    const idx = visibleModules.findIndex((m) => m.key === selected.key);
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= visibleModules.length) return;
    const next = visibleModules[nextIdx];
    setSelectedModule(next.key);
    setVisited((prev) => new Set(prev).add(next.key));
    setModuleStepIndex(0);
  };

  const currentStep = selected?.steps[Math.max(0, Math.min(moduleStepIndex, (selected?.steps.length || 1) - 1))];
  const goPhase = (
    next: 'intro' | 'overview' | 'module' | 'member' | 'admin' | 'adminReport' | 'done',
    dir: 1 | -1 = 1,
  ) => {
    setNavDir(dir);
    setPhase(next);
    if (next === 'adminReport') void loadAdminReport();
  };
  const startGuidedTour = () => {
    const first = visibleModules[0]?.key || 'home';
    setSelectedModule(first);
    setVisited((prev) => new Set(prev).add(first));
    setModuleStepIndex(0);
    goPhase('module', 1);
  };
  const handleSkip = useCallback(async (neverShowAgain: boolean) => {
    if (neverShowAgain) {
      if (onPersist) {
        await onPersist(buildProgressPayload(true), { markCompleted: true });
      }
      onClose(true);
      return;
    }

    onClose(false);
  }, [onPersist, buildProgressPayload, onClose]);
  const pageMotion = {
    initial: (dir: 1 | -1) => ({ opacity: 0, x: dir > 0 ? 36 : -36, scale: 0.985 }),
    animate: { opacity: 1, x: 0, scale: 1 },
    exit: (dir: 1 | -1) => ({ opacity: 0, x: dir > 0 ? -36 : 36, scale: 0.985 }),
  };

  if (!open || !selected) return null;

  const panelPosition = maximized ? 'fixed inset-4 z-[120] pointer-events-none' : 'fixed right-4 bottom-4 z-[120] w-[min(92vw,980px)] pointer-events-none';
  const panelBox = maximized
    ? 'rounded-2xl border bg-background/95 shadow-2xl overflow-hidden flex flex-col h-full pointer-events-auto'
    : 'rounded-2xl border bg-background/95 shadow-2xl overflow-hidden flex flex-col max-h-[88vh] pointer-events-auto';

  return (
    <div className={panelPosition}>
      <div className={panelBox}>
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="text-sm text-muted-foreground">Onboarding / 全模块剧情引导</div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">已浏览 {visited.size}/{visibleModules.length}</Badge>
            <Button variant="ghost" size="sm" onClick={() => setMaximized((v) => !v)} title={maximized ? '缩小' : '放大'}>
              <span className="material-symbols-outlined text-base">{maximized ? 'close_fullscreen' : 'open_in_full'}</span>
            </Button>
            <Popover open={skipPopoverOpen} onOpenChange={setSkipPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm">跳过</Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 space-y-3">
                <div>
                  <div className="text-sm font-medium">跳过引导</div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    这次只是关闭，还是以后不再自动弹出？
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setSkipPopoverOpen(false);
                      void handleSkip(false);
                    }}
                  >
                    本次关闭
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSkipPopoverOpen(false);
                      void handleSkip(true);
                    }}
                  >
                    不再弹出
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[280px_1fr]">
          <div className="border-r p-4 bg-muted/20 overflow-y-auto">
            <div className="mx-auto flex h-36 w-36 items-center justify-center rounded-2xl border bg-gradient-to-b from-white to-slate-100 shadow-sm dark:from-slate-100 dark:to-slate-200">
              <motion.img
                src="/images/robot.svg"
                alt="robot"
                className="h-28 w-28 drop-shadow-[0_8px_16px_rgba(0,0,0,0.28)]"
                animate={{ y: [0, -6, 0], rotate: [0, 1.5, -1.5, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>
            <div className="mt-4 rounded-xl border bg-background p-3 text-sm leading-6">
              {phase === 'intro' && <>{INTRO_STEPS[introIndex]?.text}</>}
              {phase === 'overview' && <>这是全模块地图。短路径先走，细节按需补课。</>}
              {phase === 'module' && <>当前模块：{selected.title}。你可以边看边跳转对应页面。</>}
              {phase === 'member' && <>团队成员必做项。做完这套，日常协作基本不会掉队。</>}
              {phase === 'admin' && <>管理员专属核对项。配置好以后，后面会轻松很多。</>}
              {phase === 'adminReport' && <>这里能看到每个成员的引导完成情况，便于补齐培训。</>}
              {phase === 'done' && <>引导完成。你现在具备“低慌张运行”能力。</>}
            </div>
          </div>

          <div className="p-5 overflow-y-auto">
            {loadingProgress && <div className="text-xs text-muted-foreground mb-2">正在同步上次引导进度...</div>}
            <AnimatePresence mode="wait" custom={navDir}>
              {phase === 'intro' && (
                <motion.div
                  key={`intro-${introIndex}`}
                  custom={navDir}
                  variants={pageMotion}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.24, ease: 'easeOut' }}
                  className="space-y-4"
                >
                  <h2 className="text-2xl font-bold">{INTRO_STEPS[introIndex]?.title}</h2>
                  <p className="text-muted-foreground">{INTRO_STEPS[introIndex]?.text}</p>
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      disabled={introIndex === 0}
                      onClick={() => setIntroIndex((v) => Math.max(0, v - 1))}
                    >
                      上一幕
                    </Button>
                    <Button variant="outline" onClick={() => goPhase('overview', 1)}>直接看模块地图</Button>
                    <Button
                      onClick={() => {
                        if (introIndex >= INTRO_STEPS.length - 1) startGuidedTour();
                        else setIntroIndex((v) => v + 1);
                      }}
                    >
                      {introIndex >= INTRO_STEPS.length - 1 ? '进入主线引导' : '下一幕'}
                    </Button>
                  </div>
                </motion.div>
              )}

              {phase === 'overview' && (
                <motion.div key="overview" custom={navDir} variants={pageMotion} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.24, ease: 'easeOut' }} className="space-y-4">
                  <h2 className="text-2xl font-bold">模块地图</h2>
                  <p className="text-muted-foreground">覆盖核心能力、配置能力和运维能力。先主线，再分线。</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {visibleModules.map((item) => {
                      const done = visited.has(item.key);
                      return (
                        <button
                          key={item.key}
                          className="rounded-xl border p-4 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors"
                          onClick={() => {
                            setSelectedModule(item.key);
                            setVisited((prev) => new Set(prev).add(item.key));
                            goPhase('module', 1);
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 font-semibold">
                              <span className="material-symbols-outlined text-base">{item.icon}</span>
                              {item.title}
                            </div>
                            {done && <span className="material-symbols-outlined text-green-500 text-base">check_circle</span>}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">{item.subtitle}</div>
                          <div className="text-[11px] text-muted-foreground mt-2">预计 {item.eta}</div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="pt-2 flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => goPhase('intro', -1)}>返回上一幕</Button>
                    <Button onClick={() => goPhase('member', 1)}>团队成员必做项</Button>
                    {role === 'admin' && <Button variant="outline" onClick={() => goPhase('admin', 1)}>管理员必做项</Button>}
                    {role === 'admin' && <Button variant="outline" onClick={() => goPhase('adminReport', 1)}>查看完成情况</Button>}
                    <Button variant="outline" onClick={() => goPhase('done', 1)}>先到这里，我去实操</Button>
                  </div>
                </motion.div>
              )}

              {phase === 'module' && currentStep && (
                <motion.div key={`module-${selected.key}`} custom={navDir} variants={pageMotion} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.24, ease: 'easeOut' }} className="space-y-4">
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold">{selected.title}</h2>
                    <Badge variant="secondary">ETA {selected.eta}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {visibleModules.map((item) => (
                      <Button
                        key={item.key}
                        size="sm"
                        variant={item.key === selected.key ? 'default' : 'outline'}
                        onClick={() => {
                          setSelectedModule(item.key);
                          setVisited((prev) => new Set(prev).add(item.key));
                          setModuleStepIndex(0);
                        }}
                      >
                        {item.title}
                      </Button>
                    ))}
                  </div>
                  <p className="text-muted-foreground">{selected.subtitle}</p>
                  {renderModulePanel(selected.key)}
                  <div className="space-y-2 text-sm">
                    {selected.bullets.map((b) => (
                      <div key={b} className="leading-6">- {b}</div>
                    ))}
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">模块详细步骤</div>
                      <Badge variant="outline">Step {moduleStepIndex + 1}/{selected.steps.length}</Badge>
                    </div>
                    <div className="rounded-lg border bg-background p-3">
                      <div className="font-medium">{currentStep.title}</div>
                      <div className="text-sm text-muted-foreground mt-1">{currentStep.detail}</div>
                      <div className="text-xs text-primary mt-2">执行提示：{currentStep.cue}</div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        disabled={moduleStepIndex === 0}
                        onClick={() => setModuleStepIndex((v) => Math.max(0, v - 1))}
                      >
                        上一步
                      </Button>
                      <Button
                        variant="outline"
                        disabled={moduleStepIndex >= selected.steps.length - 1}
                        onClick={() => setModuleStepIndex((v) => Math.min(selected.steps.length - 1, v + 1))}
                      >
                        下一步
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {selected.notes.map((n) => (
                      <div key={n}>• {n}</div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button variant="outline" onClick={() => goPhase('overview', -1)}>返回模块地图</Button>
                    <Button
                      variant="outline"
                      disabled={visibleModules.findIndex((m) => m.key === selected.key) <= 0}
                      onClick={() => moveModule(-1)}
                    >
                      上一模块
                    </Button>
                    <Button
                      variant="outline"
                      disabled={visibleModules.findIndex((m) => m.key === selected.key) >= visibleModules.length - 1}
                      onClick={() => moveModule(1)}
                    >
                      下一模块
                    </Button>
                    {selected.route && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          router.push(selected.route!);
                        }}
                      >
                        前往页面查看
                      </Button>
                    )}
                    <Button onClick={() => goPhase('member', 1)}>完成全部引导</Button>
                  </div>
                </motion.div>
              )}

              {phase === 'member' && (
                <motion.div key="member" custom={navDir} variants={pageMotion} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.24, ease: 'easeOut' }} className="space-y-4">
                  <h2 className="text-2xl font-bold">团队成员必做项（建议首日完成）</h2>
                  <p className="text-muted-foreground">这是操作清单模式，用于确保每个成员都完成最低可用闭环。</p>
                  <div className="space-y-2">
                    {[
                      ['homeGuideDone', '完成首页引导式对话演练（至少一次）'],
                      ['engineModelDone', '了解并确认默认引擎 / 模型切换规则'],
                      ['notebookDone', '完成 Notebook 代码块 AI 操作演练（问AI/解释代码/AI检视/添加注释）'],
                      ['personalDirConfirm', '确认个人工作目录配置正确且可写'],
                    ].map(([k, label]) => (
                      <label key={k} className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(memberChecks[k as keyof MemberChecks])}
                          onChange={(e) => setMemberChecks((prev) => ({ ...prev, [k]: e.target.checked }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2 flex-wrap">
                    <Button variant="outline" onClick={() => goPhase('overview', -1)}>返回模块地图</Button>
                    {role === 'admin' && <Button variant="outline" onClick={() => goPhase('admin', 1)}>继续管理员必做项</Button>}
                    <Button disabled={!allMemberDone} onClick={() => goPhase(role === 'admin' ? 'admin' : 'done', 1)}>进入下一步</Button>
                  </div>
                </motion.div>
              )}

              {phase === 'admin' && (
                <motion.div key="admin" custom={navDir} variants={pageMotion} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.24, ease: 'easeOut' }} className="space-y-4">
                  <h2 className="text-2xl font-bold">管理员必做项（建议首日完成）</h2>
                  <p className="text-muted-foreground">此处为演示核对项，不会写入真实配置。</p>
                  <div className="space-y-2">
                    {[
                      ['engineReady', '确认引擎工具预装完成（claude-code / kiro-cli / opencode / cursor-cli / codex）'],
                      ['defaultModel', '确认默认模型策略（稳定优先）'],
                      ['agentGroup', '确认基础 Agent 角色分组（Defender / Attacker / Judge）'],
                      ['personalDirReady', '为用户配置个人工作目录（个人空间必需）'],
                    ].map(([k, label]) => (
                      <label key={k} className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(adminChecks[k as keyof AdminChecks])}
                          onChange={(e) => setAdminChecks((prev) => ({ ...prev, [k]: e.target.checked }))}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2 flex-wrap">
                    <Button variant="outline" onClick={() => goPhase('member', -1)}>返回团队成员必做项</Button>
                    <Button variant="outline" onClick={() => goPhase('adminReport', 1)}>查看用户完成情况</Button>
                    <Button disabled={!allAdminDone || !allMemberDone} onClick={() => goPhase('done', 1)}>完成引导</Button>
                  </div>
                </motion.div>
              )}

              {phase === 'adminReport' && (
                <motion.div key="adminReport" custom={navDir} variants={pageMotion} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.24, ease: 'easeOut' }} className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-2xl font-bold">用户引导完成情况</h2>
                    <Button variant="outline" onClick={() => void loadAdminReport()}>刷新</Button>
                  </div>
                  <p className="text-muted-foreground">管理员可查看全部成员的引导进度，重点跟进未完成和停滞用户。</p>
                  {adminReportError && <div className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{adminReportError}</div>}
                  <div className="rounded-xl border overflow-auto">
                    <table className="w-full text-sm min-w-[760px]">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="text-left px-3 py-2">用户</th>
                          <th className="text-left px-3 py-2">角色</th>
                          <th className="text-left px-3 py-2">个人工作目录</th>
                          <th className="text-left px-3 py-2">状态</th>
                          <th className="text-left px-3 py-2">当前阶段</th>
                          <th className="text-left px-3 py-2">更新时间</th>
                          <th className="text-left px-3 py-2">完成时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminReportLoading ? (
                          <tr>
                            <td className="px-3 py-3 text-muted-foreground" colSpan={7}>加载中...</td>
                          </tr>
                        ) : adminRows.length === 0 ? (
                          <tr>
                            <td className="px-3 py-3 text-muted-foreground" colSpan={7}>暂无记录</td>
                          </tr>
                        ) : (
                          adminRows.map((row) => (
                            <tr key={row.userId} className="border-t">
                              <td className="px-3 py-2">
                                <div className="font-medium">{row.username}</div>
                                <div className="text-xs text-muted-foreground">{row.email}</div>
                              </td>
                              <td className="px-3 py-2">{row.role === 'admin' ? '管理员' : '成员'}</td>
                              <td className="px-3 py-2 font-mono text-xs">{row.personalDir || '-'}</td>
                              <td className="px-3 py-2">{row.done ? '已完成' : '进行中'}</td>
                              <td className="px-3 py-2">{row.phase || '-'}</td>
                              <td className="px-3 py-2">{row.updatedAt ? new Date(row.updatedAt).toLocaleString() : '-'}</td>
                              <td className="px-3 py-2">{row.completedAt ? new Date(row.completedAt).toLocaleString() : '-'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" onClick={() => goPhase('overview', -1)}>返回模块地图</Button>
                    <Button variant="outline" onClick={() => goPhase('admin', -1)}>返回管理员必做项</Button>
                  </div>
                </motion.div>
              )}

              {phase === 'done' && (
                <motion.div key="done" custom={navDir} variants={pageMotion} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.24, ease: 'easeOut' }} className="space-y-4">
                  <h2 className="text-2xl font-bold">引导完成</h2>
                  <p className="text-muted-foreground">你已经完成全模块认知。下一步建议先执行一个小规模工作流实操，再逐步扩大复杂度。</p>
                  {!allDoneForRole && (
                    <div className="rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                      必做项未全部勾选。请先完成团队成员必做项{role === 'admin' ? '和管理员必做项' : ''}。
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      disabled={!allDoneForRole}
                      onClick={async () => {
                        if (onPersist) {
                          await onPersist(buildProgressPayload(true), { markCompleted: true });
                        }
                        onClose(true);
                      }}
                    >
                      开始使用
                    </Button>
                    <Button variant="outline" onClick={() => goPhase('overview', -1)}>回到模块地图</Button>
                    <Button variant="outline" onClick={() => goPhase('member', -1)}>回到必做项</Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIntroIndex(0);
                        goPhase('intro', -1);
                      }}
                    >
                      重新开始引导
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
