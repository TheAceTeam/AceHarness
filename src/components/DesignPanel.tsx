'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import SpriteAvatar from '@/components/SpriteAvatar';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';

interface Step {
  name: string;
  agent: string;
  task: string;
  role?: 'attacker' | 'defender' | 'judge';
  constraints?: string[];
  parallelGroup?: string;
}

interface Phase {
  name: string;
  steps: Step[];
  checkpoint?: { name: string; message: string };
  iteration?: { enabled: boolean; maxIterations: number; exitCondition: string; consecutiveCleanRounds: number; escalateToHuman: boolean };
}

interface Workflow {
  name: string;
  description?: string;
  phases: Phase[];
}

interface AgentAvatarSource {
  name?: string;
  avatar?: any;
  team?: any;
  roleType?: any;
}

interface DesignPanelProps {
  workflow: Workflow;
  availableAgents?: AgentAvatarSource[];
  onSelectNode: (type: 'phase' | 'step', phaseIndex: number, stepIndex?: number) => void;
  onAddPhase: (afterIndex: number) => void;
  onAddStep: (phaseIndex: number) => void;
  onAddStepAt: (phaseIndex: number, afterStepIndex: number) => void;
  onDeletePhase: (phaseIndex: number) => void;
  onDeleteStep: (phaseIndex: number, stepIndex: number) => void;
  onMoveStep: (phaseIndex: number, fromIndex: number, toIndex: number) => void;
  onToggleParallel: (phaseIndex: number, stepIndices: number[]) => void;
  onUngroup: (phaseIndex: number, stepIndex: number) => void;
  onCrossPhaseMove: (fromPhase: number, fromIndex: number, toPhase: number, toIndex: number) => void;
  onMoveGroup: (fromPhase: number, groupStartIndex: number, toPhase: number, toIndex: number) => void;
  onJoinGroup: (phaseIndex: number, stepIndex: number, groupId: string) => void;
}

const roleIcon: Record<string, string> = { attacker: 'swords', defender: 'shield', judge: 'balance' };
const roleColor: Record<string, string> = {
  attacker: 'border-l-blue-500',
  defender: 'border-l-red-500',
  judge: 'border-l-yellow-500',
};
const roleBadge: Record<string, string> = {
  attacker: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  defender: 'bg-red-500/15 text-red-600 dark:text-red-400',
  judge: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
};

function findAgentConfig(agents: AgentAvatarSource[] | undefined, agentName: string) {
  const normalizedName = agentName.trim();
  if (!normalizedName) return undefined;
  return agents?.find((agent) => agent?.name === normalizedName);
}

function StepAgentAvatar({
  agentName,
  availableAgents,
  className = 'h-4 w-4',
}: {
  agentName: string;
  availableAgents?: AgentAvatarSource[];
  className?: string;
}) {
  const displayName = agentName?.trim() || '未分配 Agent';
  const agent = findAgentConfig(availableAgents, displayName);
  const avatarSrc = resolveAgentAvatarSrc(agent?.avatar, displayName, {
    team: agent?.team,
    roleType: agent?.roleType,
  });

  return (
    <SpriteAvatar
      avatar={avatarSrc}
      seed={displayName}
      category="agent-default"
      alt={displayName}
      fallback={displayName.charAt(0).toUpperCase()}
      className={`${className} shrink-0 ring-1 ring-border/80`}
      fallbackClassName="bg-primary/10 text-[10px] font-semibold text-primary"
    />
  );
}

function StepAgentLabel({
  agentName,
  availableAgents,
}: {
  agentName: string;
  availableAgents?: AgentAvatarSource[];
}) {
  const displayName = agentName?.trim() || '未分配 Agent';
  return (
    <span className="inline-flex min-w-0 max-w-[180px] items-center gap-1.5">
      <StepAgentAvatar agentName={displayName} availableAgents={availableAgents} />
      <span className="truncate">{displayName}</span>
    </span>
  );
}

/* ─── Step Card (pure display) ─── */
interface StepCardProps {
  step: Step;
  availableAgents?: AgentAvatarSource[];
  dragHandleProps?: Record<string, any>;
  mergeActions?: React.ReactNode;
  onSelect: () => void;
  onDelete: () => void;
  isDragging?: boolean;
}

