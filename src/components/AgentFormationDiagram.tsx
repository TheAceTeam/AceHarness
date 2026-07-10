'use client';

import { memo, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Star } from 'lucide-react';
import SpriteAvatar from '@/components/SpriteAvatar';
import { Badge } from './ui/badge';
import { cn } from '@/lib/core/utils';
import { resolveAgentAvatarSrc, type AgentAvatarConfig, type AgentRoleType, type AgentTeam } from '@/lib/agent/personas';
import { pickSpriteAvatarValue } from '@/lib/avatar/sprite';
import type { StateMachineState } from '@/lib/core/schemas';

type FormationAgent = {
  name: string;
  team?: AgentTeam;
  roleType?: AgentRoleType;
  avatar?: AgentAvatarConfig | string | null;
};

interface AgentFormationDiagramProps {
  states: StateMachineState[];
  agents: FormationAgent[];
  supervisorAgent?: string | null;
  currentStep?: string | null;
  activeSteps?: string[];
  status?: 'idle' | 'running' | 'completed' | 'failed' | 'waiting' | 'stopped';
  className?: string;
}

type FormationCardData = FormationAgent & {
  isSupervisor?: boolean;
  isActive: boolean;
  activeStep?: string | null;
  status?: AgentFormationDiagramProps['status'];
};

function normalizeStepKeyVariants(stateName: string, stepName: string): string[] {
  return [
    stepName,
    `${stateName}-${stepName}`,
    `state:${stateName}#${stepName}`,
  ];
}

function buildActiveStepMap(
  states: StateMachineState[],
  currentStep?: string | null,
  activeSteps: string[] = []
): Map<string, string> {
  const activeKeys = new Set<string>([...activeSteps, currentStep || ''].filter(Boolean));
  const map = new Map<string, string>();

  for (const state of states) {
    for (const step of state.steps || []) {
      const stepName = String(step.name || '').trim();
      const baseStepName = stepName.replace(/-迭代\d+$/, '');
      const variants = normalizeStepKeyVariants(state.name, stepName);
      const isActive = variants.some((key) => activeKeys.has(key))
        || Array.from(activeKeys).some((key) => (
          key === baseStepName
          || key.startsWith(`${stepName}-迭代`)
          || key.startsWith(`${baseStepName}-迭代`)
          || key.endsWith(`-${stepName}`)
          || key.endsWith(`-${baseStepName}`)
        ));
      if (isActive && step.agent) map.set(step.agent, stepName);
    }
  }

  return map;
}

function getTeamTone(team: AgentTeam, isSupervisor?: boolean) {
  if (isSupervisor || team === 'black-gold') {
    return {
      status: 'bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.38)]',
      ring: 'ring-amber-400/45',
      tag: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-200',
      hoverText: 'group-hover:text-amber-600 dark:group-hover:text-amber-300',
      aura: 'bg-amber-400/12',
      accent: 'border-amber-300/50',
    };
  }
  if (team === 'red') {
    return {
      status: 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.32)]',
      ring: 'ring-rose-400/35',
      tag: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-200',
      hoverText: 'group-hover:text-rose-600 dark:group-hover:text-rose-300',
      aura: 'bg-rose-400/10',
      accent: 'border-rose-300/45',
    };
  }
  if (team === 'judge') {
    return {
      status: 'bg-violet-500 shadow-[0_0_12px_rgba(139,92,246,0.32)]',
      ring: 'ring-violet-400/35',
      tag: 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-200',
      hoverText: 'group-hover:text-violet-600 dark:group-hover:text-violet-300',
      aura: 'bg-violet-400/10',
      accent: 'border-violet-300/45',
    };
  }
  return {
    status: 'bg-cyan-500 shadow-[0_0_12px_rgba(8,145,178,0.32)]',
    ring: 'ring-cyan-400/35',
    tag: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200',
    hoverText: 'group-hover:text-cyan-700 dark:group-hover:text-cyan-300',
    aura: 'bg-cyan-400/10',
    accent: 'border-cyan-300/45',
  };
}

function resolveStatusText(card: FormationCardData) {
  if (card.isSupervisor) {
    if (card.status === 'waiting') return '等待人工';
    if (card.status === 'failed') return '调度异常';
    if (card.isActive) return '指挥中';
    return '待命';
  }
  if (card.isActive) return '执行中';
  if (card.status === 'completed') return '已收束';
  return '待命';
}

