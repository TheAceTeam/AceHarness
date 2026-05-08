'use client';

import { useCallback, useMemo, useEffect, useRef } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlowInstance,
  MarkerType,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import styles from './FlowDiagram.module.css';

// --- SVG status & role icons ---
const IconCheck = () => (
  <svg className={styles.statusIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" fill="#6a8759" opacity="0.2" />
    <circle cx="8" cy="8" r="7" stroke="#6a8759" strokeWidth="1.5" fill="none" />
    <path d="M4.5 8.2 7 10.5 11.5 5.5" stroke="#6a8759" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);
const IconFail = () => (
  <svg className={styles.statusIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" fill="#c75450" opacity="0.2" />
    <circle cx="8" cy="8" r="7" stroke="#c75450" strokeWidth="1.5" fill="none" />
    <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#c75450" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const IconRunning = () => (
  <svg className={`${styles.statusIcon} ${styles.spinIcon}`} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="6.5" stroke="#4a88c7" strokeWidth="1.5" opacity="0.25" fill="none" />
    <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" stroke="#4a88c7" strokeWidth="1.8" strokeLinecap="round" fill="none" />
  </svg>
);
const IconPending = () => (
  <svg className={styles.statusIcon} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" stroke="#515151" strokeWidth="1.5" fill="none" />
    <circle cx="5.5" cy="8" r="1" fill="#515151" />
    <circle cx="8" cy="8" r="1" fill="#515151" />
    <circle cx="10.5" cy="8" r="1" fill="#515151" />
  </svg>
);
const IconAttacker = () => (
  <svg className={styles.roleBadge} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5 L10 6 L15 6.5 L11 10 L12.5 15 L8 12 L3.5 15 L5 10 L1 6.5 L6 6 Z" fill="#cc7832" opacity="0.25" stroke="#cc7832" strokeWidth="1" />
    <path d="M8 4v5M6 7h4" stroke="#cc7832" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const IconDefender = () => (
  <svg className={styles.roleBadge} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5C5.5 3 3 3.5 3 3.5s0 4.5 1.5 7c1 1.7 2.5 3 3.5 3.5 1-.5 2.5-1.8 3.5-3.5C13 8 13 3.5 13 3.5S10.5 3 8 1.5z" fill="#6897bb" opacity="0.2" stroke="#6897bb" strokeWidth="1.2" />
    <path d="M6.5 8.2 7.8 9.5 10 6.5" stroke="#6897bb" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);
const IconJudge = () => (
  <svg className={styles.roleBadge} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M3 8h10M8 3v10" stroke="#ffc66d" strokeWidth="0.8" opacity="0.3" />
    <circle cx="8" cy="8" r="6" stroke="#ffc66d" strokeWidth="1.2" fill="none" />
    <path d="M5 6.5 L8 4 L11 6.5" stroke="#ffc66d" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <rect x="5" y="8" width="6" height="3" rx="0.5" stroke="#ffc66d" strokeWidth="1" fill="#ffc66d" opacity="0.2" />
    <path d="M8 8v3" stroke="#ffc66d" strokeWidth="0.8" />
  </svg>
);
const IconAgent = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
    <rect x="3" y="2" width="8" height="6" rx="2" stroke="#808080" strokeWidth="1.2" fill="none" />
    <circle cx="5.5" cy="5" r="0.8" fill="#808080" />
    <circle cx="8.5" cy="5" r="0.8" fill="#808080" />
    <path d="M4 10c0-1.1.9-2 2-2h2c1.1 0 2 .9 2 2v1.5H4V10z" stroke="#808080" strokeWidth="1" fill="none" />
  </svg>
);

interface Step {
  name: string;
  agent: string;
  task: string;
  role?: 'attacker' | 'defender' | 'judge';
  parallelGroup?: string;
}

interface IterationConfig {
  enabled: boolean;
  maxIterations: number;
  exitCondition: string;
  consecutiveCleanRounds: number;
  escalateToHuman: boolean;
}

interface Phase {
  name: string;
  steps: Step[];
  checkpoint?: { name: string; message: string };
  iteration?: IterationConfig;
}

interface Workflow {
  name: string;
  description?: string;
  phases: Phase[];
}

interface Agent {
  name: string;
  team: string;
}

interface IterationStateInfo {
  phaseName: string;
  currentIteration: number;
  maxIterations: number;
  status: string;
}

interface FlowDiagramProps {
  workflow: Workflow;
  currentPhase: string;
  currentStep: string;
  agents: Agent[];
  completedSteps: string[];
  failedSteps?: string[];
  iterationStates?: Record<string, IterationStateInfo>;
  onSelectStep: (step: Step) => void;
  onSelectPhase?: (phase: Phase) => void;
  onSelectCheckpoint?: (checkpoint: { name: string; message: string }) => void;
  /** Phase name of the currently pending checkpoint (if any) */
  pendingCheckpointPhase?: string;
}

export default function FlowDiagram({
  workflow, currentPhase, currentStep, agents, completedSteps,
  failedSteps = [], iterationStates = {}, onSelectStep, onSelectPhase, onSelectCheckpoint, pendingCheckpointPhase,
}: FlowDiagramProps) {
  const getAgentTeam = (agentName: string) => {
    return agents?.find((a) => a.name === agentName)?.team || 'red';
  };

  const getStepStatus = (step: Step) => {
    if (failedSteps?.includes(step.name)) return 'failed';
    if (currentStep === step.name) return 'running';
    if (completedSteps?.includes(step.name)) return 'completed';
    return 'pending';
  };

  // Horizontal column layout: phases as columns, steps stacked vertically
  // Checkpoints placed horizontally between phase columns
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const colGap = 60;
    const checkpointGap = 40;
    const headerY = 0;
    const phaseHeaderH = 50;
    const stepNodeH = 90;
    const stepGap = 24;
    const stepNodeW = 220;
    const stepsStartY = phaseHeaderH + 30;
    const roundSeparatorH = 32; // height for "轮次 N" separator label

    // Helper: group consecutive steps with same parallelGroup
    const getStepGroups = (phase: Phase) => {
      const stepGroups: { steps: Step[]; parallelGroup?: string; startIndex: number }[] = [];
      let currentGroup: Step[] = [];
      let currentParallelGroup: string | undefined = undefined;
      let groupStartIndex = 0;

      phase.steps.forEach((step, idx) => {
        if (step.parallelGroup && step.parallelGroup === currentParallelGroup) {
          currentGroup.push(step);
        } else {
          if (currentGroup.length > 0) {
            stepGroups.push({ steps: currentGroup, parallelGroup: currentParallelGroup, startIndex: groupStartIndex });
          }
          currentGroup = [step];
          currentParallelGroup = step.parallelGroup;
          groupStartIndex = idx;
        }
      });
      if (currentGroup.length > 0) {
        stepGroups.push({ steps: currentGroup, parallelGroup: currentParallelGroup, startIndex: groupStartIndex });
      }
      return stepGroups;
    };

    // Count how many rounds to display for a phase
    const getRoundCount = (phase: Phase) => {
      const iterState = iterationStates[phase.name];
      if (!iterState || !phase.iteration?.enabled || iterState.currentIteration <= 1) return 1;
      return iterState.currentIteration;
    };

    // Pre-calculate group heights for checkpoint vertical centering
    // Full heights include all iteration rounds (for group background boxes)
    const groupHeights: number[] = workflow.phases.map((phase) => {
      const stepGroups = getStepGroups(phase);
      const rowCount = stepGroups.length;
      const rounds = getRoundCount(phase);
      // Each round has rowCount rows + a separator (except the first round)
      const totalRows = rowCount * rounds;
      const separators = rounds > 1 ? rounds - 1 : 0;
      const lastStepBottom = totalRows > 0
        ? stepsStartY + (totalRows - 1) * (stepNodeH + stepGap) + stepNodeH + separators * roundSeparatorH
        : stepsStartY;
      return lastStepBottom + 15;
    });

    // Base heights (first round only) for checkpoint positioning — not stretched by iterations
    const baseGroupHeights: number[] = workflow.phases.map((phase) => {
      const stepGroups = getStepGroups(phase);
      const rowCount = stepGroups.length;
      const lastStepBottom = rowCount > 0
        ? stepsStartY + (rowCount - 1) * (stepNodeH + stepGap) + stepNodeH
        : stepsStartY;
      return lastStepBottom + 15;
    });

    // Calculate X positions accounting for checkpoints between phases
    const phaseXPositions: number[] = [];
    let currentX = 0;
    workflow.phases.forEach((phase, pi) => {
      phaseXPositions.push(currentX);
      currentX += stepNodeW;
      // If this phase has a checkpoint, add space for it
      if (phase.checkpoint) {
        currentX += checkpointGap + 50 + checkpointGap; // gap + checkpoint width + gap
      } else {
        currentX += colGap;
      }
    });

    workflow.phases.forEach((phase, pi) => {
      const phaseId = `phase-${pi}`;
      const colX = phaseXPositions[pi];
      const isActive = currentPhase === phase.name;
      const isDone = phase.steps.every((s) => completedSteps?.includes(s.name));
      const iterState = iterationStates[phase.name];
      const isIterative = phase.iteration?.enabled;

      // Phase header node
      nodes.push({
        id: phaseId,
        type: 'default',
        position: { x: colX, y: headerY },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          label: (
            <div className={`${styles.phaseNode} ${isActive ? styles.activePhase : ''}`}>
              <div className={styles.phaseNumber}>{pi + 1}</div>
              <div className={styles.phaseName}>{phase.name}</div>
              {isIterative && (
                <div className={styles.iterationBadge}>
                  <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>loop</span>
                  {iterState ? `${iterState.currentIteration}/${iterState.maxIterations}` : `max ${phase.iteration!.maxIterations}`}
                </div>
              )}
            </div>
          ),
          phase,
        },
        style: {
          background: isActive ? 'hsl(var(--primary) / 0.2)' : isDone ? 'hsl(var(--flow-success) / 0.2)' : 'hsl(var(--flow-node-bg))',
          borderTop: isActive ? '2px solid hsl(var(--primary))' : isDone ? '2px solid hsl(var(--flow-success))' : '2px solid hsl(var(--flow-node-border))',
          borderRight: isActive ? '2px solid hsl(var(--primary))' : isDone ? '2px solid hsl(var(--flow-success))' : '2px solid hsl(var(--flow-node-border))',
          borderBottom: isActive ? '2px solid hsl(var(--primary))' : isDone ? '2px solid hsl(var(--flow-success))' : '2px solid hsl(var(--flow-node-border))',
          borderLeft: isActive ? '4px solid hsl(var(--primary))' : isDone ? '4px solid hsl(var(--flow-success))' : '4px solid hsl(var(--primary))',
          borderRadius: '6px',
          padding: '10px 14px',
          width: stepNodeW,
          minHeight: 50,
          cursor: 'pointer',
        },
        zIndex: 2,
      });

      // Checkpoint between this phase and next (placed at vertical center of group boxes)
      if (phase.checkpoint && pi < workflow.phases.length - 1) {
        const cpId = `checkpoint-${pi}`;
        const cpX = colX + stepNodeW + checkpointGap;
        const maxGroupH = Math.max(baseGroupHeights[pi], baseGroupHeights[pi + 1] || 0);
        const anchorCenterY = (maxGroupH - 10) / 2; // vertical center based on first-round height

        // Invisible anchor on right edge of current group
        const anchorLeftId = `anchor-left-${pi}`;
        nodes.push({
          id: anchorLeftId,
          type: 'default',
          position: { x: colX + stepNodeW + 10, y: anchorCenterY },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: { label: '' },
          style: { width: 1, height: 1, background: 'transparent', border: 'none', padding: 0, opacity: 0 },
          zIndex: 0,
          selectable: false,
          draggable: false,
        });

        // Checkpoint node — offset upward so its vertical center aligns with anchors
        const cpEstimatedH = 82; // approximate rendered height of checkpoint node
        const isPendingCp = pendingCheckpointPhase === phase.name;
        nodes.push({
          id: cpId,
          type: 'default',
          position: { x: cpX, y: anchorCenterY - cpEstimatedH / 2 },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: { label: <div className={styles.checkpointNode}><span className="material-symbols-outlined" style={{fontSize:14,verticalAlign:'middle'}}>person</span> {phase.checkpoint.name}</div>, checkpoint: isPendingCp ? phase.checkpoint : undefined },
          style: {
            background: isPendingCp ? 'hsl(var(--flow-warning) / 0.15)' : 'hsl(var(--flow-node-bg))',
            border: `2px solid ${isPendingCp ? 'hsl(var(--flow-warning))' : 'hsl(var(--muted-foreground) / 0.4)'}`,
            borderRadius: '4px',
            padding: '6px 8px',
            width: 50,
            textAlign: 'center' as const,
            lineHeight: '1.4',
            fontSize: '12px',
            cursor: isPendingCp ? 'pointer' : 'default',
            opacity: isPendingCp ? 1 : 0.5,
          },
          zIndex: 2,
        });

        // Invisible anchor on left edge of next group
        const nextColX = phaseXPositions[pi + 1];
        const anchorRightId = `anchor-right-${pi}`;
        nodes.push({
          id: anchorRightId,
          type: 'default',
          position: { x: nextColX - 11, y: anchorCenterY },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: { label: '' },
          style: { width: 1, height: 1, background: 'transparent', border: 'none', padding: 0, opacity: 0 },
          zIndex: 0,
          selectable: false,
          draggable: false,
        });

        // Edge: left anchor → checkpoint
        edges.push({
          id: `${anchorLeftId}-${cpId}`,
          source: anchorLeftId, target: cpId,
          type: 'straight',
          style: { stroke: 'hsl(var(--flow-warning))', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--flow-warning))' },
        });
        // Edge: checkpoint → right anchor
        edges.push({
          id: `${cpId}-${anchorRightId}`,
          source: cpId, target: anchorRightId,
          type: 'straight',
          style: { stroke: 'hsl(var(--primary))', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--primary))' },
        });
      } else if (pi < workflow.phases.length - 1 && !phase.checkpoint) {
        // Direct inter-phase edge (horizontal)
        edges.push({
          id: `inter-${pi}-${pi + 1}`,
          source: phaseId, target: `phase-${pi + 1}`,
          type: 'smoothstep',
          animated: isActive,
          style: { stroke: isDone ? 'hsl(var(--flow-success))' : 'hsl(var(--primary))', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: isDone ? 'hsl(var(--flow-success))' : 'hsl(var(--primary))' },
        });
      }

      // Steps vertically below header — with iteration round duplication
      const stepGroups = getStepGroups(phase);
      const rounds = getRoundCount(phase);

      for (let round = 0; round < rounds; round++) {
        const roundOffset = round > 0
          ? round * stepGroups.length * (stepNodeH + stepGap) + round * roundSeparatorH
          : 0;

        // Round separator label
        if (round > 0) {
          const sepY = stepsStartY + round * stepGroups.length * (stepNodeH + stepGap) + (round - 1) * roundSeparatorH;
          nodes.push({
            id: `round-sep-${pi}-${round}`,
            type: 'default',
            position: { x: colX, y: sepY },
            data: {
              label: (
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'hsl(var(--primary))', textAlign: 'center' }}>
                  ── 轮次 {round + 1} ──
                </div>
              ),
            },
            style: {
              background: 'transparent',
              border: 'none',
              padding: '4px 0',
              width: stepNodeW,
              pointerEvents: 'none' as const,
            },
            zIndex: 2,
            selectable: false,
            draggable: false,
            connectable: false,
          });
        }

        // Render each group for this round
        stepGroups.forEach((group, groupIdx) => {
          const groupY = stepsStartY + roundOffset + groupIdx * (stepNodeH + stepGap);
          const isParallel = group.parallelGroup && group.steps.length > 1;
          const roundSuffix = rounds > 1 ? ` (轮次 ${round + 1})` : '';
          const idSuffix = round > 0 ? `-r${round}` : '';
          // For iteration rounds >= 2, step names in completedSteps/failedSteps have "-迭代N" suffix
          const iterNameSuffix = round > 0 ? `-迭代${round + 1}` : '';

          if (isParallel) {
            // Render parallel group container
            const parallelGap = 10;
            const totalWidth = group.steps.length * stepNodeW + (group.steps.length - 1) * parallelGap;
            const containerPadding = 12;
            const containerX = colX - containerPadding;
            const containerY = groupY - containerPadding;
            const containerW = totalWidth + 2 * containerPadding;
            const containerH = stepNodeH + 2 * containerPadding;

            nodes.push({
              id: `parallel-container-${pi}-${groupIdx}${idSuffix}`,
              type: 'default',
              position: { x: containerX, y: containerY },
              data: {
                label: (
                  <div style={{
                    position: 'absolute',
                    top: '4px',
                    left: '8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'hsl(var(--primary))',
                    opacity: 0.7,
                  }}>
                    并行{roundSuffix}
                  </div>
                ),
              },
              style: {
                background: 'hsl(var(--primary) / 0.05)',
                border: '2px dashed hsl(var(--primary) / 0.3)',
                borderRadius: '8px',
                width: containerW,
                height: containerH,
                pointerEvents: 'none' as const,
              },
              zIndex: 0,
              selectable: false,
              draggable: false,
              connectable: false,
            });

            // Render steps horizontally
            group.steps.forEach((step, stepIdxInGroup) => {
              const iterStep = iterNameSuffix ? { ...step, name: `${step.name}${iterNameSuffix}` } : step;
              const stepId = `step-${pi}-${group.startIndex + stepIdxInGroup}${idSuffix}`;
              const status = round < rounds - 1
                ? (failedSteps?.includes(iterStep.name) ? 'failed' : 'completed')
                : getStepStatus(iterStep);
              const team = getAgentTeam(step.agent);
              const stepX = colX + stepIdxInGroup * (stepNodeW + parallelGap);
              const displayName = step.name + roundSuffix;

              nodes.push({
                id: stepId,
                type: 'default',
                position: { x: stepX, y: groupY },
                sourcePosition: Position.Bottom,
                targetPosition: Position.Top,
                data: {
                  label: (
                    <div className={`${styles.stepNode} ${styles[status]} ${styles[team]} ${status === 'running' ? styles.pulseGlow : ''}`}>
                      <div className={styles.stepHeader}>
                        {step.role ? (
                          <span className={`${styles.roleBadgeWrap} ${styles[step.role]}`}>
                            {step.role === 'attacker' ? <IconAttacker /> : step.role === 'judge' ? <IconJudge /> : <IconDefender />}
                          </span>
                        ) : (
                          <span className={styles.stepNumber}>{group.startIndex + stepIdxInGroup + 1}</span>
                        )}
                        <span className={styles.stepName}>{displayName}</span>
                        {status === 'completed' && <IconCheck />}
                        {status === 'failed' && <IconFail />}
                        {status === 'running' && <IconRunning />}
                        {status === 'pending' && <IconPending />}
                      </div>
                      <div className={styles.stepAgent}>
                        <IconAgent />
                        <span>{step.agent}</span>
                      </div>
                      {status === 'running' && (
                        <div className={styles.stepProgress}><div className={styles.progressBar}></div></div>
                      )}
                    </div>
                  ),
                  step: iterStep,
                },
                style: { background: 'transparent', border: 'none', padding: 0, width: stepNodeW, cursor: 'pointer' },
                zIndex: 1,
              });
            });

            // Edges from previous group in this round
            if (groupIdx > 0) {
              const prevGroup = stepGroups[groupIdx - 1];
              prevGroup.steps.forEach((prevStep, prevStepIdx) => {
                const prevStepId = `step-${pi}-${prevGroup.startIndex + prevStepIdx}${idSuffix}`;
                group.steps.forEach((step, stepIdxInGroup) => {
                  const stepId = `step-${pi}-${group.startIndex + stepIdxInGroup}${idSuffix}`;
                  const status = round < rounds - 1 ? 'completed' : getStepStatus(step);
                  const roleColor = step.role === 'attacker' ? 'hsl(var(--flow-attacker))' : step.role === 'judge' ? 'hsl(var(--flow-judge))' : 'hsl(var(--flow-defender))';
                  edges.push({
                    id: `${prevStepId}-${stepId}`,
                    source: prevStepId,
                    target: stepId,
                    type: 'smoothstep',
                    animated: status === 'running',
                    style: { stroke: roleColor, strokeWidth: 2 },
                    markerEnd: { type: MarkerType.ArrowClosed, color: roleColor },
                  });
                });
              });
            }
          } else {
            // Single step (not parallel)
            const step = group.steps[0];
            const iterStep = iterNameSuffix ? { ...step, name: `${step.name}${iterNameSuffix}` } : step;
            const stepId = `step-${pi}-${group.startIndex}${idSuffix}`;
            const status = round < rounds - 1
              ? (failedSteps?.includes(iterStep.name) ? 'failed' : 'completed')
              : getStepStatus(iterStep);
            const team = getAgentTeam(step.agent);
            const roleColor = step.role === 'attacker' ? 'hsl(var(--flow-attacker))' : step.role === 'judge' ? 'hsl(var(--flow-judge))' : 'hsl(var(--flow-defender))';
            const displayName = step.name + roundSuffix;

            nodes.push({
              id: stepId,
              type: 'default',
              position: { x: colX, y: groupY },
              sourcePosition: Position.Bottom,
              targetPosition: Position.Top,
              data: {
                label: (
                  <div className={`${styles.stepNode} ${styles[status]} ${styles[team]} ${status === 'running' ? styles.pulseGlow : ''}`}>
                    <div className={styles.stepHeader}>
                      {step.role ? (
                        <span className={`${styles.roleBadgeWrap} ${styles[step.role]}`}>
                          {step.role === 'attacker' ? <IconAttacker /> : step.role === 'judge' ? <IconJudge /> : <IconDefender />}
                        </span>
                      ) : (
                        <span className={styles.stepNumber}>{group.startIndex + 1}</span>
                      )}
                      <span className={styles.stepName}>{displayName}</span>
                      {status === 'completed' && <IconCheck />}
                      {status === 'failed' && <IconFail />}
                      {status === 'running' && <IconRunning />}
                      {status === 'pending' && <IconPending />}
                    </div>
                    <div className={styles.stepAgent}>
                      <IconAgent />
                      <span>{step.agent}</span>
                    </div>
                    {status === 'running' && (
                      <div className={styles.stepProgress}><div className={styles.progressBar}></div></div>
                    )}
                  </div>
                ),
                step: iterStep,
              },
              style: { background: 'transparent', border: 'none', padding: 0, width: stepNodeW, cursor: 'pointer' },
              zIndex: 1,
            });

            // Edge from previous group in this round
            if (groupIdx > 0) {
              const prevGroup = stepGroups[groupIdx - 1];
              prevGroup.steps.forEach((prevStep, prevStepIdx) => {
                const prevStepId = `step-${pi}-${prevGroup.startIndex + prevStepIdx}${idSuffix}`;
                edges.push({
                  id: `${prevStepId}-${stepId}`,
                  source: prevStepId,
                  target: stepId,
                  type: 'smoothstep',
                  animated: status === 'running',
                  style: { stroke: roleColor, strokeWidth: 2 },
                  markerEnd: { type: MarkerType.ArrowClosed, color: roleColor },
                });
              });
            }
          }
        });

        // Edge connecting last step of previous round to first step of this round
        if (round > 0 && stepGroups.length > 0) {
          const lastGroup = stepGroups[stepGroups.length - 1];
          const firstGroup = stepGroups[0];
          const prevIdSuffix = round > 1 ? `-r${round - 1}` : '';
          const curIdSuffix = `-r${round}`;
          lastGroup.steps.forEach((prevStep, prevStepIdx) => {
            const prevStepId = `step-${pi}-${lastGroup.startIndex + prevStepIdx}${prevIdSuffix}`;
            firstGroup.steps.forEach((step, stepIdxInGroup) => {
              const stepId = `step-${pi}-${firstGroup.startIndex + stepIdxInGroup}${curIdSuffix}`;
              edges.push({
                id: `${prevStepId}-${stepId}`,
                source: prevStepId,
                target: stepId,
                type: 'smoothstep',
                animated: false,
                style: { stroke: 'hsl(var(--primary))', strokeWidth: 2, strokeDasharray: '6 3' },
                markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--primary))' },
              });
            });
          });
        }
      }

      // Group background box for this phase column
      const groupHeight = groupHeights[pi];
      nodes.push({
        id: `group-${pi}`,
        type: 'default',
        position: { x: colX - 10, y: headerY - 10 },
        data: { label: '' },
        style: {
          background: 'hsl(var(--flow-group-bg))',
          border: '1px dashed hsl(var(--flow-group-border))',
          borderRadius: '10px',
          width: stepNodeW + 20,
          height: groupHeight,
          pointerEvents: 'none' as const,
        },
        zIndex: -1,
        selectable: false,
        draggable: false,
        connectable: false,
      });
    });

    return { nodes, edges };
  }, [workflow, currentPhase, currentStep, completedSteps, failedSteps, agents, iterationStates]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const rfInstance = useRef<ReactFlowInstance | null>(null);
  // Track structural changes (node count) to only fitView when layout changes, not on status updates
  const prevNodeCountRef = useRef(initialNodes.length);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    // Only fitView when the number of nodes changes (new steps/rounds added), not on status updates
    if (rfInstance.current && initialNodes.length !== prevNodeCountRef.current) {
      setTimeout(() => rfInstance.current?.fitView({ padding: 0.2 }), 50);
    }
    prevNodeCountRef.current = initialNodes.length;
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      if (node.data.step) {
        onSelectStep(node.data.step);
      } else if (node.data.checkpoint && onSelectCheckpoint) {
        onSelectCheckpoint(node.data.checkpoint);
      } else if (node.data.phase && onSelectPhase) {
        onSelectPhase(node.data.phase);
      }
    },
    [onSelectStep, onSelectPhase, onSelectCheckpoint]
  );

  return (
    <div className={styles.flowContainer}>
      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onInit={(instance) => { rfInstance.current = instance; }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView={false}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.1}
        maxZoom={2}
        disableKeyboardA11y
        proOptions={{ hideAttribution: true }}
        attributionPosition="bottom-left"
      >
        <Background color="hsl(var(--flow-node-border))" gap={16} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            if (node.id.startsWith('phase')) return 'hsl(var(--primary))';
            if (node.id.startsWith('group')) return 'hsl(var(--primary) / 0.2)';
            if (node.id.startsWith('checkpoint')) return 'hsl(var(--flow-warning))';
            return 'hsl(var(--flow-step-bg))';
          }}
          maskColor="hsl(var(--background) / 0.6)"
        />
      </ReactFlow>
    </div>
  );
}