function StepCard({ step, availableAgents, dragHandleProps, mergeActions, onSelect, onDelete, isDragging }: StepCardProps) {
  const role = step.role || 'defender';
  return (
    <div className={`group relative border-l-4 ${roleColor[role]} rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-accent/40 ${isDragging ? 'shadow-lg ring-2 ring-primary/30' : ''}`}>
      <div className="flex items-start gap-2.5">
        {dragHandleProps && (
          <div {...dragHandleProps} className="mt-0.5 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>drag_indicator</span>
          </div>
        )}
        <div className="flex-1 min-w-0" onClick={onSelect} role="button" tabIndex={0}>
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${roleBadge[role]}`}>
                  <span className="material-symbols-outlined" style={{ fontSize: 11 }}>{roleIcon[role]}</span>
                  {role}
                </span>
                <span className="min-w-0 truncate text-sm font-semibold leading-5">{step.name}</span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <StepAgentLabel agentName={step.agent} availableAgents={availableAgents} />
                {step.task ? (
                  <span className="min-w-0 flex-1 truncate" title={step.task}>
                    {step.task}
                  </span>
                ) : (
                  <span className="text-muted-foreground/70">未填写任务说明</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-0.5 rounded-md border border-border/60 bg-background/75 p-0.5 text-muted-foreground shadow-sm opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {mergeActions}
              <Button variant="ghost" size="icon" className="h-6 w-6" title="编辑"
                onClick={(e) => { e.stopPropagation(); onSelect(); }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>edit</span>
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" title="删除"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
              </Button>
            </div>
          </div>
      </div>
    </div>
    </div>
  );
}

/* ─── Sortable Step Card (single step, not in parallel group) ─── */
function SortableStepCard({ step, phaseIndex, stepIndex, availableAgents, mergeActions, onSelect, onDelete }: {
  step: Step; phaseIndex: number; stepIndex: number;
  availableAgents?: AgentAvatarSource[];
  mergeActions?: React.ReactNode;
  onSelect: () => void; onDelete: () => void;
}) {
  const id = `${phaseIndex}-${stepIndex}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style}>
      <StepCard step={step} availableAgents={availableAgents} dragHandleProps={{ ...attributes, ...listeners }}
        mergeActions={mergeActions} onSelect={onSelect} onDelete={onDelete} isDragging={isDragging} />
    </div>
  );
}

/* ─── Sortable Parallel Group (moves as a unit) ─── */
function SortableParallelGroup({ phaseIndex, groupSteps, availableAgents, onSelectNode, onDeleteStep, onUngroup, mergeActions }: {
  phaseIndex: number;
  groupSteps: { step: Step; si: number }[];
  availableAgents?: AgentAvatarSource[];
  onSelectNode: (type: 'phase' | 'step', pi: number, si?: number) => void;
  onDeleteStep: (pi: number, si: number) => void;
  onUngroup: (pi: number, si: number) => void;
  mergeActions?: React.ReactNode;
}) {
  const firstSi = groupSteps[0].si;
  const id = `group-${phaseIndex}-${firstSi}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style}>
      <div className={`rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-2 space-y-1 ${isDragging ? 'shadow-lg ring-2 ring-primary/30' : ''}`}>
        <div className="flex items-center gap-2 px-2 pb-1">
          <div {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing">
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>drag_indicator</span>
          </div>
          <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">并行执行</span>
          <div className="ml-auto flex gap-0.5">
            {mergeActions}
            <Button variant="ghost" size="icon" className="h-5 w-5" title="取消并行"
              onClick={() => onUngroup(phaseIndex, firstSi)}>
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 12 }}>call_split</span>
            </Button>
          </div>
        </div>
        {groupSteps.map(({ step, si }) => (
          <StepCard key={si} step={step} availableAgents={availableAgents}
            onSelect={() => onSelectNode('step', phaseIndex, si)}
            onDelete={() => onDeleteStep(phaseIndex, si)} />
        ))}
      </div>
    </div>
  );
}

/* ─── Empty Phase Drop Zone ─── */
function EmptyPhaseDropZone({ phaseIndex }: { phaseIndex: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `phase-drop-${phaseIndex}` });
  return (
    <div ref={setNodeRef}
      className={`py-8 text-center text-xs text-muted-foreground border-2 border-dashed rounded-lg transition-colors
        ${isOver ? 'border-primary bg-primary/10' : 'border-muted-foreground/20'}`}>
      拖放步骤到此处
    </div>
  );
}

/* ─── Overlay cards for DragOverlay ─── */
function StepCardOverlay({ step, availableAgents }: { step: Step; availableAgents?: AgentAvatarSource[] }) {
  const role = step.role || 'defender';
  return (
    <div className={`border-l-4 ${roleColor[role]} rounded-lg border border-border bg-card px-3 py-2.5 shadow-xl ring-2 ring-primary/30 w-[300px]`}>
      <div className="flex items-start gap-2.5">
        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${roleBadge[role]}`}>
          <span className="material-symbols-outlined" style={{ fontSize: 11 }}>{roleIcon[role]}</span>
          {role}
        </span>
        <span className="min-w-0 truncate text-sm font-semibold leading-5">{step.name}</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <StepAgentLabel agentName={step.agent} availableAgents={availableAgents} />
      </div>
    </div>
  );
}