function resolveStableFormationAvatar(
  avatar: AgentAvatarConfig | string | null | undefined,
  stableSeed: string,
  options: { team: AgentTeam; roleType: AgentRoleType }
) {
  if (typeof avatar === 'string' && avatar.trim()) {
    return resolveAgentAvatarSrc(avatar, stableSeed, options);
  }
  if (avatar && typeof avatar === 'object') {
    if (
      avatar.mode === 'uploaded'
      || avatar.mode === 'generated'
      || avatar.mode === 'sprite'
      || avatar.mode === 'preset'
    ) {
      return resolveAgentAvatarSrc(avatar, stableSeed, options);
    }
  }
  return pickSpriteAvatarValue(stableSeed, { category: 'agent-default' });
}

function buildCards(
  agents: FormationAgent[],
  states: StateMachineState[],
  supervisorAgent?: string | null,
  currentStep?: string | null,
  activeSteps: string[] = [],
  status?: AgentFormationDiagramProps['status']
) {
  const activeStepMap = buildActiveStepMap(states, currentStep, activeSteps);
  const supervisorName = supervisorAgent || agents.find((agent) => agent.roleType === 'supervisor')?.name || 'Supervisor';
  const supervisorConfig = agents.find((agent) => agent.name === supervisorName);
  const supervisor: FormationCardData = {
    name: supervisorName,
    team: supervisorConfig?.team || 'black-gold',
    roleType: 'supervisor',
    avatar: supervisorConfig?.avatar,
    isSupervisor: true,
    isActive: status === 'running' || status === 'waiting',
    activeStep: status === 'waiting' ? '等待人工回复' : null,
    status,
  };
  const workers = agents
    .filter((agent) => agent.name !== supervisorName)
    .map((agent): FormationCardData => ({
      ...agent,
      team: agent.team || 'blue',
      roleType: agent.roleType || 'normal',
      isActive: activeStepMap.has(agent.name),
      activeStep: activeStepMap.get(agent.name) || null,
      status,
    }));

  return { supervisor, workers };
}