function ParallelGroupOverlay({ steps, availableAgents }: { steps: Step[]; availableAgents?: AgentAvatarSource[] }) {
  return (
    <div className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-2 space-y-1 shadow-xl ring-2 ring-primary/30 w-[300px]">
      <div className="text-[10px] font-semibold text-primary uppercase tracking-wider px-2 pb-1">并行执行 ({steps.length})</div>
      {steps.map((step, i) => {
        const role = step.role || 'defender';
        return (
          <div key={i} className={`border-l-4 ${roleColor[role]} rounded-lg border border-border bg-card p-2`}>
            <div className="flex items-center gap-2">
              <StepAgentAvatar agentName={step.agent} availableAgents={availableAgents} className="h-4 w-4" />
              <span className="min-w-0 truncate text-xs font-medium">{step.name}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Insert Button ─── */
function InsertButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex justify-center py-0.5">
      <button onClick={onClick}
        className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/30 flex items-center justify-center text-muted-foreground/40 hover:border-primary hover:bg-primary hover:text-primary-foreground transition-all">
        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>add</span>
      </button>
    </div>
  );
}

/* ─── Group consecutive steps with same parallelGroup ─── */
function groupSteps(steps: Step[]) {
  const groups: Array<{ parallel: boolean; groupId?: string; steps: { step: Step; si: number }[] }> = [];
  let i = 0;
  while (i < steps.length) {
    const pg = steps[i].parallelGroup;
    if (pg) {
      const group: { step: Step; si: number }[] = [];
      while (i < steps.length && steps[i].parallelGroup === pg) {
        group.push({ step: steps[i], si: i });
        i++;
      }
      groups.push({ parallel: true, groupId: pg, steps: group });
    } else {
      groups.push({ parallel: false, steps: [{ step: steps[i], si: i }] });
      i++;
    }
  }
  return groups;
}

/* ─── Main Design Panel ─── */
export default function DesignPanel({
  workflow, availableAgents, onSelectNode, onAddPhase, onAddStep, onAddStepAt,
  onDeletePhase, onDeleteStep, onMoveStep, onToggleParallel, onUngroup,
  onCrossPhaseMove, onMoveGroup, onJoinGroup,
}: DesignPanelProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [activeId, setActiveId] = useState<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeStr = active.id as string;
    const overStr = over.id as string;

    // Drop onto empty phase
    if (overStr.startsWith('phase-drop-')) {
      const toPhase = parseInt(overStr.split('-')[2]);
      if (activeStr.startsWith('group-')) {
        const [, fromPhaseStr, fromSiStr] = activeStr.split('-');
        onMoveGroup(Number(fromPhaseStr), Number(fromSiStr), toPhase, 0);
      } else {
        const [fromPhase, fromIndex] = activeStr.split('-').map(Number);
        onCrossPhaseMove(fromPhase, fromIndex, toPhase, 0);
      }
      return;
    }

    // Parse target
    let toPhase: number, toIndex: number;
    if (overStr.startsWith('group-')) {
      const parts = overStr.split('-');
      toPhase = Number(parts[1]);
      toIndex = Number(parts[2]);
    } else {
      [toPhase, toIndex] = overStr.split('-').map(Number);
    }

    if (activeStr.startsWith('group-')) {
      const [, fromPhaseStr, fromSiStr] = activeStr.split('-');
      const fromPhase = Number(fromPhaseStr);
      const fromSi = Number(fromSiStr);
      if (fromPhase === toPhase) {
        onMoveGroup(fromPhase, fromSi, toPhase, toIndex);
      } else {
        onMoveGroup(fromPhase, fromSi, toPhase, toIndex);
      }
    } else {
      const [fromPhase, fromIndex] = activeStr.split('-').map(Number);
      if (fromPhase === toPhase) {
        onMoveStep(fromPhase, fromIndex, toIndex);
      } else {
        onCrossPhaseMove(fromPhase, fromIndex, toPhase, toIndex);
      }
    }
  }, [onMoveStep, onCrossPhaseMove, onMoveGroup]);

  // Derive overlay content from activeId
  const getOverlayContent = () => {
    if (!activeId) return null;
    if (activeId.startsWith('group-')) {
      const [, piStr, siStr] = activeId.split('-');
      const pi = Number(piStr);
      const si = Number(siStr);
      const phase = workflow.phases[pi];
      if (!phase) return null;
      const groupId = phase.steps[si]?.parallelGroup;
      if (!groupId) return null;
      const steps: Step[] = [];
      let i = si;
      while (i < phase.steps.length && phase.steps[i].parallelGroup === groupId) {
        steps.push(phase.steps[i]);
        i++;
      }
      return <ParallelGroupOverlay steps={steps} availableAgents={availableAgents} />;
    }
    const [pi, si] = activeId.split('-').map(Number);
    const step = workflow.phases[pi]?.steps[si];
    return step ? <StepCardOverlay step={step} availableAgents={availableAgents} /> : null;
  };

  const COLUMN_W = 340;
  const GAP = 16;
  const PAD = 16;
  const phaseCount = workflow.phases.length + 1;
  const scrollRef = useRef<HTMLDivElement>(null);
  const totalContentW = phaseCount * (COLUMN_W + GAP) + PAD;

  // Minimap navigator state
  const TRACK_W = 320;
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumbLeft, setThumbLeft] = useState(0);
  const [thumbWidth, setThumbWidth] = useState(TRACK_W);
  const thumbDragRef = useRef<{ startX: number; startScrollLeft: number } | null>(null);

  // Sync thumb position from scroll container
  const syncThumb = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const { scrollLeft, scrollWidth, clientWidth } = container;
    const ratio = clientWidth / scrollWidth;
    const tw = Math.max(30, ratio * TRACK_W);
    const tl = scrollWidth > clientWidth ? (scrollLeft / (scrollWidth - clientWidth)) * (TRACK_W - tw) : 0;
    setThumbWidth(tw);
    setThumbLeft(tl);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    requestAnimationFrame(syncThumb);
    container.addEventListener('scroll', syncThumb, { passive: true });
    const ro = new ResizeObserver(syncThumb);
    ro.observe(container);
    return () => { container.removeEventListener('scroll', syncThumb); ro.disconnect(); };
  }, [syncThumb]);

  // Click on track background → jump scroll
  const onTrackClick = (e: React.MouseEvent) => {
    const container = scrollRef.current;
    const track = trackRef.current;
    if (!container || !track) return;
    if ((e.target as HTMLElement).closest('[data-phase-marker]')) return;
    const rect = track.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = clickX / TRACK_W;
    const targetScroll = ratio * container.scrollWidth - container.clientWidth / 2;
    container.scrollTo({ left: Math.max(0, targetScroll), behavior: 'smooth' });
  };

  // Drag on track (including thumb area) to scroll
  const onTrackPointerDown = (e: React.PointerEvent) => {
    // If clicking a phase marker, don't start drag
    if ((e.target as HTMLElement).closest('[data-phase-marker]')) return;
    const container = scrollRef.current;
    if (!container) return;
    thumbDragRef.current = { startX: e.clientX, startScrollLeft: container.scrollLeft };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onTrackPointerMove = (e: React.PointerEvent) => {
    if (!thumbDragRef.current) return;
    const container = scrollRef.current;
    if (!container) return;
    const dx = e.clientX - thumbDragRef.current.startX;
    const scrollRange = container.scrollWidth - container.clientWidth;
    const trackRange = TRACK_W - thumbWidth;
    if (trackRange <= 0) return;
    const scrollDx = (dx / trackRange) * scrollRange;
    container.scrollLeft = thumbDragRef.current.startScrollLeft + scrollDx;
  };
  const onTrackPointerUp = () => { thumbDragRef.current = null; };

  // Click phase marker → scroll to that phase
  const scrollToPhase = (index: number) => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({ left: Math.max(0, PAD + index * (COLUMN_W + GAP)), behavior: 'smooth' });
  };

  // Phase marker positions on the track (center of each phase column mapped to track)
  const phaseMarkerPositions = workflow.phases.map((_, pi) => {
    const centerInContent = PAD + pi * (COLUMN_W + GAP) + COLUMN_W / 2;
    return (centerInContent / totalContentW) * TRACK_W;
  });

  // Compute merge actions for each step/group
  const computeMergeActions = (phase: Phase, pi: number, si: number, isLastInGroup: boolean, isInGroup: boolean) => {
    const steps = phase.steps;
    const step = steps[si];
    const prevStep = si > 0 ? steps[si - 1] : null;
    const nextStep = si < steps.length - 1 ? steps[si + 1] : null;
    const actions: React.ReactNode[] = [];

    if (!isInGroup) {
      // Non-grouped step: can merge down with next non-grouped step
      if (nextStep && !nextStep.parallelGroup) {
        actions.push(
          <Button key="merge" variant="ghost" size="icon" className="h-6 w-6" title="与下一步并行"
            onClick={(e) => { e.stopPropagation(); onToggleParallel(pi, [si, si + 1]); }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>call_merge</span>
          </Button>
        );
      }
      // Can join group below
      if (nextStep?.parallelGroup) {
        actions.push(
          <Button key="join-below" variant="ghost" size="icon" className="h-6 w-6" title="加入下方并行组"
            onClick={(e) => { e.stopPropagation(); onJoinGroup(pi, si, nextStep.parallelGroup!); }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>group_add</span>
          </Button>
        );
      }
      // Can join group above
      if (prevStep?.parallelGroup) {
        actions.push(
          <Button key="join-above" variant="ghost" size="icon" className="h-6 w-6" title="加入上方并行组"
            onClick={(e) => { e.stopPropagation(); onJoinGroup(pi, si, prevStep.parallelGroup!); }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>group_add</span>
          </Button>
        );
      }
    }
    return actions.length > 0 ? <>{actions}</> : undefined;
  };

  // Compute merge actions for a parallel group (extend down)
  const computeGroupMergeActions = (phase: Phase, pi: number, lastSi: number) => {
    const nextStep = lastSi < phase.steps.length - 1 ? phase.steps[lastSi + 1] : null;
    const groupId = phase.steps[lastSi]?.parallelGroup;
    if (nextStep && !nextStep.parallelGroup && groupId) {
      return (
        <Button variant="ghost" size="icon" className="h-5 w-5" title="将下一步加入并行组"
          onClick={(e) => { e.stopPropagation(); onJoinGroup(pi, lastSi + 1, groupId); }}>
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>group_add</span>
        </Button>
      );
    }
    return undefined;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Minimap scroll navigator */}
      <div className="shrink-0 border-b bg-muted/30 px-4 py-2 flex items-center gap-3 select-none">
        {/* Track */}
        <div ref={trackRef} className="relative rounded-full bg-muted border cursor-grab active:cursor-grabbing"
          style={{ width: TRACK_W, height: 28 }} onClick={onTrackClick}
          onPointerDown={onTrackPointerDown} onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp} onPointerCancel={onTrackPointerUp}>
          {/* Phase markers */}
          {workflow.phases.map((phase, pi) => {
            const x = phaseMarkerPositions[pi];
            const hasOverflow = thumbWidth < TRACK_W - 1;
            const insideThumb = hasOverflow && x >= thumbLeft && x <= thumbLeft + thumbWidth;
            return (
              <div key={pi} data-phase-marker className="absolute top-0 bottom-0 flex items-center justify-center z-20"
                style={{ left: x, transform: 'translateX(-50%)' }}
                onClick={(e) => { e.stopPropagation(); scrollToPhase(pi); }}>
                <span className={`text-[9px] font-bold cursor-pointer px-1 rounded transition-colors ${
                  insideThumb ? 'text-primary font-extrabold' : 'text-muted-foreground/60 hover:text-foreground'
                }`} title={phase.name}>
                  {pi + 1}
                </span>
              </div>
            );
          })}
          {/* Thumb (visible viewport indicator) — purely visual, pointer-events-none */}
          <div className="absolute top-0 bottom-0 rounded-full bg-primary/20 border border-primary/40 pointer-events-none z-10"
            style={{ left: thumbLeft, width: thumbWidth }} />
        </div>
        {/* Add phase button */}
        <button onClick={() => onAddPhase(workflow.phases.length - 1)}
          className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-primary transition-colors"
          title="添加阶段">
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
        </button>
      </div>

      {/* Scrollable columns with single DndContext */}
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden thin-scrollbar"
          style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="flex h-full gap-4 p-4" style={{ width: `${totalContentW}px` }}>

            {workflow.phases.map((phase, pi) => {
              const stepGroups = groupSteps(phase.steps);
              // Build sortable IDs: groups get group-pi-firstSi, singles get pi-si
              const sortableIds = stepGroups.map(g =>
                g.parallel ? `group-${pi}-${g.steps[0].si}` : `${pi}-${g.steps[0].si}`
              );

              return (
                <div key={pi} data-phase-index={pi} style={{ width: COLUMN_W }} className="shrink-0 overflow-y-auto flex flex-col">
                  <div className="rounded-xl border bg-card overflow-hidden flex flex-col">
                    {/* Phase header */}
                    <div className="flex items-center gap-3 px-4 py-3 bg-muted/50 border-b cursor-pointer"
                      onClick={() => onSelectNode('phase', pi)}>
                      <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">
                        {pi + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm truncate">{phase.name}</span>
                          {phase.iteration?.enabled && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              <span className="material-symbols-outlined mr-0.5" style={{ fontSize: 11 }}>loop</span>
                              max {phase.iteration.maxIterations}
                            </Badge>
                          )}
                          {phase.checkpoint && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-500/50 text-orange-600 dark:text-orange-400">
                              <span className="material-symbols-outlined mr-0.5" style={{ fontSize: 11 }}>pan_tool</span>
                              检查点
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">{phase.steps.length} 步骤</span>
                      </div>
                      <div className="flex gap-0.5 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="编辑阶段"
                          onClick={(e) => { e.stopPropagation(); onSelectNode('phase', pi); }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>edit</span>
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="删除阶段"
                          onClick={(e) => { e.stopPropagation(); onDeletePhase(pi); }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                        </Button>
                      </div>
                    </div>

                    {/* Steps list */}
                    <div className="p-3 space-y-1 flex-1 overflow-y-auto">
                      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                        {phase.steps.length === 0 && <EmptyPhaseDropZone phaseIndex={pi} />}
                        {stepGroups.map((group, gi) => {
                          if (group.parallel) {
                            const lastSi = group.steps[group.steps.length - 1].si;
                            const groupMerge = computeGroupMergeActions(phase, pi, lastSi);
                            return (
                              <div key={`pg-${gi}`}>
                                {gi > 0 && <InsertButton onClick={() => onAddStepAt(pi, group.steps[0].si - 1)} />}
                                <SortableParallelGroup phaseIndex={pi} groupSteps={group.steps}
                                  availableAgents={availableAgents}
                                  onSelectNode={onSelectNode} onDeleteStep={onDeleteStep} onUngroup={onUngroup}
                                  mergeActions={groupMerge} />
                              </div>
                            );
                          } else {
                            const { step, si } = group.steps[0];
                            const mergeActions = computeMergeActions(phase, pi, si, false, false);
                            return (
                              <div key={`s-${si}`}>
                                {gi > 0 && <InsertButton onClick={() => onAddStepAt(pi, si - 1)} />}
                                <SortableStepCard step={step} phaseIndex={pi} stepIndex={si}
                                  availableAgents={availableAgents}
                                  mergeActions={mergeActions}
                                  onSelect={() => onSelectNode('step', pi, si)}
                                  onDelete={() => onDeleteStep(pi, si)} />
                              </div>
                            );
                          }
                        })}
                      </SortableContext>

                      <button onClick={() => onAddStep(pi)}
                        className="w-full mt-2 py-2 rounded-lg border border-dashed border-muted-foreground/30 text-muted-foreground text-xs flex items-center justify-center gap-1 hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors">
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>add</span>
                        添加步骤
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Add phase column */}
            <div style={{ width: COLUMN_W }} className="shrink-0 flex items-start justify-center pt-8">
              <button onClick={() => onAddPhase(workflow.phases.length - 1)}
                className="px-6 py-4 rounded-xl border-2 border-dashed border-muted-foreground/30 text-muted-foreground flex flex-col items-center gap-2 hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors">
                <span className="material-symbols-outlined" style={{ fontSize: 28 }}>add_circle</span>
                <span className="text-sm">添加阶段</span>
              </button>
            </div>
          </div>
        </div>
        <DragOverlay>{getOverlayContent()}</DragOverlay>
      </DndContext>
    </div>
  );
}