const AgentProfileCard = memo(function AgentProfileCard({
  card,
  variant = 'worker',
}: {
  card: FormationCardData;
  variant?: 'supervisor' | 'worker';
}) {
  const tone = getTeamTone(card.team || 'blue', card.isSupervisor);
  const statusText = resolveStatusText(card);
  const tagLabel = card.isSupervisor ? 'Supervisor' : card.team || 'Agent';
  const isSupervisor = variant === 'supervisor';
  const stableAvatarSeed = `${card.name}:${card.team || 'blue'}:${card.roleType || 'normal'}`;
  const avatarSrc = resolveStableFormationAvatar(card.avatar, stableAvatarSeed, {
    team: card.team || 'blue',
    roleType: card.roleType || 'normal',
  });

  return (
    <motion.div
      initial={false}
      animate={{
        y: card.isActive ? -2 : 0,
      }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-white/70 bg-white p-3.5 text-center transition-all duration-200 dark:border-white/8 dark:bg-gray-800',
        'shadow-[0_8px_22px_rgba(15,23,42,0.08)]',
        'dark:shadow-[0_10px_24px_rgba(0,0,0,0.26)]',
        'hover:-translate-y-0.5 hover:border-cyan-300/45 hover:shadow-[0_12px_28px_rgba(15,23,42,0.12)]',
        'dark:hover:border-cyan-700/45 dark:hover:shadow-[0_12px_28px_rgba(0,0,0,0.32)]',
        card.isActive && 'ring-1 ring-cyan-400/45',
        isSupervisor ? 'w-[min(420px,100%)] text-left' : 'min-h-[176px] w-[176px]',
      )}
    >
      <div className={cn('pointer-events-none absolute -left-10 -top-10 h-24 w-24 rounded-full blur-2xl transition-opacity duration-300', tone.aura, card.isActive ? 'opacity-100' : 'opacity-55')} />

      <div className="absolute right-3.5 top-3.5 z-10">
        <div className="relative">
          <span className={cn('block h-2.5 w-2.5 rounded-full border-2 border-white transition-transform duration-200 group-hover:scale-110 dark:border-gray-800', card.isActive ? tone.status : 'bg-gray-400')} />
          {card.isActive ? <span className={cn('absolute inset-0 h-2.5 w-2.5 animate-ping rounded-full opacity-20', tone.status)} /> : null}
        </div>
      </div>

      {card.isSupervisor ? (
        <div className="absolute right-3.5 top-9 z-10 rounded-full bg-amber-500 p-1 shadow-[0_0_12px_rgba(245,158,11,0.24)] transition-transform duration-200 group-hover:rotate-12 group-hover:scale-105">
          <Star className="h-3 w-3 fill-white text-white" />
        </div>
      ) : null}

      <div className={cn('relative z-10', isSupervisor ? 'flex items-center gap-3 pr-10 text-left' : 'mb-3 flex justify-center')}>
        <div className="relative">
          <div className={cn(
            'shrink-0',
            'overflow-hidden rounded-full bg-white p-1 transition-transform duration-200 dark:bg-gray-700',
            isSupervisor ? 'h-16 w-16' : 'h-14 w-14',
            'shadow-[inset_4px_4px_8px_rgba(15,23,42,0.08),inset_-4px_-4px_8px_rgba(255,255,255,0.88)]',
            'dark:shadow-[inset_4px_4px_8px_rgba(0,0,0,0.26),inset_-4px_-4px_8px_rgba(255,255,255,0.055)]',
          )}>
            <SpriteAvatar
              avatar={avatarSrc}
              seed={stableAvatarSeed}
              category="agent-default"
              alt={card.name}
              fallback={card.name.charAt(0).toUpperCase()}
              className={cn('h-full w-full rounded-full ring-2', card.isActive ? 'ring-cyan-500/70' : tone.ring)}
              fallbackClassName="bg-primary/10 text-sm font-semibold text-primary"
            />
          </div>
          <div className={cn('absolute inset-0 rounded-full border-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100', tone.accent)} />
        </div>

        <div className={cn('relative z-10 min-w-0', isSupervisor ? 'flex-1' : '')}>
          <h3 className={cn('break-words text-sm font-semibold leading-5 text-gray-950 transition-colors duration-200 dark:text-gray-100', tone.hoverText)}>
            {card.name}
          </h3>
          <p className="mt-1 text-xs text-gray-500 transition-colors duration-300 dark:text-gray-400">
            {statusText}
          </p>
        </div>
      </div>

      <div className={cn('relative z-10 mt-3 flex gap-2', isSupervisor ? 'pl-[76px] justify-start' : 'justify-center')}>
        <Badge variant="outline" className={cn('text-[10px]', tone.tag)}>
          {tagLabel}
        </Badge>
        {card.isActive ? (
          <Badge variant="outline" className="border-cyan-500/25 bg-cyan-500/10 text-[10px] text-cyan-700 dark:text-cyan-200">
            Active
          </Badge>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {card.activeStep ? (
          <motion.div
            key={card.activeStep}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative z-10 mt-3 rounded-xl border border-cyan-500/14 bg-cyan-500/[0.06] px-3 py-2 text-left"
          >
            <div className="text-[10px] font-medium text-cyan-700 dark:text-cyan-300">当前步骤</div>
            <div className="mt-0.5 truncate text-xs font-semibold text-gray-950 dark:text-gray-100">{card.activeStep}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="pointer-events-none absolute inset-0 rounded-2xl border border-cyan-200/0 transition-colors duration-200 group-hover:border-cyan-300/36 dark:group-hover:border-cyan-700/36" />
    </motion.div>
  );
});

export default function AgentFormationDiagram(props: AgentFormationDiagramProps) {
  const cards = useMemo(
    () => buildCards(props.agents, props.states, props.supervisorAgent, props.currentStep, props.activeSteps, props.status),
    [props.agents, props.states, props.supervisorAgent, props.currentStep, props.activeSteps, props.status]
  );

  if (props.agents.length === 0) {
    return (
      <div className="flex h-full min-h-[clamp(420px,46vh,620px)] items-center justify-center rounded-2xl border border-dashed border-border bg-background text-sm text-muted-foreground">
        当前没有可展示的 Agent 编队
      </div>
    );
  }

  return (
    <div className={cn('h-full w-full overflow-auto rounded-2xl bg-gray-100 p-5 dark:bg-gray-900', props.className || 'min-h-[clamp(420px,46vh,620px)]')}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <div className="flex justify-center">
          <AgentProfileCard card={cards.supervisor} variant="supervisor" />
        </div>

        <div
          className="grid justify-center gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, 176px)' }}
        >
          {cards.workers.map((card) => (
            <AgentProfileCard key={card.name} card={card} />
          ))}
        </div>
      </div>
    </div>
  );
}
